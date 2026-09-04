"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, Mic, Square, Trash2, AudioLines } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { VoiceRecorder } from "@/lib/voice-recorder";

const PHASES = [
  "Listening to the fragments…",
  "Tracing recurring motifs…",
  "Reading the emotional shape…",
  "Weaving the dream memory…",
];

const VOICE_MAX_SECONDS = 90;

function formatClock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function CaptureView() {
  const navigate = useApp((s) => s.navigate);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [phase, setPhase] = useState(0);
  const [loading, setLoading] = useState(false);

  // ---- voice capture state ----
  const [voice, setVoice] = useState<"idle" | "recording" | "transcribing">("idle");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [transcriptNote, setTranscriptNote] = useState(false);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const orbRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef(false);

  useEffect(() => {
    setVoiceSupported(VoiceRecorder.isSupported());
    return () => {
      // safety: discard any live recording when leaving the view
      recorderRef.current?.cancel();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function startRecording() {
    if (!recorderRef.current) recorderRef.current = new VoiceRecorder();
    autoStopRef.current = false;
    setElapsed(0);
    try {
      await recorderRef.current.start({
        onLevel: (lvl) => {
          // drive the orb directly via CSS var — no re-renders
          orbRef.current?.style.setProperty("--lvl", lvl.toFixed(3));
        },
      });
      setVoice("recording");
      timerRef.current = setInterval(() => {
        setElapsed((e) => {
          if (e + 1 >= VOICE_MAX_SECONDS && !autoStopRef.current) {
            autoStopRef.current = true;
            stopAndTranscribe();
          }
          return e + 1;
        });
      }, 1000);
    } catch (e: any) {
      const name = e?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        toast({
          title: "Microphone declined",
          description: "Allow microphone access to speak your dream — or simply type it below.",
          variant: "destructive",
        });
      } else if (name === "NotFoundError") {
        toast({
          title: "No microphone found",
          description: "This device has no capture device. You can type your dream instead.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Could not start recording",
          description: e?.message === "unsupported" ? "This browser cannot record audio." : "Please try again or type instead.",
          variant: "destructive",
        });
      }
    }
  }

  async function stopAndTranscribe() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setVoice("transcribing");
    try {
      const result = await recorder.stop();
      if (!result || result.durationSec < 0.6) {
        toast({
          title: "Nothing captured",
          description: "Hold the button a little longer — dreams take a moment to surface.",
        });
        setVoice("idle");
        return;
      }
      const res = await fetch("/api/asr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: result.base64 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Transcription failed.");
      }
      const transcript: string = data.text ?? "";
      setText((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript));
      setTranscriptNote(true);
      toast({
        title: "Dream transcribed",
        description: "Read it through — this is exactly what was heard, ready to record.",
      });
    } catch (e: any) {
      toast({
        title: "Transcription failed",
        description: e.message || "Try again, or type the dream instead.",
        variant: "destructive",
      });
    } finally {
      setVoice("idle");
      setElapsed(0);
    }
  }

  async function discardRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    await recorderRef.current?.cancel();
    setVoice("idle");
    setElapsed(0);
  }

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

  const progress = Math.min(1, elapsed / VOICE_MAX_SECONDS);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 sm:px-8 py-10 sm:py-14">
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
            that stayed. Write it the way it comes back to you — or, still half-asleep,{" "}
            <span className="text-foreground">speak it</span> and read it back after.
          </p>

          <div className="mt-7 surface p-1.5 capture-surface">
            <AnimatePresence mode="wait">
              {voice === "recording" ? (
                <motion.div
                  key="recording"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="min-h-[220px] flex flex-col items-center justify-center px-6 py-8 text-center"
                  role="status"
                  aria-live="polite"
                >
                  <div className="relative h-24 w-24 mb-6">
                    <span className="ring-rec absolute inset-0 rounded-full" />
                    <span className="ring-rec absolute inset-0 rounded-full" style={{ animationDelay: "0.9s" }} />
                    <span className="ring-rec absolute inset-0 rounded-full" style={{ animationDelay: "1.8s" }} />
                    <span ref={orbRef} className="orb-rec absolute inset-2 rounded-full" style={{ ["--lvl" as any]: "0.12" }}>
                      <Mic className="absolute inset-0 m-auto h-6 w-6 text-background" strokeWidth={1.7} aria-hidden="true" />
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs tracking-caps uppercase text-muted-foreground">
                    <span className="rec-dot h-1.5 w-1.5 rounded-full bg-foreground" aria-hidden="true" />
                    Listening to your dream
                  </div>
                  <p className="mt-2 font-data text-lg text-foreground" aria-label={`Recording time ${formatClock(elapsed)} of ${formatClock(VOICE_MAX_SECONDS)}`}>
                    {formatClock(elapsed)}
                    <span className="text-muted-foreground text-sm"> / {formatClock(VOICE_MAX_SECONDS)}</span>
                  </p>
                  <div className="mt-3 h-1 w-44 rounded-full overflow-hidden bg-foreground/[0.08]" aria-hidden="true">
                    <div
                      className="h-full rounded-full transition-[width] duration-1000 ease-linear"
                      style={{ width: `${progress * 100}%`, background: "linear-gradient(90deg, var(--rose), var(--mauve))" }}
                    />
                  </div>
                  <div className="mt-6 flex items-center gap-3">
                    <Button
                      onClick={stopAndTranscribe}
                      className="h-10 px-5 bg-foreground text-background hover:opacity-90"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" strokeWidth={0} />
                      Stop &amp; transcribe
                    </Button>
                    <Button variant="outline" onClick={discardRecording} className="h-10">
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                      Discard
                    </Button>
                  </div>
                  <p className="mt-4 text-[11px] text-muted-foreground">
                    Speak in fragments — pauses are fine. Nothing is stored until you record the dream.
                  </p>
                </motion.div>
              ) : voice === "transcribing" ? (
                <motion.div
                  key="transcribing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="min-h-[220px] flex flex-col items-center justify-center text-center"
                  role="status"
                  aria-live="polite"
                >
                  <div className="relative h-16 w-16 mb-6">
                    <span className="drift-orb absolute inset-0 rounded-full pulse-soft"
                      style={{
                        background:
                          "radial-gradient(circle at 35% 30%, rgba(216,207,208,0.95), rgba(105,113,132,0.5) 60%, rgba(65,63,61,0.9) 100%)",
                      }}
                    />
                    <AudioLines className="absolute inset-0 m-auto h-5 w-5 text-background" strokeWidth={1.8} aria-hidden="true" />
                  </div>
                  <p className="font-display text-2xl text-foreground">Writing down what you said…</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    The recording is being transcribed — it will appear below, exactly as heard.
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="editor"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <Textarea
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      setTranscriptNote(false);
                    }}
                    placeholder="I was running through an abandoned school. Every classroom had the same clock…"
                    className="min-h-[220px] bg-transparent border-0 focus-visible:ring-0 resize-none text-base leading-relaxed font-body"
                    autoFocus
                    aria-label="Your dream, in your own words"
                  />
                  <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-1">
                    <span className="text-[11px] text-muted-foreground font-data flex items-center gap-2">
                      {text.length} chars
                      {transcriptNote && (
                        <span className="inline-flex items-center gap-1 not-italic font-body text-[10px] tracking-caps uppercase text-muted-foreground/80">
                          <AudioLines className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
                          from voice
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      {voiceSupported && (
                        <button
                          onClick={startRecording}
                          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition focus-ring rounded px-1"
                          aria-label="Speak your dream instead of typing"
                        >
                          <Mic className="h-3.5 w-3.5" strokeWidth={1.7} />
                          speak
                        </button>
                      )}
                      {samples.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => setText(s)}
                          className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-border focus-ring rounded"
                        >
                          try sample {i + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground max-w-sm pretty">
              The raw text is preserved verbatim. AI reflection is generated after — clearly
              labelled, never clinical.
            </p>
            <Button
              onClick={submit}
              disabled={text.trim().length < 12 || voice === "recording"}
              className="h-11 px-6 bg-foreground text-background hover:opacity-90"
            >
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
            Reading your dream.
          </p>
        </motion.div>
      )}
    </div>
  );
}

const samples = [
  "I was running through an abandoned school. Every classroom had the same clock. There was a faceless person following me, and the hallways kept folding back to the same door.",
  "Ocean again. The water was warm but the horizon was a wall. A lighthouse blinked, and someone I couldn't see was calling a name I almost recognised.",
];
