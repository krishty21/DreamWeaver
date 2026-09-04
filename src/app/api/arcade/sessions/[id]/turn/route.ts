import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateArcadeTurn } from "@/lib/ai";
import { applyDelta, endingText } from "@/lib/simulation";
import type { SimulationState } from "@/lib/types";
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

  // Ask the model for the next scene + proposed delta.
  const { response, raw } = await generateArcadeTurn({
    mode: session.mode as any,
    dream: { rawText: session.dream.rawText, analysis: session.dream.analysis },
    state,
    history,
    userAction: actionText,
    dreamMotifs,
  });

  // App validates + applies the delta (authoritative).
  const { state: newState, applied, ending } = applyDelta(state, response.proposedDelta);

  const turnNumber = session.turns.length + 1;

  // Persist the turn (with both proposed and applied deltas for transparency).
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

  let updatedSession = session;
  if (ending) {
    updatedSession = await db.arcadeSession.update({
      where: { id: session.id },
      data: {
        status: "ended",
        ending,
        stateJson: JSON.stringify(newState),
      },
    }) as any;
  } else {
    updatedSession = await db.arcadeSession.update({
      where: { id: session.id },
      data: { stateJson: JSON.stringify(newState) },
    }) as any;
  }

  return NextResponse.json({
    turn,
    state: newState,
    choices: response.choices,
    discoveredMotifs: response.discoveredMotifs,
    ending: ending
      ? { type: ending, ...endingText(ending) }
      : null,
    reasoning: response.proposedDelta.reasoning ?? null,
  });
}
