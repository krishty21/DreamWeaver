import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getRepository } from "@/lib/data/repository";
import { endingText } from "@/lib/simulation";

// GET a single arcade session with its turns (ownership enforced).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ session });
}

// DELETE an arcade session + turns (privacy). Ownership enforced.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const db = await getRepository();
  const owned = await db.arcadeSession.findFirst({ where: { id, userId } });
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.arcadeSession.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

// PATCH — manually end a session (e.g. user abandons).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const db = await getRepository();
  const owned = await db.arcadeSession.findFirst({ where: { id, userId } });
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.arcadeSession.update({
    where: { id },
    data: { status: "ended", ending: owned.ending ?? "unresolved" },
  });
  return NextResponse.json({ ok: true, ending: endingText((owned.ending as any) ?? "unresolved") });
}
