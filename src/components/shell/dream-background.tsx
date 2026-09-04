"use client";

import { useApp } from "@/lib/store";

// Subtle, slow-moving atmospheric backdrop that responds to the current view's
// "mood" (derived from the active dream). Light-mode, editorial, never neon.
export function DreamBackground({ mood = "neutral" }: { mood?: string }) {
  const view = useApp((s) => s.view);
  const m = mood || "neutral";

  return (
    <div className="dream-field grain" data-mood={m} aria-hidden="true">
      {/* drifting orbs */}
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
    </div>
  );
}
