"use client";

import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import { Map, Loader2, Sparkles, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { motion } from "framer-motion";
import type { PatternReport } from "@/lib/types";

async function fetchPatterns() {
  const res = await fetch("/api/patterns");
  return res.json();
}

export function PatternsView() {
  const navigate = useApp((s) => s.navigate);
  const { data, isLoading } = useQuery({ queryKey: ["patterns"], queryFn: fetchPatterns });
  const report = data?.report as PatternReport | undefined;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-28">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!report || report.totalDreams === 0) {
    return (
      <div className="mx-auto max-w-4xl px-5 sm:px-8 py-14 text-center">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-foreground/[0.05] mb-4">
          <Map className="h-6 w-6 text-muted-foreground" strokeWidth={1.4} />
        </div>
        <h1 className="font-display tracking-display text-4xl balance">
          Patterns need a little history.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground pretty max-w-md mx-auto">
          Once you have two or more dreams, DreamWeaver begins tracing the motifs that return.
        </p>
        <button
          onClick={() => navigate("capture")}
          className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-foreground text-background text-sm hover:opacity-90 transition"
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.6} />
          Capture a dream
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8 py-10 sm:py-14">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="text-xs tracking-caps uppercase text-muted-foreground mb-2">
          Longitudinal memory
        </div>
        <h1 className="font-display tracking-display text-5xl sm:text-6xl leading-[0.95] balance">
          Your dream patterns
        </h1>
        <p className="mt-3 text-sm sm:text-base text-muted-foreground pretty max-w-xl">
          {report.totalDreams} dream{report.totalDreams === 1 ? "" : "s"} ·{" "}
          {report.totalSessions} arcade session{report.totalSessions === 1 ? "" : "s"}. These
          patterns are computed from your stored dream memory — never invented by the model.
        </p>
      </motion.div>

      <div className="mt-12 grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Top motifs — big */}
        <section className="surface p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display text-2xl tracking-tight">Recurring motifs</h2>
            <span className="text-xs text-muted-foreground tracking-caps uppercase">
              {report.topMotifs.length} observed
            </span>
          </div>
          {report.topMotifs.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No motifs have surfaced yet.</p>
          ) : (
            <div className="space-y-3">
              {report.topMotifs.map((m, i) => (
                <MotifCard key={i} motif={m} max={report.topMotifs[0].count} />
              ))}
            </div>
          )}
        </section>

        {/* Mood distribution */}
        <section className="surface p-6">
          <h2 className="font-display text-2xl tracking-tight mb-4">Mood distribution</h2>
          {report.moodDistribution.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">—</p>
          ) : (
            <div className="space-y-3">
              {report.moodDistribution.map((m) => {
                const total = report.moodDistribution.reduce((s, x) => s + x.count, 0);
                const pct = (m.count / total) * 100;
                return (
                  <div key={m.mood}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="capitalize">{m.mood}</span>
                      <span className="font-data text-xs text-muted-foreground">{m.count}</span>
                    </div>
                    <div className="meter-track">
                      <div
                        className="meter-fill"
                        style={{ transform: `scaleX(${pct / 100})`, background: "var(--slate)" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Emotional trend */}
        {report.emotionalTrend.length >= 2 && (
          <section className="surface p-6 lg:col-span-2">
            <h2 className="font-display text-2xl tracking-tight mb-4">Emotional trend</h2>
            <TrendChart points={report.emotionalTrend} />
            <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: "#697184" }} /> Fear
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: "#b1a6a4" }} /> Lucidity
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: "#d8cfd0" }} /> Uncertainty
              </span>
            </div>
          </section>
        )}

        {/* Recurring pairs */}
        {report.recurringPairs.length > 0 && (
          <section className="surface p-6">
            <h2 className="font-display text-2xl tracking-tight mb-4">Motif pairs</h2>
            <p className="text-[11px] text-muted-foreground italic mb-3">
              Motifs that appeared together in the same dream.
            </p>
            <div className="space-y-2">
              {report.recurringPairs.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5">
                    <span className="chip">{p.a}</span>
                    <span className="text-muted-foreground">×</span>
                    <span className="chip">{p.b}</span>
                  </span>
                  <span className="font-data text-xs text-muted-foreground">{p.count}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Range */}
        <section className="surface p-6 flex flex-col justify-between">
          <div>
            <h2 className="font-display text-2xl tracking-tight mb-4">Range</h2>
            <div className="space-y-3 text-sm">
              <Row label="Earliest dream" value={report.earliestDream ? new Date(report.earliestDream).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"} />
              <Row label="Latest dream" value={report.latestDream ? new Date(report.latestDream).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"} />
              <Row label="Total dreams" value={report.totalDreams} />
              <Row label="Arcade sessions" value={report.totalSessions} />
            </div>
          </div>
          <p className="mt-6 text-[11px] text-muted-foreground italic pretty">
            Observed patterns are clearly distinguished from AI interpretation. The application
            computes these from your stored memory.
          </p>
        </section>
      </div>
    </div>
  );
}

function MotifCard({ motif, max }: { motif: PatternReport["topMotifs"][number]; max: number }) {
  const trendIcon =
    motif.trend === "rising" ? TrendingUp : motif.trend === "falling" ? TrendingDown : Minus;
  const Icon = trendIcon;
  return (
    <div className="surface-quiet p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-display text-2xl capitalize">{motif.label}</div>
          <div className="text-[11px] text-muted-foreground tracking-caps uppercase">{motif.type}</div>
        </div>
        <div className="text-right">
          <div className="font-data text-2xl">{motif.count}</div>
          <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1 justify-end">
            <Icon className="h-3 w-3" /> {motif.trend}
          </div>
        </div>
      </div>
      <div className="meter-track mt-3">
        <div
          className="meter-fill"
          style={{ transform: `scaleX(${motif.count / max})`, background: "linear-gradient(90deg, var(--rose), var(--mauve))" }}
        />
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">
        First seen {new Date(motif.firstSeen).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        {" · "}avg fear {(motif.avgFear * 100).toFixed(0)}%
      </div>
    </div>
  );
}

function TrendChart({ points }: { points: PatternReport["emotionalTrend"] }) {
  const w = 600;
  const h = 160;
  const series = [
    { key: "fear", color: "#697184" },
    { key: "lucidity", color: "#b1a6a4" },
    { key: "uncertainty", color: "#d8cfd0" },
  ] as const;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-44" preserveAspectRatio="none">
      {series.map((s) => {
        const path = points
          .map((p, i) => {
            const x = i * step;
            const y = h - (p[s.key] / 100) * (h - 10) - 5;
            return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ");
        return (
          <path
            key={s.key}
            d={path}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
      {points.map((p, i) => {
        const x = i * step;
        const y = h - (p.fear / 100) * (h - 10) - 5;
        return <circle key={i} cx={x} cy={y} r={2.5} fill="#413f3d" />;
      })}
    </svg>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-data text-sm">{value}</span>
    </div>
  );
}
