import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getRepository } from "@/lib/data/repository";
import { generateArcadeTurn } from "@/lib/ai";
import { applyDelta, endingText } from "@/lib/simulation";
import { computeMemoryEcho } from "@/lib/memory-graph";
import { acquireLock, lockKey, rateLimit, rateKey } from "@/lib/rate-limit";
import type { SimulationState, DreamLaw } from "@/lib/types";
import { z } from "zod";

const turnSchema = z.object({
  userAction: z.string().trim().max(800).optional(),
  choiceId: z.string().optional(),
});

// POST — take a turn. This is the multi-turn Gemini interaction.
// Flow:
//   1. load session + dream + history (ownership enforced)
//   2. build context, ask the model for the next scene + proposed delta
//   3. app validates + applies the delta (authoritative state)
//   4. persist the turn record + updated simulation state
//   5. if the state machine fires an ending, mark the session ended
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
    // resolve the choice label from the previous turn's choices (authoritative)
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

  // r12 — concurrency + abuse protection (directive §25, §26).
  // (a) Per-session single-flight lock: a double-submit / refresh / parallel
  //     request for the SAME session would otherwise create two turns and
  //     corrupt authoritative state. The lock auto-expires after 90s (the
  //     model rarely exceeds this; the lock is a safety net).
  // (b) Per-user rate limit: cap turn generation to 30/min so a malicious
  //     client cannot burn Gemini quota.
  const lock = acquireLock(lockKey("arcade-turn", session.id), { ttlMs: 90_000 });
  if (!lock.acquired) {
    return NextResponse.json(
      { error: "A turn for this dream is already forming. Let it settle before acting again." },
      { status: 409 }
    );
  }
  const rl = rateLimit(rateKey("arcade-turn", userId), { max: 30, windowMs: 60_000 });
  if (!rl.ok) {
    lock.release();
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

  // History of prior turns for context.
  const history = session.turns.map((t) => ({
    userAction: t.userAction,
    sceneText: t.sceneText,
  }));

  const dreamMotifs = session.dream.motifs.map((m) => m.label);

  // r12 — Dream Laws: recurring internal rules of the source dream. Passed to
  // the model for internal consistency (advisory; never authoritative).
  let dreamLaws: DreamLaw[] = [];
  try {
    dreamLaws = JSON.parse(session.dream.analysis?.dreamLawsJson || "[]");
  } catch {
    dreamLaws = [];
  }

  // r12 — Historical connections: motifs in THIS dream that also appear in the
  // dreamer's prior dreams. Computed app-side (authoritative); passed to the
  // model so it can naturally reference historically-resonant elements. The
  // model never decides whether to surface a MEMORY ECHO — the app does that
  // after the turn, based on what motifs the scene actually referenced.
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

  // Ask the model for the next scene + proposed delta.
  const { response, raw } = await generateArcadeTurn({
    mode: session.mode as any,
    dream: { rawText: session.dream.rawText, analysis: session.dream.analysis },
    state,
    history,
    userAction: actionText,
    dreamMotifs,
    dreamLaws,
    historicalConnections,
  });

  // App validates + applies the delta (authoritative).
  const { state: newState, applied, ending } = applyDelta(state, response.proposedDelta);

  // r12 — MEMORY ECHO: selectively surface a historical connection when the
  // turn's scene references a motif that also appears in a prior dream.
  // Selectivity rule (directive §16: "historical retrieval must be selective.
  // Do not interrupt gameplay constantly. Do not inject irrelevant memories."):
  //   - only when there ARE historical connections in this dream
  //   - only on turns where the model surfaced a discovered motif OR referenced
  //     a known motif in the scene text (we scan for known-motif labels)
  //   - cap frequency: at most every 3rd turn, and never on the very first turn
  //     (let the dream establish itself before echoing)
  let memoryEcho: Awaited<ReturnType<typeof computeMemoryEcho>> = null;
  const turnNumber = session.turns.length + 1;
  const shouldConsiderEcho =
    historicalConnections.length > 0 &&
    turnNumber > 1 &&
    (turnNumber % 3 === 0 || response.discoveredMotifs.length > 0);
  if (shouldConsiderEcho) {
    // candidate motifs = discovered this turn + known motifs whose label appears
    // in the scene text (the scene "referenced" them)
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
        console.warn("[arcade turn] memory echo failed (non-fatal):", e instanceof Error ? e.message : e);
      }
    }
  }
  if (memoryEcho) response.memoryEcho = memoryEcho;

  try {
    // Persist the turn (with both proposed and applied deltas for transparency).
    // COMPENSATING WRITE: if the authoritative ArcadeSession.stateJson update
    // fails AFTER the SessionTurn row exists, we delete the orphan turn so the
    // session's authoritative state and its turn ledger cannot diverge. A
    // half-applied delta must never silently persist.
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
          data: {
            status: "ended",
            ending,
            stateJson: JSON.stringify(newState),
          },
        });
      } else {
        await db.arcadeSession.update({
          where: { id: session.id },
          data: { stateJson: JSON.stringify(newState) },
        });
      }
    } catch (updateErr) {
      // state write failed → roll back the orphan turn so state stays consistent
      try { await db.sessionTurn.delete({ where: { id: turn.id } }); } catch {}
      throw updateErr;
    }

    return NextResponse.json({
      turn,
      state: newState,
      choices: response.choices,
      discoveredMotifs: response.discoveredMotifs,
      // r12 — the selective historical-connection notice. Null when the app
      // decided not to surface an echo this turn (the default).
      memoryEcho: response.memoryEcho ?? null,
      ending: ending
        ? { type: ending, ...endingText(ending) }
        : null,
      reasoning: response.proposedDelta.reasoning ?? null,
    });
  } catch (e) {
    // Persistence or model-failure path: never expose adapter internals.
    // The client sees a calm error; the lock still releases in `finally`.
    return NextResponse.json(
      { error: "The dream faltered. Try that again." },
      { status: 500 }
    );
  } finally {
    // r12 — always release the per-session single-flight lock so the next
    // turn can proceed (even if persistence threw; the lock would otherwise
    // wait for its TTL).
    lock.release();
  }
}
