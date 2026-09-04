"use client";

import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Sparkles, Compass, Moon, MoonStar, Sunrise, Sun, Map as MapIcon, ArrowRight, TrendingUp, Gamepad2, CalendarCheck2, BookOpenText, Quote, Clock, TrendingDown, Waypoints } from "lucide-react";
import { motion } from "framer-motion";
import { useMemo } from "react";
import { MOOD_COLORS } from "@/lib/moods";
import type { Mood } from "@/lib/types";

async function fetchMe() {
  const res = await fetch("/api/me");
  return res.json();
}
async function fetchDreams() {
  const res = await fetch("/api/dreams");
  return res.json();
}
async function fetchSessions() {
  const res = await fetch("/api/arcade/sessions");
  return res.json();
}
async function fetchPatterns() {
  const res = await fetch("/api/patterns");
  return res.json();
}

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Streaks are computed app-side from dream timestamps — never guessed.
function dreamStats(dreams: { createdAt: string }[]) {
  const dates = new Set(dreams.map((d) => dateKey(new Date(d.createdAt))));
  const nightsRemembered = dates.size;

  // current streak: consecutive dream-days ending today (or yesterday, so an
  // unbroken run isn't reset the moment you wake up late)
  let streak = 0;
  const cursor = new Date();
  if (!dates.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (dates.has(dateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // longest run across all recorded history
  const sorted = [...dates].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    if (prev) {
      const p = new Date(prev + "T00:00:00");
      p.setDate(p.getDate() + 1);
      run = dateKey(p) === d ? run + 1 : 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    prev = d;
  }
  return { streak, nightsRemembered, longestStreak: Math.max(longest, streak) };
}

// r8 — longitudinal insight. A single derived sentence computed app-side
// from the patterns data (no model calls). Picks the most "interesting"
// signal available based on data strength. Returns null when there isn't
// enough pattern data yet (fewer than 3 dreams with analysis).
//
// Priority order (the first one that fires wins):
//   1. Fear trend (rising or falling across >=3 dreams with analysis)
//   2. Lucidity trend (rising across >=3 dreams)
//   3. Mood clustering (a single mood appears in >=50% of >=3 dreams)
//   4. Mood diversity (>=3 distinct moods across >=3 dreams)
//   5. Cadence (a streak of >=2 — already celebrated, but framed as cadence)
type InsightResult = {
  kind: "fear-rising" | "fear-falling" | "lucidity-rising" | "mood-cluster" | "mood-diversity" | "cadence";
  icon: any;
  sentence: string;
  footer: string;
};

function deriveInsight(
  report: any,
  dreams: any[]
): InsightResult | null {
  if (!report) return null;
  const trend = report.emotionalTrend ?? [];
  if (trend.length < 3) return null;

  // 1 — Fear trend. Compare the average of the most recent half against the
  // first half. The trend array is oldest-first.
  const half = Math.floor(trend.length / 2);
  const early = trend.slice(0, half);
  const late = trend.slice(half);
  const avg = (arr: any[]) =>
    arr.reduce((s, x) => s + (x.fear ?? 0), 0) / (arr.length || 1);
  const earlyFear = avg(early);
  const lateFear = avg(late);
  const fearDelta = lateFear - earlyFear;
  // Threshold: 8 points on a 0-100 scale. Anything less is "stable".
  if (fearDelta >= 8) {
    return {
      kind: "fear-rising",
      icon: TrendingUp,
      sentence: `Fear has been rising across your last ${trend.length} dreams — up ${Math.round(fearDelta)} points from where it began.`,
      footer: `derived from ${trend.length} dream analyses`,
    };
  }
  if (fearDelta <= -8) {
    return {
      kind: "fear-falling",
      icon: TrendingDown,
      sentence: `Fear has eased across your last ${trend.length} dreams — down ${Math.round(Math.abs(fearDelta))} points from where it began.`,
      footer: `derived from ${trend.length} dream analyses`,
    };
  }

  // 2 — Lucidity trend. Same comparison, but for lucidity.
  const earlyLuc = early.reduce((s, x) => s + (x.lucidity ?? 0), 0) / (early.length || 1);
  const lateLuc = late.reduce((s, x) => s + (x.lucidity ?? 0), 0) / (late.length || 1);
  const lucDelta = lateLuc - earlyLuc;
  if (lucDelta >= 8) {
    return {
      kind: "lucidity-rising",
      icon: Waypoints,
      sentence: `Lucidity is rising — you noticed more in your last dreams than your first. Up ${Math.round(lucDelta)} points.`,
      footer: `derived from ${trend.length} dream analyses`,
    };
  }

  // 3 — Mood clustering. If one mood appears in >=50% of >=3 dreams, name it.
  const moodDist = report.moodDistribution ?? [];
  const totalDreams = report.totalDreams ?? dreams.length;
  if (totalDreams >= 3 && moodDist.length > 0) {
    const top = [...moodDist].sort((a, b) => b.count - a.count)[0];
    if (top && top.count >= Math.ceil(totalDreams * 0.5)) {
      return {
        kind: "mood-cluster",
        icon: Moon,
        sentence: `Your dreams cluster around the ${top.mood} — ${top.count} of ${totalDreams} nights have landed there.`,
        footer: `derived from ${totalDreams} dream moods`,
      };
    }
  }

  // 4 — Mood diversity. >=3 distinct moods across >=3 dreams.
  if (totalDreams >= 3 && moodDist.length >= 3) {
    return {
      kind: "mood-diversity",
      icon: Waypoints,
      sentence: `Your dreams span ${moodDist.length} moods — a wide interior weather, not a single climate.`,
      footer: `derived from ${totalDreams} dream moods`,
    };
  }

  // 5 — Cadence (streak of >=2 nights — already celebrated in the eyebrow
  // but framed here as longitudinal cadence).
  const stats = dreamStats(dreams);
  if (stats.streak >= 2) {
    return {
      kind: "cadence",
      icon: CalendarCheck2,
      sentence: `${stats.streak} nights in a row of remembering — a steady thread, not a single pull.`,
      footer: `derived from ${dreams.length} dream timestamps`,
    };
  }

  return null;
}

// Rank revisit candidates: motifs that recur across dreams carry weight;
// dreams already re-entered many times sink. Ties resolve oldest-first.
function pickRevisit(
  dreams: any[],
  sessions: any[],
  topMotifs: { label: string; count: number }[]
): { dream: any; matched: { label: string; count: number }[] } | null {
  if (!dreams.length) return null;
  const weight = new Map<string, { label: string; count: number; w: number }>();
  topMotifs.forEach((m, i) => {
    weight.set(m.label.toLowerCase(), { label: m.label, count: m.count, w: topMotifs.length - i });
  });
  const sessionCount = new Map<string, number>();
  for (const s of sessions) {
    if (s.dreamId) sessionCount.set(s.dreamId, (sessionCount.get(s.dreamId) ?? 0) + 1);
  }

  let best: { dream: any; matched: { label: string; count: number }[] } | null = null;
  let bestScore = -Infinity;
  for (const d of [...dreams].reverse()) {
    // dreams arrive newest-first; reverse → oldest-first tie-break
    const labels = new Set((d.motifs ?? []).map((m: any) => String(m.label).toLowerCase()));
    const matched: { label: string; count: number }[] = [];
    let score = 0;
    for (const [key, m] of weight) {
      if (labels.has(key)) {
        score += m.w;
        matched.push({ label: m.label, count: m.count });
      }
    }
    score = score * 2 - (sessionCount.get(d.id) ?? 0);
    if (score > bestScore) {
      bestScore = score;
      best = { dream: d, matched };
    }
  }
  return best;
}

export function DashboardView() {
  const navigate = useApp((s) => s.navigate);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const { data: dreamsData } = useQuery({ queryKey: ["dreams"], queryFn: fetchDreams });
  const { data: sessionsData } = useQuery({ queryKey: ["sessions"], queryFn: fetchSessions });
  const { data: patternsData } = useQuery({ queryKey: ["patterns"], queryFn: fetchPatterns });

  const dreams: any[] = dreamsData?.dreams ?? [];
  const sessions: any[] = sessionsData?.sessions ?? [];
  const report = patternsData?.report;
  const recent = dreams[0];
  const recentSession = sessions[0];
  const topMotifs = (report?.topMotifs ?? []).slice(0, 5);
  const stats = dreamStats(dreams);
  const revisit = pickRevisit(dreams, sessions, report?.topMotifs ?? []);
  const recommended = revisit?.dream ?? dreams[dreams.length - 1];

  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Late tonight" : hour < 12 ? "This morning" : hour < 18 ? "This afternoon" : "Tonight";
  const GreetIcon = hour < 5 ? MoonStar : hour < 12 ? Sunrise : hour < 18 ? Sun : Moon;
  const greetingHint =
    hour < 5
      ? "The hour when dreams are closest."
      : hour < 12
      ? "If a dream is still with you, catch it now."
      : hour < 18
      ? "A quiet moment to look back."
      : "The night ahead has room for dreams.";

  // r7: tonight's reflection prompt. Deterministic per-day rotation so the
  // same prompt is shown all day (no flickering between renders), and the
  // prompt set reflects the time of day (morning prompts favour recall,
  // evening prompts favour intention).
  //
  // r7 enhancement: when the user has recurring motifs, the prompt becomes
  // personalised — it names the user's strongest recurring motif and asks
  // them to notice / invite it. Static rotation only kicks in when there
  // isn't enough pattern data yet (fewer than 2 dreams or no recurring motif).
  const promptSeed = Math.floor(Date.now() / 86400000);
  const eveningPrompts = [
    "Carry one question into sleep tonight. What would you like the dream to answer?",
    "Name a figure from a recent dream. Invite it to return.",
    "Tonight, notice the threshold — the door, the staircase, the parting. Hold it in mind.",
    "Ask the dream to repeat itself. The same motif, seen twice, tells more.",
    "Before sleep, picture where you'd like to wake inside the dream.",
  ];
  const morningPrompts = [
    "Hold the dream for one breath before checking the time. What stayed?",
    "Name the first fragment that returns. Don't reach for the rest yet.",
    "Was there a colour? A name? A direction? Write one, not all.",
    "If the dream left a feeling, where in your body does it sit?",
    "Don't explain it yet. Just describe the room you were in.",
  ];
  const promptSet = hour < 12 && hour >= 5 ? morningPrompts : eveningPrompts;
  const fallbackPrompt = promptSet[promptSeed % promptSet.length];
  const promptKind = hour < 12 && hour >= 5 ? "Morning recall" : "Tonight's prompt";

  // r7 — personalised prompt: when the user has a top recurring motif, swap
  // the static rotation for a line that names that motif. The motif is
  // already computed app-side (no model calls) so this is cheap. Stable
  // for the day because topMotifs doesn't change between renders.
  const topRecurring = (report?.topMotifs ?? []).find((m) => m.count >= 2);
  const tonightPrompt = topRecurring
    ? hour < 12 && hour >= 5
      ? `"${topRecurring.label}" returned again last time. Notice whether it finds you tonight.`
      : `Tonight, watch for "${topRecurring.label}". It has returned ${topRecurring.count} times — invite it closer.`
    : fallbackPrompt;

  // r6: streak microcopy — celebrate an active streak with a one-line whisper
  // that sits beside the hero greeting. Doesn't replace the stat tile; it gives
  // the streak a sentence-voice.
  const streakLine =
    stats.streak > 0
      ? `${stats.streak} night${stats.streak === 1 ? "" : "s"} in a row — keep the thread.`
      : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 py-10 sm:py-14">
      {/* hero greeting */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col sm:flex-row sm:items-end justify-between gap-6"
      >
        <div className="min-w-0">
          <div className="page-rule mb-3" aria-hidden="true" />
          <div className="text-xs tracking-caps uppercase text-muted-foreground mb-2 flex items-center gap-2 flex-wrap">
            <GreetIcon className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
            {greeting}
            <span className="hidden sm:inline font-normal normal-case tracking-normal text-muted-foreground/70">· {greetingHint}</span>
            {streakLine && (
              <span className="ml-1 inline-flex items-center gap-1.5 text-foreground/70 normal-case tracking-normal">
                <span className="h-px w-3 bg-border" />
                <span className="streak-pulse-dot" aria-hidden="true" />
                {streakLine}
              </span>
            )}
          </div>
          <h1 className="font-display tracking-display text-5xl sm:text-6xl leading-[0.95] balance">
            {me?.user?.name ? `Welcome back, ${me.user.name.split(" ")[0]}.` : "Your dream observatory."}
          </h1>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground pretty max-w-lg">
            {dreams.length === 0
              ? "Capture a dream and watch it become memory, pattern, and a world you can return to."
              : `${dreams.length} dream${dreams.length === 1 ? "" : "s"} remembered. ${sessions.length} session${sessions.length === 1 ? "" : "s"} in the arcade. The landscape is still forming.`}
          </p>
        </div>
        <Button
          onClick={() => navigate("capture")}
          className="h-11 px-6 bg-foreground text-background hover:opacity-90 self-start sm:self-end"
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.6} />
          Capture a dream
        </Button>
      </motion.section>

      {dreams.length === 0 ? (
        <FirstDream onCapture={() => navigate("capture")} />
      ) : (
        <>
          {/* observatory stats */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.03 }}
            className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-3"
            aria-label="Your dream observatory at a glance"
          >
            <StatTile
              icon={<Moon className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />}
              value={dreams.length}
              label={dreams.length === 1 ? "dream kept" : "dreams kept"}
            />
            <StatTile
              icon={<CalendarCheck2 className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />}
              value={stats.nightsRemembered}
              label={stats.nightsRemembered === 1 ? "night remembered" : "nights remembered"}
            />
            <StatTile
              icon={<TrendingUp className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />}
              value={stats.streak > 0 ? stats.streak : "—"}
              label={
                stats.streak > 0
                  ? stats.streak === 1
                    ? "night in a row"
                    : "nights in a row"
                  : `best ${stats.longestStreak}`
              }
              accent={stats.streak > 0}
            />
            <StatTile
              icon={<Gamepad2 className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />}
              value={sessions.length}
              label={sessions.length === 1 ? "arcade session" : "arcade sessions"}
            />
          </motion.div>

          {/* r6: tonight's reflection prompt — a quiet invitation that sits
              between the stats and the deep content. Deterministic per day. */}
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08 }}
            onClick={() => navigate("capture")}
            className="mt-5 w-full text-left surface p-5 sm:p-6 flex items-start gap-4 lift group"
            aria-label="Open tonight's reflection prompt in capture"
          >
            <div className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-full bg-foreground/[0.05] text-foreground/70 group-hover:bg-foreground/10 transition">
              <Quote className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] tracking-caps uppercase text-muted-foreground mb-1.5 flex items-center gap-2">
                {promptKind}
                <span className="h-px w-3 bg-border" />
                <span className="font-data text-[10px]">daily</span>
              </div>
              <p className="font-display italic text-xl sm:text-2xl leading-snug text-foreground/90 pretty balance">
                {tonightPrompt}
              </p>
              <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground group-hover:text-foreground transition">
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
                Open in capture
                <ArrowRight className="h-3 w-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition" strokeWidth={1.6} aria-hidden="true" />
              </div>
            </div>
          </motion.button>

          {/* r8 — longitudinal insight. A single derived sentence computed
              app-side from the patterns data (no model calls). Surfaces the
              strongest available signal: fear trend, lucidity trend, mood
              clustering, mood diversity, or cadence. Sits between the prompt
              and the deep content so the user sees a "here's what's been
              happening" line before diving back in. */}
          <LongitudinalInsight report={report} dreams={dreams} />

          <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Recent dream — big. r6: mood-accented with a soft glow and motif chips. */}
          {recent && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.05 }}
              whileHover={{ y: -4 }}
              onClick={() => navigate("dream", { dreamId: recent.id })}
              className="surface p-6 lg:col-span-2 text-left flex flex-col lift relative overflow-hidden"
            >
              {/* mood-tinted accent ribbon */}
              <span
                aria-hidden="true"
                className="absolute top-0 left-0 right-0 h-1"
                style={{
                  background: `linear-gradient(90deg, ${MOOD_COLORS[(recent.mood as Mood) ?? "neutral"]}, transparent)`,
                }}
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
                <span className="tracking-caps uppercase inline-flex items-center gap-2">
                  <span
                    className="mood-dot"
                    style={{ background: MOOD_COLORS[(recent.mood as Mood) ?? "neutral"] }}
                    aria-hidden="true"
                  />
                  Most recent dream
                </span>
                <span className="inline-flex items-center gap-1.5 font-data">
                  <Clock className="h-3 w-3" strokeWidth={1.6} aria-hidden="true" />
                  {new Date(recent.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                </span>
              </div>
              <h2 className="font-display tracking-display text-4xl leading-tight balance">
                {recent.title || "Untitled dream"}
              </h2>
              {recent.analysis && (
                <p className="mt-3 text-sm sm:text-base text-muted-foreground pretty line-clamp-3">
                  {recent.analysis.summary}
                </p>
              )}
              {/* motif chips — surface the dream's recurring elements right on the card */}
              {recent.motifs && recent.motifs.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {recent.motifs.slice(0, 4).map((m: any, i: number) => (
                    <span key={i} className="chip capitalize">{m.label}</span>
                  ))}
                  {recent.motifs.length > 4 && (
                    <span className="chip">+{recent.motifs.length - 4}</span>
                  )}
                </div>
              )}
              <div className="mt-auto pt-5 flex items-center gap-2 text-foreground group">
                <Moon className="h-4 w-4 group-hover:rotate-12 transition" strokeWidth={1.6} />
                <span className="text-sm">Read reflection</span>
                <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition" strokeWidth={1.6} />
              </div>
            </motion.button>
          )}

          {/* Top motifs */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="surface p-6 flex flex-col"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs tracking-caps uppercase text-muted-foreground">Recurring motifs</span>
              <button onClick={() => navigate("patterns")} className="text-xs text-muted-foreground hover:text-foreground">
                Patterns →
              </button>
            </div>
            {topMotifs.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No motifs surfaced yet.</p>
            ) : (
              <div className="space-y-2.5 mt-1">
                {topMotifs.map((m, i) => (
                  <MotifRow key={i} label={m.label} count={m.count} max={topMotifs[0]?.count || 1} />
                ))}
              </div>
            )}
          </motion.div>

          {/* Revisit recommendation */}
          {recommended && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="surface p-6 lg:col-span-2 flex flex-col sm:flex-row sm:items-center gap-4 justify-between"
            >
              <div className="min-w-0">
                <div className="text-xs tracking-caps uppercase text-muted-foreground mb-1">
                  Worth revisiting
                </div>
                <h3 className="font-display text-2xl tracking-tight truncate">
                  {recommended.title || "A dream"}
                </h3>
                {revisit && revisit.matched.length > 0 ? (
                  <>
                    <p className="text-sm text-muted-foreground mt-1 pretty">
                      Carries your most recurrent motifs — they keep returning.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {revisit.matched.slice(0, 3).map((m) => (
                        <span key={m.label} className="chip capitalize">
                          {m.label} ×{m.count}
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground mt-1 pretty">
                    An older dream. Time to re-enter it as an interactive world.
                  </p>
                )}
              </div>
              <Button
                onClick={() => navigate("arcade", { dreamId: recommended.id })}
                className="h-11 bg-foreground text-background hover:opacity-90 shrink-0"
              >
                <Compass className="h-4 w-4" strokeWidth={1.6} />
                Re-enter
              </Button>
            </motion.div>
          )}

          {/* Recent arcade session */}
          {recentSession && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="surface p-6 flex flex-col"
            >
              <div className="text-xs tracking-caps uppercase text-muted-foreground mb-3">
                Last arcade session
              </div>
              <h3 className="font-display text-2xl tracking-tight line-clamp-2">
                {recentSession.dream?.title || "A dream"}
              </h3>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="chip">{recentSession.mode}</span>
                <span className="chip">{recentSession.status}</span>
                {recentSession.ending && <span className="chip">{recentSession.ending}</span>}
              </div>
              <button
                onClick={() => navigate("arcade")}
                className="mt-auto pt-4 text-sm text-foreground hover:opacity-70 inline-flex items-center gap-1.5"
              >
                <Compass className="h-4 w-4" strokeWidth={1.6} />
                Open the arcade
              </button>
            </motion.div>
          )}

          {/* Emotional trend mini */}
          {report && report.emotionalTrend.length >= 2 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.25 }}
              className="surface p-6 flex flex-col"
            >
              <div className="text-xs tracking-caps uppercase text-muted-foreground mb-3">
                Emotional trend
              </div>
              <Sparkline points={report.emotionalTrend.map((p: any) => p.fear)} />
              <p className="mt-2 text-[11px] text-muted-foreground italic">
                Fear / tension across your recorded dreams.
              </p>
              <button
                onClick={() => navigate("patterns")}
                className="mt-auto pt-4 text-sm text-foreground hover:opacity-70 inline-flex items-center gap-1.5"
              >
                <MapIcon className="h-4 w-4" strokeWidth={1.6} />
                See full pattern
              </button>
            </motion.div>
          )}
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({
  icon,
  value,
  label,
  accent,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div
      className="surface-quiet stat-tile px-4 py-3.5 flex items-center gap-3"
      aria-label={`${typeof value === "number" ? value : ""} ${label}`}
    >
      <span
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          accent ? "bg-foreground text-background" : "bg-foreground/[0.06] text-foreground"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-display text-2xl leading-none tabular-nums">{value}</span>
        <span className="block text-[11px] text-muted-foreground tracking-caps uppercase mt-1 truncate">
          {label}
        </span>
      </span>
    </div>
  );
}

function MotifRow({ label, count, max }: { label: string; count: number; max: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm capitalize w-28 truncate">{label}</span>
      <div className="meter-track flex-1">
        <div
          className="meter-fill"
          style={{ transform: `scaleX(${count / max})`, background: "linear-gradient(90deg, var(--rose), var(--mauve))" }}
        />
      </div>
      <span className="font-data text-xs text-muted-foreground w-5 text-right">{count}</span>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const w = 220;
  const h = 60;
  const max = Math.max(...points, 1);
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = h - (p / max) * (h - 6) - 3;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  // r8 — soft area fill below the line. Goes from the first point across the
  // line, then down to the bottom-right, then to the bottom-left, then closes.
  // The fill is a vertical gradient from a faint rose to transparent so the
  // shape reads as a soft hill, not a solid block.
  const lastX = (points.length - 1) * step;
  const firstX = 0;
  const areaPath = `${path} L${lastX.toFixed(1)},${h} L${firstX.toFixed(1)},${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--rose)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--rose)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#spark-area)" stroke="none" />
      <path d={path} fill="none" stroke="var(--slate)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => {
        const x = i * step;
        const y = h - (p / max) * (h - 6) - 3;
        return <circle key={i} cx={x} cy={y} r={2.5} fill="var(--ink)" />;
      })}
    </svg>
  );
}

// r8 — Longitudinal insight card. Renders the strongest available derived
// insight (fear trend / lucidity trend / mood clustering / mood diversity /
// cadence) as a quiet editorial card. Doesn't navigate — it just observes.
// Returns null when deriveInsight returns null (insufficient data).
function LongitudinalInsight({ report, dreams }: { report: any; dreams: any[] }) {
  const insight = useMemo(() => deriveInsight(report, dreams), [report, dreams]);
  if (!insight) return null;
  const Icon = insight.icon;
  // A small label that maps the insight kind to a human-readable label.
  const kindLabel: Record<string, string> = {
    "fear-rising": "fear · rising",
    "fear-falling": "fear · easing",
    "lucidity-rising": "lucidity · rising",
    "mood-cluster": "mood · clustering",
    "mood-diversity": "mood · diversity",
    cadence: "cadence · steady",
  };
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="mt-5 surface p-5 sm:p-6 flex items-start gap-4 lift"
      aria-label="Longitudinal insight"
    >
      <div className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-full bg-foreground/[0.05] text-foreground/70">
        <Icon className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] tracking-caps uppercase text-muted-foreground mb-1.5 flex items-center gap-2">
          <span>Longitudinal insight</span>
          <span className="h-px w-3 bg-border" />
          <span className="font-data text-[10px] normal-case tracking-normal">{kindLabel[insight.kind]}</span>
        </div>
        <p className="font-display italic text-lg sm:text-xl leading-snug text-foreground/90 pretty balance">
          {insight.sentence}
        </p>
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground italic">
          <span className="font-data not-italic tracking-caps uppercase">{insight.footer}</span>
          <span aria-hidden="true">·</span>
          <span>computed app-side, never the model</span>
        </div>
      </div>
    </motion.section>
  );
}

function FirstDream({ onCapture }: { onCapture: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="mt-12 surface p-10 sm:p-14 text-center"
    >
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-foreground/[0.05] mb-5">
        <BookOpenText className="h-6 w-6 text-muted-foreground" strokeWidth={1.4} />
      </div>
      <h2 className="font-display tracking-display text-4xl balance">
        Your dream landscape is empty.
      </h2>
      <p className="mt-2 text-sm text-muted-foreground pretty max-w-md mx-auto">
        Capture your first dream. Fragments are fine — Gemini reads its shape after.
      </p>
      <Button onClick={onCapture} className="mt-6 h-11 px-6 bg-foreground text-background hover:opacity-90">
        <Sparkles className="h-4 w-4" strokeWidth={1.6} />
        Begin
      </Button>
    </motion.div>
  );
}
