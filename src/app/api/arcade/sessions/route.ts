import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { initialState } from "@/lib/simulation";
import type { ArcadeMode } from "@/lib/types";
import { z } from "zod";

const createSchema = z.object({
  dreamId: z.string(),
  mode: z.enum(["replay", "rewrite", "confront"]).default("replay"),
  // App-selected motif the Confront session will centre on (advisory to the model,
  // selected from app-computed patterns — never chosen by the model itself).
  confrontMotif: z.string().max(60).optional().nullable(),
});

// GET — list user's arcade sessions (with dream summary).
export async function GET() {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sessions = await db.arcadeSession.findMany({
    where: { userId },
    include: {
      dream: { select: { id: true, title: true, mood: true, createdAt: true } },
      turns: { select: { id: true, turnNumber: true, isEnding: true, createdAt: true }, orderBy: { turnNumber: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ sessions });
}

// POST — start a new arcade session from a historical dream.
export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  }
  const { dreamId, mode, confrontMotif } = parsed.data as {
    dreamId: string;
    mode: ArcadeMode;
    confrontMotif?: string | null;
  };

  // ownership check on the dream
  const dream = await db.dream.findFirst({
    where: { id: dreamId, userId },
    include: { analysis: true, motifs: true },
  });
  if (!dream) return NextResponse.json({ error: "dream not found" }, { status: 404 });

  const state = initialState();
  if (mode === "confront" && confrontMotif) {
    // The app pins the motif this session will centre on.
    (state as any).confrontMotif = confrontMotif.toLowerCase();
  }

  const session = await db.arcadeSession.create({
    data: {
      userId,
      dreamId,
      mode,
      status: "active",
      stateJson: JSON.stringify(state),
    },
  });

  return NextResponse.json({ session });
}
