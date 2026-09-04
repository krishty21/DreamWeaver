import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

const bodySchema = z.object({
  includeRaw: z.boolean().optional(),
  // null → never expires; a positive integer → link dies N days from now.
  // undefined → keep whatever expiry the share already has.
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
});

// POST — create or update a read-only public share for this dream's reflection.
// Ownership enforced. The share token is a 48-char hex secret. Re-sharing keeps
// the existing token (so circulated links stay valid) but can toggle includeRaw
// and adjust the expiry. Setting an expiry always re-arms it from NOW.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const dream = await db.dream.findFirst({ where: { id, userId }, include: { analysis: { select: { id: true } } } });
  if (!dream) return NextResponse.json({ error: "dream not found" }, { status: 404 });
  if (!dream.analysis) {
    return NextResponse.json(
      { error: "this dream has no reflection to share yet" },
      { status: 409 }
    );
  }

  let includeRaw = dream.shareIncludeRaw;
  let expiresAt: Date | null = dream.shareExpiresAt;
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
  if (typeof parsed.data.includeRaw === "boolean") {
    includeRaw = parsed.data.includeRaw;
  }
  if (parsed.data.expiresInDays !== undefined) {
    expiresAt =
      parsed.data.expiresInDays === null
        ? null
        : new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000);
  }

  const updated = await db.dream.update({
    where: { id: dream.id },
    data: {
      shareToken: dream.shareToken ?? randomBytes(24).toString("hex"),
      shareIncludeRaw: includeRaw,
      sharedAt: dream.sharedAt ?? new Date(),
      shareExpiresAt: expiresAt,
    },
  });

  return NextResponse.json({
    share: {
      token: updated.shareToken,
      includeRaw: updated.shareIncludeRaw,
      sharedAt: updated.sharedAt,
      expiresAt: updated.shareExpiresAt,
    },
  });
}

// DELETE — revoke the share. The token stops resolving immediately; any
// previously circulated link will 404.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const dream = await db.dream.findFirst({ where: { id, userId } });
  if (!dream) return NextResponse.json({ error: "dream not found" }, { status: 404 });

  await db.dream.update({
    where: { id: dream.id },
    data: { shareToken: null, shareIncludeRaw: false, sharedAt: null, shareExpiresAt: null },
  });

  return NextResponse.json({ ok: true });
}
