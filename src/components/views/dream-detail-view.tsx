"use client";

import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Compass,
  Trash2,
  Loader2,
  Quote,
  Eye,
  Brain,
  Sparkles,
  RefreshCw,
  User,
  MapPin,
  Footprints,
  Link2,
} from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type {
  DreamAnalysisData,
  Emotion,
  LabeledItem,
  EntityItem,
  Interpretation,
  HistoricalConnection,
} from "@/lib/types";

async function fetchDream(id: string) {
  const res = await fetch(`/api/dreams/${id}`);
  if (!res.ok) throw new Error("not found");
  return res.json();
}

export function DreamDetailView() {
  const dreamId = useApp((s) => s.activeDreamId);
  const navigate = useApp((s) => s.navigate);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [reflecting, setReflecting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["dream", dreamId],
    queryFn: () => fetchDream(dreamId!),
    enabled: !!dreamId,
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-28">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const dream = data.dream;
  const a = dream.analysis ? (parseAnalysis(dream.analysis) as DreamAnalysisData) : null;

  // Re-run the Gemini reflection. The raw dream is never modified — only the
  // derived analysis is replaced.
  async function onReflect() {
    if (!dream || reflecting) return;
    setReflecting(true);
    try {
      const res = await fetch(`/api/dreams/${dream.id}/reanalyze`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "The reflection could not be produced.");
      }
      qc.invalidateQueries({ queryKey: ["dream", dream.id] });
      qc.invalidateQueries({ queryKey: ["dreams"] });
      qc.invalidateQueries({ queryKey: ["patterns"] });
      toast({
        title: "Dream re-read",
        description: "A fresh reflection has been woven. Your original memory is unchanged.",
      });
    } catch (e: any) {
      toast({ title: "Re-reflection failed", description: e.message, variant: "destructive" });
    } finally {
      setReflecting(false);
    }
  }

  async function onDelete() {
    if (!dream) return;
    const ok = window.confirm(
      "Delete this dream and all of its analysis, motifs, and arcade sessions? This cannot be undone."
    );
    if (!ok) return;
    const res = await fetch(`/api/dreams/${dream.id}`, { method: "DELETE" });
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ["dreams"] });
      qc.invalidateQueries({ queryKey: ["patterns"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      toast({ title: "Dream deleted", description: "The record has been removed." });
      navigate("journal");
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-5 sm:px-8 py-10 sm:py-14">
      <div className="flex items-center justify-between gap-3 mb-8">
        <button
          onClick={() => navigate("journal")}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition focus-ring"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.6} />
          Journal
        </button>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => navigate("arcade", { dreamId: dream.id })}
            className="h-9 bg-foreground text-background hover:opacity-90"
          >
            <Compass className="h-4 w-4" strokeWidth={1.6} />
            Re-enter dream
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onReflect}
            disabled={reflecting}
            className="h-9"
          >
            {reflecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" strokeWidth={1.6} />
            )}
            <span className="sr-only sm:not-sr-only sm:ml-1.5">
              {reflecting ? "Reading…" : a ? "Re-reflect" : "Add reflection"}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.6} />
            <span className="sr-only sm:not-sr-only sm:ml-1.5">Delete</span>
          </Button>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="text-xs tracking-caps uppercase text-muted-foreground mb-3 flex items-center gap-2">
          <span>{new Date(dream.createdAt).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
          {dream.mood && dream.mood !== "neutral" && (
            <span className="chip">{dream.mood}</span>
          )}
        </div>
        <h1 className="font-display tracking-display text-4xl sm:text-5xl leading-tight balance">
          {dream.title || "A dream, partially recalled"}
        </h1>
      </motion.div>

      {/* OBSERVED — raw memory */}
      <section className="mt-10">
        <SectionLabel icon={Eye} tag="01 · Observed" label="Your raw dream memory" />
        <div className="mt-4 surface p-6 sm:p-7">
          <Quote className="h-5 w-5 text-muted-foreground mb-3" strokeWidth={1.4} />
          <p className="prose-dream whitespace-pre-wrap pretty">{dream.rawText}</p>
        </div>
      </section>

      {!a ? (
        <section className="mt-12 surface p-6 text-sm text-muted-foreground">
          No structured reflection was produced for this dream. You can still re-enter it as an
          arcade session.
        </section>
      ) : (
        <>
          {/* Summary */}
          <section className="mt-12">
            <SectionLabel icon={Brain} tag="02 · Reflection" label="Summary" />
            <p className="mt-4 font-display text-2xl leading-snug text-foreground pretty">
              {a.summary}
            </p>
          </section>

          {/* Emotional signature */}
          <section className="mt-12">
            <SectionLabel icon={Sparkles} tag="03 · Emotional signature" label="What you felt" />
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {a.emotions.length === 0 && <Empty />}
              {a.emotions.map((e, i) => (
                <EmotionBar key={i} emotion={e} />
              ))}
            </div>
          </section>

          {/* Grid: motifs / symbols / people / places / actions */}
          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-10">
            <ItemGroup title="Symbolic motifs" items={a.motifs} type="symbol" />
            <ItemGroup title="Symbols" items={a.symbols} type="symbol" />
            <ItemGroup title="People & entities" items={a.people.map((p) => ({ label: p.name, note: p.role ? `${p.role}` : p.note, confidence: p.confidence }))} type="person" />
            <ItemGroup title="Locations" items={a.locations} type="place" />
            <ItemGroup title="Actions" items={a.actions} type="action" />
          </div>

          {/* Relationships within the dream */}
          {a.relationships.length > 0 && (
            <section className="mt-12">
              <SectionLabel icon={Link2} tag="04 · Within this dream" label="Relationships" />
              <div className="mt-4 flex flex-wrap gap-2.5">
                {a.relationships.map((r, i) => (
                  <span
                    key={i}
                    className="surface-quiet px-3.5 py-2 inline-flex items-center gap-2 text-sm"
                  >
                    <span className="text-foreground">{r.from}</span>
                    <span className="text-[10px] tracking-caps uppercase text-muted-foreground border-b border-border pb-0.5">
                      {r.relation}
                    </span>
                    <span className="text-foreground">{r.to}</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Lucidity / fear / uncertainty meters */}
          <section className="mt-12">
            <SectionLabel icon={Brain} tag="05 · Dream lucidity & emotional tone" label="Estimate" />
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-5">
              <Meter label="Lucidity" value={a.lucidity * 100} hint={a.lucidityNote} tone="lucid" />
              <Meter label="Fear / tension" value={a.fear * 100} tone="tense" />
              <Meter label="Uncertainty" value={a.uncertainty * 100} tone="surreal" />
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground italic">
              Estimates are AI-reported and advisory. Where evidence is weak, treat them as uncertain.
            </p>
          </section>

          {/* Historical connections */}
          {a.historicalConnections.length > 0 && (
            <section className="mt-12">
              <SectionLabel icon={Brain} tag="06 · Recurring in your history" label="Observed pattern" />
              <div className="mt-4 space-y-3">
                {a.historicalConnections.map((c, i) => (
                  <div key={i} className="surface-quiet p-4 flex items-start justify-between gap-3">
                    <div>
                      <div className="font-display text-xl">{cap(c.motif)}</div>
                      {c.note && <p className="text-sm text-muted-foreground mt-0.5">{c.note}</p>}
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <span className="font-data">{c.dreamIds.length}</span>{" "}
                      prior dream{c.dreamIds.length === 1 ? "" : "s"}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Interpretations */}
          {a.interpretations.length > 0 && (
            <section className="mt-12">
              <SectionLabel icon={Sparkles} tag="07 · Possible interpretation" label="AI-generated reflection" />
              <div className="mt-4 space-y-3">
                {a.interpretations.map((it, i) => (
                  <InterpretationCard key={i} interp={it} />
                ))}
              </div>
              <p className="mt-4 text-[11px] text-muted-foreground italic">
                Interpretations are reflective, not diagnostic. They may suggest; they do not
                decide.
              </p>
            </section>
          )}

          {/* Re-enter CTA */}
          <section className="mt-14 surface p-7 text-center">
            <h3 className="font-display text-3xl tracking-display balance">
              This dream can become a world you revisit.
            </h3>
            <p className="mt-2 text-sm text-muted-foreground pretty max-w-md mx-auto">
              Enter the Subconscious Arcade to re-experience this memory as an interactive
              simulation — grounded in what you recorded.
            </p>
            <Button
              onClick={() => navigate("arcade", { dreamId: dream.id })}
              className="mt-5 h-11 px-6 bg-foreground text-background hover:opacity-90"
            >
              <Compass className="h-4 w-4" strokeWidth={1.6} />
              Re-enter dream
            </Button>
          </section>
        </>
      )}
    </div>
  );
}

// ---------- sub-components ----------

function SectionLabel({ icon: Icon, tag, label }: { icon: any; tag: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
      <div className="text-xs tracking-caps uppercase text-muted-foreground">{tag}</div>
      <span className="h-px flex-1 bg-border" />
      <h2 className="font-display text-2xl tracking-tight">{label}</h2>
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-muted-foreground italic">Nothing extracted here.</p>;
}

function EmotionBar({ emotion }: { emotion: Emotion }) {
  return (
    <div className="surface-quiet p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm capitalize text-foreground">{emotion.emotion}</span>
        <span className="font-data text-xs text-muted-foreground">
          {(emotion.intensity * 100).toFixed(0)}%
        </span>
      </div>
      <div className="meter-track mt-2">
        <div
          className="meter-fill"
          style={{
            transform: `scaleX(${emotion.intensity})`,
            background: "linear-gradient(90deg, var(--rose), var(--mauve))",
          }}
        />
      </div>
      {emotion.confidence !== undefined && (
        <div className="mt-1.5 text-[10px] text-muted-foreground">
          AI confidence: {(emotion.confidence * 100).toFixed(0)}%
        </div>
      )}
    </div>
  );
}

function ItemGroup({
  title,
  items,
  type = "symbol",
}: {
  title: string;
  items: LabeledItem[];
  type?: "symbol" | "person" | "place" | "action";
}) {
  const Icon = type === "person" ? User : type === "place" ? MapPin : type === "action" ? Footprints : Sparkles;
  return (
    <div>
      <h3 className="text-xs tracking-caps uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
        <Icon className="h-3 w-3" strokeWidth={1.6} />
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">—</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((it, i) => (
            <span key={i} className="chip">
              {it.label}
              {it.note && <span className="text-muted-foreground">· {it.note}</span>}
              {it.confidence !== undefined && (
                <span className="text-muted-foreground/70 font-data text-[10px]" title={`AI confidence ${(it.confidence * 100).toFixed(0)}%`}>
                  {it.confidence < 0.4 ? "?" : it.confidence > 0.7 ? "●" : "◐"}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Meter({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone: "lucid" | "tense" | "surreal";
}) {
  const color =
    tone === "lucid"
      ? "linear-gradient(90deg, #d8cfd0, #697184)"
      : tone === "tense"
      ? "linear-gradient(90deg, #b1a6a4, #413f3d)"
      : "linear-gradient(90deg, #b1a6a4, #697184)";
  return (
    <div className="surface-quiet p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-foreground">{label}</span>
        <span className="font-data text-xs text-muted-foreground">{value.toFixed(0)}</span>
      </div>
      <div className="meter-track mt-2.5">
        <div className="meter-fill" style={{ transform: `scaleX(${value / 100})`, background: color }} />
      </div>
      {hint && <p className="mt-2 text-[11px] text-muted-foreground italic pretty">{hint}</p>}
    </div>
  );
}

function InterpretationCard({ interp }: { interp: Interpretation }) {
  const c = interp.confidence;
  const tag = c < 0.35 ? "tentative" : c < 0.65 ? "moderate" : "considered";
  return (
    <div className="surface p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] tracking-caps uppercase text-muted-foreground">
          Possible interpretation
        </span>
        <span className="chip font-data">{tag}</span>
      </div>
      <p className="text-sm sm:text-base leading-relaxed pretty">{interp.text}</p>
      <div className="mt-3 flex items-center gap-2">
        <div className="meter-track flex-1">
          <div
            className="meter-fill"
            style={{ transform: `scaleX(${c})`, background: "var(--slate)" }}
          />
        </div>
        <span className="font-data text-[10px] text-muted-foreground">
          {(c * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseAnalysis(a: any): DreamAnalysisData {
  const j = (k: string, fallback: any = []) => {
    try {
      const v = JSON.parse(a[k] ?? "[]");
      return Array.isArray(v) ? v : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    title: a.summary ? "" : "",
    summary: a.summary ?? "",
    emotions: j("emotionsJson"),
    symbols: j("symbolsJson"),
    motifs: j("motifsJson"),
    people: j("peopleJson"),
    locations: j("locationsJson"),
    actions: j("actionsJson"),
    lucidity: a.lucidity ?? 0.3,
    lucidityNote: a.lucidityNote ?? undefined,
    fear: a.fear ?? 0.2,
    uncertainty: a.uncertainty ?? 0.3,
    interpretations: j("interpretationsJson"),
    relationships: j("relationshipsJson"),
    historicalConnections: j("historicalConnectionsJson"),
    mood: (a as any).mood ?? "neutral",
  };
}
