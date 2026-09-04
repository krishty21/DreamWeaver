"use client";

import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import { DreamMark } from "@/components/shell/top-nav";
import {
  Loader2,
  MoonStar,
  Hourglass,
  Compass,
  Sparkles,
  BookOpenText,
  PenLine,
  Eye,
  Copy,
  Check,
} from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { endingText } from "@/lib/simulation";
import type { EndingType } from "@/lib/types";

// r10 — Public, read-only view of one arcade session's STORY, addressed by
// share token (#/story/<token>). Works signed-out, exactly like the shared
// dream reflection. It renders precisely what /api/shared/session/[token]
// returns — the sanitised narrative: mode, the dream's TITLE only, every turn
// (your action + the scene Gemini wove), the ending, and the final meters.
// Never the dream's raw text, never model internals, never the dreamer's
// identity beyond an optional first name.

async function fetchStory(token: string) {
  const res = await fetch(`/api/shared/session/${token}`);
  if (!res.ok) {
    // r11 — distinguish "expired" from plain 404 (both are 404 http, but the
    // body carries an error code), same as the shared dream view.
    let code = "not found";
    try {
      const body = await res.json();
      if (body?.error === "expired") code = "expired";
    } catch {
      /* keep default */
    }
    throw new Error(code);
  }
  return res.json();
}

const MODE_COPY: Record<string, { verb: string; line: string }> = {
  replay: {
    verb: "Replayed",
    line: "The dream was re-lived the way it was remembered.",
  },
  rewrite: {
    verb: "Rewritten",
    line: "The dream was taken by the hand and steered somewhere new.",
  },
  confront: {
    verb: "Confronted",
    line: "A recurring motif was met on purpose, eye to eye.",
  },
};

export function StoryView() {
  const token = useApp((s) => s.activeShareToken);
  const navigate = useApp((s) => s.navigate);
  const [progress, setProgress] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ["story", token],
    queryFn: () => fetchStory(token!),
    enabled: !!token,
    retry: false,
    // Public share links must be FRESH on every mount: a dreamer can revoke or
    // let the window expire at any moment, and a cached copy would keep showing
    // the story after it closed (the global 30s staleTime is wrong here).
    staleTime: 0,
    refetchOnMount: "always",
  });

  // r10 — reading progress: a hairline rose line at the very top of the page
  // that fills as the visitor reads the night through.
  useEffect(() => {
    function onScroll() {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="relative min-h-screen flex flex-col">
      {/* reading progress hairline */}
      <div className="story-progress-track" aria-hidden="true">
        <span className="story-progress-fill" style={{ transform: `scaleX(${progress})` }} />
      </div>
      {/* brand bar */}
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 pt-8 flex items-center justify-between">
        <button
          onClick={() => navigate("landing")}
          className="flex items-center gap-2.5 focus-ring rounded-sm"
          aria-label="DreamWeaver home"
        >
          <DreamMark />
          <span className="font-display text-2xl tracking-display">DreamWeaver</span>
        </button>
        <div className="flex items-center gap-2">
          {data?.story && <CopyStoryLink />}
          <button
            onClick={() => navigate("auth", { authMode: "signup" })}
            className="px-4 py-2 rounded-full text-sm bg-foreground text-background hover:opacity-90 transition focus-ring"
          >
            Keep your own dreams
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center py-28">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error || !data?.story ? (
        <div className="flex-1 flex items-center justify-center px-6 py-28">
          <div className="text-center max-w-md">
            {error?.message === "expired" ? (
              <Hourglass className="h-8 w-8 mx-auto text-muted-foreground" strokeWidth={1.4} />
            ) : (
              <MoonStar className="h-8 w-8 mx-auto text-muted-foreground" strokeWidth={1.4} />
            )}
            <h1 className="mt-5 font-display text-4xl tracking-display balance">
              {error?.message === "expired"
                ? "This window has closed."
                : "This story is no longer being told."}
            </h1>
            <p className="mt-3 text-sm text-muted-foreground pretty">
              {error?.message === "expired"
                ? "The dreamer set this story to expire, and its time has passed. The re-entry returns to private memory."
                : "The dreamer may have withdrawn the link, or it never existed. The night it came from stays private, wherever it is."}
            </p>
            <button
              onClick={() => navigate("landing")}
              className="mt-7 px-5 py-2.5 rounded-full text-sm border border-border hover:bg-card transition focus-ring"
            >
              What is DreamWeaver?
            </button>
          </div>
        </div>
      ) : (
        <StoryBody story={data.story} />
      )}

      {/* footer */}
      <footer className="mt-auto border-t border-border/60">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="font-display text-sm tracking-display text-foreground">DreamWeaver</span>
          <span className="pretty">
            Shared stories are read-only. Scenes are AI-generated; the choices were the dreamer&rsquo;s own.
          </span>
        </div>
      </footer>
    </div>
  );
}

function StoryBody({ story }: { story: any }) {
  const mode = MODE_COPY[story.mode] ?? MODE_COPY.replay;
  const ending = endingText((story.ending as EndingType) ?? "unresolved");
  const turns: any[] = story.turns ?? [];
  const st = story.finalState ?? {};

  return (
    <div className="mx-auto w-full max-w-2xl px-5 sm:px-8 py-12 sm:py-16">
      {/* masthead */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="page-rule" aria-hidden="true" />
        <div className="eyebrow mb-3">
          <Compass className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
          A re-entered dream · {mode.verb.toLowerCase()}
        </div>
        <h1 className="font-display tracking-display text-4xl sm:text-5xl leading-[1.02] balance">
          {story.dream.title}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground pretty">
          {mode.line} {story.authorName ? `${story.authorName} went back in` : "The dreamer went back in"}
          {" "}on {fmtDay(story.beganOn)} and stayed {story.turnsCount} turn{story.turnsCount === 1 ? "" : "s"}.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="chip">{story.mode}</span>
          <span className="chip">{story.dream.mood}</span>
          {story.sharedAt && (
            <span className="font-data tracking-caps uppercase inline-flex items-center gap-1">
              <Hourglass className="h-3 w-3" strokeWidth={1.6} aria-hidden="true" />
              shared {fmtDay(story.sharedAt)}
            </span>
          )}
          {/* r11 — if the dreamer armed an expiry, readers deserve to see the window */}
          {story.expiresAt && <StoryExpiryChip expiresAt={story.expiresAt} />}
        </div>
      </motion.div>

      {/* the narrative */}
      <div className="mt-12 space-y-10">
        {turns.map((t, i) => (
          <motion.section
            key={t.n}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: Math.min(0.05 * i, 0.3) }}
            className="story-turn"
            aria-label={`Turn ${t.n}`}
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="font-data text-[10px] text-muted-foreground tracking-caps uppercase">
                {String(t.n).padStart(2, "0")}
              </span>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
              {i === 0 && (
                <span className="font-data text-[10px] text-muted-foreground tracking-caps uppercase">
                  the entry
                </span>
              )}
            </div>
            {t.userAction && t.userAction.trim() !== "" && (
              <p className="story-action pretty">
                <PenLine className="inline h-3 w-3 mr-1.5 -mt-0.5" strokeWidth={1.7} aria-hidden="true" />
                <span className="text-foreground font-medium">You: </span>
                {t.userAction}
              </p>
            )}
            <p className={`scene-text pretty ${i === 0 ? "story-dropcap" : ""}`}>{t.sceneText}</p>
          </motion.section>
        ))}
      </div>

      {/* discovered motifs */}
      {Array.isArray(story.discovered) && story.discovered.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="mt-12"
        >
          <div className="flex items-center gap-3 mb-3">
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
            <h2 className="font-display text-xl tracking-tight">Found along the way</h2>
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>
          <p className="text-xs text-muted-foreground pretty mb-3">
            Motifs the dreamer met inside the re-entry — some were already part of the recorded
            night, some appeared only here.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {story.discovered.map((m: string, i: number) => (
              <span key={i} className="chip capitalize">{m}</span>
            ))}
          </div>
        </motion.div>
      )}

      {/* ending */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="surface p-7 mt-12 text-center"
      >
        <div className="ornament-rule mb-4" aria-hidden="true" />
        <div className="text-xs tracking-caps uppercase text-muted-foreground mb-2">
          How it ended
        </div>
        <h2 className="font-display tracking-display text-3xl sm:text-4xl balance">{ending.title}.</h2>
        <p className="mt-3 text-sm text-muted-foreground pretty max-w-md mx-auto">{ending.body}</p>
      </motion.div>

      {/* final meters */}
      {st.fear != null && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-4"
        >
          <StoryMeter label="Fear" value={st.fear} />
          <StoryMeter label="Lucidity" value={st.lucidity} />
          <StoryMeter label="Stability" value={st.stability} />
          <StoryMeter label="Agency" value={st.agency} />
        </motion.div>
      )}

      {/* provenance */}
      <p className="mt-10 text-[11px] text-muted-foreground italic pretty text-center">
        The scenes above were generated scene-by-scene by an AI as the dreamer acted; the state
        meters were validated by the application, not the model. The original recorded dream is
        not part of this share.
      </p>

      {/* CTA */}
      <div className="mt-10 text-center">
        <button
          onClick={() => useApp.getState().navigate("auth", { authMode: "signup" })}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-foreground text-background text-sm hover:opacity-90 transition focus-ring"
        >
          <BookOpenText className="h-4 w-4" strokeWidth={1.6} aria-hidden="true" />
          Keep your own dreams
        </button>
      </div>
    </div>
  );
}

function StoryMeter({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  return (
    <div className="text-center">
      <div className="font-display text-2xl leading-none tabular-nums">{value}</div>
      <div className="mt-1 text-[10px] tracking-caps uppercase text-muted-foreground">{label}</div>
    </div>
  );
}

// r10 — copy-link chip in the public story header. Copies the current URL so
// a visitor can pass the story along without the dreamer's app chrome.
function CopyStoryLink() {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <button
      onClick={onCopy}
      className="story-link-chip inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs focus-ring"
      aria-label="Copy this story's link"
    >
      {copied ? (
        <Check className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
      ) : (
        <Copy className="h-3 w-3" strokeWidth={1.7} aria-hidden="true" />
      )}
      {copied ? "copied" : "copy link"}
    </button>
  );
}

// r11 — quiet chip telling readers when the link closes (day precision).
function StoryExpiryChip({ expiresAt }: { expiresAt: string }) {
  let d: Date | null = null;
  try {
    d = new Date(expiresAt);
    if (Number.isNaN(d.getTime())) d = null;
  } catch {
    d = null;
  }
  if (!d) return null;
  const closes = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return (
    <span
      className="story-expiry-chip font-data tracking-caps uppercase inline-flex items-center gap-1"
      title="The dreamer chose a window for this share"
    >
      <Hourglass className="h-3 w-3" strokeWidth={1.6} aria-hidden="true" />
      closes {closes}
    </span>
  );
}

function fmtDay(iso: string): string {
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
