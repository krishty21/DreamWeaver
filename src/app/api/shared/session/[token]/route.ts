import { NextResponse } from "next/server";
import { getRepository } from "@/lib/data/repository";

// GET /api/shared/session/[token] — PUBLIC read-only view of one arcade
// session's STORY (ended sessions only).
//
// SECURITY MODEL (mirrors /api/shared/[token] for dreams):
// - The token is an unguessable secret (48 hex chars). Possession = read
//   access to exactly this session's sanitised narrative. Nothing else.
// - NEVER returned: the dream's raw text (the story is about the re-entry,
//   not the original memory), the dream's motifs/analysis, model internals
//   (proposedDeltaJson / appliedDeltaJson / modelRaw), internal ids, the
//   dreamer's email, or any other session.
// - Revoking (shareToken → null) makes this endpoint 404 immediately.
// - r11: an expiry date in the past closes the link too — reported as
//   { error: "expired" } so the public page can say so, without revealing
//   anything else.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 16 || !/^[a-f0-9]+$/i.test(token)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const db = await getRepository();
  const session = await db.arcadeSession.findFirst({
    where: { shareToken: token },
    include: {
      dream: { select: { title: true, mood: true, createdAt: true } },
      user: { select: { name: true } },
      turns: { orderBy: { turnNumber: "asc" } },
    },
  });
  if (!session || session.status !== "ended" || !session.ending) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // r11 — an expired window closes the story (same code path as dream shares)
  if (session.shareExpiresAt && session.shareExpiresAt.getTime() < Date.now()) {
    return NextResponse.json(
      { error: "expired" },
      { headers: { "Cache-Control": "no-store" }, status: 404 }
    );
  }

  // final authoritative state — meters only, no internals
  let state: { fear?: number; lucidity?: number; stability?: number; agency?: number } = {};
  try {
    state = JSON.parse(session.stateJson) ?? {};
  } catch {
    /* meters omitted on parse failure */
  }

  // discovered motifs across the session, deduped, order of first discovery
  const discovered: string[] = [];
  for (const t of session.turns) {
    try {
      const arr = JSON.parse(t.discoveredMotifsJson || "[]");
      if (Array.isArray(arr)) {
        for (const m of arr) {
          if (typeof m === "string" && !discovered.includes(m)) discovered.push(m);
        }
      }
    } catch {
      /* skip malformed */
    }
  }

  return NextResponse.json(
    {
      story: {
        mode: session.mode, // replay | rewrite | confront
        ending: session.ending,
        // day-level precision only — no timestamps
        beganOn: session.createdAt.toISOString().slice(0, 10),
        sharedAt: session.sharedAt ? session.sharedAt.toISOString().slice(0, 10) : null,
        // r11 — day-level precision; lets readers see the window closes
        expiresAt: session.shareExpiresAt ? session.shareExpiresAt.toISOString() : null,
        turnsCount: session.turns.length,
        dream: {
          title: session.dream.title ?? "A dream",
          mood: session.dream.mood ?? "neutral",
          dreamedOn: session.dream.createdAt.toISOString().slice(0, 10),
        },
        // first name only, if the dreamer set one
        authorName: session.user?.name ? session.user.name.split(" ")[0] : null,
        finalState: {
          fear: typeof state.fear === "number" ? Math.round(state.fear) : null,
          lucidity: typeof state.lucidity === "number" ? Math.round(state.lucidity) : null,
          stability: typeof state.stability === "number" ? Math.round(state.stability) : null,
          agency: typeof state.agency === "number" ? Math.round(state.agency) : null,
        },
        discovered,
        turns: session.turns.map((t) => ({
          n: t.turnNumber,
          userAction: t.userAction,
          sceneText: t.sceneText,
        })),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
