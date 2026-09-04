"use client";

import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Compass,
  Inbox,
  FileDown,
  Search,
  X,
  CalendarDays,
  MoonStar,
  GitCompareArrows,
  Check,
  Repeat,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
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
  const journalQuery = useApp((s) => s.journalQuery);
  const setJournalQuery = useApp((s) => s.setJournalQuery);
  const { toast } = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["dreams"], queryFn: fetchDreams });

  const [query, setQuery] = useState("");
  const [moodFilter, setMoodFilter] = useState<Mood | "all">("all");
  const searchRef = useRef<HTMLInputElement>(null);

  // r11 — DREAM ECHO FROM THE JOURNAL: pick any two recorded nights (not just
  // motif co-occurrences from the Atlas) and read them side by side. While
  // echoMode is on, dream cards become selectable; a floating bar tracks the
  // two chosen nights. Dreams without a reflection can't be compared (the
  // echo's thread + drift are computed from the analysis).
  const [echoMode, setEchoMode] = useState(false);
  const [echoSel, setEchoSel] = useState<string[]>([]);

  function toggleEchoSel(id: string) {
    setEchoSel((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= 2
        ? [prev[1], id] // full: drop the oldest, keep the newest pick
        : [...prev, id]
    );
  }

  function exitEchoMode() {
    setEchoMode(false);
    setEchoSel([]);
  }

  function compareEcho() {
    if (echoSel.length !== 2) return;
    navigate("echo", { dreamId: echoSel[0], echoId: echoSel[1] });
    exitEchoMode();
  }

  // Esc leaves compare mode — matches the palette/dialog escape convention.
  useEffect(() => {
    if (!echoMode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") exitEchoMode();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [echoMode]);

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

  // r9 — one-shot search prefill. The Patterns lexicon cloud (and the command
  // palette) set `journalQuery` in the store before navigating here. The value
  // is consumed during render with React's "adjust state when a value changes"
  // pattern (no effect needed); the handoff field is cleared + focused in an
  // effect because those are external-system syncs (store + DOM).
  const [consumedQuery, setConsumedQuery] = useState<string | null>(null);
  if (journalQuery !== consumedQuery) {
    setConsumedQuery(journalQuery);
    if (journalQuery) setQuery(journalQuery);
  }
  useEffect(() => {
    if (!journalQuery) return;
    setJournalQuery(null);
    const t = setTimeout(() => searchRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [journalQuery, setJournalQuery]);

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
    <div
      className={`mx-auto w-full max-w-5xl px-5 sm:px-8 py-10 sm:py-14 ${
        echoMode ? "pb-28" : ""
      }`}
    >
      {/* pb-28 while comparing: keeps the last row of cards scrollable clear of
          the floating echo bar (which sits ~bottom-5 above the viewport edge). */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
        <div>
          <div className="page-rule mb-2" aria-hidden="true" />
          <div className="text-xs tracking-caps uppercase text-muted-foreground mb-2">
            Dream journal
          </div>
          <h1 className="font-display tracking-display text-4xl sm:text-5xl balance">
            Your recorded dreams
          </h1>
        </div>
        {/* r11 — with the Compare affordance added, the header no longer fits
            beside the title on small screens: the actions drop below the title
            (right-aligned) and return to the header row from sm up. */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (echoMode) exitEchoMode();
              else setEchoMode(true);
            }}
            disabled={dreams.length < 2}
            aria-pressed={echoMode}
            className={`h-9 shadow-sm transition focus-ring ${
              echoMode
                ? "bg-foreground text-background border-foreground hover:opacity-90 hover:bg-foreground"
                : "border-foreground/25 bg-card hover:bg-accent hover:border-foreground/40"
            }`}
            aria-label={echoMode ? "Exit compare-two-dreams mode" : "Compare two dreams side by side"}
          >
            <GitCompareArrows className="h-4 w-4" strokeWidth={1.6} />
            <span className="sr-only sm:not-sr-only sm:ml-1.5">{echoMode ? "Choosing…" : "Compare"}</span>
          </Button>
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

      {/* ——— echo selection hint ——— */}
      <AnimatePresence>
        {echoMode && dreams.length >= 2 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="mb-6 flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-foreground/25 bg-foreground/[0.02]"
            role="status"
            aria-live="polite"
          >
            <Repeat className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
            <p className="text-xs text-muted-foreground pretty">
              Dream echo — choose <span className="text-foreground font-medium">two nights</span> below. The
              shared thread between them will open side by side: motifs, feelings, and the drift from one
              night to the other. Press Esc to stop choosing.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

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
                {items.map((d, i) => {
                  const selectable = !!d.analysis;
                  const selection: "off" | "available" | "selected" | "unavailable" = !echoMode
                    ? "off"
                    : echoSel.includes(d.id)
                    ? "selected"
                    : selectable
                    ? "available"
                    : "unavailable";
                  return (
                    <DreamCard
                      key={d.id}
                      dream={d}
                      index={i}
                      query={query}
                      selection={selection}
                      onOpen={
                        echoMode
                          ? () => selectable && toggleEchoSel(d.id)
                          : () => navigate("dream", { dreamId: d.id })
                      }
                      onArcade={() => navigate("arcade", { dreamId: d.id })}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="mt-12 text-center text-xs text-muted-foreground/70 pretty">
        <MoonStar className="inline h-3.5 w-3.5 -translate-y-px mr-1" strokeWidth={1.5} aria-hidden="true" />
        Every search runs against your words and your reflections — never anyone else&rsquo;s.
      </p>

      {/* r11 — floating echo bar: tracks the two chosen nights (fixed above footer) */}
      <EchoBar
        echoMode={echoMode}
        echoSel={echoSel}
        dreams={dreams}
        onCompare={compareEcho}
        onCancel={exitEchoMode}
      />
    </div>
  );
}

// r11 — the floating compare bar. Springs up from the bottom edge when the
// journal enters compare mode; the Compare button lights once two nights are
// chosen. Selection state lives in the parent; this is presentational.
function EchoBar({
  echoMode,
  echoSel,
  dreams,
  onCompare,
  onCancel,
}: {
  echoMode: boolean;
  echoSel: string[];
  dreams: any[];
  onCompare: () => void;
  onCancel: () => void;
}) {
  const titles = echoSel.map((id) => dreams.find((d) => d.id === id)?.title ?? "A dream");
  return (
    <AnimatePresence>
      {echoMode && (
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 28 }}
          transition={{ type: "spring", stiffness: 340, damping: 30 }}
          className="fixed bottom-5 sm:bottom-7 inset-x-0 z-40 flex justify-center px-4 pointer-events-none"
        >
          <div
            className="journal-echo-bar pointer-events-auto flex items-center gap-2.5 sm:gap-3 max-w-full flex-wrap justify-center px-4 py-2.5 rounded-3xl sm:rounded-full"
            role="region"
            aria-label="Dream echo selection"
          >
            <Repeat className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {echoSel.length === 0
                ? "choose the first night"
                : echoSel.length === 1
                ? "now choose the second"
                : "two nights chosen"}
            </span>
            {titles.map((t, i) => (
              <span key={echoSel[i]} className="echo-sel-chip" title={t}>
                <span className="echo-sel-idx" aria-hidden="true">{i + 1}</span>
                <span className="truncate max-w-[120px] sm:max-w-[160px]">{t}</span>
              </span>
            ))}
            <button
              onClick={onCompare}
              disabled={echoSel.length !== 2}
              className="h-8 px-4 rounded-full text-xs bg-foreground text-background hover:opacity-90 transition disabled:opacity-40 focus-ring"
              aria-label="Open the dream echo comparing the two chosen nights"
            >
              Compare
            </button>
            <button
              onClick={onCancel}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition focus-ring"
              aria-label="Stop choosing dreams"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
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
  selection,
  onOpen,
  onArcade,
}: {
  dream: any;
  index: number;
  query: string;
  selection: "off" | "available" | "selected" | "unavailable";
  onOpen: () => void;
  onArcade: () => void;
}) {
  const a = dream.analysis;
  const motifs: string[] = a ? safeParse(a.motifsJson).slice(0, 4).map((m: any) => m.label) : [];
  const mood = dream.mood || "neutral";
  const moodColor = MOOD_COLORS[mood as Mood] ?? MOOD_COLORS.neutral;
  const q = query.trim();
  const choosing = selection !== "off";

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.4) }}
      whileHover={{ y: -4 }}
      className={`surface p-5 flex flex-col lift relative ${
        selection === "selected"
          ? "echo-card-selected"
          : selection === "unavailable"
          ? "opacity-55"
          : "cursor-pointer"
      }`}
      onClick={onOpen}
      aria-pressed={selection === "selected" ? true : undefined}
      aria-disabled={selection === "unavailable" ? true : undefined}
    >
      {/* r11 — selection check badge (compare mode) */}
      <AnimatePresence>
        {selection === "selected" && (
          <motion.span
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 26 }}
            className="echo-check"
            aria-hidden="true"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
          </motion.span>
        )}
      </AnimatePresence>
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="mood-dot" style={{ background: moodColor }} aria-hidden="true" />
          {new Date(dream.createdAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
        </span>
        {mood !== "neutral" && !choosing && <span className="chip">{mood}</span>}
        {selection === "unavailable" && (
          <span className="text-[10px] italic">no reflection yet</span>
        )}
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
        {choosing ? (
          <span className="text-xs text-muted-foreground italic pretty">
            {selection === "selected"
              ? "chosen — click again to release"
              : selection === "unavailable"
              ? "this night needs a reflection first"
              : "choose this night"}
          </span>
        ) : (
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
        )}
        {!choosing && (
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
        )}
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
        Capture your first dream — fragments, contradictions, half-images — and its shape will be read.
      </p>
      <Button onClick={onCapture} className="mt-6 h-11 px-6 bg-foreground text-background hover:opacity-90">
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
