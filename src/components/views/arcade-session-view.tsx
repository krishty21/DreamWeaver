"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, Send, Compass, RotateCcw, Brain, Sparkles, Moon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import type { SimulationState, ArcadeChoice } from "@/lib/types";

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

  // While a turn is pending: rotate whispers + count seconds, so waiting feels
  // like drifting rather than stalling.
  useEffect(() => {
    if (!pending) return;
    setWhisper(0);
    setElapsedSec(0);
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
    try {
      const res = await fetch(`/api/arcade/sessions/${session.id}/turn`, {
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
      const data2 = await res.json();
      qc.invalidateQueries({ queryKey: ["session", session.id] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      setAction("");
      if (data2.ending) {
        toast({ title: data2.ending.title, description: data2.ending.body });
      }
    } catch (e: any) {
      toast({ title: "Turn failed", description: e.message, variant: "destructive" });
    } finally {
      setPending(false);
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
      <div className="surface p-4 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Meter label="Fear" value={state.fear} tone="tense" />
          <Meter label="Lucidity" value={state.lucidity} tone="lucid" />
          <Meter label="Stability" value={state.stability} tone="neutral" />
          <Meter label="Agency" value={state.agency} tone="lucid" />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
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

        {/* loading turn — the dream forms */}
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
                  The dream is forming
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
                <div className="flex-1 space-y-2.5 pt-1" aria-hidden="true">
                  <div className="shimmer-line h-3 w-11/12" />
                  <div className="shimmer-line h-3 w-full" />
                  <div className="shimmer-line h-3 w-4/5" />
                  <div className="shimmer-line h-3 w-3/5" />
                </div>
              </div>
              <AnimatePresence mode="wait">
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
          <div className="mt-6 flex items-center justify-center gap-3">
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
                  The dream is waiting. Step in and Gemini will open the first scene — grounded in
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
