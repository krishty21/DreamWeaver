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
  | "shared"
  | "story"
  | "echo";

type AppState = {
  view: View;
  activeDreamId: string | null;
  activeSessionId: string | null;
  activeShareToken: string | null;
  // r10 — second dream of an echo comparison (#/echo/<a>/<b>).
  echoDreamId: string | null;
  // Optional day drill-down for the journal (#/journal/<YYYY-MM-DD>, linked
  // from the nights-remembered calendar). Null = show all dreams.
  journalDate: string | null;
  authMode: "signin" | "signup";
  arcadeMode: "replay" | "rewrite" | "confront";
  mounted: boolean;
  // r9 — command palette (⌘K): fuzzy dream search + quick actions.
  paletteOpen: boolean;
  // r9 — one-shot prefill for the journal search (set by the lexicon cloud /
  // palette; consumed and cleared by JournalView on mount).
  journalQuery: string | null;
  navigate: (view: View, opts?: { dreamId?: string; sessionId?: string; shareToken?: string; authMode?: "signin" | "signup"; arcadeMode?: "replay" | "rewrite" | "confront"; journalDate?: string | null; echoId?: string }) => void;
  syncFromHash: () => void;
  openPalette: () => void;
  closePalette: () => void;
  setJournalQuery: (q: string | null) => void;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseHash(): { view: View; activeDreamId: string | null; activeSessionId: string | null; activeShareToken: string | null; journalDate: string | null; echoDreamId: string | null } {
  const h = (typeof window !== "undefined" ? window.location.hash : "").replace(/^#\/?/, "");
  const [head, ...rest] = h.split("/");
  const view = (head as View) || "landing";
  const valid: View[] = ["landing", "auth", "dashboard", "capture", "journal", "dream", "patterns", "atlas", "arcade", "session", "profile", "shared", "story", "echo"];
  if (!valid.includes(view) || !view) return { view: "landing", activeDreamId: null, activeSessionId: null, activeShareToken: null, journalDate: null, echoDreamId: null };
  let dreamId: string | null = null;
  let sessionId: string | null = null;
  let shareToken: string | null = null;
  let journalDate: string | null = null;
  let echoDreamId: string | null = null;
  // #/dream/<id> — dream detail
  // #/session/<id> — arcade session
  // #/arcade/<id> — arcade with a pre-selected dream (re-enter panel)
  // #/shared/<token> — public read-only shared reflection
  // #/story/<token> — public read-only arcade session story (r10)
  // #/echo/<a>/<b> — two-dream comparative echo view (r10)
  // #/journal/<YYYY-MM-DD> — journal filtered to one night (calendar drill-down)
  if (view === "dream" && rest[0]) dreamId = rest[0];
  if (view === "session" && rest[0]) sessionId = rest[0];
  if (view === "arcade" && rest[0] && rest[0] !== "") dreamId = rest[0];
  if ((view === "shared" || view === "story") && rest[0]) shareToken = rest[0];
  if (view === "echo" && rest[0] && rest[1]) {
    dreamId = rest[0];
    echoDreamId = rest[1];
  }
  if (view === "journal" && rest[0] && DATE_RE.test(rest[0])) journalDate = rest[0];
  return { view, activeDreamId: dreamId, activeSessionId: sessionId, activeShareToken: shareToken, journalDate, echoDreamId };
}

function toHash(view: View, dreamId?: string | null, sessionId?: string | null, shareToken?: string | null, journalDate?: string | null, echoId?: string | null) {
  if (view === "dream" && dreamId) return `#/dream/${dreamId}`;
  if (view === "session" && sessionId) return `#/session/${sessionId}`;
  if (view === "arcade" && dreamId) return `#/arcade/${dreamId}`;
  if (view === "shared" && shareToken) return `#/shared/${shareToken}`;
  if (view === "story" && shareToken) return `#/story/${shareToken}`;
  if (view === "echo" && dreamId && echoId) return `#/echo/${dreamId}/${echoId}`;
  if (view === "journal" && journalDate) return `#/journal/${journalDate}`;
  return `#/${view === "landing" ? "" : view}`;
}

export const useApp = create<AppState>((set, get) => ({
  // Initialise WITHOUT touching window so SSR + client first render match.
  view: "landing",
  activeDreamId: null,
  activeSessionId: null,
  activeShareToken: null,
  echoDreamId: null,
  journalDate: null,
  authMode: "signin",
  arcadeMode: "replay",
  mounted: false,
  paletteOpen: false,
  journalQuery: null,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  setJournalQuery: (q) => set({ journalQuery: q }),
  syncFromHash: () => {
    if (typeof window === "undefined") return;
    const parsed = parseHash();
    set({
      view: parsed.view,
      activeDreamId: parsed.activeDreamId,
      activeSessionId: parsed.activeSessionId,
      activeShareToken: parsed.activeShareToken,
      journalDate: parsed.journalDate,
      echoDreamId: parsed.echoDreamId,
      mounted: true,
    });
  },
  navigate: (view, opts) => {
    const dreamId = opts?.dreamId ?? null;
    const sessionId = opts?.sessionId ?? null;
    const shareToken = opts?.shareToken ?? null;
    const echoId = view === "echo" ? opts?.echoId ?? null : null;
    const journalDate = view === "journal" ? opts?.journalDate ?? null : null;
    if (typeof window !== "undefined") {
      const hash = toHash(view, dreamId, sessionId, shareToken, journalDate, echoId);
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
      echoDreamId: echoId,
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
      echoDreamId: parsed.echoDreamId,
    });
  });
}
