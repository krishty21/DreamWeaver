// Shared mood palette + helpers.
// Authoritative for the editorial mood colour system used across
// dashboard dots, journal cards, calendar cells, and patterns.
// Extracted here in r6 to avoid drift between journal-view and dream-calendar.

import type { Mood } from "@/lib/types";

// Editorial mood palette (matches the app's design system).
//   tense        → ink (darkest, heaviest)
//   melancholic  → slate
//   surreal      → mauve
//   lucid        → dusty rose (lightest, airiest)
//   neutral      → warm grey (no strong valence)
export const MOOD_COLORS: Record<Mood, string> = {
  tense: "#413f3d",
  melancholic: "#697184",
  surreal: "#b1a6a4",
  lucid: "#d8cfd0",
  neutral: "#8a8580",
};

// Display order — moods with the strongest valence come first so they
// surface above neutral when space is tight.
export const MOODS: Mood[] = ["surreal", "tense", "melancholic", "lucid", "neutral"];

// Intensity (alpha-like multiplier) for a single dream-day in the calendar.
// More dreams that day → more saturated. Drives the cell opacity.
export function dayIntensity(count: number): number {
  if (count >= 3) return 0.95;
  if (count === 2) return 0.7;
  if (count === 1) return 0.45;
  return 0;
}

export function moodColor(mood: Mood | string | undefined): string {
  if (!mood) return MOOD_COLORS.neutral;
  return MOOD_COLORS[mood as Mood] ?? MOOD_COLORS.neutral;
}
