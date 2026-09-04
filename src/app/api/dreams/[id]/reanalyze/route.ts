import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { analyzeDream } from "@/lib/ai";
import { reconcileUserGraph } from "@/lib/memory-graph";
import type { DreamAnalysisData } from "@/lib/types";

// POST — re-run the Gemini reflection for an existing dream.
// The raw text is NEVER modified; only the derived analysis is replaced.
// Useful when a previous analysis failed or the user wants a fresh reading.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const dream = await db.dream.findFirst({
    where: { id, userId },
    include: { analysis: true, motifs: true },
  });
  if (!dream) return NextResponse.json({ error: "not found" }, { status: 404 });

  // gather prior history (excluding this dream)
  const prior = await db.dream.findMany({
    where: { userId, id: { not: dream.id } },
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

  let analysisData: DreamAnalysisData;
  let modelRaw = "";
  try {
    const { data, raw } = await analyzeDream(dream.rawText, history);
    analysisData = data;
    modelRaw = raw;
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "The reflection could not be produced. Please try again." },
      { status: 502 }
    );
  }

  // compute historical connections app-side (authoritative)
  const priorMotifSet = new Set(prior.flatMap((d) => d.motifs.map((m) => m.label.toLowerCase())));
  const historicalConnections = analysisData.motifs
    .filter((m) => priorMotifSet.has(m.label.toLowerCase()))
    .map((m) => ({
      motif: m.label,
      dreamIds: prior
        .filter((d) => d.motifs.some((mm) => mm.label.toLowerCase() === m.label.toLowerCase()))
        .map((d) => d.id),
      note: m.note,
    }));
  analysisData.historicalConnections = historicalConnections;

  // replace the previous analysis (raw dream untouched)
  if (dream.analysis) {
    await db.dreamAnalysis.delete({ where: { dreamId: dream.id } });
  }
  await db.dreamAnalysis.create({
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
      // r12 — Dream Laws + Evidence persisted on re-analyze too.
      dreamLawsJson: JSON.stringify(analysisData.dreamLaws ?? []),
      evidenceJson: JSON.stringify(
        (analysisData.interpretations ?? []).map((i) => ({
          interpretation: i.text,
          evidence: i.evidence ?? [],
        }))
      ),
      modelRawJson: modelRaw.slice(0, 20000),
    },
  });

  // replace motif instances
  await db.motif.deleteMany({ where: { dreamId: dream.id } });
  const rows = [
    ...analysisData.motifs.map((m) => ({
      dreamId: dream.id,
      userId,
      label: m.label,
      type: "symbol" as const,
      note: m.note ?? null,
      confidence: m.confidence ?? 0.5,
    })),
    ...analysisData.people.map((p) => ({
      dreamId: dream.id,
      userId,
      label: p.name.toLowerCase(),
      type: "person" as const,
      note: p.role ?? null,
      confidence: p.confidence ?? 0.5,
    })),
    ...analysisData.locations.map((l) => ({
      dreamId: dream.id,
      userId,
      label: l.label,
      type: "place" as const,
      note: l.note ?? null,
      confidence: l.confidence ?? 0.5,
    })),
    ...analysisData.actions.map((a) => ({
      dreamId: dream.id,
      userId,
      label: a.label,
      type: "action" as const,
      note: a.note ?? null,
      confidence: a.confidence ?? 0.5,
    })),
  ];
  if (rows.length) await db.motif.createMany({ data: rows });

  await db.dream.update({
    where: { id: dream.id },
    data: { title: analysisData.title, mood: analysisData.mood },
  });

  // r12 — re-reconcile the memory graph so canonical Entities reflect the
  // refreshed motifs (old mentions pruned, new ones clustered).
  try {
    await reconcileUserGraph(userId);
  } catch (e) {
    console.warn("[reanalyze] memory-graph reconcile failed (non-fatal):", e instanceof Error ? e.message : e);
  }

  const refreshed = await db.dream.findUnique({
    where: { id: dream.id },
    include: { analysis: true, motifs: true },
  });

  return NextResponse.json({ dream: refreshed });
}
