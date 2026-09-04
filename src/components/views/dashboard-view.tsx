"use client";

import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Sparkles, Compass, Moon, MoonStar, Sunrise, Sun, Map as MapIcon, ArrowRight, TrendingUp, Gamepad2, CalendarCheck2, BookOpenText } from "lucide-react";
import { motion } from "framer-motion";

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

  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8 py-10 sm:py-14">
      {/* hero greeting */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col sm:flex-row sm:items-end justify-between gap-6"
      >
        <div>
          <div className="text-xs tracking-caps uppercase text-muted-foreground mb-2 flex items-center gap-2">
            <GreetIcon className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
            {greeting}
            <span className="hidden sm:inline font-normal normal-case tracking-normal text-muted-foreground/70">· {greetingHint}</span>
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

          <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Recent dream — big */}
          {recent && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.05 }}
              onClick={() => navigate("dream", { dreamId: recent.id })}
              className="surface p-6 lg:col-span-2 text-left flex flex-col lift"
            >
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
                <span className="tracking-caps uppercase">Most recent dream</span>
                <span>{new Date(recent.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
              </div>
              <h2 className="font-display tracking-display text-4xl leading-tight balance">
                {recent.title || "Untitled dream"}
              </h2>
              {recent.analysis && (
                <p className="mt-3 text-sm sm:text-base text-muted-foreground pretty line-clamp-3">
                  {recent.analysis.summary}
                </p>
              )}
              <div className="mt-auto pt-5 flex items-center gap-2 text-foreground">
                <Moon className="h-4 w-4" strokeWidth={1.6} />
                <span className="text-sm">Read reflection</span>
                <ArrowRight className="h-4 w-4" strokeWidth={1.6} />
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
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none">
      <path d={path} fill="none" stroke="var(--slate)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => {
        const x = i * step;
        const y = h - (p / max) * (h - 6) - 3;
        return <circle key={i} cx={x} cy={y} r={2.5} fill="var(--ink)" />;
      })}
    </svg>
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
