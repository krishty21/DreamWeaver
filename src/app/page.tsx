"use client";

import { useSession } from "next-auth/react";
import { useApp, View } from "@/lib/store";
import { useAuthRouting } from "@/lib/use-auth-routing";
import { useEffect } from "react";
import { DreamBackground } from "@/components/shell/dream-background";
import { TopNav, Footer } from "@/components/shell/top-nav";
import { LandingView } from "@/components/views/landing-view";
import { AuthView } from "@/components/views/auth-view";
import { DashboardView } from "@/components/views/dashboard-view";
import { CaptureView } from "@/components/views/capture-view";
import { JournalView } from "@/components/views/journal-view";
import { DreamDetailView } from "@/components/views/dream-detail-view";
import { PatternsView } from "@/components/views/patterns-view";
import { AtlasView } from "@/components/views/atlas-view";
import { ArcadeView } from "@/components/views/arcade-view";
import { ArcadeSessionView } from "@/components/views/arcade-session-view";
import { ProfileView } from "@/components/views/profile-view";
import { SharedDreamView } from "@/components/views/shared-dream-view";
import { StoryView } from "@/components/views/story-view";
import { EchoView } from "@/components/views/echo-view";
import { ThreadsView } from "@/components/views/threads-view";
import { CommandPalette } from "@/components/shell/command-palette";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";

export default function Home() {
  const { status } = useSession();
  const view = useApp((s) => s.view);
  const mounted = useApp((s) => s.mounted);
  const syncFromHash = useApp((s) => s.syncFromHash);
  const navigate = useApp((s) => s.navigate);
  useAuthRouting();

  // Sync the store from the URL hash AFTER mount to avoid SSR/CSR mismatch.
  useEffect(() => {
    syncFromHash();
  }, [syncFromHash]);

  const authed = status === "authenticated";

  // Global keyboard shortcuts (only when authenticated).
  // C capture · J journal · P patterns · A arcade · T today · X atlas
  // r9: Cmd/Ctrl+K now opens the command palette (fuzzy dream search + quick
  // actions) — the palette registers its own global listener, so the handler
  // here only covers the single-key navigation shortcuts.
  useEffect(() => {
    if (!authed) return;
    const onKey = (e: KeyboardEvent) => {
      // Single-key shortcuts ignore modifier keys and require
      // the focus NOT to be inside a text input.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      switch (e.key.toLowerCase()) {
        case "c":
          navigate("capture");
          break;
        case "j":
          navigate("journal");
          break;
        case "p":
          navigate("patterns");
          break;
        case "x":
          navigate("atlas");
          break;
        case "a":
          navigate("arcade");
          break;
        case "t":
          navigate("dashboard");
          break;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [authed, navigate]);

  const loading = status === "loading" || !mounted;

  // Full-bleed views (landing + auth + public shared reflection + public
  // session story) render their own background + chrome. Both public views
  // render signed out — even for authed visitors.
  const fullBleed = view === "shared" || view === "story" || view === "landing" || view === "auth" || !authed;

  return (
    <div className="relative min-h-screen flex flex-col">
      <DreamBackground mood={moodFor(view)} />

      {/* The shared reflection and the session story are standalone public
          pages — they render their own brand bar and footer, never the
          private app chrome. */}
      {authed && view !== "shared" && view !== "story" && <TopNav />}
      {authed && view !== "shared" && view !== "story" && <CommandPalette />}

      <main className="relative z-10 flex-1 flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : fullBleed ? (
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="relative z-10 flex-1 flex flex-col"
            >
              {view === "auth" ? (
                <AuthView />
              ) : view === "shared" ? (
                <SharedDreamView />
              ) : view === "story" ? (
                <StoryView />
              ) : (
                <LandingView />
              )}
            </motion.div>
          </AnimatePresence>
        ) : (
          <div className="relative z-10 flex-1 flex flex-col">
            <AnimatePresence mode="wait">
              <motion.div
                key={view + (useApp.getState().activeDreamId ?? "") + (useApp.getState().activeSessionId ?? "")}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="flex-1 flex flex-col"
              >
                {renderView(view)}
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </main>

      {authed && view !== "shared" && view !== "story" && <Footer />}
    </div>
  );
}

function renderView(view: View) {
  switch (view) {
    case "dashboard":
      return <DashboardView />;
    case "capture":
      return <CaptureView />;
    case "journal":
      return <JournalView />;
    case "dream":
      return <DreamDetailView />;
    case "patterns":
      return <PatternsView />;
    case "atlas":
      return <AtlasView />;
    case "arcade":
      return <ArcadeView />;
    case "session":
      return <ArcadeSessionView />;
    case "echo":
      return <EchoView />;
    case "threads":
      return <ThreadsView />;
    case "profile":
      return <ProfileView />;
    default:
      return <DashboardView />;
  }
}

function moodFor(view: View): string {
  // The arcade + dream + story views tend toward the surreal palette.
  if (view === "session" || view === "arcade" || view === "story") return "surreal";
  if (view === "capture") return "lucid";
  if (view === "dream" || view === "shared") return "melancholic";
  if (view === "atlas" || view === "echo" || view === "threads") return "lucid";
  if (view === "patterns") return "neutral";
  return "neutral";
}
