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
  | "atlas"
  | "arcade"
  | "session"
  | "profile"
  | "shared";

type AppState = {
  view: View;
  activeDreamId: string | null;
  activeSessionId: string | null;
  activeShareToken: string | null;
  // Optional day drill-down for the journal (#/journal/<YYYY-MM-DD>, linked
  // from the nights-remembered calendar). Null = show all dreams.
  journalDate: string | null;
  authMode: "signin" | "signup";
  arcadeMode: "replay" | "rewrite" | "confront";
  mounted: boolean;
  navigate: (view: View, opts?: { dreamId?: string; sessionId?: string; shareToken?: string; authMode?: "signin" | "signup"; arcadeMode?: "replay" | "rewrite" | "confront"; journalDate?: string | null }) => void;
  syncFromHash: () => void;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseHash(): { view: View; activeDreamId: string | null; activeSessionId: string | null; activeShareToken: string | null; journalDate: string | null } {
  const h = (typeof window !== "undefined" ? window.location.hash : "").replace(/^#\/?/, "");
  const [head, ...rest] = h.split("/");
  const view = (head as View) || "landing";
  const valid: View[] = ["landing", "auth", "dashboard", "capture", "journal", "dream", "patterns", "atlas", "arcade", "session", "profile", "shared"];
  if (!valid.includes(view) || !view) return { view: "landing", activeDreamId: null, activeSessionId: null, activeShareToken: null, journalDate: null };
  let dreamId: string | null = null;
  let sessionId: string | null = null;
  let shareToken: string | null = null;
  let journalDate: string | null = null;
  // #/dream/<id> — dream detail
  // #/session/<id> — arcade session
  // #/arcade/<id> — arcade with a pre-selected dream (re-enter panel)
  // #/shared/<token> — public read-only shared reflection
  // #/journal/<YYYY-MM-DD> — journal filtered to one night (calendar drill-down)
  if (view === "dream" && rest[0]) dreamId = rest[0];
  if (view === "session" && rest[0]) sessionId = rest[0];
  if (view === "arcade" && rest[0] && rest[0] !== "") dreamId = rest[0];
  if (view === "shared" && rest[0]) shareToken = rest[0];
  if (view === "journal" && rest[0] && DATE_RE.test(rest[0])) journalDate = rest[0];
  return { view, activeDreamId: dreamId, activeSessionId: sessionId, activeShareToken: shareToken, journalDate };
}

function toHash(view: View, dreamId?: string | null, sessionId?: string | null, shareToken?: string | null, journalDate?: string | null) {
  if (view === "dream" && dreamId) return `#/dream/${dreamId}`;
  if (view === "session" && sessionId) return `#/session/${sessionId}`;
  if (view === "arcade" && dreamId) return `#/arcade/${dreamId}`;
  if (view === "shared" && shareToken) return `#/shared/${shareToken}`;
  if (view === "journal" && journalDate) return `#/journal/${journalDate}`;
  return `#/${view === "landing" ? "" : view}`;
}

export const useApp = create<AppState>((set, get) => ({
  // Initialise WITHOUT touching window so SSR + client first render match.
  view: "landing",
  activeDreamId: null,
  activeSessionId: null,
  activeShareToken: null,
  journalDate: null,
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
      activeShareToken: parsed.activeShareToken,
      journalDate: parsed.journalDate,
      mounted: true,
    });
  },
  navigate: (view, opts) => {
    const dreamId = opts?.dreamId ?? null;
    const sessionId = opts?.sessionId ?? null;
    const shareToken = opts?.shareToken ?? null;
    // Only the journal accepts a day filter; navigating anywhere else clears it.
    const journalDate = view === "journal" ? opts?.journalDate ?? null : null;
    if (typeof window !== "undefined") {
      const hash = toHash(view, dreamId, sessionId, shareToken, journalDate);
      if (window.location.hash !== hash) {
        window.location.hash = hash;
      }
    }
    set((s) => ({
      view,
      activeDreamId: dreamId,
      activeSessionId: sessionId,
      activeShareToken: shareToken,
      journalDate,
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
      activeShareToken: parsed.activeShareToken,
      journalDate: parsed.journalDate,
    });
  });
}
