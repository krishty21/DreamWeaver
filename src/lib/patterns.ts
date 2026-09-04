// Longitudinal dream pattern computation.
// AUTHORITATIVE: computed by the application from stored dream analyses + motifs.
// The model never produces these directly — it only proposes per-dream motifs.

import { db } from "@/lib/db";
import type {
  PatternReport,
  MotifFrequency,
  EmotionalTrendPoint,
  CalendarDay,
  Mood,
} from "@/lib/types";

export async function computePatternReport(userId: string): Promise<PatternReport> {
  const dreams = await db.dream.findMany({
    where: { userId },
    include: { analysis: true, motifs: true },
    orderBy: { createdAt: "asc" },
  });

  const sessions = await db.arcadeSession.findMany({
    where: { userId },
    select: { id: true, createdAt: true, status: true, ending: true, mode: true, dreamId: true },
    orderBy: { createdAt: "asc" },
  });

  // --- motif frequency ---
  const motifMap = new Map<string, MotifFrequency>();
  for (const d of dreams) {
    for (const m of d.motifs) {
      const key = `${m.type}::${m.label}`.toLowerCase();
      const existing = motifMap.get(key);
      const fear = d.analysis?.fear ?? 0;
      if (existing) {
        existing.count += 1;
        existing.dreamIds.push(d.id);
        existing.lastSeen = d.createdAt.toISOString();
        existing.avgFear = (existing.avgFear * (existing.count - 1) + fear) / existing.count;
      } else {
        motifMap.set(key, {
          label: m.label,
          type: m.type,
          count: 1,
          dreamIds: [d.id],
          firstSeen: d.createdAt.toISOString(),
          lastSeen: d.createdAt.toISOString(),
          avgFear: fear,
          trend: "stable",
        });
      }
    }
  }

  // trend: compare avgFear of last 2 occurrences vs first 2 — simple heuristic
  for (const [, mf] of motifMap) {
    if (mf.count < 2) continue;
    const ordered = dreams
      .filter((d) => mf.dreamIds.includes(d.id))
      .map((d) => d.analysis?.fear ?? 0);
    const firstHalf = ordered.slice(0, Math.ceil(ordered.length / 2));
    const secondHalf = ordered.slice(Math.floor(ordered.length / 2));
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
    const diff = avg(secondHalf) - avg(firstHalf);
    mf.trend = diff > 0.05 ? "rising" : diff < -0.05 ? "falling" : "stable";
  }

  const topMotifs = Array.from(motifMap.values())
    .sort((a, b) => b.count - a.count || b.avgFear - a.avgFear)
    .slice(0, 12);

  // --- emotional trend ---
  const emotionalTrend: EmotionalTrendPoint[] = dreams
    .filter((d) => d.analysis)
    .map((d) => ({
      dreamId: d.id,
      date: d.createdAt.toISOString(),
      fear: (d.analysis!.fear ?? 0) * 100,
      lucidity: (d.analysis!.lucidity ?? 0) * 100,
      uncertainty: (d.analysis!.uncertainty ?? 0) * 100,
    }));

  // --- mood distribution ---
  const moodCounts = new Map<Mood, number>();
  for (const d of dreams) {
    const mood = (d.mood as Mood) || "neutral";
    moodCounts.set(mood, (moodCounts.get(mood) ?? 0) + 1);
  }
  const moodDistribution = Array.from(moodCounts.entries()).map(([mood, count]) => ({
    mood,
    count,
  }));

  // --- recurring pairs (motifs appearing together) ---
  const pairCounts = new Map<string, number>();
  for (const d of dreams) {
    const labels = Array.from(new Set(d.motifs.map((m) => m.label.toLowerCase()))).slice(0, 10);
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const [a, b] = [labels[i], labels[j]].sort();
        const key = `${a}|${b}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const recurringPairs = Array.from(pairCounts.entries())
    .filter(([, c]) => c >= 2)
    .map(([k, c]) => {
      const [a, b] = k.split("|");
      return { a, b, count: c };
    })
    .sort((x, y) => y.count - x.count)
    .slice(0, 8);

  // --- calendar (nights remembered, per day) ---
  // Aggregated app-side from dream timestamps; the dominant mood of the day
  // colours the cell. Ties resolve to the latest dream that day.
  const calMap = new Map<string, { count: number; moodTally: Map<Mood, number>; lastMood: Mood }>();
  for (const d of dreams) {
    const key = d.createdAt.toISOString().slice(0, 10);
    const mood = (d.mood as Mood) || "neutral";
    const entry = calMap.get(key) ?? { count: 0, moodTally: new Map<Mood, number>(), lastMood: mood };
    entry.count += 1;
    entry.lastMood = mood;
    entry.moodTally.set(mood, (entry.moodTally.get(mood) ?? 0) + 1);
    calMap.set(key, entry);
  }
  const dreamCalendar: CalendarDay[] = Array.from(calMap.entries())
    .map(([date, e]) => {
      let dominant: Mood = e.lastMood;
      let best = -1;
      for (const [m, c] of e.moodTally) {
        if (c > best) {
          best = c;
          dominant = m;
        }
      }
      return { date, count: e.count, mood: dominant };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    totalDreams: dreams.length,
    totalSessions: sessions.length,
    topMotifs,
    emotionalTrend,
    moodDistribution,
    dreamCalendar,
    recurringPairs,
    earliestDream: dreams[0]?.createdAt.toISOString() ?? null,
    latestDream: dreams[dreams.length - 1]?.createdAt.toISOString() ?? null,
  };
}
