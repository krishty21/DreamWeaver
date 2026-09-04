import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

// GET a single dream (ownership enforced).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const dream = await db.dream.findFirst({
    where: { id, userId },
    include: { analysis: true, motifs: true, sessions: { orderBy: { createdAt: "desc" } } },
  });
  if (!dream) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ dream });
}

// DELETE a dream + all related data (privacy). Ownership enforced.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const owned = await db.dream.findFirst({ where: { id, userId } });
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });
  // cascade handles analysis, motifs, sessions, turns
  await db.dream.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
