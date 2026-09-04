import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getRepository } from "@/lib/data/repository";
import { z } from "zod";

// r11 — Lexicon ignore list. The Patterns lexicon cloud surfaces the words a
// dreamer's raw memory reaches for; some of those are surface noise ("dream",
// "remember", a name). This route lets the dreamer MUTE a word — the lexicon
// is recomputed on /api/patterns with muted words excluded, so the next
// recurring word surfaces in its place. Muting is a preference, not data
// deletion: the word stays in the dreams; only the cloud overlooks it.
//
// POST   { word }  → mute a word (idempotent)
// DELETE { word }  → restore a muted word
// GET              → list muted words (also carried on /api/patterns as
//                    report.lexiconIgnored)

const WORD_RE = /^[a-z][a-z']{2,15}$/; // 3–16 chars, letters/apostrophes, lowercase

const bodySchema = z.object({ word: z.string().min(3).max(16) });

export async function GET() {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = await getRepository();
  const rows = await db.lexiconIgnore.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { word: true, createdAt: true },
  });
  return NextResponse.json({ ignored: rows.map((r) => r.word) });
}

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid word" }, { status: 400 });
  }
  const word = parsed.data.word.toLowerCase().trim();
  if (!WORD_RE.test(word)) {
    return NextResponse.json({ error: "invalid word" }, { status: 400 });
  }
  const db = await getRepository();
  await db.lexiconIgnore.upsert({
    where: { userId_word: { userId, word } },
    create: { userId, word },
    update: {},
  });
  return NextResponse.json({ ok: true, word });
}

export async function DELETE(req: Request) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid word" }, { status: 400 });
  }
  const word = parsed.data.word.toLowerCase().trim();
  const db = await getRepository();
  await db.lexiconIgnore.deleteMany({ where: { userId, word } });
  return NextResponse.json({ ok: true, word });
}
