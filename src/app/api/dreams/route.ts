import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyzeDream } from "@/lib/ai";
import type { DreamAnalysisData } from "@/lib/types";
import { z } from "zod";

const createSchema = z.object({
  rawText: z.string().trim().min(12, "Please write at least a sentence of what you remember."),
});

// GET — list dreams (newest first), with analysis + motifs.
export async function GET() {
  let userId: string;
  try {
    userId = await requireUser();
  } catch (e: any) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dreams = await db.dream.findMany({
    where: { userId },
    include: { analysis: true, motifs: { select: { label: true, type: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ dreams });
}

// POST — capture raw dream, run Gemini analysis, persist structured memory.
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 }
    );
  }
  const rawText = parsed.data.rawText.slice(0, 8000);

  // gather prior dream history for the analyzer (motifs + dates + summaries)
  const prior = await db.dream.findMany({
    where: { userId },
    include: { analysis: true, motifs: true },
    orderBy: { createdAt: "asc" },
    take: 12,
  });
  const history = prior
    .filter((d) => d.analysis)
    .map((d) => ({
      dreamId: d.id,
      date: d.createdAt.toISOString(),
      motifs: d.motifs.map((m) => m.label),
      summary: d.analysis!.summary,
    }));

  // create the dream row first (raw preserved even if analysis fails)
  const dream = await db.dream.create({
    data: {
      userId,
      rawText,
      title: "Untitled dream",
      mood: "neutral",
    },
  });

  // run analysis (Gemini). Server-side only; secrets never shipped to client.
  let analysisData: DreamAnalysisData | null = null;
  let modelRaw = "";
  let analysisError: string | null = null;

  try {
    const { data, raw } = await analyzeDream(rawText, history);
    analysisData = data;
    modelRaw = raw;
  } catch (e: any) {
    analysisError = e?.message ?? "analysis failed";
  }

  if (analysisData) {
    // persist structured memory
    const priorMotifSet = new Set(
      prior.flatMap((d) => d.motifs.map((m) => m.label.toLowerCase()))
    );
    const historicalConnections = analysisData.motifs
      .filter((m) => priorMotifSet.has(m.label.toLowerCase()))
      .map((m) => ({
        motif: m.label,
        dreamIds: prior
          .filter((d) =>
            d.motifs.some((mm) => mm.label.toLowerCase() === m.label.toLowerCase())
          )
          .map((d) => d.id),
        note: m.note,
      }));

    analysisData.historicalConnections = historicalConnections;

    const a = await db.dreamAnalysis.create({
      data: {
        dreamId: dream.id,
        summary: analysisData.summary,
        emotionsJson: JSON.stringify(analysisData.emotions),
        symbolsJson: JSON.stringify(analysisData.symbols),
        motifsJson: JSON.stringify(analysisData.motifs),
        peopleJson: JSON.stringify(analysisData.people),
        locationsJson: JSON.stringify(analysisData.locations),
        actionsJson: JSON.stringify(analysisData.actions),
        lucidity: analysisData.lucidity,
        lucidityNote: analysisData.lucidityNote ?? null,
        fear: analysisData.fear,
        uncertainty: analysisData.uncertainty,
        interpretationsJson: JSON.stringify(analysisData.interpretations),
        relationshipsJson: JSON.stringify(analysisData.relationships),
        historicalConnectionsJson: JSON.stringify(historicalConnections),
        modelRawJson: modelRaw.slice(0, 20000),
      },
    });

    // persist motif instances (for longitudinal pattern computation)
    const motifRows = analysisData.motifs.map((m) => ({
      dreamId: dream.id,
      userId,
      label: m.label,
      type: "symbol" as const,
      note: m.note ?? null,
      confidence: m.confidence ?? 0.5,
    }));
    if (motifRows.length) await db.motif.createMany({ data: motifRows });

    // also store people/locations/actions as typed motifs for pattern richness
    const peopleRows = analysisData.people.map((p) => ({
      dreamId: dream.id,
      userId,
      label: p.name.toLowerCase(),
      type: "person" as const,
      note: p.role ?? null,
      confidence: p.confidence ?? 0.5,
    }));
    const placeRows = analysisData.locations.map((l) => ({
      dreamId: dream.id,
      userId,
      label: l.label,
      type: "place" as const,
      note: l.note ?? null,
      confidence: l.confidence ?? 0.5,
    }));
    const actionRows = analysisData.actions.map((a2) => ({
      dreamId: dream.id,
      userId,
      label: a2.label,
      type: "action" as const,
      note: a2.note ?? null,
      confidence: a2.confidence ?? 0.5,
    }));
    const extra = [...peopleRows, ...placeRows, ...actionRows];
    if (extra.length) await db.motif.createMany({ data: extra });

    // update dream title + mood
    await db.dream.update({
      where: { id: dream.id },
      data: { title: analysisData.title, mood: analysisData.mood },
    });
    dream.title = analysisData.title;
    dream.mood = analysisData.mood;
  }

  const refreshed = await db.dream.findUnique({
    where: { id: dream.id },
    include: { analysis: true, motifs: true },
  });

  return NextResponse.json({
    dream: refreshed,
    analysisError,
  });
}
