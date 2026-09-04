import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateArcadeTurnStreaming } from "@/lib/ai";
import { applyDelta, endingText } from "@/lib/simulation";
import type { SimulationState } from "@/lib/types";
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
        },
        (delta) => send({ type: "delta", text: delta })
      );

      // Apply the authoritative delta now that we have the full response.
      const { state: newState, applied, ending } = applyDelta(state, response.proposedDelta);

      const turnNumber = session.turns.length + 1;

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

      send({
        type: "final",
        turn,
        state: newState,
        choices: response.choices,
        discoveredMotifs: response.discoveredMotifs,
        ending: ending
          ? { type: ending, ...endingText(ending) }
          : null,
        reasoning: response.proposedDelta.reasoning ?? null,
      });
    } catch (e: any) {
      console.warn("[api/arcade/turn/stream] failed:", e);
      send({ type: "error", error: e?.message ?? "The dream faltered." });
    } finally {
      writer.close();
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
