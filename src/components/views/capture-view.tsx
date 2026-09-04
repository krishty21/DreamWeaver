"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, ArrowLeft, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

const PHASES = [
  "Listening to the fragments…",
  "Tracing recurring motifs…",
  "Reading the emotional shape…",
  "Weaving the dream memory…",
];

export function CaptureView() {
  const navigate = useApp((s) => s.navigate);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [phase, setPhase] = useState(0);
  const [loading, setLoading] = useState(false);

  const samples = [
    "I was running through an abandoned school. Every classroom had the same clock. There was a faceless person following me, and the hallways kept folding back to the same door.",
    "Ocean again. The water was warm but the horizon was a wall. A lighthouse blinked, and someone I couldn't see was calling a name I almost recognised.",
  ];

  async function submit() {
    if (text.trim().length < 12) {
      toast({
        title: "A little more, please",
        description: "Write at least a sentence of what you remember — fragments are fine.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    // rotate progress text while waiting
    let p = 0;
    setPhase(0);
    const iv = setInterval(() => {
      p = (p + 1) % PHASES.length;
      setPhase(p);
    }, 2200);

    try {
      const res = await fetch("/api/dreams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: text }),
      });
      clearInterval(iv);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Could not save the dream.");
      }
      const data = await res.json();
      // refresh lists
      qc.invalidateQueries({ queryKey: ["dreams"] });
      qc.invalidateQueries({ queryKey: ["patterns"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      toast({
        title: "Dream recorded",
        description: data.analysisError
          ? "Saved. The reflection could not be produced this time — you can re-enter it later."
          : "Your dream memory is ready. Take a moment to read its reflection.",
      });
      navigate("dream", { dreamId: data.dream.id });
    } catch (e: any) {
      clearInterval(iv);
      toast({
        title: "Something went wrong",
        description: e.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-5 sm:px-8 py-10 sm:py-14">
      <button
        onClick={() => navigate("journal")}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition focus-ring mb-8"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.6} />
        Journal
      </button>

      {!loading ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="text-xs tracking-caps uppercase text-muted-foreground mb-3">
            Capture
          </div>
          <h1 className="font-display tracking-display text-4xl sm:text-5xl leading-tight balance">
            What do you remember?
          </h1>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground pretty max-w-xl">
            Fragments are fine. Incomplete sentences, contradictions, half-images, the feeling
            that stayed. Write it the way it comes back to you — Gemini will read its shape after.
          </p>

          <div className="mt-7 surface p-1.5">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="I was running through an abandoned school. Every classroom had the same clock…"
              className="min-h-[220px] bg-transparent border-0 focus-visible:ring-0 resize-none text-base leading-relaxed font-body"
              autoFocus
            />
            <div className="flex items-center justify-between px-3 pb-2 pt-1">
              <span className="text-[11px] text-muted-foreground font-data">
                {text.length} chars
              </span>
              <div className="flex items-center gap-2">
                {samples.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setText(s)}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-border"
                  >
                    try sample {i + 1}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground max-w-sm pretty">
              The raw text is preserved verbatim. AI reflection is generated after — clearly
              labelled, never clinical.
            </p>
            <Button
              onClick={submit}
              disabled={text.trim().length < 12}
              className="h-11 px-6 bg-foreground text-background hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" strokeWidth={1.6} />
              Record &amp; reflect
            </Button>
          </div>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-28 text-center"
        >
          <div className="relative h-16 w-16 mb-6">
            <span
              className="absolute inset-0 rounded-full pulse-soft"
              style={{
                background:
                  "radial-gradient(circle at 35% 30%, rgba(216,207,208,0.95), rgba(105,113,132,0.5) 60%, rgba(65,63,61,0.9) 100%)",
              }}
            />
            <Loader2 className="absolute inset-0 m-auto h-5 w-5 text-background animate-spin" />
          </div>
          <motion.p
            key={phase}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-display text-2xl text-foreground"
          >
            {PHASES[phase]}
          </motion.p>
          <p className="mt-2 text-sm text-muted-foreground">
            Gemini is reading your dream.
          </p>
        </motion.div>
      )}
    </div>
  );
}
