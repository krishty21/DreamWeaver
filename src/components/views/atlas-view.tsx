"use client";

import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import {
  Globe,
  Loader2,
  Sparkles,
  Users,
  MapPin,
  Footprints,
  Tag,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
  Search,
  Layers,
  ChevronDown,
  Clock,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useMemo } from "react";
import type { AtlasEntry, Mood, PatternReport, TimelinePoint } from "@/lib/types";
import { MOOD_COLORS, MOODS } from "@/lib/moods";

async function fetchPatterns() {
  const res = await fetch("/api/patterns");
  return res.json();
}
async function fetchDreams() {
  const res = await fetch("/api/dreams");
  return res.json();
}

const TYPE_LABELS: Record<string, { label: string; icon: any }> = {
  symbol: { label: "Symbols & motifs", icon: Tag },
  person: { label: "People", icon: Users },
  place: { label: "Places", icon: MapPin },
  action: { label: "Actions", icon: Footprints },
};

const TYPE_ORDER: string[] = ["symbol", "person", "place", "action"];

// Lightweight dream metadata for the Atlas "Browse N dreams" stacked list.
// We already have dreamIds on each AtlasEntry; we just need to look them up
// to render a row per dream (date, title, mood, motif note if any).
type DreamMeta = {
  id: string;
  title: string | null;
  createdAt: string;
  mood: Mood | "neutral";
  motifNote?: string | null;
};

export function AtlasView() {
  const navigate = useApp((s) => s.navigate);
  const { data, isLoading } = useQuery({ queryKey: ["patterns"], queryFn: fetchPatterns });
  // r8 — also fetch the dreams list so we can map dreamIds → titles/dates/moods
  // for the per-card "Browse N dreams" stacked list. The journal and dashboard
  // already request this same endpoint, so react-query dedupes the request.
  const { data: dreamsData } = useQuery({ queryKey: ["dreams"], queryFn: fetchDreams });
  const report = data?.report as PatternReport | undefined;

  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState<string>("all");

  const atlas = report?.atlas ?? [];
  const timeline = report?.timeline ?? [];
  const recurringPairs = report?.recurringPairs ?? [];

  // Build a dreamId → DreamMeta lookup, including the per-dream motif note
  // for this atlas entry if present. The motifs array on each dream contains
  // {label, type, note} — we find the entry whose label matches (case-insensitive)
  // to surface its note alongside the row.
  const dreamMap = useMemo(() => {
    const m = new Map<string, DreamMeta>();
    for (const d of dreamsData?.dreams ?? []) {
      m.set(d.id, {
        id: d.id,
        title: d.title ?? null,
        createdAt: d.createdAt,
        mood: (d.mood as Mood) ?? "neutral",
      });
    }
    return m;
  }, [dreamsData]);

  // Lookup the per-dream motif note for a specific (atlasEntry, dreamId) pair.
  function motifNoteFor(entry: AtlasEntry, dreamId: string): string | null {
    const d = (dreamsData?.dreams ?? []).find((x: any) => x.id === dreamId);
    if (!d) return null;
    const match = (d.motifs ?? []).find(
      (m: any) => String(m.label).toLowerCase() === entry.label.toLowerCase()
    );
    return match?.note ?? null;
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return atlas.filter((e) => {
      if (activeType !== "all" && e.type !== activeType) return false;
      if (!q) return true;
      return (
        e.label.toLowerCase().includes(q) ||
        (e.note ?? "").toLowerCase().includes(q)
      );
    });
  }, [atlas, query, activeType]);

  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of atlas) m.set(e.type, (m.get(e.type) ?? 0) + 1);
    return m;
  }, [atlas]);

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
          <Globe className="h-6 w-6 text-muted-foreground" strokeWidth={1.4} />
        </div>
        <h1 className="font-display tracking-display text-4xl balance">
          The atlas is still forming.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground pretty max-w-md mx-auto">
          Once you have a dream or two, every person, place, and motif you've ever
          recorded will gather here — a longitudinal map of your dreaming mind.
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
    <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 py-10 sm:py-14">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="page-rule" aria-hidden="true" />
        <div className="eyebrow mb-2">
          <Globe className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
          Atlas
        </div>
        <h1 className="font-display tracking-display text-5xl sm:text-6xl leading-[0.95] balance">
          Every figure, every place, every return.
        </h1>
        <p className="mt-3 text-sm sm:text-base text-muted-foreground pretty max-w-2xl">
          {atlas.length} recorded element{atlas.length === 1 ? "" : "s"} across{" "}
          {report.totalDreams} dream{report.totalDreams === 1 ? "" : "s"}. The atlas
          collects everything Gemini has ever surfaced from your memory — people,
          places, actions, and the motifs that keep coming back. Computed app-side,
          never invented.
        </p>
      </motion.div>

      {/* Longitudinal timeline — chronological mood & intensity map */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="mt-10 surface p-6"
        aria-label="Dream timeline"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-2xl tracking-tight">Longitudinal arc</h2>
          <span className="text-xs text-muted-foreground tracking-caps uppercase">
            {timeline.length} dream{timeline.length === 1 ? "" : "s"}
          </span>
        </div>
        <TimelineStrip points={timeline} onPick={(id) => navigate("dream", { dreamId: id })} />
        <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: MOOD_COLORS.surreal }} />
            surreal
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: MOOD_COLORS.tense }} />
            tense
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: MOOD_COLORS.melancholic }} />
            melancholic
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: MOOD_COLORS.lucid }} />
            lucid
          </span>
          <span className="ml-auto italic">bar height = fear recorded for that dream</span>
        </div>
      </motion.section>

      {/* Search + filter */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08 }}
        className="mt-10 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip
            active={activeType === "all"}
            onClick={() => setActiveType("all")}
            label="All"
            count={atlas.length}
          />
          {TYPE_ORDER.map((t) => {
            const c = typeCounts.get(t) ?? 0;
            if (c === 0) return null;
            const Icon = TYPE_LABELS[t].icon;
            return (
              <FilterChip
                key={t}
                active={activeType === t}
                onClick={() => setActiveType(t)}
                label={TYPE_LABELS[t].label}
                count={c}
                icon={<Icon className="h-3 w-3" strokeWidth={1.6} aria-hidden="true" />}
              />
            );
          })}
        </div>
        <div className="relative w-full sm:w-72">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
            strokeWidth={1.6}
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the atlas…"
            aria-label="Search the atlas"
            className="w-full h-10 pl-9 pr-3 rounded-full bg-card/60 border border-border text-sm placeholder:text-muted-foreground focus-ring"
          />
        </div>
      </motion.div>

      {/* Catalog — grouped by type */}
      <div className="mt-6 space-y-10">
        {TYPE_ORDER.map((t) => {
          const entries = filtered.filter((e) => e.type === t);
          if (entries.length === 0) return null;
          const Icon = TYPE_LABELS[t].icon;
          return (
            <section key={t}>
              <div className="flex items-center gap-3 mb-4">
                <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
                <h2 className="font-display text-2xl tracking-tight">
                  {TYPE_LABELS[t].label}
                </h2>
                <span className="h-px flex-1 bg-border" />
                <span className="font-data text-xs text-muted-foreground">
                  {entries.length}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <AnimatePresence mode="popLayout">
                  {entries.map((e, i) => (
                    <AtlasCard
                      key={`${e.type}-${e.label}`}
                      entry={e}
                      index={i}
                      max={atlas[0]?.count || 1}
                      dreamMap={dreamMap}
                      motifNoteFor={motifNoteFor}
                      onOpen={(id) => navigate("dream", { dreamId: id })}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </section>
          );
        })}

        {filtered.length === 0 && (
          <div className="surface p-10 text-center">
            <Globe className="h-5 w-5 text-muted-foreground mx-auto mb-3" strokeWidth={1.4} />
            <p className="text-sm text-muted-foreground pretty">
              Nothing in the atlas matches "{query}". Try a different word, or clear the filter.
            </p>
            <button
              onClick={() => { setQuery(""); setActiveType("all"); }}
              className="mt-4 text-sm text-foreground hover:opacity-70 inline-flex items-center gap-1.5"
            >
              Clear the search
            </button>
          </div>
        )}
      </div>

      {/* r8 — motif co-occurrence panel. Surface the recurringPairs that
          patterns.ts already computes (pairs that appear together in >=2
          dreams). Sits at the bottom of the atlas as a closing insight. */}
      {recurringPairs.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.12 }}
          className="mt-12 surface p-6"
          aria-label="Motifs that travel together"
        >
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <Layers className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
            <h2 className="font-display text-2xl tracking-tight">Motifs that travel together</h2>
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground tracking-caps uppercase">
              {recurringPairs.length} pair{recurringPairs.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground pretty mb-4">
            Pairs of motifs that have shown up in the same dream — the recurring
            combinations of your interior world.
          </p>
          <div className="flex flex-wrap gap-2">
            {recurringPairs.map((p, i) => (
              <CoOccurrenceChip key={`${p.a}-${p.b}`} a={p.a} b={p.b} count={p.count} index={i} />
            ))}
          </div>
        </motion.section>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`filter-chip inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs focus-ring ${
        active
          ? "bg-foreground text-background"
          : "bg-foreground/[0.04] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.08]"
      }`}
    >
      {icon}
      {label}
      <span className={`font-data text-[10px] ${active ? "opacity-80" : "opacity-60"}`}>
        {count}
      </span>
    </button>
  );
}

// r8 — Co-occurrence chip: shows "motif a · motif b" with a "× N" badge.
// Both motif labels are clickable as a unit, but we keep them visually
// separated so the pair reads as a pair.
function CoOccurrenceChip({
  a,
  b,
  count,
  index,
}: {
  a: string;
  b: string;
  count: number;
  index: number;
}) {
  return (
    <motion.span
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.4) }}
      className="co-occurrence-chip inline-flex items-center gap-2 px-3 py-1.5 rounded-full surface-quiet lift"
      title={`These motifs have appeared together in ${count} of your dreams.`}
    >
      <span className="capitalize text-sm">{a}</span>
      <span className="text-muted-foreground/50 text-[10px] tracking-caps uppercase">·</span>
      <span className="capitalize text-sm">{b}</span>
      <span
        className="font-data text-[10px] tracking-caps uppercase rounded-full px-1.5 py-0.5 bg-foreground/[0.06] text-foreground/70"
        aria-label={`appeared together in ${count} dreams`}
      >
        ×{count}
      </span>
    </motion.span>
  );
}

function AtlasCard({
  entry,
  index,
  max,
  dreamMap,
  motifNoteFor,
  onOpen,
}: {
  entry: AtlasEntry;
  index: number;
  max: number;
  dreamMap: Map<string, DreamMeta>;
  motifNoteFor: (entry: AtlasEntry, dreamId: string) => string | null;
  onOpen: (dreamId: string) => void;
}) {
  const trendIcon =
    entry.trend === "rising" ? TrendingUp : entry.trend === "falling" ? TrendingDown : Minus;
  const Icon = trendIcon;
  const firstDate = new Date(entry.firstSeen);
  const lastDate = new Date(entry.lastSeen);
  const sameDay = firstDate.toDateString() === lastDate.toDateString();
  const dateRange = sameDay
    ? firstDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : `${firstDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${lastDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  // Mood spectrum — a tiny stacked bar showing the distribution of moods
  // across the dreams this entry appeared in.
  const total = entry.moodBreakdown.reduce((s, x) => s + x.count, 0) || 1;

  // r8 — expandable "Browse N dreams" panel. Clicking the toggle reveals an
  // inline list of every dream containing this motif, sorted newest-first,
  // each clickable to open the dream detail view. Replaces the previous
  // "Open last" affordance, which only opened the most recent occurrence.
  const [expanded, setExpanded] = useState(false);
  const dreams = entry.dreamIds
    .map((id) => {
      const meta = dreamMap.get(id);
      if (!meta) return null;
      return { ...meta, motifNote: motifNoteFor(entry, id) };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => (a.createdAt < b.createdAt ? 1 : -1)); // newest first

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.025, 0.3) }}
      whileHover={{ y: -3 }}
      className="atlas-card surface p-5 lift group flex flex-col"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="type-tag">{entry.type}</span>
          <h3 className="font-display text-2xl leading-tight capitalize truncate mt-0.5">
            {entry.label}
          </h3>
          {entry.note && (
            <p className="mt-0.5 text-xs text-muted-foreground italic line-clamp-1">
              {entry.note}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="font-data text-2xl leading-none">{entry.count}</div>
          <div className="text-[10px] text-muted-foreground tracking-caps uppercase mt-1 inline-flex items-center gap-0.5">
            <Icon className="h-3 w-3" strokeWidth={1.6} aria-hidden="true" />
            {entry.trend}
          </div>
        </div>
      </div>

      {/* frequency meter */}
      <div className="meter-track mt-3">
        <div
          className="meter-fill"
          style={{
            transform: `scaleX(${entry.count / max})`,
            background: "linear-gradient(90deg, var(--rose), var(--mauve))",
          }}
        />
      </div>

      {/* mood spectrum — per-motif mood distribution */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] tracking-caps uppercase text-muted-foreground">
          Mood spectrum
        </span>
        <div className="flex-1 h-2 rounded-full overflow-hidden flex bg-foreground/[0.05]">
          {MOODS.filter((m) => entry.moodBreakdown.some((b) => b.mood === m && b.count > 0)).map(
            (m) => {
              const c = entry.moodBreakdown.find((b) => b.mood === m)?.count ?? 0;
              if (!c) return null;
              return (
                <span
                  key={m}
                  title={`${m}: ${c}`}
                  style={{ width: `${(c / total) * 100}%`, background: MOOD_COLORS[m] }}
                  className="block h-full mood-segment"
                />
              );
            }
          )}
        </div>
      </div>

      <div className="mt-3 text-[11px] text-muted-foreground pretty">
        {dateRange}{" · "}avg fear {(entry.avgFear * 100).toFixed(0)}%
      </div>

      <div className="mt-auto pt-4 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground tracking-caps uppercase">
          {entry.dreamIds.length} dream{entry.dreamIds.length === 1 ? "" : "s"}
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={`atlas-dreams-${entry.label.replace(/\s+/g, "-").toLowerCase()}`}
          className="atlas-browse-btn inline-flex items-center gap-1 text-xs text-foreground hover:opacity-70 focus-ring rounded"
        >
          <Layers className="h-3 w-3" strokeWidth={1.6} aria-hidden="true" />
          {entry.dreamIds.length === 1 ? "Open the dream" : `Browse ${entry.dreamIds.length} dreams`}
          <ChevronDown
            className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
            strokeWidth={1.6}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* r8 — expandable stacked list of every dream containing this motif. */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id={`atlas-dreams-${entry.label.replace(/\s+/g, "-").toLowerCase()}`}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="atlas-dreams-stack overflow-hidden mt-3 -mx-1 sm:mx-0"
          >
            <ul className="space-y-1">
              {dreams.map((d: any) => (
                <li key={d.id}>
                  <button
                    onClick={() => onOpen(d.id)}
                    className="atlas-dream-row w-full text-left px-2 sm:px-3 py-2 rounded-md flex items-center gap-3 hover:bg-foreground/[0.04] focus-ring transition"
                    aria-label={`Open dream: ${d.title ?? "Untitled dream"}, ${new Date(d.createdAt).toLocaleDateString()}`}
                  >
                    <span
                      className="mood-dot shrink-0"
                      style={{ background: MOOD_COLORS[d.mood as Mood] ?? MOOD_COLORS.neutral }}
                      aria-hidden="true"
                    />
                    <span className="font-data text-[10px] text-muted-foreground tracking-caps uppercase shrink-0 w-14 tabular-nums">
                      {new Date(d.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-sm font-display">
                      {d.title || "Untitled dream"}
                    </span>
                    {d.motifNote && (
                      <span className="hidden sm:inline text-[11px] text-muted-foreground italic line-clamp-1 max-w-[40%]">
                        {d.motifNote}
                      </span>
                    )}
                    <ArrowRight className="h-3 w-3 shrink-0 opacity-50 group-hover:opacity-100 transition" strokeWidth={1.6} aria-hidden="true" />
                  </button>
                </li>
              ))}
              {dreams.length === 0 && (
                <li className="px-3 py-2 text-xs text-muted-foreground italic">
                  No dreams found.
                </li>
              )}
            </ul>
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground italic">
              <Clock className="h-2.5 w-2.5" strokeWidth={1.6} aria-hidden="true" />
              newest first · {dreams.length} of {entry.dreamIds.length} shown
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

function TimelineStrip({
  points,
  onPick,
}: {
  points: TimelinePoint[];
  onPick: (id: string) => void;
}) {
  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No dreams yet.</p>;
  }
  const maxFear = Math.max(...points.map((p) => p.fear), 0.01);
  const maxMotifs = Math.max(8, ...points.map((p) => p.motifCount));
  return (
    <div className="flex items-end gap-1.5 overflow-x-auto pb-2 scroll-elegant">
      {points.map((p, i) => {
        const h = 24 + (p.fear / maxFear) * 56; // 24..80px
        const color = MOOD_COLORS[p.mood] ?? MOOD_COLORS.neutral;
        const date = new Date(p.date);
        return (
          <button
            key={p.dreamId}
            onClick={() => onPick(p.dreamId)}
            className="group flex flex-col items-center gap-1.5 shrink-0 focus-ring rounded-md"
            style={{ width: 56 }}
            title={`${p.title} — ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}
            aria-label={`Open dream: ${p.title}, ${date.toLocaleDateString()}`}
          >
            <span
              className="block rounded-t-md transition-all group-hover:scale-y-105 group-hover:opacity-100"
              style={{
                width: 36,
                height: Math.round(h),
                background: color,
                opacity: 0.55 + 0.45 * (p.motifCount / maxMotifs),
              }}
            />
            <span className="font-data text-[10px] text-muted-foreground group-hover:text-foreground transition">
              {date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
            </span>
            <span className="sr-only">
              {" · "}
              {p.mood} · {p.motifCount} motifs
            </span>
            {/* invisible spacer for first-point animation */}
            {i === 0 && <span className="sr-only">earliest</span>}
          </button>
        );
      })}
    </div>
  );
}
