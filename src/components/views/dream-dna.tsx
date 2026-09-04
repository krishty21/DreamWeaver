"use client";

// r12 — DREAM DNA: a compact visual signature per dream.
// (directive §12: "Where useful, provide each dream with a compact visual
//  signature ... emotional signature, dominant motifs, narrative shape,
//  lucidity, uncertainty, recurring entities, atmosphere. The exact
//  presentation is your design decision. Do not turn this into an ugly
//  analytics dashboard.")
//
// This is a small deterministic SVG glyph — no external assets, no
// generation calls. It encodes:
//   - the dream's mood (frame colour)
//   - fear + lucidity + uncertainty (three radial bars)
//   - dominant motifs (up to 6 glyphs arranged in a ring)
//   - a "narrative shape" path derived deterministically from the summary
//
// It renders small (e.g. next to the dream title in detail view, or as a
// journal-card accent). It is decorative-but-meaningful: aria-hidden for
// screen readers, with a title tooltip for sighted users.

import { useMemo } from "react";
import type { Mood } from "@/lib/types";
import { MOOD_COLORS } from "@/lib/moods";

export type DreamDNAInput = {
  mood: Mood;
  fear: number; // 0..1
  lucidity: number; // 0..1
  uncertainty: number; // 0..1
  motifs: string[]; // labels (top 6 used)
  summary?: string;
};

// Deterministic hash → [0..1) so the narrative-shape path is stable per dream.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

export function DreamDNA({ dream, size = 72 }: { dream: DreamDNAInput; size?: number }) {
  const path = useMemo(() => {
    const base = dream.summary ?? dream.motifs.join(" ");
    return buildNarrativePath(base || "");
  }, [dream.summary, dream.motifs]);
  const mood = MOOD_COLORS[dream.mood] ?? MOOD_COLORS.neutral;
  const motifs = dream.motifs.slice(0, 6);
  const ringR = 28 * 0.36; // viewBox is 0 0 80 80; ring radius in those units
  // three radial bars: fear (top), lucidity (right-lower), uncertainty (left-lower)
  const bars = [
    { v: dream.fear, angle: -Math.PI / 2 },
    { v: dream.lucidity, angle: -Math.PI / 2 + (2 * Math.PI) / 3 },
    { v: dream.uncertainty, angle: -Math.PI / 2 + (4 * Math.PI) / 3 },
  ];
  return (
    <span
      className="dream-dna"
      role="img"
      aria-label={`Dream signature · ${dream.mood} mood · fear ${(dream.fear * 100).toFixed(0)}% · lucidity ${(dream.lucidity * 100).toFixed(0)}%`}
      title={`Dream DNA · ${dream.mood} · ${motifs.length} motifs`}
    >
      <svg width={size} height={size} viewBox="0 0 80 80" className="dream-dna-frame">
        {/* mood ring */}
        <circle cx="40" cy="40" r="34" fill="none" stroke={mood} strokeOpacity="0.22" strokeWidth="1" />
        <circle cx="40" cy="40" r="30" fill="none" stroke={mood} strokeOpacity="0.5" strokeWidth="0.75" />

        {/* narrative shape — the dream's abstract contour */}
        <path d={path} fill="none" stroke={mood} strokeWidth="0.9" strokeOpacity="0.55" strokeLinecap="round" strokeLinejoin="round" />

        {/* three telemetry bars radiating from centre */}
        {bars.map((b, i) => {
          const len = 8 + b.v * 22;
          const x2 = 40 + Math.cos(b.angle) * len;
          const y2 = 40 + Math.sin(b.angle) * len;
          return (
            <line
              key={i}
              x1={40}
              y1={40}
              x2={x2}
              y2={y2}
              stroke={mood}
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeOpacity={0.35 + b.v * 0.5}
            />
          );
        })}

        {/* centre dot */}
        <circle cx="40" cy="40" r="2.2" fill={mood} fillOpacity="0.7" />

        {/* motif glyphs around the ring */}
        {motifs.map((m, i) => {
          const angle = -Math.PI / 2 + (i / motifs.length) * 2 * Math.PI;
          const x = 40 + Math.cos(angle) * ringR;
          const y = 40 + Math.sin(angle) * ringR;
          return <circle key={i} cx={x} cy={y} r="1.4" fill={mood} fillOpacity={0.4 + 0.6 * (1 - i / Math.max(1, motifs.length))} />;
        })}
      </svg>
    </span>
  );
}

// Build a smooth-ish closed contour deterministically from the summary hash.
// The seed controls 4 control points; the path is a cubic-bezier loop.
function buildNarrativePath(summary: string): string {
  const seed = hash(summary || "dream");
  const seed2 = hash((summary || "dream") + "2");
  const seed3 = hash((summary || "dream") + "3");
  const seed4 = hash((summary || "dream") + "4");
  const r = (s: number, lo: number, hi: number) => lo + s * (hi - lo);
  // 4 anchor points around the centre (40,40) at varying radii
  const pts = [
    [40 + r(seed, -14, -6), 40 + r(seed2, -14, -6)],
    [40 + r(seed3, 6, 14), 40 + r(seed, -14, -6)],
    [40 + r(seed4, 6, 14), 40 + r(seed3, 6, 14)],
    [40 + r(seed2, -14, -6), 40 + r(seed4, 6, 14)],
  ];
  // cubic bezier loop through the 4 points (smooth)
  return `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} ` +
    `C ${pts[1][0].toFixed(1)} ${pts[1][1].toFixed(1)}, ${pts[2][0].toFixed(1)} ${pts[2][1].toFixed(1)}, ${pts[3][0].toFixed(1)} ${pts[3][1].toFixed(1)} ` +
    `C ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}, ${pts[1][0].toFixed(1)} ${pts[1][1].toFixed(1)}, ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} Z`;
}
