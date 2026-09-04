"use client";

// Dream calendar — a nights-remembered heatmap over the last ~20 weeks.
// Computed app-side from dream timestamps (PatternsView receives
// `dreamCalendar` from /api/patterns). Cells are coloured by the dominant
// mood of that day's dreams; intensity scales with dreams-per-day.
//
// r6: hovering a recorded night pops a small card with that night's dream
// titles + dominant mood. The popover anchors to the cell, hides on leave
// or scroll, and stays pointer-events-none so it never blocks a click
// through to the drill-down navigation. (Mobile keeps click-to-drill-down
// as before — no hover on touch.)

import { useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { CalendarDay } from "@/lib/types";
import { useApp } from "@/lib/store";
import { MOOD_COLORS, moodColor, dayIntensity } from "@/lib/moods";

const WEEKS = 20;

function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateLabel(dateStr: string): string {
  // dateStr is YYYY-MM-DD — parse without TZ shift
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function DreamCalendar({ days }: { days: CalendarDay[] }) {
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const navigate = useApp((s) => s.navigate);

  // r6: hover popover state. We track the active cell so an AnimatePresence
  // transition can run on enter/leave. Mobile doesn't fire mouseenter so the
  // popover is desktop-only by nature.
  const [hovered, setHovered] = useState<{ key: string; x: number; y: number; day: CalendarDay } | null>(null);

  // Hide popover on scroll — it would otherwise drift off its anchor.
  useEffect(() => {
    if (!hovered) return;
    const hide = () => setHovered(null);
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", hide, { capture: true } as any);
  }, [hovered]);

  // Build a grid: columns = weeks ending this week, rows = Mon..Sun.
  const { weeks, monthLabels, activeCells, nightsInRange } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // find Monday of the current week
    const monday = new Date(today);
    const dow = (today.getDay() + 6) % 7; // Mon=0 … Sun=6
    monday.setDate(today.getDate() - dow);

    const cols: Date[][] = [];
    // start WEEKS-1 weeks before the current week
    const firstMonday = new Date(monday);
    firstMonday.setDate(monday.getDate() - 7 * (WEEKS - 1));
    for (let w = 0; w < WEEKS; w++) {
      const col: Date[] = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(firstMonday);
        day.setDate(firstMonday.getDate() + w * 7 + d);
        col.push(day);
      }
      cols.push(col);
    }

    // month label positions: label a column when its Monday starts a new month
    const labels: { week: number; label: string }[] = [];
    let lastMonth = -1;
    for (let w = 0; w < cols.length; w++) {
      const m = cols[w][0].getMonth();
      if (m !== lastMonth) {
        labels.push({
          week: w,
          label: cols[w][0].toLocaleDateString(undefined, { month: "short" }),
        });
        lastMonth = m;
      }
    }

    let active = 0;
    const future = new Date();
    future.setHours(0, 0, 0, 0);
    for (const col of cols) {
      for (const day of col) {
        if (day <= future && byDate.has(toKey(day))) active++;
      }
    }

    return { weeks: cols, monthLabels: labels, activeCells: active, nightsInRange: active };
  }, [byDate]);

  const now = new Date();
  const todayKey = toKey(now);
  const futureLimit = new Date();
  futureLimit.setHours(0, 0, 0, 0);

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="font-display text-2xl tracking-tight">Nights remembered</h2>
        <span className="font-data text-xs text-muted-foreground">
          {nightsInRange} night{nightsInRange === 1 ? "" : "s"} · last {WEEKS} weeks
          {activeCells > 0 && (
            <span className="ml-2 pl-2 border-l border-border/80 hidden sm:inline">
              click a night to open its dreams
            </span>
          )}
        </span>
      </div>

      <div className="overflow-x-auto pb-1 -mx-1 px-1">
        <div className="min-w-[560px]">
          {/* month labels */}
          <div className="flex gap-[3px] mb-1.5 ml-7">
            {weeks.map((_, w) => {
              const label = monthLabels.find((l) => l.week === w);
              return (
                <div key={w} className="w-[13px] text-[10px] text-muted-foreground font-data">
                  {label ? label.label : ""}
                </div>
              );
            })}
          </div>

          <div className="flex gap-[3px]">
            {/* weekday initials */}
            <div className="flex flex-col gap-[3px] mr-1">
              {["M", "", "W", "", "F", "", "S"].map((d, i) => (
                <div key={i} className="h-[13px] w-5 text-[10px] leading-[13px] text-muted-foreground font-data text-right">
                  {d}
                </div>
              ))}
            </div>

            {/* the grid */}
            {weeks.map((col, w) => (
              <div key={w} className="flex flex-col gap-[3px]">
                {col.map((day, d) => {
                  const key = toKey(day);
                  const entry = byDate.get(key);
                  const isFuture = day > futureLimit;
                  const isToday = key === todayKey;
                  const color = entry ? moodColor(entry.mood) : null;
                  const intensity = entry ? dayIntensity(entry.count) : 0;
                  const tooltip = entry
                    ? `${day.toLocaleDateString(undefined, { month: "short", day: "numeric" })} — ${entry.count} dream${entry.count === 1 ? "" : "s"} · ${entry.mood}`
                    : `${day.toLocaleDateString(undefined, { month: "short", day: "numeric" })} — no dream recalled`;
                  return (
                    <motion.div
                      key={key}
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      whileHover={entry ? { scale: 1.45 } : undefined}
                      transition={{ delay: Math.min((w * 7 + d) * 0.004, 0.6), duration: 0.3 }}
                      title={tooltip}
                      aria-label={tooltip}
                      role={entry ? "button" : "img"}
                      tabIndex={entry ? 0 : -1}
                      onClick={
                        entry && !isFuture
                          ? () => navigate("journal", { journalDate: key })
                          : undefined
                      }
                      onKeyDown={
                        entry && !isFuture
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                navigate("journal", { journalDate: key });
                              }
                            }
                          : undefined
                      }
                      onMouseEnter={
                        entry && !isFuture
                          ? (e) => {
                              const rect = (e.target as HTMLElement).getBoundingClientRect();
                              setHovered({
                                key,
                                x: rect.left + rect.width / 2,
                                y: rect.bottom,
                                day: entry,
                              });
                            }
                          : undefined
                      }
                      onMouseLeave={() => setHovered((h) => (h?.key === key ? null : h))}
                      className="h-[13px] w-[13px] rounded-[3px] relative z-0 hover:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground"
                      style={{
                        background: color ? color : "var(--muted, rgba(65,63,61,0.06))",
                        // Empty cells sit well back so recorded nights pop;
                        // recorded intensity scales with dreams-per-day.
                        opacity: isFuture ? 0 : entry ? intensity : 0.32,
                        outline: isToday ? "1.5px solid var(--foreground)" : "none",
                        outlineOffset: isToday ? "1px" : "0",
                        cursor: entry && !isFuture ? "pointer" : "default",
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* r6: hover popover with that night's dream titles + dominant mood.
          Fixed-positioned to the viewport so it works inside an
          overflow-x-auto grid without being clipped. Hides on scroll.
          pointer-events-none so it never blocks the click through. */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            key={hovered.key}
            initial={{ opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none fixed z-50 w-56 surface p-3.5"
            style={{
              left: Math.max(8, Math.min(hovered.x - 112, window.innerWidth - 224 - 8)),
              top: Math.min(hovered.y + 8, window.innerHeight - 180),
            }}
            role="tooltip"
          >
            <div className="flex items-center justify-between text-[10px] tracking-caps uppercase text-muted-foreground mb-1.5">
              <span>{formatDateLabel(hovered.day.date)}</span>
              <span className="inline-flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-[2px]"
                  style={{ background: moodColor(hovered.day.mood) }}
                  aria-hidden="true"
                />
                {hovered.day.mood}
              </span>
            </div>
            <div className="text-sm font-display leading-tight text-foreground mb-1.5">
              {hovered.day.count} dream{hovered.day.count === 1 ? "" : "s"} kept
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground pretty">
              {hovered.day.titles.slice(0, 3).map((t, i) => (
                <li key={i} className="truncate">
                  · {t}
                </li>
              ))}
              {hovered.day.count > hovered.day.titles.length && (
                <li className="text-[11px] italic opacity-80">
                  + {hovered.day.count - hovered.day.titles.length} more
                </li>
              )}
            </ul>
            <div className="mt-2 pt-2 border-t border-border text-[10px] text-muted-foreground/80 italic">
              click to open the night
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* legend */}
      <div className="mt-4 flex items-center flex-wrap gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
        {(Object.keys(MOOD_COLORS) as Array<keyof typeof MOOD_COLORS>).map((m) => (
          <span key={m} className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-[3px] inline-block"
              style={{ background: MOOD_COLORS[m], opacity: 0.75 }}
            />
            {m}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-[3px] inline-block"
            style={{ background: "var(--muted, rgba(65,63,61,0.1))" }}
          />
          no dream recalled
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-[3px] inline-block"
            style={{ outline: "1.5px solid var(--foreground)", outlineOffset: "1px" }}
          />
          today
        </span>
      </div>
    </div>
  );
}
