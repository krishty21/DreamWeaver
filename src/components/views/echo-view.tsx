"use client";

import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import {
  ArrowLeft,
  Loader2,
  Repeat,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  MapPin,
  Tag,
  Footprints,
  Smile,
} from "lucide-react";
import { motion } from "framer-motion";
import { useMemo } from "react";
import type { Mood } from "@/lib/types";
import { MOOD_COLORS } from "@/lib/moods";

// r10 — DREAM ECHO: a comparative view of two dreams (#/echo/<a>/<b>).
// Answers the question the Atlas co-occurrence chips raise: "these motifs
// travel together — what do the nights actually look like side by side?"
// Everything is computed app-side from the cached /api/dreams payload: shared
// motifs/people/places/actions/emotions, emotional drift between the two
// nights, nights apart, words remembered. No model calls.

async function fetchDreams() {
  const res = await fetch("/api/dreams");
  if (!res.ok) throw new Error("failed");
  return res.json();
}

function safeParseArray(v: unknown): any[] {
  try {
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function labelsOf(d: any, json: string, key: string): string[] {
  return safeParseArray(d?.analysis?.[json])
    .map((x: any) => String(x?.[key] ?? "").trim())
    .filter(Boolean);
}

function wordCount(text: string | null | undefined): number {
  if (!text) return 0;
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function EchoView() {
  const dreamIdA = useApp((s) => s.activeDreamId);
  const dreamIdB = useApp((s) => s.echoDreamId);
  const navigate = useApp((s) => s.navigate);
  const { data, isLoading } = useQuery({ queryKey: ["dreams"], queryFn: fetchDreams });

  const dreams: any[] = data?.dreams ?? [];
  const a = dreams.find((d) => d.id === dreamIdA) ?? null;
  const b = dreams.find((d) => d.id === dreamIdB) ?? null;

  const comparison = useMemo(() => {
    if (!a || !b) return null;
    const motifLabels = (d: any): string[] =>
      Array.from(new Set((d.motifs ?? []).map((m: any) => String(m.label).toLowerCase())));
    const setA = new Set(motifLabels(a));
    const setB = new Set(motifLabels(b));
    const sharedMotifs = Array.from(setA).filter((l) => setB.has(l));
    const sharedPeople = labelsOf(a, "peopleJson", "name")
      .map((s) => s.toLowerCase())
      .filter((s) => labelsOf(b, "peopleJson", "name").map((x) => x.toLowerCase()).includes(s));
    const sharedPlaces = labelsOf(a, "locationsJson", "label")
      .map((s) => s.toLowerCase())
      .filter((s) => labelsOf(b, "locationsJson", "label").map((x) => x.toLowerCase()).includes(s));
    const sharedActions = labelsOf(a, "actionsJson", "label")
      .map((s) => s.toLowerCase())
      .filter((s) => labelsOf(b, "actionsJson", "label").map((x) => x.toLowerCase()).includes(s));
    const sharedEmotions = labelsOf(a, "emotionsJson", "emotion")
      .map((s) => s.toLowerCase())
      .filter((s) => labelsOf(b, "emotionsJson", "emotion").map((x) => x.toLowerCase()).includes(s));
    const nights = Math.abs(
      Math.round(
        (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) / 86_400_000
      )
    );
    return {
      sharedMotifs: Array.from(new Set([...sharedMotifs])).sort(),
      sharedPeople: Array.from(new Set(sharedPeople)),
      sharedPlaces: Array.from(new Set(sharedPlaces)),
      sharedActions: Array.from(new Set(sharedActions)),
      sharedEmotions: Array.from(new Set(sharedEmotions)),
      nights,
      // motif rows with type + note (from either dream, first match wins)
      motifRows: sharedMotifs
        .map((l) => {
          const ma = (a.motifs ?? []).find((m: any) => String(m.label).toLowerCase() === l);
          const mb = (b.motifs ?? []).find((m: any) => String(m.label).toLowerCase() === l);
          return { label: (ma ?? mb)?.label ?? l, type: (ma ?? mb)?.type ?? "symbol", note: ma?.note ?? mb?.note ?? null };
        })
        .sort((x, y) => x.label.localeCompare(y.label)),
    };
  }, [a, b]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-28">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!a || !b || !comparison) {
    return (
      <div className="mx-auto w-full max-w-3xl px-5 sm:px-8 py-16 text-center">
        <Repeat className="h-8 w-8 mx-auto text-muted-foreground" strokeWidth={1.4} />
        <h1 className="mt-5 font-display text-4xl tracking-display balance">
          This echo could not be heard.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground pretty max-w-md mx-auto">
          One of the two dreams is missing — it may have been deleted. Echoes need two nights to
          resonate.
        </p>
        <button
          onClick={() => navigate("journal")}
          className="mt-6 px-5 py-2.5 rounded-full text-sm border border-border hover:bg-card transition focus-ring"
        >
          Back to the journal
        </button>
      </div>
    );
  }

  const fearDelta = pct(b.analysis?.fear) - pct(a.analysis?.fear);
  const lucidityDelta = pct(b.analysis?.lucidity) - pct(a.analysis?.lucidity);
  const uncertaintyDelta = pct(b.analysis?.uncertainty) - pct(a.analysis?.uncertainty);

  return (
    <div className="mx-auto w-full max-w-5xl px-5 sm:px-8 py-10 sm:py-14">
      <button
        onClick={() => navigate("atlas")}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition focus-ring mb-6"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.6} />
        Atlas
      </button>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="page-rule" aria-hidden="true" />
        <div className="eyebrow mb-2">
          <Repeat className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
          Dream echo
        </div>
        <h1 className="font-display tracking-display text-5xl sm:text-6xl leading-[0.95] balance">
          Two nights, one thread.
        </h1>
        <p className="mt-3 text-sm sm:text-base text-muted-foreground pretty max-w-2xl">
          {comparison.nights === 0
            ? "Both dreamed on the same night — two rooms of the same house."
            : `${comparison.nights} night${comparison.nights === 1 ? "" : "s"} apart.`}{" "}
          {comparison.sharedMotifs.length > 0
            ? `${comparison.sharedMotifs.length} element${comparison.sharedMotifs.length === 1 ? "" : "s"} returned in both dreams — the thread is highlighted below.`
            : "No shared elements were found between these two nights — the echo is faint."}{" "}
          Computed app-side, never the model.
        </p>
      </motion.div>

      {/* the two nights, side by side */}
      <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-0 echo-grid">
        <EchoSide
          dream={a}
          shared={new Set(comparison.sharedMotifs)}
          onOpen={() => navigate("dream", { dreamId: a.id })}
          position="first"
        />
        <EchoSide
          dream={b}
          shared={new Set(comparison.sharedMotifs)}
          onOpen={() => navigate("dream", { dreamId: b.id })}
          position="second"
        />
      </div>

      {/* the thread — shared elements */}
      {comparison.sharedMotifs.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="mt-10 surface p-6"
          aria-label="The thread between these dreams"
        >
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <Repeat className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
            <h2 className="font-display text-2xl tracking-tight">The thread between them</h2>
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground tracking-caps uppercase">
              {comparison.motifRows.length} shared
            </span>
          </div>
          <ul className="space-y-2">
            {comparison.motifRows.map((m) => {
              const Icon =
                m.type === "person" ? Users : m.type === "place" ? MapPin : m.type === "action" ? Footprints : Tag;
              return (
                <li
                  key={m.label}
                  className="echo-thread-row flex items-start gap-3 px-3 py-2.5 rounded-lg"
                >
                  <span className="echo-thread-icon shrink-0">
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-display text-lg capitalize">{m.label}</span>
                      <span className="font-data text-[9px] tracking-caps uppercase text-muted-foreground">
                        {m.type} · in both dreams
                      </span>
                    </div>
                    {m.note && (
                      <p className="text-xs text-muted-foreground italic line-clamp-1 pretty">{m.note}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {(comparison.sharedEmotions.length > 0 || comparison.sharedPlaces.length > 0) && (
            <div className="mt-4 pt-4 border-t border-border flex flex-col sm:flex-row gap-2 sm:gap-6 text-[11px]">
              {comparison.sharedEmotions.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="tracking-caps uppercase text-muted-foreground shrink-0 mt-0.5 inline-flex items-center gap-1">
                    <Smile className="h-3 w-3" strokeWidth={1.6} aria-hidden="true" /> Same feelings
                  </span>
                  <span className="capitalize">{comparison.sharedEmotions.join(", ")}</span>
                </div>
              )}
              {comparison.sharedPlaces.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="tracking-caps uppercase text-muted-foreground shrink-0 mt-0.5 inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" strokeWidth={1.6} aria-hidden="true" /> Same places
                  </span>
                  <span className="capitalize">{comparison.sharedPlaces.join(", ")}</span>
                </div>
              )}
            </div>
          )}
        </motion.section>
      )}

      {/* emotional drift */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.12 }}
        className="mt-6 surface p-6"
        aria-label="Emotional drift between the two dreams"
      >
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <TrendingUp className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
          <h2 className="font-display text-2xl tracking-tight">The drift between them</h2>
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground tracking-caps uppercase">
            first → second
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <DriftMeter label="Fear / tension" from={pct(a.analysis?.fear)} to={pct(b.analysis?.fear)} delta={fearDelta} />
          <DriftMeter label="Lucidity" from={pct(a.analysis?.lucidity)} to={pct(b.analysis?.lucidity)} delta={lucidityDelta} />
          <DriftMeter label="Uncertainty" from={pct(a.analysis?.uncertainty)} to={pct(b.analysis?.uncertainty)} delta={uncertaintyDelta} />
        </div>
        <p className="mt-4 text-[11px] text-muted-foreground italic">
          Estimates are AI-reported and advisory; the comparison itself is computed by the app.
        </p>
      </motion.section>
    </div>
  );
}

function EchoSide({
  dream,
  shared,
  onOpen,
  position,
}: {
  dream: any;
  shared: Set<string>;
  onOpen: () => void;
  position: "first" | "second";
}) {
  const mood = (dream.mood as Mood) ?? "neutral";
  const date = new Date(dream.createdAt);
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: position === "first" ? 0.02 : 0.06 }}
      onClick={onOpen}
      className={`echo-side surface p-6 text-left lift group focus-ring ${position === "second" ? "md:-ml-3 echo-side-second" : ""}`}
      aria-label={`Open dream: ${dream.title ?? "Untitled dream"}`}
    >
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-3">
        <span
          className="mood-dot shrink-0"
          style={{ background: MOOD_COLORS[mood] ?? MOOD_COLORS.neutral }}
          aria-hidden="true"
        />
        <span className="font-data tracking-caps uppercase">
          {date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
        </span>
        <span className="chip">{mood}</span>
      </div>
      <h3 className="font-display text-3xl leading-tight balance group-hover:opacity-80 transition">
        {dream.title || "Untitled dream"}
      </h3>
      <p className="mt-2 text-sm text-muted-foreground pretty line-clamp-4">
        {dream.analysis?.summary ?? dream.rawText?.slice(0, 180) ?? ""}
      </p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {(dream.motifs ?? []).slice(0, 8).map((m: any, i: number) => {
          const isShared = shared.has(String(m.label).toLowerCase());
          return (
            <span
              key={i}
              className={`chip capitalize ${isShared ? "echo-shared-chip" : ""}`}
              title={isShared ? "returned in both dreams" : undefined}
            >
              {m.label}
            </span>
          );
        })}
        {(dream.motifs?.length ?? 0) > 8 && (
          <span className="font-data text-[10px] text-muted-foreground self-center">
            +{(dream.motifs?.length ?? 0) - 8}
          </span>
        )}
      </div>
      <div className="mt-5 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="font-data">
          {wordCount(dream.rawText)} words ·{" "}
          {dream.analysis ? `${Math.round((dream.analysis.fear ?? 0) * 100)}% fear` : "unreflected"}
        </span>
        <span className="inline-flex items-center gap-1 opacity-60 group-hover:opacity-100 transition">
          open
          <ArrowRight className="h-3 w-3" strokeWidth={1.6} aria-hidden="true" />
        </span>
      </div>
    </motion.button>
  );
}

function DriftMeter({
  label,
  from,
  to,
  delta,
}: {
  label: string;
  from: number;
  to: number;
  delta: number;
}) {
  const Icon = Math.abs(delta) < 3 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const tone = Math.abs(delta) < 3 ? "flat" : delta > 0 ? "rose" : "mauve";
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-2">
        <span className="text-muted-foreground">{label}</span>
        <span className={`echo-drift-badge echo-drift-${tone} inline-flex items-center gap-1`}>
          <Icon className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
          {delta > 0 ? "+" : ""}
          {delta.toFixed(0)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-data text-[11px] text-muted-foreground w-8 text-right tabular-nums">
          {from.toFixed(0)}%
        </span>
        <div className="flex-1 h-2 rounded-full bg-foreground/[0.06] relative overflow-hidden">
          <span
            className="absolute inset-y-0 left-0 rounded-full echo-drift-bar-from"
            style={{ width: `${from}%` }}
          />
          <span
            className="absolute inset-y-0 left-0 rounded-full echo-drift-bar-to"
            style={{ width: `${to}%` }}
          />
        </div>
        <span className="font-data text-[11px] text-foreground w-8 tabular-nums">
          {to.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

function pct(v: unknown): number {
  return typeof v === "number" ? Math.round(v * 100) : 0;
}
