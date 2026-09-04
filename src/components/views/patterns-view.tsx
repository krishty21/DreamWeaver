"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import { Map, Loader2, TrendingUp, TrendingDown, Minus, Feather, X, RotateCcw } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import type { PatternReport, LexiconWord } from "@/lib/types";
import { DreamCalendar } from "@/components/views/dream-calendar";

async function fetchPatterns() {
  const res = await fetch("/api/patterns");
  return res.json();
}

export function PatternsView() {
  const navigate = useApp((s) => s.navigate);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["patterns"], queryFn: fetchPatterns });
  const report = data?.report as PatternReport | undefined;

  // r11 — mute / restore a lexicon word. The list itself is recomputed
  // server-side on /api/patterns (muted words are excluded BEFORE ranking, so
  // the next recurring word surfaces in the muted word's place).
  const ignoreMut = useMutation({
    mutationFn: async ({ word, restore }: { word: string; restore?: boolean }) => {
      const res = await fetch("/api/patterns/lexicon", {
        method: restore ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "The lexicon could not be updated.");
      }
      return { word, restore };
    },
    onSuccess: ({ word, restore }) => {
      qc.invalidateQueries({ queryKey: ["patterns"] });
      toast({
        title: restore ? "Word restored" : "Word muted",
        description: restore
          ? `“${word}” rejoins the cloud on the next breath.`
          : `“${word}” steps aside — the next recurring word takes its place.`,
      });
    },
    onError: (e: any) => {
      toast({ title: "Lexicon update failed", description: e.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-28">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!report || report.totalDreams === 0) {
    return (
      <div className="mx-auto w-full max-w-4xl px-5 sm:px-8 py-14 text-center">
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
          Capture a dream
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 py-10 sm:py-14">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="page-rule" aria-hidden="true" />
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

      {/* Nights-remembered calendar — full width */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="mt-10 surface p-6"
        aria-label="Dream calendar"
      >
        <DreamCalendar days={report.dreamCalendar ?? []} />
      </motion.section>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-5">
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

      {/* r9 — Dream lexicon: the words your dreaming mind reaches for most.
          Computed app-side from raw texts (never the model). Clicking a word
          jumps to the journal pre-filtered to that word.
          r11 — words can be MUTED (× on hover); the cloud recomposes without
          them and the muted set is restorable below. */}
      {((report.lexicon ?? []).length > 0 || (report.lexiconIgnored ?? []).length > 0) && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="mt-8 surface p-6 sm:p-8"
          aria-label="Dream lexicon"
        >
          <div className="flex items-start justify-between gap-4 mb-1">
            <div>
              <h2 className="font-display text-2xl sm:text-3xl tracking-tight">The lexicon of your dreams</h2>
              <p className="mt-1 text-[11px] text-muted-foreground italic">
                The words your memory reaches for, counted across every raw dream — not chosen by the model.
                Tap a word to find every dream it appears in; hover a word and press × to mute the noise.
              </p>
            </div>
            <span className="hidden sm:inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.05]">
              <Feather className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
            </span>
          </div>
          <LexiconCloud
            words={report.lexicon ?? []}
            busy={ignoreMut.isPending}
            onIgnore={(word) => ignoreMut.mutate({ word })}
          />
          {(report.lexiconIgnored ?? []).length > 0 && (
            <div className="mt-5 pt-4 border-t border-border/60">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-muted-foreground italic">Muted from the cloud:</span>
                {(report.lexiconIgnored ?? []).map((w) => (
                  <button
                    key={w}
                    type="button"
                    className="lexicon-restore-chip"
                    disabled={ignoreMut.isPending}
                    onClick={() => ignoreMut.mutate({ word: w, restore: true })}
                    aria-label={`Restore the word ${w} to the lexicon`}
                  >
                    <RotateCcw className="h-3 w-3" strokeWidth={1.7} aria-hidden="true" />
                    {w}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground/70 pretty">
                Muted words are skipped while the cloud is composed — the next recurring word takes their
                place. Nothing is deleted from your dreams; the muting is a lens, not an eraser.
              </p>
            </div>
          )}
        </motion.section>
      )}
    </div>
  );
}

// r9 — typographic word cloud. Sizes are scaled between the most and least
// frequent entries; words fade in with a small stagger so the cloud "surfaces"
// like a memory rather than rendering all at once.
// r11 — each word carries a mute (×) affordance that appears on hover/focus;
// muting asks the server to skip the word and recompose the cloud.
function LexiconCloud({
  words,
  busy,
  onIgnore,
}: {
  words: LexiconWord[];
  busy: boolean;
  onIgnore: (word: string) => void;
}) {
  const navigate = useApp((s) => s.navigate);
  const setJournalQuery = useApp((s) => s.setJournalQuery);
  if (words.length === 0) {
    return (
      <p className="mt-5 text-sm text-muted-foreground italic">
        Every recurring word is muted — restore one below, or record another night.
      </p>
    );
  }
  const maxDreams = words[0].dreamCount;
  const minDreams = words[words.length - 1].dreamCount;
  const span = Math.max(1, maxDreams - minDreams);
  return (
    <div className="lexicon-cloud mt-5" role="group" aria-label="Words that recur across your dreams">
      {words.map((w, i) => {
        const t = (w.dreamCount - minDreams) / span; // 0..1
        const size = 15 + t * 19; // 15px .. 34px
        const italic = i % 5 === 2; // every 5th word italic — editorial rhythm
        return (
          <span key={w.word} className="lexicon-cell">
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: Math.min(i * 0.035, 0.8) }}
              className="lexicon-word"
              style={{ fontSize: `${size.toFixed(1)}px`, fontStyle: italic ? "italic" : "normal", fontWeight: t > 0.6 ? 600 : 400 }}
              title={`“${w.word}” appears in ${w.dreamCount} dream${w.dreamCount === 1 ? "" : "s"} (${w.count} times)`}
              aria-label={`Find dreams containing the word ${w.word} — appears in ${w.dreamCount} dreams`}
              onClick={() => {
                setJournalQuery(w.word);
                navigate("journal");
              }}
            >
              {w.word}
              <span className="lexicon-count" aria-hidden="true">×{w.dreamCount}</span>
            </motion.button>
            <button
              type="button"
              className="lexicon-x"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                onIgnore(w.word);
              }}
              aria-label={`Mute the word ${w.word} from the lexicon`}
              title={`Mute “${w.word}” — hide it from the cloud`}
            >
              <X className="h-2.5 w-2.5" strokeWidth={2.4} />
            </button>
          </span>
        );
      })}
      <span className="sr-only">End of lexicon.</span>
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
