"use client";

import { useApp } from "@/lib/store";
import { DreamMark } from "@/components/shell/top-nav";
import { Moon, Compass, Map, Lock, Layers } from "lucide-react";
import { motion } from "framer-motion";

const fade = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.08 * i, duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export function LandingView() {
  const navigate = useApp((s) => s.navigate);

  return (
    <div className="relative min-h-screen flex flex-col">
      {/* top brand bar */}
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 pt-8 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <DreamMark />
          <span className="font-display text-2xl tracking-display">DreamWeaver</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("auth", { authMode: "signin" })}
            className="px-4 py-2 rounded-full text-sm text-muted-foreground hover:text-foreground transition focus-ring"
          >
            Sign in
          </button>
          <button
            onClick={() => navigate("auth", { authMode: "signup" })}
            className="px-4 py-2 rounded-full text-sm bg-foreground text-background hover:opacity-90 transition focus-ring"
          >
            Begin
          </button>
        </div>
      </div>

      {/* hero */}
      <section className="relative mx-auto w-full max-w-6xl px-5 sm:px-8 pt-16 sm:pt-24 pb-20">
        {/* floating dream fragments — soft surrealism (decorative only, never intercepts clicks) */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none select-none" aria-hidden="true">
          <span className="fragment" style={{ left: "8%", top: "12%", animationDelay: "0s", fontSize: "1.4rem" }}>the same door…</span>
          <span className="fragment" style={{ left: "78%", top: "6%", animationDelay: "-3s", fontSize: "1.15rem" }}>an ocean, again</span>
          <span className="fragment" style={{ left: "16%", top: "58%", animationDelay: "-6s", fontSize: "1.25rem" }}>someone calling</span>
          <span className="fragment" style={{ left: "84%", top: "46%", animationDelay: "-8.5s", fontSize: "1.05rem" }}>the clock again</span>
          <span className="fragment" style={{ left: "46%", top: "2%", animationDelay: "-5s", fontSize: "1rem" }}>half a memory</span>
          <span className="fragment" style={{ left: "63%", top: "72%", animationDelay: "-9.5s", fontSize: "1.2rem" }}>flight, briefly</span>
        </div>
        <motion.div
          initial="hidden"
          animate="show"
          variants={fade}
          custom={0}
          className="text-center"
        >
          <h1 className="font-display tracking-display balance text-5xl sm:text-7xl leading-[0.95] text-foreground">
            Your dreams disappear
            <br />
            by morning.
          </h1>
          <p className="mt-3 font-display italic text-3xl sm:text-4xl text-muted-foreground">
            DreamWeaver lets you keep them.
          </p>
          <p className="mx-auto mt-7 max-w-xl text-base sm:text-lg text-muted-foreground pretty leading-relaxed">
            Capture a fragment. Its shape is read — the emotions, motifs, the things that
            return. Your dreams become a single, evolving world you can re-enter at any time.
          </p>
          <div className="mt-9 flex items-center justify-center gap-3">
            <button
              onClick={() => navigate("auth", { authMode: "signup" })}
              className="group inline-flex items-center gap-2 px-6 py-3 rounded-full bg-foreground text-background text-sm hover:opacity-90 transition focus-ring"
            >
              Start your dream memory
            </button>
            <button
              onClick={() => navigate("auth", { authMode: "signin" })}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-border text-sm text-foreground hover:bg-foreground/[0.04] transition focus-ring"
            >
              I have an account
            </button>
          </div>
        </motion.div>

        {/* the three layers */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-5">
          {LAYERS.map((l, i) => {
            const Icon = l.icon;
            return (
              <motion.article
                key={l.title}
                custom={i + 1}
                variants={fade}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, margin: "-80px" }}
                className="surface p-6 flex flex-col"
              >
                <div className="flex items-center gap-2 text-muted-foreground text-xs tracking-caps uppercase">
                  <span className="font-data">{String(i + 1).padStart(2, "0")}</span>
                  <span className="h-px w-6 bg-border" />
                  {l.tag}
                </div>
                <div className="mt-5 inline-flex h-11 w-11 items-center justify-center rounded-full bg-foreground/[0.06]">
                  <Icon className="h-5 w-5 text-foreground" strokeWidth={1.4} />
                </div>
                <h3 className="mt-4 font-display text-2xl tracking-tight">{l.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed pretty">{l.body}</p>
              </motion.article>
            );
          })}
        </div>
      </section>

      {/* the loop */}
      <section className="mx-auto w-full max-w-6xl px-5 sm:px-8 pb-24">
        <motion.div
          custom={4}
          variants={fade}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
        >
          <div className="text-xs tracking-caps uppercase text-muted-foreground mb-4">
            The loop
          </div>
          <h2 className="font-display tracking-display text-4xl sm:text-5xl leading-tight balance max-w-3xl">
            Capture. Reflect. Remember. Discover. Re-enter.
          </h2>
        </motion.div>

        <div className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-3">
          {LOOP.map((step, i) => (
            <motion.div
              key={step}
              custom={i + 5}
              variants={fade}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              className="flex items-center gap-3"
            >
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card/60 text-sm">
                <span className="font-data text-xs text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {step}
              </span>
              {i < LOOP.length - 1 && <span className="text-muted-foreground">→</span>}
            </motion.div>
          ))}
        </div>
      </section>

      {/* principles */}
      <section className="mx-auto w-full max-w-6xl px-5 sm:px-8 pb-28">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <motion.div
            custom={12}
            variants={fade}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
            className="surface p-7"
          >
            <Lock className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
            <h3 className="mt-4 font-display text-2xl">Private by default</h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed pretty">
              Every dream belongs to the account that recorded it. Records are isolated
              server-side, never shared across users, and deletable at any time.
            </p>
          </motion.div>
          <motion.div
            custom={13}
            variants={fade}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
            className="surface p-7"
          >
            <Layers className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
            <h3 className="mt-4 font-display text-2xl">Observed, inferred, generated</h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed pretty">
              Your original memory stays untouched. Gemini's interpretation is always labelled
              as reflection, and the simulation state stays under the application's authority —
              never the model's.
            </p>
          </motion.div>
        </div>
      </section>

      {/* closing CTA */}
      <section className="mx-auto w-full max-w-6xl px-5 sm:px-8 pb-24 text-center">
        <motion.div
          custom={14}
          variants={fade}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
        >
          <h2 className="font-display tracking-display text-4xl sm:text-5xl balance">
            A dream you remember for thirty seconds
            <br />
            can become a world you revisit for years.
          </h2>
          <button
            onClick={() => navigate("auth", { authMode: "signup" })}
            className="mt-8 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-foreground text-background text-sm hover:opacity-90 transition focus-ring"
          >
            Open your dream memory
          </button>
        </motion.div>
      </section>

      {/* footer */}
      <footer className="mt-auto border-t border-border">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <DreamMark />
            <span className="font-display text-base text-foreground">DreamWeaver</span>
          </div>
          <div className="flex items-center gap-4">
            <span>AI reflection is advisory, never clinical.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

const LAYERS = [
  {
    tag: "Capture",
    title: "Raw dream, preserved",
    body: "Write a fragment — incomplete sentences, contradictions, the half-images you woke with. Nothing is rewritten. The raw memory stays as you recorded it.",
    icon: Moon,
  },
  {
    tag: "Intelligence",
    title: "Structured dream memory",
    body: "The dream is read and its emotions, motifs, people, places, lucidity and uncertainty are derived. Confidence is shown where it exists, and so is its absence.",
    icon: Map,
  },
  {
    tag: "Arcade",
    title: "Re-enter your dream",
    body: "Past dreams become interactive worlds. Make a choice; the scene continues in context. Your decisions shape a stateful simulation — grounded in your own memory.",
    icon: Compass,
  },
];

const LOOP = [
  "Capture",
  "Analyze",
  "Remember",
  "Discover",
  "Re-enter",
  "Interact",
  "Evolve",
];
