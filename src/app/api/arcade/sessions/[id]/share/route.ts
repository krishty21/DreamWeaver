import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

// r10 — Session STORY sharing.
// r11 — optional expiry windows, mirroring the dream share route.
// POST — create a read-only public share for this session's story. Only ENDED
//        sessions can be shared (a story needs an ending). The token is a
//        48-char hex secret; possession grants read access to the sanitised
//        narrative ONLY. Re-sharing keeps the existing token so circulated
//        links stay valid; the expiry can be adjusted at any time and setting
//        one always re-arms it from NOW.
//        expiresInDays: null → never expires; positive int → link dies N days
//        from now; undefined (absent) → keep whatever expiry the share has.
// DELETE — revoke. The token stops resolving immediately.
const bodySchema = z.object({
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  let expiresAt: Date | null = session.shareExpiresAt;
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid share options" }, { status: 400 });
  }
  if (parsed.data.expiresInDays !== undefined) {
    expiresAt =
      parsed.data.expiresInDays === null
        ? null
        : new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000);
  }

  const updated = await db.arcadeSession.update({
    where: { id: session.id },
    data: {
      shareToken: session.shareToken ?? randomBytes(24).toString("hex"),
      sharedAt: session.sharedAt ?? new Date(),
      shareExpiresAt: expiresAt,
    },
  });

  return NextResponse.json({
    share: {
      token: updated.shareToken,
      sharedAt: updated.sharedAt,
      expiresAt: updated.shareExpiresAt,
    },
  });
}

// DELETE — revoke the story share (clears the expiry window too).
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
    data: { shareToken: null, sharedAt: null, shareExpiresAt: null },
  });

  return NextResponse.json({ ok: true });
}
