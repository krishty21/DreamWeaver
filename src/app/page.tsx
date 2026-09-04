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
import { ArcadeView } from "@/components/views/arcade-view";
import { ArcadeSessionView } from "@/components/views/arcade-session-view";
import { ProfileView } from "@/components/views/profile-view";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";

export default function Home() {
  const { status } = useSession();
  const view = useApp((s) => s.view);
  const mounted = useApp((s) => s.mounted);
  const syncFromHash = useApp((s) => s.syncFromHash);
  useAuthRouting();

  // Sync the store from the URL hash AFTER mount to avoid SSR/CSR mismatch.
  useEffect(() => {
    syncFromHash();
  }, [syncFromHash]);

  const authed = status === "authenticated";
  const loading = status === "loading" || !mounted;

  // Full-bleed views (landing + auth) render their own background + footer.
  const fullBleed = view === "landing" || view === "auth" || !authed;

  return (
    <div className="relative min-h-screen flex flex-col">
      <DreamBackground mood={moodFor(view)} />

      {authed && <TopNav />}

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
              className="relative z-10"
            >
              {view === "auth" ? <AuthView /> : <LandingView />}
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

      {authed && <Footer />}
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
    case "arcade":
      return <ArcadeView />;
    case "session":
      return <ArcadeSessionView />;
    case "profile":
      return <ProfileView />;
    default:
      return <DashboardView />;
  }
}

function moodFor(view: View): string {
  // The arcade + dream views tend toward the surreal/lucid palette.
  if (view === "session" || view === "arcade") return "surreal";
  if (view === "capture") return "lucid";
  if (view === "dream") return "melancholic";
  if (view === "patterns") return "neutral";
  return "neutral";
}
