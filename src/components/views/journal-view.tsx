"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Sparkles, Compass, Inbox, FileDown } from "lucide-react";
import { motion } from "framer-motion";
import { useMemo } from "react";
import { buildJournalMarkdown, downloadMarkdown } from "@/lib/journal-export";
import { useToast } from "@/hooks/use-toast";

async function fetchDreams() {
  const res = await fetch("/api/dreams");
  if (!res.ok) throw new Error("failed");
  return res.json();
}

export function JournalView() {
  const navigate = useApp((s) => s.navigate);
  const { toast } = useToast();
  const { data, isLoading } = useQuery({ queryKey: ["dreams"], queryFn: fetchDreams });

  const dreams: any[] = data?.dreams ?? [];

  function onExport() {
    if (dreams.length === 0) return;
    try {
      const md = buildJournalMarkdown(dreams);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadMarkdown(md, `dream-journal-${stamp}.md`);
      toast({
        title: "Journal exported",
        description: `${dreams.length} dream${dreams.length === 1 ? "" : "s"} written to Markdown.`,
      });
    } catch {
      toast({ title: "Export failed", description: "Please try again.", variant: "destructive" });
    }
  }

  // group by month for an editorial reading rhythm
  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const d of dreams) {
      const date = new Date(d.createdAt);
      const key = date.toLocaleDateString(undefined, { year: "numeric", month: "long" });
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return Array.from(map.entries());
  }, [dreams]);

  return (
    <div className="mx-auto max-w-5xl px-5 sm:px-8 py-10 sm:py-14">
      <div className="flex items-center justify-between gap-3 mb-8">
        <div>
          <div className="text-xs tracking-caps uppercase text-muted-foreground mb-2">
            Dream journal
          </div>
          <h1 className="font-display tracking-display text-4xl sm:text-5xl balance">
            Your recorded dreams
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={dreams.length === 0}
            className="h-9 border-foreground/25 bg-card hover:bg-accent hover:border-foreground/40 shadow-sm"
            aria-label="Export the whole journal as a Markdown file"
          >
            <FileDown className="h-4 w-4" strokeWidth={1.6} />
            <span className="sr-only sm:not-sr-only sm:ml-1.5">Export .md</span>
          </Button>
          <Button
            onClick={() => navigate("capture")}
            className="h-11 bg-foreground text-background hover:opacity-90"
          >
            <Sparkles className="h-4 w-4" strokeWidth={1.6} />
            Capture a dream
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : dreams.length === 0 ? (
        <EmptyJournal onCapture={() => navigate("capture")} />
      ) : (
        <div className="space-y-12">
          {groups.map(([month, items]) => (
            <section key={month}>
              <div className="flex items-center gap-3 mb-5">
                <h2 className="font-display text-2xl text-muted-foreground">{month}</h2>
                <span className="h-px flex-1 bg-border" />
                <span className="font-data text-xs text-muted-foreground">{items.length}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {items.map((d, i) => (
                  <DreamCard key={d.id} dream={d} index={i} onOpen={() => navigate("dream", { dreamId: d.id })} onArcade={() => navigate("arcade", { dreamId: d.id })} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function DreamCard({
  dream,
  index,
  onOpen,
  onArcade,
}: {
  dream: any;
  index: number;
  onOpen: () => void;
  onArcade: () => void;
}) {
  const a = dream.analysis;
  const motifs: string[] = a ? safeParse(a.motifsJson).slice(0, 4).map((m: any) => m.label) : [];
  const mood = dream.mood || "neutral";
  const moodColor =
    mood === "tense"
      ? "#413f3d"
      : mood === "melancholic"
      ? "#697184"
      : mood === "surreal"
      ? "#b1a6a4"
      : mood === "lucid"
      ? "#d8cfd0"
      : "#8a8580";

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.4) }}
      className="surface p-5 flex flex-col cursor-pointer lift"
      onClick={onOpen}
    >
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="mood-dot" style={{ background: moodColor }} aria-hidden="true" />
          {new Date(dream.createdAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
        </span>
        {mood !== "neutral" && <span className="chip">{mood}</span>}
      </div>
      <h3 className="font-display text-2xl leading-snug tracking-tight balance">
        {dream.title || "Untitled dream"}
      </h3>
      {a && (
        <p className="mt-2 text-sm text-muted-foreground pretty line-clamp-2">{a.summary}</p>
      )}
      {motifs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {motifs.map((m, i) => (
            <span key={i} className="chip">{m}</span>
          ))}
        </div>
      )}
      <div className="mt-auto pt-4 flex items-center justify-between">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-border"
        >
          Read reflection
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onArcade();
          }}
          className="inline-flex items-center gap-1.5 text-xs text-foreground hover:opacity-70 transition"
        >
          <Compass className="h-3.5 w-3.5" strokeWidth={1.6} />
          Re-enter
        </button>
      </div>
    </motion.article>
  );
}

function EmptyJournal({ onCapture }: { onCapture: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="surface p-12 text-center"
    >
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-foreground/[0.05] mb-4">
        <Inbox className="h-6 w-6 text-muted-foreground" strokeWidth={1.4} />
      </div>
      <h3 className="font-display text-3xl tracking-display balance">
        No dreams recorded yet.
      </h3>
      <p className="mt-2 text-sm text-muted-foreground pretty max-w-md mx-auto">
        Capture your first dream — fragments, contradictions, half-images — and Gemini will
        read its shape for you.
      </p>
      <Button onClick={onCapture} className="mt-6 h-11 px-6 bg-foreground text-background hover:opacity-90">
        <Sparkles className="h-4 w-4" strokeWidth={1.6} />
        Capture your first dream
      </Button>
    </motion.div>
  );
}

function safeParse(s: string) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
