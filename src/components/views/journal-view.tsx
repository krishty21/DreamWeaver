"use client";

import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Sparkles,
  Compass,
  Inbox,
  FileDown,
  Search,
  X,
  CalendarDays,
  MoonStar,
} from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildJournalMarkdown, downloadMarkdown } from "@/lib/journal-export";
import { useToast } from "@/hooks/use-toast";
import type { Mood } from "@/lib/types";
import { MOOD_COLORS, MOODS } from "@/lib/moods";

async function fetchDreams() {
  const res = await fetch("/api/dreams");
  if (!res.ok) throw new Error("failed");
  return res.json();
}

// r6: highlight matched search terms inside dream cards. Splits the text on
// the query (case-insensitive) and wraps each match in a <mark>. The match
// is rendered with the editorial mood colour so it reads as a soft underline
// rather than a harsh yellow highlighter.
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const idx = lower.indexOf(needle, i);
    if (idx === -1) {
      out.push(text.slice(i));
      break;
    }
    if (idx > i) out.push(text.slice(i, idx));
    out.push(
      <mark key={k++} className="bg-[var(--rose)]/60 text-inherit rounded-[2px] px-0.5 -mx-0.5">
        {text.slice(idx, idx + needle.length)}
      </mark>
    );
    i = idx + needle.length;
  }
  return <>{out}</>;
}

function toDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function JournalView() {
  const navigate = useApp((s) => s.navigate);
  const journalDate = useApp((s) => s.journalDate);
  const { toast } = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["dreams"], queryFn: fetchDreams });

  const [query, setQuery] = useState("");
  const [moodFilter, setMoodFilter] = useState<Mood | "all">("all");
  const searchRef = useRef<HTMLInputElement>(null);

  const dreams: any[] = data?.dreams ?? [];

  // "/" focuses the journal search — a small editor's delight.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el as HTMLElement | null)?.isContentEditable;
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onExport() {
    if (dreams.length === 0) return;
    try {
      const md = buildJournalMarkdown(dreams);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadMarkdown(md, `dream-journal-${stamp}.md`);
      toast({
        title: "Journal exported",
        description: `${dreams.length} dream${dreams.length === 1 ? "" : "s"} written to Markdown.`,
      });
    } catch {
      toast({ title: "Export failed", description: "Please try again.", variant: "destructive" });
    }
  }

  const moodCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of dreams) {
      const m = d.mood || "neutral";
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    return counts;
  }, [dreams]);

  // Search + mood + day filtering. Search looks across everything the dreamer
  // wrote and everything the reflection surfaced (title, summary, raw text,
  // motifs, symbols) — one field, the whole night, findable.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dreams.filter((d) => {
      if (journalDate && toDayKey(d.createdAt) !== journalDate) return false;
      if (moodFilter !== "all" && (d.mood || "neutral") !== moodFilter) return false;
      if (!q) return true;
      const a = d.analysis;
      const haystack = [
        d.title ?? "",
        d.rawText ?? "",
        a?.summary ?? "",
        ...safeParse(a?.motifsJson).map((m: any) => m.label ?? ""),
        ...safeParse(a?.symbolsJson).map((s: any) => s.label ?? ""),
        ...safeParse(a?.peopleJson).map((p: any) => p.name ?? ""),
        ...safeParse(a?.locationsJson).map((l: any) => l.label ?? ""),
      ]
        .join(" \n ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [dreams, query, moodFilter, journalDate]);

  const filtering = query.trim() !== "" || moodFilter !== "all" || journalDate !== null;

  // group by month for an editorial reading rhythm
  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const d of filtered) {
      const date = new Date(d.createdAt);
      const key = date.toLocaleDateString(undefined, { year: "numeric", month: "long" });
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const dayLabel = journalDate
    ? new Date(journalDate + "T12:00:00").toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="mx-auto w-full max-w-5xl px-5 sm:px-8 py-10 sm:py-14">
      <div className="flex items-center justify-between gap-3 mb-8">
        <div>
          <div className="page-rule mb-2" aria-hidden="true" />
          <div className="text-xs tracking-caps uppercase text-muted-foreground mb-2">
            Dream journal
          </div>
          <h1 className="font-display tracking-display text-4xl sm:text-5xl balance">
            Your recorded dreams
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={dreams.length === 0}
            className="h-9 border-foreground/25 bg-card hover:bg-accent hover:border-foreground/40 shadow-sm"
            aria-label="Export the whole journal as a Markdown file"
          >
            <FileDown className="h-4 w-4" strokeWidth={1.6} />
            <span className="sr-only sm:not-sr-only sm:ml-1.5">Export .md</span>
          </Button>
          <Button
            onClick={() => navigate("capture")}
            className="h-11 bg-foreground text-background hover:opacity-90"
          >
            <Sparkles className="h-4 w-4" strokeWidth={1.6} />
            Capture a dream
          </Button>
        </div>
      </div>

      {/* ——— search & filters ——— */}
      {dreams.length > 0 && (
        <div className="mb-8">
          <div className="relative">
            <Search
              className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your nights — a word, a feeling, a figure"
              aria-label="Search dreams by any word in the memory or reflection"
              className="w-full h-12 pl-10 pr-24 rounded-xl bg-card border border-border shadow-sm
                         text-sm text-foreground placeholder:text-muted-foreground/70
                         focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/30
                         transition [&::-webkit-search-cancel-button]:hidden"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
              {query ? (
                <button
                  onClick={() => {
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition focus-ring"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
              ) : (
                <kbd className="hidden sm:inline-flex h-5 min-w-5 items-center justify-center px-1.5 rounded border border-border bg-background text-[10px] font-data text-muted-foreground">
                  /
                </kbd>
              )}
            </div>
          </div>

          {/* mood chips */}
          <div className="mt-3 flex items-center gap-1.5 flex-wrap" role="group" aria-label="Filter by mood">
            <FilterChip
              active={moodFilter === "all"}
              onClick={() => setMoodFilter("all")}
              label="All"
              count={dreams.length}
              color={null}
            />
            {MOODS.filter((m) => (moodCounts.get(m) ?? 0) > 0).map((m) => (
              <FilterChip
                key={m}
                active={moodFilter === m}
                onClick={() => setMoodFilter(moodFilter === m ? "all" : m)}
                label={m}
                count={moodCounts.get(m) ?? 0}
                color={MOOD_COLORS[m]}
              />
            ))}
          </div>
        </div>
      )}

      {/* ——— calendar day drill-down banner ——— */}
      {journalDate && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="surface-quiet p-4 sm:p-5 mb-8 flex items-center gap-4"
          role="region"
          aria-label={`Journal filtered to ${dayLabel}`}
        >
          <div className="h-10 w-10 shrink-0 rounded-full bg-foreground/[0.05] flex items-center justify-center">
            <CalendarDays className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs tracking-caps uppercase text-muted-foreground">
              One night, opened from the calendar
            </div>
            <div className="font-display text-xl sm:text-2xl tracking-tight truncate">
              {dayLabel}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="font-data text-xs text-muted-foreground hidden sm:inline">
              {filtered.length} dream{filtered.length === 1 ? "" : "s"}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => navigate("journal")}
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={1.6} />
              <span className="sr-only sm:not-sr-only sm:ml-1.5">All dreams</span>
            </Button>
          </div>
        </motion.div>
      )}

      {/* ——— results meta ——— */}
      {dreams.length > 0 && filtering && (
        <div className="mb-6 text-xs text-muted-foreground/80 pretty" aria-live="polite">
          Showing <span className="font-data text-foreground/80">{filtered.length}</span> of{" "}
          <span className="font-data">{dreams.length}</span> recorded dream
          {dreams.length === 1 ? "" : "s"}.
        </div>
      )}

      {isLoading ? (
        <JournalSkeleton />
      ) : dreams.length === 0 ? (
        <EmptyJournal onCapture={() => navigate("capture")} />
      ) : filtered.length === 0 ? (
        <EmptySearch
          onClear={() => {
            setQuery("");
            setMoodFilter("all");
            if (journalDate) navigate("journal");
          }}
        />
      ) : (
        <div className="space-y-12">
          {groups.map(([month, items]) => (
            <section key={month}>
              <div className="flex items-center gap-3 mb-5">
                <h2 className="font-display text-2xl text-muted-foreground">{month}</h2>
                <span className="h-px flex-1 bg-border" />
                <span className="font-data text-xs text-muted-foreground">{items.length}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {items.map((d, i) => (
                  <DreamCard
                    key={d.id}
                    dream={d}
                    index={i}
                    query={query}
                    onOpen={() => navigate("dream", { dreamId: d.id })}
                    onArcade={() => navigate("arcade", { dreamId: d.id })}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="mt-12 text-center text-xs text-muted-foreground/70 pretty">
        <MoonStar className="inline h-3.5 w-3.5 -translate-y-px mr-1" strokeWidth={1.5} aria-hidden="true" />
        Every search runs against your words and your reflections — never anyone else&rsquo;s.
      </p>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color: string | null;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs transition focus-ring
                 aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:shadow-sm
                 border-border bg-card text-muted-foreground hover:border-foreground/25 hover:text-foreground"
    >
      {color && (
        <span
          className="h-2 w-2 rounded-full"
          style={{
            background: color,
            opacity: active ? 1 : 0.75,
            // light ring keeps the mood colour visible on the dark active fill
            boxShadow: active ? "0 0 0 1.5px rgba(242,241,239,0.55)" : undefined,
          }}
          aria-hidden="true"
        />
      )}
      {label}
      <span className="font-data text-[10px] opacity-70">{count}</span>
    </button>
  );
}

function JournalSkeleton() {
  // Shimmering placeholders — the journal is "being unwrapped" while it loads.
  return (
    <div className="space-y-10" aria-hidden="true">
      {[0, 1].map((row) => (
        <div key={row}>
          <div className="flex items-center gap-3 mb-5">
            <div className="shimmer-line h-6 w-32 rounded-md" />
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="surface p-5 space-y-3">
                <div className="shimmer-line h-3 w-24 rounded" />
                <div className="shimmer-line h-6 w-3/4 rounded" />
                <div className="shimmer-line h-3 w-full rounded" />
                <div className="shimmer-line h-3 w-2/3 rounded" />
                <div className="flex gap-1.5 pt-2">
                  <div className="shimmer-line h-5 w-16 rounded-full" />
                  <div className="shimmer-line h-5 w-12 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptySearch({ onClear }: { onClear: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="surface p-12 text-center"
    >
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-foreground/[0.05] mb-4">
        <Search className="h-6 w-6 text-muted-foreground" strokeWidth={1.4} />
      </div>
      <h3 className="font-display text-3xl tracking-display balance">
        No dreams match — yet.
      </h3>
      <p className="mt-2 text-sm text-muted-foreground pretty max-w-md mx-auto">
        Memory is slippery. Try a shorter word, a mood instead of a phrase, or open the
        whole journal again.
      </p>
      <Button onClick={onClear} variant="outline" className="mt-6 h-11 px-6">
        <X className="h-4 w-4" strokeWidth={1.6} />
        Clear the search
      </Button>
    </motion.div>
  );
}

function DreamCard({
  dream,
  index,
  query,
  onOpen,
  onArcade,
}: {
  dream: any;
  index: number;
  query: string;
  onOpen: () => void;
  onArcade: () => void;
}) {
  const a = dream.analysis;
  const motifs: string[] = a ? safeParse(a.motifsJson).slice(0, 4).map((m: any) => m.label) : [];
  const mood = dream.mood || "neutral";
  const moodColor = MOOD_COLORS[mood as Mood] ?? MOOD_COLORS.neutral;
  const q = query.trim();

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.4) }}
      whileHover={{ y: -4 }}
      className="surface p-5 flex flex-col cursor-pointer lift"
      onClick={onOpen}
    >
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="mood-dot" style={{ background: moodColor }} aria-hidden="true" />
          {new Date(dream.createdAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
        </span>
        {mood !== "neutral" && <span className="chip">{mood}</span>}
      </div>
      <h3 className="font-display text-2xl leading-snug tracking-tight balance">
        <Highlight text={dream.title || "Untitled dream"} query={q} />
      </h3>
      {a && (
        <p className="mt-2 text-sm text-muted-foreground pretty line-clamp-2">
          <Highlight text={a.summary} query={q} />
        </p>
      )}
      {motifs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {motifs.map((m, i) => (
            <span key={i} className="chip">
              <Highlight text={m} query={q} />
            </span>
          ))}
        </div>
      )}
      <div className="mt-auto pt-4 flex items-center justify-between">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="group inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-border"
        >
          Read reflection
          <ArrowRight className="h-3 w-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition" strokeWidth={1.6} aria-hidden="true" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onArcade();
          }}
          className="group inline-flex items-center gap-1.5 text-xs text-foreground hover:opacity-70 transition"
        >
          <Compass className="h-3.5 w-3.5 group-hover:rotate-12 transition" strokeWidth={1.6} aria-hidden="true" />
          Re-enter
        </button>
      </div>
    </motion.article>
  );
}

function EmptyJournal({ onCapture }: { onCapture: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="surface p-12 text-center"
    >
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-foreground/[0.05] mb-4">
        <Inbox className="h-6 w-6 text-muted-foreground" strokeWidth={1.4} />
      </div>
      <h3 className="font-display text-3xl tracking-display balance">
        No dreams recorded yet.
      </h3>
      <p className="mt-2 text-sm text-muted-foreground pretty max-w-md mx-auto">
        Capture your first dream — fragments, contradictions, half-images — and Gemini will
        read its shape for you.
      </p>
      <Button onClick={onCapture} className="mt-6 h-11 px-6 bg-foreground text-background hover:opacity-90">
        <Sparkles className="h-4 w-4" strokeWidth={1.6} />
        Capture your first dream
      </Button>
    </motion.div>
  );
}

function safeParse(s: string) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
