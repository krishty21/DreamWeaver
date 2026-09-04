"use client";

import { useApp, View } from "@/lib/store";

// Subtle, slow-moving atmospheric backdrop that responds to the current view's
// "mood" (derived from the active dream). Light-mode, editorial, never neon.
//
// Density: content-heavy reading views (journal, dream detail, patterns,
// atlas, threads) render only TWO orbs so the motion never competes with
// reading. Atmospheric views (landing, auth, arcade, session, story, capture)
// keep three for the dreamlike drift. The field stays aria-hidden +
// pointer-events-none — it never blocks input or causes layout shift.
const READING_VIEWS: View[] = ["journal", "dream", "patterns", "atlas", "threads"];

export function DreamBackground({ mood = "neutral" }: { mood?: string }) {
  const view = useApp((s) => s.view);
  const m = mood || "neutral";
  const dense = !READING_VIEWS.includes(view);

  return (
    <div className="dream-field grain" data-mood={m} aria-hidden="true">
      {/* primary orb — always present */}
      <div
        className="dream-orb"
        style={{
          width: "32rem",
          height: "32rem",
          left: "-8rem",
          top: "-6rem",
          background:
            "radial-gradient(circle at 30% 30%, rgba(216,207,208,0.85), rgba(216,207,208,0) 70%)",
          animationDelay: "0s",
        }}
      />
      {/* secondary orb — always present, opacity varies on atmospheric views */}
      <div
        className="dream-orb"
        style={{
          width: "26rem",
          height: "26rem",
          right: "-6rem",
          top: "4rem",
          background:
            "radial-gradient(circle at 60% 40%, rgba(177,166,164,0.55), rgba(177,166,164,0) 70%)",
          animationDelay: "-8s",
          opacity: view === "arcade" || view === "session" ? 0.7 : 0.45,
        }}
      />
      {/* tertiary orb — only on atmospheric views (omitted on reading views
          so motion doesn't compete with prose) */}
      {dense && (
        <div
          className="dream-orb"
          style={{
            width: "30rem",
            height: "30rem",
            left: "30%",
            bottom: "-12rem",
            background:
              "radial-gradient(circle at 50% 50%, rgba(105,113,132,0.28), rgba(105,113,132,0) 70%)",
            animationDelay: "-16s",
          }}
        />
      )}
    </div>
  );
}
