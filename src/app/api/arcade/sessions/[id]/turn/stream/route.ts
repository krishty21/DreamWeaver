import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getRepository } from "@/lib/data/repository";
import { generateArcadeTurnStreaming } from "@/lib/ai";
import { applyDelta, endingText } from "@/lib/simulation";
import { computeMemoryEcho } from "@/lib/memory-graph";
import { acquireArcadeLock } from "@/lib/distributed-lock";
import { rateLimit, rateKey } from "@/lib/rate-limit";
import type { SimulationState, DreamLaw } from "@/lib/types";
import { z } from "zod";

// POST /api/arcade/sessions/[id]/turn/stream
// Same flow as POST /turn but emits Server-Sent Events:
//   data: {"type":"delta","text":"..."}\n\n   (zero or more)
//   data: {"type":"final","turn":...,"state":...,...}\n\n   (once, at end)
//   data: {"type":"error","error":"..."}\n\n   (on failure)
//
// The scene text streams to the client as the model produces it, so the user
// reads instead of staring at a shimmer. The full JSON is parsed at end and
// the authoritative state is applied — same as the non-streaming path.

const turnSchema = z.object({
  userAction: z.string().trim().max(800).optional(),
  choiceId: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const db = await getRepository();
  const session = await db.arcadeSession.findFirst({
    where: { id, userId },
    include: {
      dream: { include: { analysis: true, motifs: true } },
      turns: { orderBy: { turnNumber: "asc" } },
    },
  });
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (session.status === "ended") {
    return NextResponse.json({ error: "session ended", ending: session.ending }, { status: 409 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = turnSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  }

  // Determine the user's action text for this turn.
  const isOpening = session.turns.length === 0;
  let userAction = parsed.data.userAction?.trim() ?? "";
  if (parsed.data.choiceId) {
    const lastTurn = session.turns[session.turns.length - 1];
    if (lastTurn) {
      try {
        const choices = JSON.parse(lastTurn.choicesJson || "[]");
        const choice = choices.find((c: any) => c.id === parsed.data.choiceId);
        if (choice) userAction = userAction ? `${choice.label} — ${userAction}` : choice.label;
      } catch {
        // ignore malformed
      }
    }
  }
  if (!userAction && !isOpening) {
    return NextResponse.json({ error: "an action is required" }, { status: 400 });
  }
  const actionText = userAction || "I enter the dream.";

  // r12 — concurrency + rate-limit guard (see non-streaming route). For the
  // streaming path the lock lives across the whole background turn and is
  // released in the finally of the IIFE below. If a second request arrives
  // while the first is still streaming, it gets 409 and the client shows a
  // clear "a turn is already forming" message. The lock is DISTRIBUTED
  // (Firestore document + transaction) when DATA_BACKEND=firestore, so it
  // holds across Cloud Run instances; the in-memory lock is used for local
  // single-process dev.
  const lock = await acquireArcadeLock(session.id, { ttlMs: 90_000 });
  if (!lock.acquired) {
    return NextResponse.json(
      { error: "A turn for this dream is already forming. Let it settle before acting again." },
      { status: 409 }
    );
  }
  const rl = rateLimit(rateKey("arcade-turn", userId), { max: 30, windowMs: 60_000 });
  if (!rl.ok) {
    await lock.release();
    return NextResponse.json(
      { error: "You're moving through the dream a little too fast. Pause for a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  // Build authoritative current state.
  let state: SimulationState;
  try {
    state = JSON.parse(session.stateJson) as SimulationState;
    if (!state || typeof state.turn !== "number") state = { ...state, turn: session.turns.length };
  } catch {
    state = { fear: 25, lucidity: 40, stability: 70, agency: 35, turn: session.turns.length, discoveredMotifs: [], visitedScenes: [], inventory: [], phase: "opening" };
  }

  const history = session.turns.map((t) => ({
    userAction: t.userAction,
    sceneText: t.sceneText,
  }));

  const dreamMotifs = session.dream.motifs.map((m) => m.label);

  // r12 — Dream Laws + historical connections (see non-streaming turn route).
  let dreamLaws: DreamLaw[] = [];
  try {
    dreamLaws = JSON.parse(session.dream.analysis?.dreamLawsJson || "[]");
  } catch {
    dreamLaws = [];
  }
  const historicalConnections = (() => {
    try {
      const hc = JSON.parse(session.dream.analysis?.historicalConnectionsJson || "[]");
      return (Array.isArray(hc) ? hc : []).map((c: any) => ({
        motif: String(c.motif),
        priorDreamCount: Array.isArray(c.dreamIds) ? c.dreamIds.length : 0,
      }));
    } catch {
      return [];
    }
  })();

  // Set up the SSE response. We use a TransformStream so we can write text
  // chunks to the client as they arrive.
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  function send(obj: any) {
    writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
  }

  // Run the streaming turn in the background; the response returns the
  // readable end immediately so the client begins receiving deltas.
  (async () => {
    try {
      const { response, raw } = await generateArcadeTurnStreaming(
        {
          mode: session.mode as any,
          dream: { rawText: session.dream.rawText, analysis: session.dream.analysis },
          state,
          history,
          userAction: actionText,
          dreamMotifs,
          dreamLaws,
          historicalConnections,
        },
        (delta) => send({ type: "delta", text: delta })
      );

      // Apply the authoritative delta now that we have the full response.
      const { state: newState, applied, ending } = applyDelta(state, response.proposedDelta);

      const turnNumber = session.turns.length + 1;

      // r12 — selective MEMORY ECHO (see non-streaming route for the rule).
      let memoryEcho: Awaited<ReturnType<typeof computeMemoryEcho>> = null;
      const shouldConsiderEcho =
        historicalConnections.length > 0 &&
        turnNumber > 1 &&
        (turnNumber % 3 === 0 || response.discoveredMotifs.length > 0);
      if (shouldConsiderEcho) {
        const sceneText = response.sceneText.toLowerCase();
        const referenced = dreamMotifs.filter((m) => m && sceneText.includes(m.toLowerCase()));
        const candidates = Array.from(
          new Set([...response.discoveredMotifs, ...referenced])
        ).filter(Boolean);
        if (candidates.length > 0) {
          try {
            memoryEcho = await computeMemoryEcho({
              userId,
              currentDreamId: session.dreamId,
              sceneMotifs: candidates,
            });
          } catch (e) {
            console.warn("[arcade stream] memory echo failed (non-fatal):", e instanceof Error ? e.message : e);
          }
        }
      }
      if (memoryEcho) response.memoryEcho = memoryEcho;

      // GUARD: the streaming model call can outlive the lock's TTL (90s). If a
      // retry arrived and re-acquired the lock, our writes would double-commit
      // authoritative state. Bail cleanly in that case — the retry owns the
      // turn now.
      if (!lock.stillMine()) {
        send({ type: "error", error: "The dream resettled. Try that again." });
        return;
      }

      // COMPENSATING WRITE: persist the turn, then update the session's
      // authoritative state. If the state update fails, roll back the orphan
      // turn so the ledger and authoritative state cannot diverge.
      const turn = await db.sessionTurn.create({
        data: {
          sessionId: session.id,
          turnNumber,
          userAction: actionText,
          sceneText: response.sceneText,
          choicesJson: JSON.stringify(response.choices),
          proposedStateDeltaJson: JSON.stringify(response.proposedDelta),
          discoveredMotifsJson: JSON.stringify(response.discoveredMotifs),
          appliedDeltaJson: JSON.stringify(applied),
          isEnding: !!ending,
          endingType: ending ?? null,
        },
      });

      try {
        if (ending) {
          await db.arcadeSession.update({
            where: { id: session.id },
            data: { status: "ended", ending, stateJson: JSON.stringify(newState) },
          });
        } else {
          await db.arcadeSession.update({
            where: { id: session.id },
            data: { stateJson: JSON.stringify(newState) },
          });
        }
      } catch (updateErr) {
        // state write failed → remove the orphan turn so state stays consistent
        try { await db.sessionTurn.delete({ where: { id: turn.id } }); } catch {}
        throw updateErr;
      }

      send({
        type: "final",
        turn,
        state: newState,
        choices: response.choices,
        discoveredMotifs: response.discoveredMotifs,
        // r12 — selective historical-connection notice.
        memoryEcho: response.memoryEcho ?? null,
        ending: ending
          ? { type: ending, ...endingText(ending) }
          : null,
        reasoning: response.proposedDelta.reasoning ?? null,
      });
    } catch (e: any) {
      console.warn("[api/arcade/turn/stream] failed:", e);
      // Never expose adapter internals / stack traces to the client.
      send({ type: "error", error: "The dream faltered. Try that again." });
    } finally {
      try { writer.close(); } catch {}
      // r12 — release the per-session single-flight lock so the next turn
      // can proceed immediately (rather than waiting for the TTL).
      try { await lock.release(); } catch {}
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // gateway: don't buffer
    },
  });
}
