import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

// r10 — Session STORY sharing.
// POST — create a read-only public share for this session's story. Only ENDED
//        sessions can be shared (a story needs an ending). The token is a
//        48-char hex secret; possession grants read access to the sanitised
//        narrative ONLY. Re-sharing keeps the existing token so circulated
//        links stay valid.
// DELETE — revoke. The token stops resolving immediately.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const session = await db.arcadeSession.findFirst({ where: { id, userId } });
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (session.status !== "ended" || !session.ending) {
    return NextResponse.json(
      { error: "only a finished session can be shared as a story" },
      { status: 409 }
    );
  }

  const updated = await db.arcadeSession.update({
    where: { id: session.id },
    data: {
      shareToken: session.shareToken ?? randomBytes(24).toString("hex"),
      sharedAt: session.sharedAt ?? new Date(),
    },
  });

  return NextResponse.json({
    share: { token: updated.shareToken, sharedAt: updated.sharedAt },
  });
}

// DELETE — revoke the story share.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const session = await db.arcadeSession.findFirst({ where: { id, userId } });
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

  await db.arcadeSession.update({
    where: { id: session.id },
    data: { shareToken: null, sharedAt: null },
  });

  return NextResponse.json({ ok: true });
}
