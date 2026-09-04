"use client";

import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import {
  Loader2,
  Network,
  ArrowUpRight,
  Activity,
  Users,
  MapPin,
  Tag,
  Footprints,
  Smile,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
  Brain,
} from "lucide-react";
import { motion } from "framer-motion";
import type { DreamThread, Mood } from "@/lib/types";
import { MOOD_COLORS } from "@/lib/moods";

// r12 — DREAM THREADS: the Dream Memory Graph.
//
// Each canonical entity (the unified node behind different textual mentions
// of the same dream element) is traced through time as a THREAD. The user
// sees: "this thing has appeared in N dreams; its role has changed across
// them." This is the directive's §8–10 conceptual requirement made visible.
//
// Everything here is computed app-side by /api/threads (the memory-graph
// reconciler); the model is never involved in canonicalisation, thread
// construction, or evolution summary. The dreamer can trust that the
// "evolution" claim is grounded in their own recorded motifs, not invented.

const TYPE_ICON: Record<string, any> = {
  symbol: Tag,
  person: Users,
  place: MapPin,
  action: Footprints,
  emotion: Smile,
};

async function fetchThreads() {
  const res = await fetch("/api/threads");
  if (!res.ok) throw new Error("failed");
  const data = await res.json();
  return data.threads as DreamThread[];
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

function fearArcPath(values: number[], w = 120, h = 28): string {
  if (values.length === 0) return "";
  if (values.length === 1) return `M 0 ${h - values[0] * h}`;
  const step = w / (values.length - 1);
  return values
    .map((v, i) => {
      const x = i * step;
      const y = h - Math.max(0, Math.min(1, v)) * h;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function moodColor(m: Mood): string {
  return MOOD_COLORS[m] ?? "var(--mauve)";
}

function TrendBadge({ trend }: { trend: "rising" | "falling" | "stable" }) {
  const map = {
    rising: { icon: TrendingUp, label: "rising", tint: "var(--rose)" },
    falling: { icon: TrendingDown, label: "falling", tint: "var(--mauve)" },
    stable: { icon: Minus, label: "steady", tint: "var(--slate)" },
  } as const;
  const { icon: Icon, label, tint } = map[trend] ?? map.stable;
  return (
    <span className="inline-flex items-center gap-1 font-data text-[10px] tracking-caps uppercase" style={{ color: tint }}>
      <Icon className="h-3 w-3" strokeWidth={1.6} />
      {label}
    </span>
  );
}

export function ThreadsView() {
  const navigate = useApp((s) => s.navigate);
  const { data: threads, isLoading, error } = useQuery({
    queryKey: ["threads"],
    queryFn: fetchThreads,
    staleTime: 0,
    refetchOnMount: "always",
  });

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <p className="text-sm text-muted-foreground">
          The dream memory couldn&apos;t be reached right now. Try again in a moment.
        </p>
      </div>
    );
  }

  const list = threads ?? [];
  const recurring = list.filter((t) => t.dreamCount >= 2);
  const singular = list.filter((t) => t.dreamCount < 2);

  return (
    <div className="w-full max-w-5xl mx-auto px-5 sm:px-8 py-10 sm:py-14">
      {/* Header */}
      <header className="mb-10 sm:mb-14">
        <div className="flex items-center gap-2 text-[11px] tracking-caps uppercase text-muted-foreground">
          <Network className="h-3.5 w-3.5" strokeWidth={1.6} />
          Dream Memory Graph
        </div>
        <h1 className="mt-3 font-display text-4xl sm:text-5xl tracking-display balance leading-[1.05]">
          The threads that connect your dreams.
        </h1>
        <p className="mt-4 text-sm sm:text-base text-muted-foreground pretty max-w-2xl">
          Every recurring element — a place, a figure, a movement, a feeling — is traced through
          the dreams it touched. Different wordings of the same thing are reconciled into one
          thread, so the memory is the world, not a list of entries.
        </p>
        <p className="mt-3 text-[11px] text-muted-foreground/70 italic">
          Computed app-side from your recorded motifs; never invented by the model.
        </p>
      </header>

      {list.length === 0 ? (
        <EmptyState onCapture={() => navigate("capture")} />
      ) : (
        <div className="space-y-10">
          {recurring.length > 0 && (
            <section>
              <SectionHead label="Recurring threads" hint={`${recurring.length} · traced across multiple dreams`} />
              <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
                {recurring.map((t, i) => (
                  <ThreadCard key={t.id} thread={t} index={i} navigate={navigate} priority />
                ))}
              </div>
            </section>
          )}

          {singular.length > 0 && (
            <section>
              <SectionHead label="First appearances" hint={`${singular.length} · observed once so far`} />
              <div className="mt-5 flex flex-wrap gap-2">
                {singular.map((t) => {
                  const Icon = TYPE_ICON[t.type] ?? Tag;
                  return (
                    <button
                      key={t.id}
                      onClick={() => navigate("dream", { dreamId: t.mentions[0]?.dreamId })}
                      className="thread-chip group"
                      title={`First seen ${fmtDate(t.firstSeen)}`}
                    >
                      <Icon className="h-3 w-3 mr-1.5 opacity-70" strokeWidth={1.6} />
                      <span>{t.label}</span>
                      <span className="ml-1.5 font-data text-[9px] tracking-caps uppercase text-muted-foreground/70">
                        {t.type}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function SectionHead({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/40 pb-2">
      <h2 className="font-display text-xl sm:text-2xl tracking-display">{label}</h2>
      <span className="font-data text-[10px] tracking-caps uppercase text-muted-foreground">{hint}</span>
    </div>
  );
}

function EmptyState({ onCapture }: { onCapture: () => void }) {
  return (
    <div className="surface p-10 text-center">
      <Network className="h-8 w-8 mx-auto text-muted-foreground/50" strokeWidth={1.2} />
      <h3 className="mt-4 font-display text-2xl tracking-display">No threads yet.</h3>
      <p className="mt-2 text-sm text-muted-foreground pretty max-w-md mx-auto">
        Capture a few dreams and DreamWeaver will begin to weave their recurring elements into
        threads — the figures, places, and movements that return across nights.
      </p>
      <button
        onClick={onCapture}
        className="mt-5 inline-flex items-center gap-2 h-10 px-5 bg-foreground text-background text-sm hover:opacity-90 transition-opacity"
      >
        Capture a dream
      </button>
    </div>
  );
}

function ThreadCard({
  thread,
  index,
  navigate,
  priority,
}: {
  thread: DreamThread;
  index: number;
  navigate: (view: any, opts?: any) => void;
  priority?: boolean;
}) {
  const Icon = TYPE_ICON[thread.type] ?? Tag;
  const ev = thread.evolution;
  // sparkline values are fear (0..1); show only when 2+ mentions
  const arc = ev.fearArc.length >= 2 ? ev.fearArc : [];
  const arcTrend: "rising" | "falling" | "stable" =
    arc.length >= 2 && arc[arc.length - 1] - arc[0] > 0.08
      ? "rising"
      : arc.length >= 2 && arc[arc.length - 1] - arc[0] < -0.08
      ? "falling"
      : "stable";

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.3) }}
      className="surface thread-card p-6"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] tracking-caps uppercase text-muted-foreground">
            <Icon className="h-3 w-3" strokeWidth={1.6} />
            {thread.type}
            {thread.aliases.length > 0 && (
              <span className="text-muted-foreground/60">· {thread.aliases.length} alias{thread.aliases.length === 1 ? "" : "es"}</span>
            )}
          </div>
          <h3 className="mt-1.5 font-display text-2xl sm:text-3xl tracking-display balance leading-tight">
            {thread.label}
          </h3>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-data text-2xl text-foreground/90 leading-none">{thread.dreamCount}</div>
          <div className="font-data text-[9px] tracking-caps uppercase text-muted-foreground mt-1">
            dream{thread.dreamCount === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {/* Evolution summary */}
      <div className="mt-4 pt-4 border-t border-border/30">
        <div className="flex items-center gap-2 text-[10px] tracking-caps uppercase text-muted-foreground">
          <Activity className="h-3 w-3" strokeWidth={1.6} />
          Motif evolution
          {ev.hasShift && <span className="text-[var(--rose)]">· shifting</span>}
        </div>
        <p className="mt-2 text-sm leading-relaxed pretty text-foreground/90">{ev.summary}</p>

        {/* Role sequence */}
        {ev.roles.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {ev.roles.map((role, i) => (
              <span key={i} className="thread-role-chip">
                {role}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Fear arc sparkline */}
      {arc.length >= 2 && (
        <div className="mt-4 flex items-center gap-3">
          <svg
            viewBox="0 0 120 28"
            className="thread-sparkline flex-1"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d={fearArcPath(arc)} fill="none" strokeWidth="1.5" stroke="var(--slate)" strokeLinecap="round" strokeLinejoin="round" />
            {arc.map((v, i) => {
              const step = 120 / (arc.length - 1);
              const x = i * step;
              const y = 28 - Math.max(0, Math.min(1, v)) * 28;
              return <circle key={i} cx={x} cy={y} r="1.8" fill="var(--rose)" />;
            })}
          </svg>
          <TrendBadge trend={arcTrend} />
        </div>
      )}

      {/* Chronological mentions */}
      <div className="mt-5 pt-4 border-t border-border/30">
        <div className="text-[10px] tracking-caps uppercase text-muted-foreground mb-3">
          Across {thread.mentions.length} appearance{thread.mentions.length === 1 ? "" : "s"}
        </div>
        <ol className="space-y-2.5">
          {thread.mentions.slice(0, 6).map((m, i) => {
            const mood = m.mood as Mood;
            return (
              <li key={m.mentionId} className="thread-mention-row">
                <span className="thread-mention-dot" style={{ background: moodColor(mood) }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-data text-[10px] text-muted-foreground/70 shrink-0">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <button
                      onClick={() => navigate("dream", { dreamId: m.dreamId })}
                      className="text-sm font-medium text-foreground/90 hover:text-foreground hover:underline underline-offset-4 decoration-1 truncate text-left"
                      title={m.dreamTitle}
                    >
                      {m.dreamTitle}
                    </button>
                    <span className="thread-role-tag">{m.role}</span>
                  </div>
                  <div className="font-data text-[10px] text-muted-foreground/60 mt-0.5">
                    {fmtDate(m.date)}
                    {m.surfaceLabel !== thread.label && ` · as “${m.surfaceLabel}”`}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Associated entities */}
      {thread.associatedWith.length > 0 && (
        <div className="mt-5 pt-4 border-t border-border/30">
          <div className="text-[10px] tracking-caps uppercase text-muted-foreground mb-3">
            Appears alongside
          </div>
          <div className="flex flex-wrap gap-1.5">
            {thread.associatedWith.map((a, i) => (
              <span key={i} className="thread-assoc-chip" title={`${a.count} co-occurrence${a.count === 1 ? "" : "s"}`}>
                {a.label}
                <span className="ml-1 font-data text-[9px] text-muted-foreground/70">×{a.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-5 pt-4 border-t border-border/30 flex items-center justify-between gap-2">
        <span className="font-data text-[10px] text-muted-foreground/70">
          {fmtDate(thread.firstSeen)} → {fmtDate(thread.lastSeen)}
        </span>
        {thread.mentions[0] && (
          <button
            onClick={() => navigate("dream", { dreamId: thread.mentions[thread.mentions.length - 1].dreamId })}
            className="thread-cta"
          >
            Open the latest
            <ArrowRight className="h-3 w-3" strokeWidth={1.6} />
          </button>
        )}
      </div>
    </motion.article>
  );
}
