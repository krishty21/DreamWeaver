"use client";

import { create } from "zustand";

export type View =
  | "landing"
  | "auth"
  | "dashboard"
  | "capture"
  | "journal"
  | "dream"
  | "patterns"
  | "arcade"
  | "session"
  | "profile";

type AppState = {
  view: View;
  activeDreamId: string | null;
  activeSessionId: string | null;
  authMode: "signin" | "signup";
  arcadeMode: "replay" | "rewrite" | "confront";
  mounted: boolean;
  navigate: (view: View, opts?: { dreamId?: string; sessionId?: string; authMode?: "signin" | "signup"; arcadeMode?: "replay" | "rewrite" | "confront" }) => void;
  syncFromHash: () => void;
};

function parseHash(): { view: View; activeDreamId: string | null; activeSessionId: string | null } {
  const h = (typeof window !== "undefined" ? window.location.hash : "").replace(/^#\/?/, "");
  const [head, ...rest] = h.split("/");
  const view = (head as View) || "landing";
  const valid: View[] = ["landing", "auth", "dashboard", "capture", "journal", "dream", "patterns", "arcade", "session", "profile"];
  if (!valid.includes(view) || !view) return { view: "landing", activeDreamId: null, activeSessionId: null };
  let dreamId: string | null = null;
  let sessionId: string | null = null;
  if (view === "dream" && rest[0]) dreamId = rest[0];
  if (view === "session" && rest[0]) sessionId = rest[0];
  return { view, activeDreamId: dreamId, activeSessionId: sessionId };
}

function toHash(view: View, dreamId?: string | null, sessionId?: string | null) {
  if (view === "dream" && dreamId) return `#/dream/${dreamId}`;
  if (view === "session" && sessionId) return `#/session/${sessionId}`;
  return `#/${view === "landing" ? "" : view}`;
}

export const useApp = create<AppState>((set, get) => ({
  // Initialise WITHOUT touching window so SSR + client first render match.
  view: "landing",
  activeDreamId: null,
  activeSessionId: null,
  authMode: "signin",
  arcadeMode: "replay",
  mounted: false,
  syncFromHash: () => {
    if (typeof window === "undefined") return;
    const parsed = parseHash();
    set({
      view: parsed.view,
      activeDreamId: parsed.activeDreamId,
      activeSessionId: parsed.activeSessionId,
      mounted: true,
    });
  },
  navigate: (view, opts) => {
    const dreamId = opts?.dreamId ?? null;
    const sessionId = opts?.sessionId ?? null;
    if (typeof window !== "undefined") {
      const hash = toHash(view, dreamId, sessionId);
      if (window.location.hash !== hash) {
        window.location.hash = hash;
      }
    }
    set((s) => ({
      view,
      activeDreamId: dreamId,
      activeSessionId: sessionId,
      authMode: opts?.authMode ?? s.authMode,
      arcadeMode: opts?.arcadeMode ?? s.arcadeMode,
    }));
  },
}));

// sync from hashchange (back/forward)
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    const parsed = parseHash();
    useApp.setState({
      view: parsed.view,
      activeDreamId: parsed.activeDreamId,
      activeSessionId: parsed.activeSessionId,
    });
  });
}
