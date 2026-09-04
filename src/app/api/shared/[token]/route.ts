import { NextResponse } from "next/server";
import { getRepository } from "@/lib/data/repository";

// GET /api/shared/[token] — PUBLIC read-only view of one dream's reflection.
//
// SECURITY MODEL:
// - The token is an unguessable secret (48 hex chars). Possession = read access
//   to exactly this dream's sanitised reflection. Nothing else.
// - NEVER returned: the raw model output (modelRawJson), historicalConnections
//   (they leak other dream ids), internal ids, the dreamer's email, or any
//   other dream. rawText is included ONLY if the dreamer opted in.
// - Revoking (shareToken → null) makes this endpoint 404 immediately.
// - An expiry date in the past closes the link too — reported as { error: "expired" }
//   so the public page can say so, without revealing anything else.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 16 || !/^[a-f0-9]+$/i.test(token)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const db = await getRepository();
  const dream = await db.dream.findFirst({
    where: { shareToken: token },
    include: { analysis: true, user: { select: { name: true } } },
  });
  if (!dream || !dream.analysis) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (dream.shareExpiresAt && dream.shareExpiresAt.getTime() < Date.now()) {
    return NextResponse.json(
      { error: "expired" },
      { headers: { "Cache-Control": "no-store" }, status: 404 }
    );
  }

  const j = (k: string, fallback: any = []) => {
    try {
      const v = JSON.parse((dream.analysis as any)[k] ?? "[]");
      return Array.isArray(v) ? v : fallback;
    } catch {
      return fallback;
    }
  };

  return NextResponse.json(
    {
      shared: {
        title: dream.title ?? "A dream, partially recalled",
        mood: dream.mood ?? "neutral",
        // day-level precision only — no timestamps
        dreamedOn: dream.createdAt.toISOString().slice(0, 10),
        sharedAt: dream.sharedAt ? dream.sharedAt.toISOString().slice(0, 10) : null,
        expiresAt: dream.shareExpiresAt ? dream.shareExpiresAt.toISOString() : null,
        includeRaw: dream.shareIncludeRaw,
        rawText: dream.shareIncludeRaw ? dream.rawText : null,
        // first name only, if the dreamer set one
        authorName: dream.user?.name ? dream.user.name.split(" ")[0] : null,
        reflection: {
          summary: dream.analysis.summary,
          emotions: j("emotionsJson"),
          motifs: j("motifsJson"),
          symbols: j("symbolsJson"),
          people: j("peopleJson"),
          locations: j("locationsJson"),
          actions: j("actionsJson"),
          lucidity: dream.analysis.lucidity,
          lucidityNote: dream.analysis.lucidityNote,
          fear: dream.analysis.fear,
          uncertainty: dream.analysis.uncertainty,
          interpretations: j("interpretationsJson"),
          relationships: j("relationshipsJson"),
        },
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
