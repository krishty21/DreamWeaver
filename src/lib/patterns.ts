// Longitudinal dream pattern computation.
// AUTHORITATIVE: computed by the application from stored dream analyses + motifs.
// The model never produces these directly — it only proposes per-dream motifs.

import { db } from "@/lib/db";
import { reconcileUserGraph, computeThreads } from "@/lib/memory-graph";
import type {
  PatternReport,
  MotifFrequency,
  EmotionalTrendPoint,
  CalendarDay,
  AtlasEntry,
  TimelinePoint,
  Mood,
  LexiconWord,
} from "@/lib/types";

// r9 — English stopwords filtered from the dream lexicon. Deliberately broad:
// the lexicon should surface imagery nouns (water, door, staircase), not
// grammar. Kept inline so the module stays dependency-free.
const STOPWORDS = new Set([
  "the", "and", "was", "were", "that", "this", "with", "for", "but", "not", "you", "she", "her", "him", "his", "they", "them", "their", "there", "then", "than", "when", "what", "where", "which", "while", "would", "could", "should", "have", "has", "had", "been", "being", "into", "from", "about", "again", "just", "only", "very", "some", "something", "somehow", "someone", "anything", "everything", "nothing", "somebody", "everybody", "nobody",
  "over", "under", "after", "before", "because", "through", "between", "around", "against", "without", "within", "toward", "towards", "onto", "upon", "off", "out", "up", "down", "back", "away", "here", "now", "still", "even", "also", "almost", "always", "never", "maybe", "perhaps", "really", "actually", "somehow",
  "like", "just", "know", "knew", "think", "thought", "felt", "feel", "feeling", "seemed", "seems", "seem", "looked", "looking", "looks", "going", "went", "come", "came", "coming", "gets", "got", "getting", "make", "made", "making", "take", "took", "taking", "keep", "kept", "keeping", "start", "started", "starting", "stop", "stopped", "turn", "turned", "turning", "try", "tried", "trying",
  "me", "my", "mine", "we", "us", "our", "ours", "your", "yours", "it", "its", "its", "im", "id", "ill", "ive", "dont", "didnt", "doesnt", "cant", "couldnt", "wouldnt", "wont", "isnt", "arent", "wasnt", "werent", "thats", "theres", "hers", "himself", "herself", "myself", "itself",
  "a", "an", "as", "at", "by", "he", "if", "in", "is", "it", "no", "of", "on", "or", "so", "to", "do", "did", "does", "done", "be", "am", "are", "can", "will", "who", "how", "why", "all", "any", "both", "each", "few", "more", "most", "other", "such", "own", "same", "too", "once", "says", "said", "saw", "see", "seen", "eyes", "eye", "around", "behind", "beside", "next",
]);

function computeLexicon(rawTexts: { text: string }[], ignored: Set<string> = new Set()): LexiconWord[] {
  const counts = new Map<string, { count: number; dreams: Set<string> }>();
  let dreamIdx = 0;
  for (const { text } of rawTexts) {
    const id = String(dreamIdx++);
    const words = text.toLowerCase().match(/[a-z][a-z']*/g) ?? [];
    for (const w of words) {
      if (w.length < 4 || w.length > 16) continue;
      if (STOPWORDS.has(w)) continue;
      // r11 — the dreamer's muted words are excluded BEFORE ranking, so the
      // next most-recurring word surfaces in the muted word's place.
      if (ignored.has(w)) continue;
      const e = counts.get(w) ?? { count: 0, dreams: new Set<string>() };
      e.count += 1;
      e.dreams.add(id);
      counts.set(w, e);
    }
  }
  return Array.from(counts.entries())
    .map(([word, e]) => ({ word, count: e.count, dreamCount: e.dreams.size }))
    // prefer words that recur ACROSS dreams (longitudinal voice), then raw count
    .sort((a, b) => b.dreamCount - a.dreamCount || b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, 28);
}

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

  // r11 — the dreamer's muted lexicon words (ownership enforced by userId).
  const ignoredRows = await db.lexiconIgnore.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { word: true },
  });
  const lexiconIgnored = ignoredRows.map((r) => r.word);

  // --- motif frequency ---
  // r7: tracks a per-motif mood breakdown so the Atlas view can show how a
  // single motif distributes across moods (e.g. "doors" → 3 surreal, 1 tense).
  type Acc = MotifFrequency & {
    moodBreakdown: Map<Mood, number>;
    note?: string | null;
  };
  const motifMap = new Map<string, Acc>();
  for (const d of dreams) {
    const mood = (d.mood as Mood) || "neutral";
    const fear = d.analysis?.fear ?? 0;
    for (const m of d.motifs) {
      const key = `${m.type}::${m.label}`.toLowerCase();
      const existing = motifMap.get(key);
      if (existing) {
        existing.count += 1;
        existing.dreamIds.push(d.id);
        existing.lastSeen = d.createdAt.toISOString();
        existing.avgFear = (existing.avgFear * (existing.count - 1) + fear) / existing.count;
        existing.moodBreakdown.set(mood, (existing.moodBreakdown.get(mood) ?? 0) + 1);
        if (!existing.note && m.note) existing.note = m.note;
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
          moodBreakdown: new Map([[mood, 1]]),
          note: m.note ?? null,
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

  // r7 — full atlas: every motif (including people/places/actions), sorted
  // count-desc then alphabetical for stability. Carries the mood breakdown
  // so the Atlas view can render a per-motif mood spectrum.
  const atlas: AtlasEntry[] = Array.from(motifMap.values())
    .map((mf) => ({
      label: mf.label,
      type: mf.type,
      count: mf.count,
      dreamIds: mf.dreamIds,
      firstSeen: mf.firstSeen,
      lastSeen: mf.lastSeen,
      avgFear: mf.avgFear,
      trend: mf.trend,
      moodBreakdown: Array.from(mf.moodBreakdown.entries()).map(([mood, count]) => ({ mood, count })),
      note: mf.note ?? null,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const topMotifs = atlas
    .filter((m) => m.type === "symbol")
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
  // r6: also carries up to 3 dream titles for the calendar hover popover.
  const calMap = new Map<string, { count: number; moodTally: Map<Mood, number>; lastMood: Mood; titles: string[] }>();
  for (const d of dreams) {
    const key = d.createdAt.toISOString().slice(0, 10);
    const mood = (d.mood as Mood) || "neutral";
    const entry = calMap.get(key) ?? { count: 0, moodTally: new Map<Mood, number>(), lastMood: mood, titles: [] };
    entry.count += 1;
    entry.lastMood = mood;
    entry.moodTally.set(mood, (entry.moodTally.get(mood) ?? 0) + 1);
    if (d.title && entry.titles.length < 3) entry.titles.push(d.title);
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
      return { date, count: e.count, mood: dominant, titles: e.titles };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // r7 — timeline: one point per dream, oldest-first. The Atlas view renders
  // this as a chronological motif map so the user can see their dreaming arc.
  const timeline: TimelinePoint[] = dreams.map((d) => ({
    dreamId: d.id,
    date: d.createdAt.toISOString(),
    title: d.title ?? "Untitled dream",
    mood: (d.mood as Mood) || "neutral",
    motifCount: d.motifs.length,
    fear: d.analysis?.fear ?? 0,
    lucidity: d.analysis?.lucidity ?? 0,
  }));

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
    atlas,
    timeline,
    lexicon: computeLexicon(dreams.map((d) => ({ text: d.rawText ?? "" })), new Set(lexiconIgnored)),
    lexiconIgnored,
    // r12 — Dream Memory Graph threads (canonical entities + evolution).
    // Lazy-backfill the graph if the user has motifs but no entities (so
    // accounts whose dreams predate r12 get threads on first pattern load).
    // Failures are non-fatal — the report still returns, just with empty threads.
    threads: await (async () => {
      try {
        const motifCount = dreams.reduce((acc, d) => acc + d.motifs.length, 0);
        const entityCount = await db.entity.count({ where: { userId } });
        if (motifCount > 0 && entityCount === 0) {
          await reconcileUserGraph(userId);
        }
        return await computeThreads(userId);
      } catch (e) {
        console.warn("[patterns] threads computation failed (non-fatal):", e instanceof Error ? e.message : e);
        return [];
      }
    })(),
  };
}
