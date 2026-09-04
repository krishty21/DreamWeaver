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
  Share2,
  Copy,
  Check,
  Link2Off,
  MoonStar,
  FileDown,
  Hourglass,
} from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { buildDreamMarkdown, downloadMarkdown, slugify } from "@/lib/journal-export";
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
  const [shareBusy, setShareBusy] = useState(false);

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

  // ---------- share management ----------
  // The share is a read-only public link to this dream's SANITISED reflection.
  // rawText is only exposed if the dreamer explicitly opts in.
  const shareToken: string | null = dream.shareToken ?? null;
  const shareUrl =
    shareToken && typeof window !== "undefined"
      ? `${window.location.origin}/#/shared/${shareToken}`
      : "";

  async function onShare(opts?: { includeRaw?: boolean; expiresInDays?: number | null }) {
    if (!dream || shareBusy) return;
    setShareBusy(true);
    try {
      const res = await fetch(`/api/dreams/${dream.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts ?? {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "The share link could not be created.");
      await qc.invalidateQueries({ queryKey: ["dream", dream.id] });
      if (opts?.expiresInDays !== undefined) {
        toast({
          title: "Link window updated",
          description:
            opts.expiresInDays === null
              ? "The link now stays open until you revoke it."
              : `The link will close in ${opts.expiresInDays} day${opts.expiresInDays === 1 ? "" : "s"}.`,
        });
      } else if (opts?.includeRaw === undefined) {
        toast({
          title: "Reflection shared",
          description: "A read-only link has been created. Your raw memory stays private.",
        });
      }
    } catch (e: any) {
      toast({ title: "Sharing failed", description: e.message, variant: "destructive" });
    } finally {
      setShareBusy(false);
    }
  }

  async function onRevokeShare() {
    if (!dream || shareBusy) return;
    setShareBusy(true);
    try {
      const res = await fetch(`/api/dreams/${dream.id}/share`, { method: "DELETE" });
      if (!res.ok) throw new Error("The link could not be revoked.");
      await qc.invalidateQueries({ queryKey: ["dream", dream.id] });
      toast({
        title: "Link revoked",
        description: "The shared reflection is no longer reachable.",
      });
    } catch (e: any) {
      toast({ title: "Revoke failed", description: e.message, variant: "destructive" });
    } finally {
      setShareBusy(false);
    }
  }

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
    <div className="mx-auto w-full max-w-4xl px-5 sm:px-8 py-10 sm:py-14">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-8">
        <button
          onClick={() => navigate("journal")}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition focus-ring"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.6} />
          Journal
        </button>
        <div className="flex items-center gap-1.5 sm:gap-2 ml-auto">
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
          {a && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onShare()}
              disabled={shareBusy || reflecting}
              className="h-9"
              aria-label="Share this reflection"
            >
              {shareBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Share2 className="h-4 w-4" strokeWidth={1.6} />
              )}
              <span className="sr-only sm:not-sr-only sm:ml-1.5">
                {shareToken ? "Shared…" : "Share"}
              </span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const md = buildDreamMarkdown(dream);
              downloadMarkdown(md, `${slugify(dream.title || "dream")}.md`);
              toast({ title: "Dream exported", description: "Saved as a Markdown file." });
            }}
            className="h-9"
            aria-label="Export this dream as a Markdown file"
          >
            <FileDown className="h-4 w-4" strokeWidth={1.6} />
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

      {/* Share panel — visible while the reflection is shared */}
      {shareToken && (
        <SharePanel
          url={shareUrl}
          includeRaw={!!dream.shareIncludeRaw}
          sharedAt={dream.sharedAt}
          expiresAt={dream.shareExpiresAt ?? null}
          busy={shareBusy}
          onToggleRaw={(v) => onShare({ includeRaw: v })}
          onSetExpiry={(days) => onShare({ expiresInDays: days })}
          onRevoke={onRevokeShare}
          onPreview={() => navigate("shared", { shareToken })}
        />
      )}

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
                    className="surface-quiet px-3.5 py-2 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm max-w-full"
                  >
                    <span className="text-foreground min-w-0">{r.from}</span>
                    <span className="text-[10px] tracking-caps uppercase text-muted-foreground border-b border-border pb-0.5">
                      {r.relation}
                    </span>
                    <span className="text-foreground min-w-0">{r.to}</span>
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

function SharePanel({
  url,
  includeRaw,
  sharedAt,
  expiresAt,
  busy,
  onToggleRaw,
  onSetExpiry,
  onRevoke,
  onPreview,
}: {
  url: string;
  includeRaw: boolean;
  sharedAt: string | null;
  expiresAt: string | null;
  busy: boolean;
  onToggleRaw: (v: boolean) => void;
  onSetExpiry: (days: number | null) => void;
  onRevoke: () => void;
  onPreview: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({
        title: "Copy failed",
        description: "Select the link text and copy it manually.",
        variant: "destructive",
      });
    }
  }

  const shared = sharedAt ? new Date(sharedAt).toLocaleDateString() : null;

  const expiryDate = expiresAt ? new Date(expiresAt) : null;
  const isExpired = !!expiryDate && expiryDate.getTime() < Date.now();
  const daysLeft = expiryDate
    ? Math.ceil((expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const expiryLabel = !expiryDate
    ? "never"
    : isExpired
    ? "expired"
    : daysLeft !== null && daysLeft <= 1
    ? "last day"
    : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
  const currentWindow: "never" | "7" | "30" =
    !expiryDate ? "never" : isExpired ? "7" : (daysLeft ?? 0) > 22 ? "30" : "7";

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="surface p-5 sm:p-6 mb-2"
      role="region"
      aria-label="Public share link for this reflection"
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs tracking-caps uppercase text-muted-foreground">
            <MoonStar className="h-3.5 w-3.5" strokeWidth={1.6} />
            Public read-only link
            {shared && <span className="normal-case tracking-normal">· since {shared}</span>}
            <span
              className={`normal-case tracking-normal inline-flex items-center gap-1 ${
                isExpired ? "text-destructive" : ""
              }`}
            >
              ·{" "}
              <Hourglass className="h-3 w-3" strokeWidth={1.7} aria-hidden="true" />
              {isExpired ? "expired — renew or revoke" : expiryLabel}
            </span>
          </div>
          <div className={`mt-2 flex items-center gap-2 ${isExpired ? "opacity-60" : ""}`}>
            <code className="share-url text-xs sm:text-sm px-3 py-2 bg-background/70 border border-border rounded-md truncate flex-1 min-w-0" title={url}>
              {url || "…"}
            </code>
            <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={copy} aria-label="Copy share link">
              {copied ? <Check className="h-4 w-4 text-green-700" strokeWidth={1.8} /> : <Copy className="h-4 w-4" strokeWidth={1.6} />}
              <span className="sr-only sm:not-sr-only sm:ml-1.5">{copied ? "Copied" : "Copy"}</span>
            </Button>
          </div>
          {isExpired && (
            <p className="mt-1.5 text-[11px] text-destructive/90 pretty">
              This window has passed — visitors see a closed page. Choose a new window below to re-open it.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" className="h-9" onClick={onPreview}>
            <Eye className="h-4 w-4" strokeWidth={1.6} />
            <span className="sr-only sm:not-sr-only sm:ml-1.5">Preview</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-9 text-muted-foreground hover:text-destructive"
            onClick={onRevoke}
            disabled={busy}
          >
            <Link2Off className="h-4 w-4" strokeWidth={1.6} />
            <span className="sr-only sm:not-sr-only sm:ml-1.5">Revoke</span>
          </Button>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-border/60 grid gap-4 sm:grid-cols-2 sm:gap-6">
        <div>
          <label htmlFor="include-raw" className="text-sm text-foreground flex items-center gap-2">
            Include my dream words in the public page
          </label>
          <p className="text-[11px] text-muted-foreground mt-0.5 pretty">
            Off by default — the shared page shows the reflection only, never your raw memory.
          </p>
          <div className="mt-2.5">
            <Switch
              id="include-raw"
              checked={includeRaw}
              disabled={busy}
              onCheckedChange={onToggleRaw}
              aria-label="Include the raw dream text in the shared page"
            />
          </div>
        </div>
        <div>
          <span id="share-expiry-label" className="text-sm text-foreground flex items-center gap-2">
            How long may the link stay open?
          </span>
          <p className="text-[11px] text-muted-foreground mt-0.5 pretty">
            A shorter window is kinder to your future self — you can always re-open it.
          </p>
          <div
            className="mt-2.5 inline-flex items-center rounded-full border border-border bg-card p-0.5"
            role="group"
            aria-labelledby="share-expiry-label"
          >
            {([
              { v: "7", label: "7 days" },
              { v: "30", label: "30 days" },
              { v: "never", label: "Forever" },
            ] as const).map((opt) => {
              const active = currentWindow === opt.v;
              return (
                <button
                  key={opt.v}
                  type="button"
                  disabled={busy}
                  aria-pressed={active}
                  onClick={() => onSetExpiry(opt.v === "never" ? null : Number(opt.v))}
                  className={`px-3 h-8 rounded-full text-xs transition focus-ring ${
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
        </div>
      </div>
    </motion.div>
  );
}

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
            <span key={i} className="chip max-w-full">
              {/* label + note in one wrapping flow so long notes never force the
                  page wide on mobile; confidence glyph stays pinned at the end */}
              <span className="min-w-0">
                {it.label}
                {it.note && <span className="text-muted-foreground">· {it.note}</span>}
              </span>
              {it.confidence !== undefined && (
                <span className="text-muted-foreground/70 font-data text-[10px] shrink-0" title={`AI confidence ${(it.confidence * 100).toFixed(0)}%`}>
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
