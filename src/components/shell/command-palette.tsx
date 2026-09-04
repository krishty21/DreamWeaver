"use client";

// r9 — Command palette (⌘K / Ctrl+K).
// A keyboard-first way to move through the dream memory: fuzzy search across
// every recorded dream plus quick actions (capture, journal, patterns, atlas,
// arcade, today). Muscle memory from earlier rounds still works: ⌘K then
// Enter = capture, because "Capture a dream" is always the first action.
//
// r10 — the search haystack now matches the journal's: title, raw text,
// reflection summary AND the structured elements Gemini surfaced (motifs,
// symbols, people, places, actions). A match that comes from a structured
// element shows a small pill naming the field ("motif", "person"…) so the
// user can see WHY this dream surfaced.
//
// Data comes from the react-query ["dreams"] cache (already fetched by the
// journal / dashboard / atlas) so the palette opens with zero latency.
//
// Structure: the outer component owns the open state + the global hotkey and
// mounts <PaletteDialog /> fresh on every open — so query/selection state
// starts clean without any reset effects.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Sparkles,
  BookOpenText,
  Map,
  Globe,
  Compass,
  Moon,
  Search,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useApp, View } from "@/lib/store";
import { cn } from "@/lib/utils";

async function fetchDreams() {
  const res = await fetch("/api/dreams");
  if (!res.ok) throw new Error("failed");
  return res.json();
}

// Lightweight fuzzy score for a candidate string against the query.
// - exact substring at start  → 3 (best)
// - substring anywhere        → 2
// - subsequence (loose)       → 0.1 (weak but kept)
// - no match                  → -1 (dropped)
function fuzzyScore(text: string, q: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  const n = q.toLowerCase().trim();
  if (!n) return 1;
  const idx = t.indexOf(n);
  if (idx !== -1) return idx === 0 ? 3 : 2;
  // subsequence fallback: every char of the query appears in order
  let ti = 0;
  for (const ch of n) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return -1;
    ti = found + 1;
  }
  return 0.1;
}

type Action = {
  kind: "action";
  id: string;
  label: string;
  hint: string;
  icon: any;
  view: View;
};

type DreamResult = {
  kind: "dream";
  id: string;
  dreamId: string;
  label: string;
  snippet: string;
  dateLabel: string;
  score: number;
  // r10 — when the best (or a strong) match came from a structured element,
  // name the field + the element so the result row explains itself.
  via?: string; // "motif" | "symbol" | "person" | "place" | "action"
  viaLabel?: string; // the matched element, e.g. "security guard"
};

type Item = Action | DreamResult;

const ACTIONS: Action[] = [
  { kind: "action", id: "a-capture", label: "Capture a dream", hint: "write it before it fades", icon: Sparkles, view: "capture" },
  { kind: "action", id: "a-today", label: "Today", hint: "your observatory", icon: Moon, view: "dashboard" },
  { kind: "action", id: "a-journal", label: "Journal", hint: "every recorded night", icon: BookOpenText, view: "journal" },
  { kind: "action", id: "a-patterns", label: "Patterns", hint: "longitudinal memory", icon: Map, view: "patterns" },
  { kind: "action", id: "a-atlas", label: "Atlas", hint: "the motif map", icon: Globe, view: "atlas" },
  { kind: "action", id: "a-arcade", label: "Arcade", hint: "re-enter a dream", icon: Compass, view: "arcade" },
];

function snippetAround(text: string, q: string, radius = 46): string {
  // Return a window of the raw text centred on the first match so the user
  // can tell WHICH dream this is without opening it.
  const t = text.toLowerCase();
  const n = q.toLowerCase().trim();
  if (!n) return text.slice(0, radius * 2).trim();
  const idx = t.indexOf(n);
  if (idx === -1) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + n.length + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

// r10 — structured-element search fields. Mirrors the journal's haystack
// (motifs, symbols, people, locations) and adds actions so the two search
// surfaces stay aligned. Weight < 1 so an exact title match always wins over
// an exact element match; people rank slightly above motifs because a name
// is usually what the dreamer is looking for.
const VIA_FIELDS: { via: string; weight: number; json: string; key: string }[] = [
  { via: "person", weight: 0.93, json: "peopleJson", key: "name" },
  { via: "motif", weight: 0.9, json: "motifsJson", key: "label" },
  { via: "symbol", weight: 0.88, json: "symbolsJson", key: "label" },
  { via: "place", weight: 0.87, json: "locationsJson", key: "label" },
  { via: "action", weight: 0.86, json: "actionsJson", key: "label" },
];

function safeParseArray(v: unknown): any[] {
  try {
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  const closePalette = useApp((s) => s.closePalette);
  const openPalette = useApp((s) => s.openPalette);

  // Global ⌘K/Ctrl+K toggles the palette (works even while typing elsewhere).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (useApp.getState().paletteOpen) closePalette();
        else openPalette();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPalette, closePalette]);

  return (
    <AnimatePresence>
      {open && <PaletteDialog onClose={closePalette} />}
    </AnimatePresence>
  );
}

// Mounted fresh each time the palette opens — state starts clean by construction.
function PaletteDialog({ onClose }: { onClose: () => void }) {
  const navigate = useApp((s) => s.navigate);
  const setJournalQuery = useApp((s) => s.setJournalQuery);
  const { data } = useQuery({
    queryKey: ["dreams"],
    queryFn: fetchDreams,
    staleTime: 30_000,
  });

  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus the input on mount (pure DOM sync — allowed in an effect).
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  const dreams: any[] = data?.dreams ?? [];

  const items = useMemo<Item[]>(() => {
    const q = query.trim();
    const acts: Item[] = ACTIONS.filter((a) => fuzzyScore(a.label, q) > 0);
    if (!q) {
      // no query → quick actions + the 4 most recent dreams
      const recent: DreamResult[] = dreams.slice(0, 4).map((d) => ({
        kind: "dream",
        id: `d-${d.id}`,
        dreamId: d.id,
        label: d.title || "Untitled dream",
        snippet: snippetAround(d.rawText ?? "", "", 34),
        dateLabel: new Date(d.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        score: 1,
      }));
      return [...acts, ...recent];
    }
    const scored: DreamResult[] = [];
    for (const d of dreams) {
      const titleScore = fuzzyScore(d.title ?? "", q);
      const rawScore = fuzzyScore(d.rawText ?? "", q);
      const summaryScore = fuzzyScore(d.analysis?.summary ?? "", q);
      let best = Math.max(titleScore, rawScore * 0.95, summaryScore * 0.9);
      // r10 — score every structured element too, keeping the strongest match
      // per dream along with the field it came from (for the via pill).
      let via: string | undefined;
      let viaLabel: string | undefined;
      const a = d.analysis;
      if (a) {
        for (const f of VIA_FIELDS) {
          for (const item of safeParseArray((a as any)[f.json])) {
            const label = String(item?.[f.key] ?? "").trim();
            if (!label) continue;
            const s = fuzzyScore(label, q);
            if (s < 0) continue;
            const weighted = s * f.weight;
            if (weighted > best) {
              best = weighted;
              via = f.via;
              viaLabel = label;
            } else if (s >= 2 && (!via || f.weight > 0.9)) {
              // keep a strong substring match on display even when ranking
              // was decided by another field — but never overwrite a better via
              const betterRank = !via || (f.via === "person" && via !== "person");
              if (betterRank) {
                via = f.via;
                viaLabel = label;
              }
            }
          }
        }
      }
      if (best < 0) continue;
      scored.push({
        kind: "dream",
        id: `d-${d.id}`,
        dreamId: d.id,
        label: d.title || "Untitled dream",
        snippet: via
          ? `“${viaLabel}” — the ${via} Gemini surfaced in this dream`
          : snippetAround(d.rawText ?? d.analysis?.summary ?? "", q),
        dateLabel: new Date(d.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        score: best,
        via,
        viaLabel,
      });
    }
    scored.sort((a, b) => b.score - a.score || b.dateLabel.localeCompare(a.dateLabel));
    return [...acts, ...scored.slice(0, 7)];
  }, [query, dreams]);

  // Derived clamp — if the list shrank, keep the selection in range without
  // an effect (React's "adjust during render" is unnecessary here because
  // arrow keys already wrap modulo the CURRENT length).
  const selIdx = Math.min(sel, Math.max(0, items.length - 1));

  // keep the selected item in view (DOM sync — allowed in an effect)
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${selIdx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selIdx]);

  function choose(item: Item) {
    onClose();
    if (item.kind === "action") {
      navigate(item.view);
    } else {
      navigate("dream", { dreamId: item.dreamId });
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel(items.length ? (selIdx + 1) % items.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel(items.length ? (selIdx - 1 + items.length) % items.length : 0);
    } else if (e.key === "Home") {
      e.preventDefault();
      setSel(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setSel(Math.max(0, items.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[selIdx];
      if (item) choose(item);
    }
  }

  const dreamCount = items.filter((x) => x.kind === "dream").length;

  return (
    <motion.div
      key="palette-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh] sm:pt-[14vh]"
      style={{ background: "color-mix(in srgb, var(--ink, #413f3d) 22%, transparent)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
      role="presentation"
    >
      <motion.div
        key="palette-dialog"
        initial={{ opacity: 0, scale: 0.97, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: -6 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-xl palette-dialog rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search your dreams and quick actions"
      >
        {/* input row */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" strokeWidth={1.7} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search dreams, or jump anywhere…"
            className="flex-1 bg-transparent outline-none text-base text-foreground placeholder:text-muted-foreground/70 font-body"
            aria-label="Search dreams and actions"
            aria-controls="palette-list"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            onClick={onClose}
            className="font-data text-[10px] px-1.5 py-1 rounded border border-border bg-card/70 text-muted-foreground hover:text-foreground transition focus-ring"
            aria-label="Close the palette (Escape)"
          >
            esc
          </button>
        </div>

        {/* results */}
        <div
          ref={listRef}
          id="palette-list"
          role="listbox"
          aria-label="Results"
          className="max-h-[52vh] overflow-y-auto scroll-elegant py-2"
        >
          {items.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="font-display text-xl text-foreground">No dream matches.</p>
              <p className="mt-1 text-sm text-muted-foreground pretty">
                Try a shorter fragment — a motif, a name, a feeling.
              </p>
              {query.trim() && (
                <button
                  onClick={() => {
                    onClose();
                    setJournalQuery(query.trim());
                    navigate("journal");
                  }}
                  className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-border bg-card/60 text-sm text-foreground hover:bg-foreground/[0.05] transition focus-ring"
                >
                  <BookOpenText className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                  Search the journal for “{query.trim()}”
                </button>
              )}
            </div>
          ) : (
            items.map((item, i) => {
              const selected = i === selIdx;
              const Icon = item.kind === "action" ? item.icon : Moon;
              return (
                <button
                  key={item.id}
                  data-idx={i}
                  role="option"
                  aria-selected={selected}
                  onClick={() => choose(item)}
                  onMouseMove={() => setSel(i)}
                  className={cn(
                    "palette-item w-full flex items-center gap-3.5 px-5 py-3 text-left transition-colors",
                    selected && "palette-item-active"
                  )}
                >
                  <span className="palette-item-icon shrink-0">
                    <Icon className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />
                  </span>
                  <span className="flex-1 min-w-0">
                    {item.kind === "action" ? (
                      <>
                        <span className="block text-sm text-foreground font-body">{item.label}</span>
                        <span className="block text-xs text-muted-foreground font-body">{item.hint}</span>
                      </>
                    ) : (
                      <>
                        <span className="flex items-baseline gap-2">
                          <span className="font-display text-[17px] leading-snug text-foreground truncate">{item.label}</span>
                          <span className="font-data text-[10px] text-muted-foreground shrink-0">{item.dateLabel}</span>
                          {item.via && (
                            <span className="palette-via-tag shrink-0" title={`matched the ${item.via} “${item.viaLabel}”`}>
                              {item.via}
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-muted-foreground font-body truncate italic">{item.snippet}</span>
                      </>
                    )}
                  </span>
                  {selected && (
                    <span className="font-data text-[10px] text-muted-foreground tracking-caps uppercase shrink-0 flex items-center gap-1">
                      <CornerDownLeft className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
                      enter
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* footer hints */}
        <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-t border-border bg-[color-mix(in_srgb,var(--background)_55%,transparent)]">
          <span className="font-data text-[10px] text-muted-foreground flex items-center gap-1.5">
            <ArrowUp className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
            <ArrowDown className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
            navigate
          </span>
          <span className="font-data text-[10px] text-muted-foreground flex items-center gap-1.5">
            <CornerDownLeft className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
            open
          </span>
          <span className="font-data text-[10px] text-muted-foreground">
            {dreamCount > 0
              ? `${dreamCount} dream${dreamCount === 1 ? "" : "s"} found`
              : "searched over every recorded night"}
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
