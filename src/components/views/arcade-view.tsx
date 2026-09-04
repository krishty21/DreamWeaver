"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp, View } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Compass, ArrowLeft, Loader2, Sparkles, Play, RotateCcw, Swords, Moon } from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import type { ArcadeMode } from "@/lib/types";

async function fetchDreams() {
  const res = await fetch("/api/dreams");
  return res.json();
}
async function fetchSessions() {
  const res = await fetch("/api/arcade/sessions");
  return res.json();
}

const MODES: { id: ArcadeMode; label: string; icon: any; body: string }[] = [
  { id: "replay", label: "Replay", icon: Play, body: "Reconstruct the dream faithfully — preserve its core imagery, motifs, and emotional shape." },
  { id: "rewrite", label: "Rewrite", icon: RotateCcw, body: "Branch from the remembered scenario. Explore alternative outcomes through different choices." },
  { id: "confront", label: "Confront", icon: Swords, body: "Directly engage a recurring motif from your dream history as a present, addressable entity." },
];

export function ArcadeView() {
  const navigate = useApp((s) => s.navigate);
  const dreamId = useApp((s) => s.activeDreamId);
  const { data: dreamsData } = useQuery({ queryKey: ["dreams"], queryFn: fetchDreams, enabled: !dreamId });
  const { data: sessionsData } = useQuery({ queryKey: ["sessions"], queryFn: fetchSessions });

  const dreams: any[] = dreamsData?.dreams ?? [];
  const sessions: any[] = sessionsData?.sessions ?? [];

  // If a dreamId is set (from "Re-enter dream"), show the start panel for that dream.
  const startDream = dreams.find((d) => d.id === dreamId) || (dreamId ? { id: dreamId, title: "A dream", analysis: null, rawText: "" } : null);

  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8 py-10 sm:py-14">
      {startDream ? (
        <StartPanel dream={startDream} onBack={() => navigate("arcade", { dreamId: undefined as any } as any)} />
      ) : (
        <>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="text-xs tracking-caps uppercase text-muted-foreground mb-2">
              Subconscious arcade
            </div>
            <h1 className="font-display tracking-display text-5xl sm:text-6xl leading-[0.95] balance">
              Re-enter your dreams
            </h1>
            <p className="mt-3 text-sm sm:text-base text-muted-foreground pretty max-w-xl">
              Past dreams become interactive worlds. Gemini continues the scene in context;
              your decisions shape a stateful simulation grounded in your own memory.
            </p>
          </motion.div>

          {/* Active / recent sessions */}
          {sessions.length > 0 && (
            <section className="mt-12">
              <div className="flex items-center gap-3 mb-5">
                <h2 className="font-display text-2xl">Sessions</h2>
                <span className="h-px flex-1 bg-border" />
                <span className="font-data text-xs text-muted-foreground">{sessions.length}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {sessions.map((s, i) => (
                  <SessionCard key={s.id} session={s} index={i} onOpen={() => navigate("session", { sessionId: s.id })} />
                ))}
              </div>
            </section>
          )}

          {/* Pick a dream to re-enter */}
          <section className="mt-12">
            <div className="flex items-center gap-3 mb-5">
              <h2 className="font-display text-2xl">Choose a dream</h2>
              <span className="h-px flex-1 bg-border" />
              <span className="font-data text-xs text-muted-foreground">{dreams.length}</span>
            </div>
            {dreams.length === 0 ? (
              <div className="surface p-10 text-center">
                <Compass className="h-6 w-6 text-muted-foreground mx-auto mb-3" strokeWidth={1.4} />
                <p className="text-sm text-muted-foreground">
                  Capture a dream first — then return here to re-enter it.
                </p>
                <Button onClick={() => navigate("capture")} className="mt-5 h-11 bg-foreground text-background hover:opacity-90">
                  <Sparkles className="h-4 w-4" strokeWidth={1.6} /> Capture a dream
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {dreams.map((d, i) => (
                  <button
                    key={d.id}
                    onClick={() => navigate("arcade", { dreamId: d.id })}
                    className="surface p-5 text-left hover:translate-y-[-2px] transition-transform"
                  >
                    <div className="text-xs text-muted-foreground mb-1">
                      {new Date(d.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                    </div>
                    <h3 className="font-display text-2xl leading-snug tracking-tight line-clamp-2">
                      {d.title || "Untitled dream"}
                    </h3>
                    {d.analysis && (
                      <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">{d.analysis.summary}</p>
                    )}
                    <div className="mt-4 inline-flex items-center gap-1.5 text-sm text-foreground">
                      <Compass className="h-4 w-4" strokeWidth={1.6} /> Re-enter
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StartPanel({ dream, onBack }: { dream: any; onBack: () => void }) {
  const navigate = useApp((s) => s.navigate);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [mode, setMode] = useState<ArcadeMode>("replay");
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    try {
      const res = await fetch("/api/arcade/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dreamId: dream.id, mode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Could not start session.");
      }
      const data = await res.json();
      qc.invalidateQueries({ queryKey: ["sessions"] });
      navigate("session", { sessionId: data.session.id });
    } catch (e: any) {
      toast({ title: "Could not start", description: e.message, variant: "destructive" });
    } finally {
      setStarting(false);
    }
  }

  return (
    <div>
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition focus-ring mb-8"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.6} />
        Back to the arcade
      </button>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="text-xs tracking-caps uppercase text-muted-foreground mb-2">
          Re-enter dream
        </div>
        <h1 className="font-display tracking-display text-5xl sm:text-6xl leading-[0.95] balance">
          {dream.title || "Untitled dream"}
        </h1>
        {dream.analysis?.summary && (
          <p className="mt-3 text-sm sm:text-base text-muted-foreground pretty max-w-xl">
            {dream.analysis.summary}
          </p>
        )}
      </motion.div>

      <section className="mt-10">
        <div className="text-xs tracking-caps uppercase text-muted-foreground mb-4">
          Choose a mode
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`surface p-5 text-left transition ${active ? "ring-2 ring-foreground" : "hover:translate-y-[-2px]"}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${active ? "bg-foreground text-background" : "bg-foreground/[0.06]"}`}>
                    <Icon className="h-4 w-4" strokeWidth={1.6} />
                  </span>
                  {active && <span className="text-[10px] tracking-caps uppercase text-foreground">selected</span>}
                </div>
                <h3 className="mt-3 font-display text-2xl">{m.label}</h3>
                <p className="mt-1 text-xs text-muted-foreground pretty">{m.body}</p>
              </button>
            );
          })}
        </div>
      </section>

      <div className="mt-8 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground max-w-sm pretty">
          The simulation state — fear, lucidity, stability, agency — is controlled by the
          application, never the model directly. Gemini proposes; the app validates.
        </p>
        <Button onClick={start} disabled={starting} className="h-11 px-6 bg-foreground text-background hover:opacity-90">
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Moon className="h-4 w-4" strokeWidth={1.6} />}
          Enter the dream
        </Button>
      </div>
    </div>
  );
}

function SessionCard({ session, index, onOpen }: { session: any; index: number; onOpen: () => void }) {
  const Icon = session.status === "ended" ? Compass : Moon;
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.4) }}
      onClick={onOpen}
      className="surface p-5 text-left hover:translate-y-[-2px] transition-transform"
    >
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
        <span className="tracking-caps uppercase">{session.mode}</span>
        <span>{new Date(session.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
      </div>
      <h3 className="font-display text-2xl leading-snug tracking-tight line-clamp-2">
        {session.dream?.title || "A dream"}
      </h3>
      <div className="mt-2 flex items-center gap-2">
        <span className="chip">{session.status}</span>
        {session.ending && <span className="chip">{session.ending}</span>}
        {session.turns && <span className="font-data text-[10px] text-muted-foreground">{session.turns.length} turns</span>}
      </div>
      <div className="mt-4 inline-flex items-center gap-1.5 text-sm text-foreground">
        <Icon className="h-4 w-4" strokeWidth={1.6} />
        {session.status === "ended" ? "View outcome" : "Continue"}
      </div>
    </motion.button>
  );
}
