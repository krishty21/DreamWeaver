"use client";

import { Moon, Sparkles, BookOpenText, Map, Compass, User, LogOut } from "lucide-react";
import { useSession, signOut } from "next-auth/react";
import { useApp, View } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const NAV: { view: View; label: string; icon: any }[] = [
  { view: "dashboard", label: "Today", icon: Moon },
  { view: "capture", label: "Capture", icon: Sparkles },
  { view: "journal", label: "Journal", icon: BookOpenText },
  { view: "patterns", label: "Patterns", icon: Map },
  { view: "arcade", label: "Arcade", icon: Compass },
];

export function TopNav() {
  const { status } = useSession();
  const view = useApp((s) => s.view);
  const navigate = useApp((s) => s.navigate);
  const authed = status === "authenticated";

  if (!authed) return null;

  return (
    <header className="sticky top-0 z-30 w-full">
      <div className="backdrop-blur-md bg-[color-mix(in_srgb,var(--background)_72%,transparent)] border-b border-border">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 h-16 flex items-center gap-6">
          <button
            onClick={() => navigate("dashboard")}
            className="flex items-center gap-2.5 focus-ring rounded-md"
            aria-label="DreamWeaver home"
          >
            <DreamMark />
            <span className="font-display text-xl tracking-display text-foreground">DreamWeaver</span>
          </button>

          <nav className="hidden md:flex items-center gap-1 ml-4">
            {NAV.map((item) => {
              const active = view === item.view;
              const Icon = item.icon;
              return (
                <button
                  key={item.view}
                  onClick={() => navigate(item.view)}
                  className={cn(
                    "flex items-center gap-2 px-3.5 py-2 rounded-full text-sm transition-all focus-ring",
                    active
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]"
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.6} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => navigate("profile")}
              className={cn(
                "hidden sm:flex items-center gap-2 px-3 py-2 rounded-full text-sm transition-all focus-ring",
                view === "profile"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]"
              )}
            >
              <User className="h-4 w-4" strokeWidth={1.6} />
              Profile
            </button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut({ redirect: false })}
              className="text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.6} />
              <span className="sr-only sm:not-sr-only sm:ml-1.5">Sign out</span>
            </Button>
          </div>
        </div>

        {/* mobile nav */}
        <div className="md:hidden flex items-center gap-1 overflow-x-auto px-3 pb-2 scroll-elegant">
          {NAV.map((item) => {
            const active = view === item.view;
            const Icon = item.icon;
            return (
              <button
                key={item.view}
                onClick={() => navigate(item.view)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-all focus-ring",
                  active
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.6} />
                {item.label}
              </button>
            );
          })}
          <button
            onClick={() => navigate("profile")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-all focus-ring",
              view === "profile" ? "bg-foreground text-background" : "text-muted-foreground"
            )}
          >
            <User className="h-3.5 w-3.5" strokeWidth={1.6} />
            Profile
          </button>
        </div>
      </div>
    </header>
  );
}

export function DreamMark() {
  return (
    <span
      className="inline-flex h-8 w-8 items-center justify-center rounded-full"
      style={{
        background:
          "radial-gradient(circle at 35% 30%, rgba(216,207,208,0.95), rgba(105,113,132,0.55) 60%, rgba(65,63,61,0.95) 100%)",
      }}
      aria-hidden="true"
    >
      <span className="block h-3 w-3 rounded-full bg-background/90 pulse-soft" />
    </span>
  );
}

export function Footer() {
  return (
    <footer className="mt-auto border-t border-border bg-[color-mix(in_srgb,var(--background)_80%,transparent)]">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <DreamMark />
          <span className="font-display text-base text-foreground">DreamWeaver</span>
          <span className="hidden sm:inline">— your dreams, kept.</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="hidden md:inline-flex items-center gap-1.5" aria-hidden="true">
            <kbd className="font-data text-[10px] px-1.5 py-0.5 rounded border border-border bg-card/70">C</kbd>
            capture
            <kbd className="font-data text-[10px] px-1.5 py-0.5 rounded border border-border bg-card/70 ml-1.5">J</kbd>
            journal
            <kbd className="font-data text-[10px] px-1.5 py-0.5 rounded border border-border bg-card/70 ml-1.5">A</kbd>
            arcade
          </span>
          <span>AI reflection is advisory, never clinical.</span>
        </div>
      </div>
    </footer>
  );
}
