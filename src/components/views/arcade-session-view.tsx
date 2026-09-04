"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, Send, Compass, RotateCcw, Brain, Sparkles, Moon, Share2, Copy, Check, Link2Off, BookOpenText, Hourglass } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import type { SimulationState, ArcadeChoice, MemoryEcho } from "@/lib/types";

async function fetchSession(id: string) {
  const res = await fetch(`/api/arcade/sessions/${id}`);
  if (!res.ok) throw new Error("not found");
  return res.json();
}

// Rotating whispers shown while the model composes the next scene — turns
// unavoidable LLM latency into part of the dream's texture.
const WHISPERS = [
  "somewhere behind your eyes, the scene is assembling…",
  "a door is deciding whether to open…",
  "the motifs are finding each other again…",
  "the dream is remembering you…",
  "the next moment is choosing its shape…",
];

export function ArcadeSessionView() {
  const sessionId = useApp((s) => s.activeSessionId);
  const navigate = useApp((s) => s.navigate);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [action, setAction] = useState("");
  const [whisper, setWhisper] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  // r6: live-streamed scene text from the model — replaces the static shimmer
  // with text that types itself as Gemini produces it.
  const [streamingScene, setStreamingScene] = useState("");
  // r12 — the latest MEMORY ECHO (a selective historical-connection notice
  // the app attached to the most recent turn). Transient by design: it shows
  // for the current turn, then clears on the next. Not persisted on the turn
  // row because echoes are occasional, contextual asides — not part of the
  // dream's authoritative record.
  const [lastEcho, setLastEcho] = useState<MemoryEcho | null>(null);

  // While a turn is pending: rotate whispers + count seconds, so waiting feels
  // like drifting rather than stalling.
  useEffect(() => {
    if (!pending) return;
    setWhisper(0);
    setElapsedSec(0);
    setStreamingScene("");
    const wi = setInterval(() => setWhisper((w) => (w + 1) % WHISPERS.length), 3600);
    const si = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => {
      clearInterval(wi);
      clearInterval(si);
    };
  }, [pending]);

  const { data, isLoading } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => fetchSession(sessionId!),
    enabled: !!sessionId,
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-28">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const session = data.session;
  const turns: any[] = session.turns ?? [];
  const lastTurn = turns[turns.length - 1];
  const state: SimulationState = (() => {
    try {
      return JSON.parse(session.stateJson) as SimulationState;
    } catch {
      return { fear: 25, lucidity: 40, stability: 70, agency: 35, turn: turns.length, discoveredMotifs: [], visitedScenes: [], inventory: [], phase: "opening" };
    }
  })();
  const ended = session.status === "ended" && !!session.ending;
  const choices: ArcadeChoice[] = (() => {
    try {
      return JSON.parse(lastTurn?.choicesJson || "[]") as ArcadeChoice[];
    } catch {
      return [];
    }
  })();
  const discovered = (() => {
    try {
      return Array.from(new Set(turns.flatMap((t) => JSON.parse(t.discoveredMotifsJson || "[]")))) as string[];
    } catch {
      return [];
    }
  })();

  async function takeTurn(payload: { userAction?: string; choiceId?: string }) {
    if (pending || ended) return;
    setPending(true);
    setStreamingScene("");
    // r12 — clear the previous turn's echo so a fresh one can surface this turn.
    setLastEcho(null);
    try {
      // r6: SSE streaming turn — the scene text types itself as the model
      // produces it. The endpoint emits delta + final events; we parse the
      // text/event-stream manually (no EventSource because we need POST).
      const res = await fetch(`/api/arcade/sessions/${session.id}/turn/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 409) {
          // already ended — refresh
          qc.invalidateQueries({ queryKey: ["session", session.id] });
          return;
        }
        throw new Error(err.error || "The dream faltered.");
      }
      if (!res.body) throw new Error("The dream faltered.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalPayload: any = null;
      let errorMsg: string | null = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of chunk.split("\n")) {
            const m = line.match(/^data:\s?(.*)$/);
            if (!m) continue;
            try {
              const ev = JSON.parse(m[1]);
              if (ev.type === "delta" && typeof ev.text === "string") {
                setStreamingScene((s) => s + ev.text);
              } else if (ev.type === "final") {
                finalPayload = ev;
              } else if (ev.type === "error") {
                errorMsg = ev.error || "The dream faltered.";
              }
            } catch {
              // skip malformed
            }
          }
        }
      }
      if (errorMsg) throw new Error(errorMsg);
      // If we got no final event, the stream ended early — refresh from server.
      if (!finalPayload) {
        qc.invalidateQueries({ queryKey: ["session", session.id] });
        qc.invalidateQueries({ queryKey: ["sessions"] });
        setAction("");
        return;
      }
      qc.invalidateQueries({ queryKey: ["session", session.id] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      setAction("");
      // r12 — capture the memory echo for this turn (transient display).
      setLastEcho(finalPayload.memoryEcho ?? null);
      if (finalPayload.ending) {
        toast({ title: finalPayload.ending.title, description: finalPayload.ending.body });
      }
    } catch (e: any) {
      toast({ title: "Turn failed", description: e.message, variant: "destructive" });
    } finally {
      setPending(false);
      setStreamingScene("");
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-5 sm:px-8 py-8 sm:py-12">
      <button
        onClick={() => navigate("arcade")}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition focus-ring mb-6"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.6} />
        Leave the dream
      </button>

      {/* header */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <div className="text-xs tracking-caps uppercase text-muted-foreground mb-1 flex items-center gap-2">
            <span>{session.mode}</span>
            <span className="h-px w-4 bg-border" />
            <span>{session.dream?.title || "A dream"}</span>
          </div>
          <h1 className="font-display tracking-display text-4xl sm:text-5xl leading-tight balance">
            {ended ? endingTitle(session.ending) : state.phase === "opening" ? "The dream opens." : state.phase === "climax" ? "The dream crests." : "The dream continues."}
          </h1>
        </div>
      </div>

      {/* state meters — always visible */}
      <div className="surface p-4 sm:p-5 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-5">
          <Meter label="Fear" value={state.fear} tone="tense" />
          <Meter label="Lucidity" value={state.lucidity} tone="lucid" />
          <Meter label="Stability" value={state.stability} tone="neutral" />
          <Meter label="Agency" value={state.agency} tone="lucid" />
        </div>
        {/* hairline + breathing room so the meta line reads as a caption,
            not a crammed fifth meter row */}
        <div className="mt-4 pt-3 border-t border-border/50 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            Turn <span className="font-data">{state.turn}</span> · phase {state.phase}
            {state.confrontMotif && (
              <>
                {" · "}confronting <span className="capitalize text-foreground">{state.confrontMotif}</span>
              </>
            )}
          </span>
          {discovered.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" /> discovered: {discovered.join(", ")}
            </span>
          )}
        </div>
        {/* inventory + visited scenes */}
        {(state.inventory?.length > 0 || state.visitedScenes?.length > 0) && (
          <div className="mt-3 pt-3 border-t border-border flex flex-col sm:flex-row gap-3 sm:gap-6 text-[11px]">
            {state.inventory?.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="tracking-caps uppercase text-muted-foreground shrink-0 mt-0.5">Carrying</span>
                <span className="flex flex-wrap gap-1.5">
                  {state.inventory.map((item, i) => (
                    <span key={i} className="chip">{item}</span>
                  ))}
                </span>
              </div>
            )}
            {state.visitedScenes?.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="tracking-caps uppercase text-muted-foreground shrink-0 mt-0.5">Scenes</span>
                <span className="flex flex-wrap gap-1.5">
                  {state.visitedScenes.map((s, i) => (
                    <span key={i} className="font-data text-[10px] text-muted-foreground">
                      {s}
                      {i < state.visitedScenes.length - 1 ? " ·" : ""}
                    </span>
                  ))}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* turns log */}
      <div className="space-y-6">
        {turns.map((t, i) => {
          const applied = (() => {
            try {
              return JSON.parse(t.appliedDeltaJson || "{}");
            } catch {
              return {};
            }
          })();
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: Math.min(i * 0.02, 0.2) }}
            >
              <div className="flex items-start gap-3 mb-2 text-xs text-muted-foreground">
                <span className="font-data">{String(t.turnNumber).padStart(2, "0")}</span>
                <span className="h-px flex-1 bg-border mt-2" />
                {t.isEnding && <span className="chip">{t.endingType}</span>}
              </div>
              <div className="text-sm text-muted-foreground italic mb-2">
                <span className="text-foreground not-italic font-medium">You: </span>
                {t.userAction}
              </div>
              <p className="scene-text pretty">{t.sceneText}</p>
              {applied.reasoning && (
                <p className="mt-2 text-[11px] text-muted-foreground italic">
                  <Brain className="inline h-3 w-3 mr-1" /> {applied.reasoning}
                </p>
              )}
            </motion.div>
          );
        })}

        {/* r12 — MEMORY ECHO: a subtle, selective historical-connection aside
            that the app attached to the most recent turn (never the model).
            Shown only when the app decided to surface one, and only briefly —
            it clears on the next turn. Never interrupts gameplay; appears as
            a quiet margin-note below the latest scene. */}
        <AnimatePresence>
          {lastEcho && !pending && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <div className="memory-echo">
                <div className="memory-echo-label">
                  <Sparkles className="h-3 w-3" strokeWidth={1.6} />
                  Memory echo
                </div>
                <p className="pretty">{lastEcho.note}</p>
                <button
                  onClick={() => navigate("dream", { dreamId: lastEcho.priorDreamId })}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-data tracking-caps uppercase text-foreground/70 hover:text-foreground transition-colors"
                >
                  Open that dream
                  <Compass className="h-3 w-3" strokeWidth={1.6} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* loading turn — the dream forms. r6: scene text types itself as
            the model streams it; the shimmer is replaced by actual prose the
            moment the first chunk arrives. */}
        <AnimatePresence>
          {pending && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="rounded-xl border border-border/70 bg-card/40 p-5"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-4">
                <span className="tracking-caps uppercase flex items-center gap-2">
                  <span className="rec-dot h-1.5 w-1.5 rounded-full bg-foreground" aria-hidden="true" />
                  {streamingScene ? "The dream unfolds" : "The dream is forming"}
                </span>
                <span className="font-data tabular-nums" aria-label={`${elapsedSec} seconds`}>
                  {elapsedSec}s
                </span>
              </div>
              <div className="flex items-start gap-4">
                <div className="relative h-12 w-12 shrink-0" aria-hidden="true">
                  <span
                    className="drift-orb absolute inset-0 rounded-full pulse-soft"
                    style={{
                      background:
                        "radial-gradient(circle at 35% 30%, rgba(216,207,208,0.95), rgba(105,113,132,0.5) 60%, rgba(65,63,61,0.9) 100%)",
                    }}
                  />
                  <Moon className="absolute inset-0 m-auto h-4 w-4 text-background" strokeWidth={1.8} />
                </div>
                <div className="flex-1 pt-1 min-w-0">
                  {streamingScene ? (
                    <p className="scene-text pretty streaming-text">
                      {streamingScene}
                      <span className="streaming-caret" aria-hidden="true" />
                    </p>
                  ) : (
                    <div className="space-y-2.5" aria-hidden="true">
                      <div className="shimmer-line h-3 w-11/12" />
                      <div className="shimmer-line h-3 w-full" />
                      <div className="shimmer-line h-3 w-4/5" />
                      <div className="shimmer-line h-3 w-3/5" />
                    </div>
                  )}
                </div>
              </div>
              <AnimatePresence mode="wait">
                {!streamingScene && (
                  <motion.p
                    key={whisper}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.5 }}
                    className="mt-4 font-display italic text-lg text-muted-foreground whisper"
                  >
                    {WHISPERS[whisper]}
                  </motion.p>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ending */}
      {ended ? (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="surface p-7 mt-8 text-center"
        >
          <div className="text-xs tracking-caps uppercase text-muted-foreground mb-2">
            Outcome
          </div>
          <h2 className="font-display tracking-display text-4xl balance">
            {endingTitle(session.ending)}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground pretty max-w-md mx-auto">
            {endingBody(session.ending)}
          </p>
          {/* r10 — share the session as a public read-only story */}
          <StoryShare session={session} />
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button
              onClick={() => navigate("arcade", { dreamId: session.dream.id })}
              className="h-11 bg-foreground text-background hover:opacity-90"
            >
              <RotateCcw className="h-4 w-4" strokeWidth={1.6} />
              Re-enter again
            </Button>
            <Button variant="outline" onClick={() => navigate("dream", { dreamId: session.dream.id })}>
              Read the dream
            </Button>
          </div>
        </motion.div>
      ) : (
        !pending && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="surface p-5 mt-6">
            {/* opening — no turns yet: invite the user to enter the dream */}
            {turns.length === 0 ? (
              <div className="text-center py-3">
                <p className="text-sm text-muted-foreground pretty mb-4">
                  The dream is waiting. Step in and the first scene will open — grounded in
                  what you recorded.
                </p>
                <Button
                  onClick={() => takeTurn({})}
                  className="h-11 px-6 bg-foreground text-background hover:opacity-90"
                >
                  <Moon className="h-4 w-4" strokeWidth={1.6} />
                  Open the dream
                </Button>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Or describe your own first action below.
                </p>
              </div>
            ) : null}

            {/* choices */}
            {choices.length > 0 && (
              <div className="space-y-2 mb-4">
                {choices.map((c) => (
                  <button
                    key={c.id}
                    disabled={pending}
                    onClick={() => takeTurn({ choiceId: c.id })}
                    className="w-full text-left px-4 py-3 rounded-lg border border-border bg-card/60 hover:bg-foreground/[0.04] transition flex items-center justify-between gap-3 disabled:opacity-50 focus-ring"
                  >
                    <span className="text-sm">{c.label}</span>
                    {c.hint && <span className="text-[11px] text-muted-foreground italic">{c.hint}</span>}
                  </button>
                ))}
              </div>
            )}

            {/* free action */}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Textarea
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  placeholder="Or describe what you do…"
                  className="min-h-[60px] max-h-[120px] bg-background/70 resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      if (action.trim()) takeTurn({ userAction: action.trim() });
                    }
                  }}
                />
              </div>
              <Button
                aria-label="Send action"
                disabled={pending || action.trim().length === 0}
                onClick={() => takeTurn({ userAction: action.trim() })}
                className="h-11 bg-foreground text-background hover:opacity-90"
              >
                <Send className="h-4 w-4" strokeWidth={1.6} />
                <span className="sr-only">Send action</span>
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Press ⌘/Ctrl + Enter to act. Gemini proposes scene changes; the application
              validates them before they affect your simulation.
            </p>
          </motion.div>
        )
      )}
    </div>
  );
}

// r10 — Story share controls for an ENDED session. Creates a read-only public
// link to the session's narrative (#/story/<token>) that works signed-out.
// The share never exposes the dream's raw text — only the story of the
// re-entry: mode, every turn (action + scene), the ending, the final meters.
// r11 — expiry windows (7 / 30 days / forever), mirroring the dream share
// panel. Setting a window re-arms it from now; "forever" clears it.
const STORY_WINDOWS = [
  { v: "7", label: "7 days" },
  { v: "30", label: "30 days" },
  { v: "never", label: "Forever" },
] as const;

function StoryShare({ session }: { session: any }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useApp((s) => s.navigate);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const token: string | null = session.shareToken ?? null;
  const url =
    token && typeof window !== "undefined" ? `${window.location.origin}/#/story/${token}` : "";

  async function onShare(opts?: { expiresInDays?: number | null }) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/arcade/sessions/${session.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          opts?.expiresInDays !== undefined ? { expiresInDays: opts.expiresInDays } : {}
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "The story could not be shared.");
      await qc.invalidateQueries({ queryKey: ["session", session.id] });
      const link = body?.share?.token
        ? `${window.location.origin}/#/story/${body.share.token}`
        : "";
      if (link && navigator.clipboard) {
        navigator.clipboard.writeText(link).catch(() => {});
      }
      const windowNote =
        opts?.expiresInDays === undefined || opts?.expiresInDays === null
          ? ""
          : ` The link will close in ${opts.expiresInDays} day${opts.expiresInDays === 1 ? "" : "s"}.`;
      toast({
        title: "Story shared",
        description: `A read-only link was copied to your clipboard. The dream's raw memory stays private.${windowNote}`,
      });
    } catch (e: any) {
      toast({ title: "Sharing failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/arcade/sessions/${session.id}/share`, { method: "DELETE" });
      if (!res.ok) throw new Error("The link could not be revoked.");
      await qc.invalidateQueries({ queryKey: ["session", session.id] });
      toast({
        title: "Story withdrawn",
        description: "The link no longer resolves. The story returns to private memory.",
      });
    } catch (e: any) {
      toast({ title: "Revoke failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function onCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  if (!token) {
    return (
      <div className="mt-5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onShare()}
          disabled={busy}
          className="h-9 story-share-btn"
          aria-label="Share this session as a read-only story"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" strokeWidth={1.6} />}
          <span className="ml-1.5">Share this story</span>
        </Button>
        <p className="mt-2 text-[11px] text-muted-foreground pretty max-w-md mx-auto">
          A read-only page with the whole re-entry — your choices, the scenes, the ending. The
          recorded dream itself is never included. You choose how long the link stays open.
        </p>
      </div>
    );
  }

  // r11 — expiry status, mirroring the dream share panel's semantics.
  const expiresAt: string | null = session.shareExpiresAt ?? null;
  const expiryDate = expiresAt ? new Date(expiresAt) : null;
  const isExpired = !!expiryDate && expiryDate.getTime() < Date.now();
  const daysLeft = expiryDate
    ? Math.ceil((expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const expiryLabel = !expiryDate
    ? "open forever"
    : isExpired
    ? "expired — re-open below"
    : daysLeft !== null && daysLeft <= 1
    ? "last day"
    : `closes in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
  const currentWindow: "never" | "7" | "30" =
    !expiryDate ? "never" : isExpired ? "7" : (daysLeft ?? 0) > 22 ? "30" : "7";
  const sharedLabel = session.sharedAt
    ? new Date(session.sharedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "recently";

  return (
    <div className="mt-5 story-share-row">
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <button
          onClick={onCopy}
          className="story-link-chip inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs focus-ring"
          aria-label="Copy the story link"
          title={url}
        >
          {copied ? (
            <Check className="h-3 w-3 text-foreground" strokeWidth={2} />
          ) : (
            <Copy className="h-3 w-3" strokeWidth={1.7} />
          )}
          {copied ? "copied" : "story link"}
        </button>
        <button
          onClick={() => navigate("story", { shareToken: token })}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-border hover:bg-foreground/[0.04] transition focus-ring"
        >
          <BookOpenText className="h-3 w-3" strokeWidth={1.7} />
          Read as story
        </button>
        <button
          onClick={onRevoke}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-muted-foreground hover:text-destructive transition focus-ring disabled:opacity-50"
          aria-label="Withdraw the story link"
        >
          <Link2Off className="h-3 w-3" strokeWidth={1.7} />
          withdraw
        </button>
      </div>
      {/* r11 — expiry window segmented control + status line */}
      <div className="mt-3 flex flex-col items-center gap-1.5">
        <div
          className="inline-flex items-center rounded-full border border-border bg-card p-0.5 story-window-group"
          role="group"
          aria-label="How long the story link stays open"
        >
          {STORY_WINDOWS.map((opt) => {
            const active = currentWindow === opt.v;
            return (
              <button
                key={opt.v}
                type="button"
                disabled={busy}
                aria-pressed={active}
                onClick={() =>
                  onShare({ expiresInDays: opt.v === "never" ? null : Number(opt.v) })
                }
                className={`px-3 h-7 rounded-full text-[11px] transition focus-ring disabled:opacity-50 ${
                  active
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className={`text-[11px] text-muted-foreground ${isExpired ? "text-destructive/90" : ""}`}>
          Shared {sharedLabel} · read-only ·{" "}
          <span className="inline-flex items-center gap-0.5">
            <Hourglass className="h-3 w-3" strokeWidth={1.7} aria-hidden="true" />
            {expiryLabel}
          </span>{" "}
          · the recorded dream stays private
        </p>
      </div>
    </div>
  );
}

function Meter({ label, value, tone }: { label: string; value: number; tone: "tense" | "lucid" | "neutral" }) {
  const color =
    tone === "tense"
      ? "linear-gradient(90deg, #b1a6a4, #413f3d)"
      : tone === "lucid"
      ? "linear-gradient(90deg, #d8cfd0, #697184)"
      : "linear-gradient(90deg, #d8cfd0, #b1a6a4)";
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-data text-muted-foreground">{value.toFixed(0)}</span>
      </div>
      <div className="meter-track">
        <div className="meter-fill" style={{ transform: `scaleX(${value / 100})`, background: color }} />
      </div>
    </div>
  );
}

function endingTitle(ending: string | null | undefined): string {
  switch (ending) {
    case "collapse": return "The dream collapsed.";
    case "escape": return "You escaped the dream.";
    case "control": return "Conscious control achieved.";
    case "transformed": return "The dream transformed.";
    case "unresolved": return "The dream drifts unresolved.";
    default: return "The dream continues.";
  }
}
function endingBody(ending: string | null | undefined): string {
  switch (ending) {
    case "collapse": return "The dream's coherence frayed past recovery. The scene dissolved into fragments and you surfaced, holding only echoes.";
    case "escape": return "A threshold opened — a door, a staircase, a parting — and you crossed it. The dream released you, still holding its motifs.";
    case "control": return "Lucidity crested. You saw the dream for what it was — yours — and shaped it deliberately before the waking world returned.";
    case "transformed": return "Rather than escape or collapse, the dream transmuted. Its central tension resolved into something you had not anticipated.";
    case "unresolved": return "No single resolution emerged. The dream simply thinned, the way dreams do, leaving you somewhere between memory and morning.";
    default: return "";
  }
}
