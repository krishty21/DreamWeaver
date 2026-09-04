"use client";

import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import { DreamMark } from "@/components/shell/top-nav";
import {
  Loader2,
  MoonStar,
  Quote,
  Sparkles,
  User,
  MapPin,
  Footprints,
  Eye,
  Lock,
  Compass,
  Hourglass,
} from "lucide-react";
import { motion } from "framer-motion";
import type { Emotion, Interpretation, LabeledItem } from "@/lib/types";

// Public, read-only view of one dream's reflection, addressed by share token.
// This view works signed-out: no private navigation, no session-dependent UI.
// It shows exactly what /api/shared/[token] returns — the sanitised payload.

async function fetchShared(token: string) {
  const res = await fetch(`/api/shared/${token}`);
  if (!res.ok) {
    // Distinguish "the dreamer closed this window" from "never existed" —
    // both 404, but the body carries an `error` code.
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

const fade = {
  hidden: { opacity: 0, y: 14 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.07 * i, duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export function SharedDreamView() {
  const token = useApp((s) => s.activeShareToken);
  const navigate = useApp((s) => s.navigate);

  const { data, isLoading, error } = useQuery({
    queryKey: ["shared", token],
    queryFn: () => fetchShared(token!),
    enabled: !!token,
    retry: false,
    // Same as the story view: revocation/expiry must be reflected on the very
    // next mount — never serve a cached copy of a public share.
    staleTime: 0,
    refetchOnMount: "always",
  });

  return (
    <div className="relative min-h-screen flex flex-col">
      {/* brand bar */}
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8 pt-8 flex items-center justify-between no-print">
        <button
          onClick={() => navigate("landing")}
          className="flex items-center gap-2.5 focus-ring rounded-sm"
          aria-label="DreamWeaver home"
        >
          <DreamMark />
          <span className="font-display text-2xl tracking-display">DreamWeaver</span>
        </button>
        <button
          onClick={() => navigate("auth", { authMode: "signup" })}
          className="px-4 py-2 rounded-full text-sm bg-foreground text-background hover:opacity-90 transition focus-ring"
        >
          Keep your own dreams
        </button>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center py-28">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error || !data?.shared ? (
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
                : "This reflection is no longer shared."}
            </h1>
            <p className="mt-3 text-sm text-muted-foreground pretty">
              {error?.message === "expired"
                ? "The dreamer set this link to expire, and its time has passed. The reflection returns to private memory."
                : "The dreamer may have revoked the link, or it never existed. The dream itself stays private, wherever it is."}
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
        <SharedBody shared={data.shared} />
      )}

      {/* footer */}
      <footer className="mt-auto border-t border-border/60">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="font-display text-sm tracking-display text-foreground">DreamWeaver</span>
          <span className="pretty">
            Shared reflections are read-only. AI interpretation is reflective, never clinical.
          </span>
        </div>
      </footer>
    </div>
  );
}

function SharedBody({ shared }: { shared: any }) {
  const r = shared.reflection;
  const date = new Date(shared.dreamedOn + "T00:00:00");
  const dreamed = Number.isNaN(date.getTime())
    ? shared.dreamedOn
    : date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const sharedOn = shared.sharedAt
    ? new Date(shared.sharedAt + "T00:00:00").toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;
  // If the dreamer armed an expiry, readers deserve to know the window closes.
  const expiresOn = shared.expiresAt
    ? (() => {
        const d = new Date(shared.expiresAt);
        return Number.isNaN(d.getTime())
          ? null
          : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      })()
    : null;

  return (
    <motion.article
      initial="hidden"
      animate="show"
      className="relative mx-auto w-full max-w-3xl px-5 sm:px-8 pt-14 sm:pt-20 pb-20"
    >
      {/* floating dream fragments — soft surrealism, decorative only */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none" aria-hidden="true">
        <span className="fragment" style={{ left: "4%", top: "14%", animationDelay: "0s", fontSize: "1.15rem" }}>read while it's still dark…</span>
        <span className="fragment" style={{ left: "82%", top: "22%", animationDelay: "-4s", fontSize: "1rem" }}>someone else's night</span>
        <span className="fragment" style={{ left: "10%", top: "64%", animationDelay: "-7s", fontSize: "1.05rem" }}>a borrowed dream</span>
        <span className="fragment" style={{ left: "76%", top: "78%", animationDelay: "-9s", fontSize: "1.2rem" }}>keep what returns</span>
      </div>

      {/* masthead */}
      <motion.div variants={fade} custom={0} className="text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-card/60 text-xs tracking-caps uppercase text-muted-foreground">
          <MoonStar className="h-3 w-3" strokeWidth={1.8} />
          A shared dream reflection
        </div>
        <h1 className="mt-6 font-display tracking-display balance text-4xl sm:text-6xl leading-[1.02] text-foreground">
          {shared.title}
        </h1>
        <p className="mt-4 text-sm text-foreground/80">
          {shared.authorName ? <>Dreamed by {shared.authorName} · </> : null}
          {dreamed}
          {shared.mood && shared.mood !== "neutral" && (
            <span className="chip ml-2">{shared.mood}</span>
          )}
        </p>
        {sharedOn && (
          <p className="mt-1 text-[11px] text-muted-foreground font-data">
            shared {sharedOn} · read-only link
            {expiresOn && ` · closes ${expiresOn}`}
          </p>
        )}
      </motion.div>

      {/* OBSERVED — the dreamer's own words (only when they opted in) */}
      {shared.includeRaw && shared.rawText ? (
        <motion.section variants={fade} custom={1} className="mt-14">
          <SharedSectionLabel icon={Eye} tag="01 · Observed" label="The dreamer's words" />
          <div className="mt-4 surface p-6 sm:p-7">
            <Quote className="h-5 w-5 text-muted-foreground mb-3" strokeWidth={1.4} />
            <p className="prose-dream whitespace-pre-wrap pretty">{shared.rawText}</p>
          </div>
        </motion.section>
      ) : (
        <motion.p
          variants={fade}
          custom={1}
          className="mt-12 mx-auto max-w-md text-center text-sm text-muted-foreground italic pretty"
        >
          <Lock className="h-3.5 w-3.5 inline-block mr-1.5 -mt-0.5" strokeWidth={1.6} />
          The dreamer has kept the original memory private. What follows is the reflection alone.
        </motion.p>
      )}

      {/* Reflection summary */}
      <motion.section variants={fade} custom={2} className="mt-14">
        <SharedSectionLabel icon={Sparkles} tag="02 · Reflection" label="Summary" />
        <p className="mt-4 font-display text-2xl sm:text-[1.7rem] leading-snug text-foreground pretty drop-first">
          {r.summary}
        </p>
      </motion.section>

      {/* Emotional signature */}
      {Array.isArray(r.emotions) && r.emotions.length > 0 && (
        <motion.section variants={fade} custom={3} className="mt-14">
          <SharedSectionLabel icon={Sparkles} tag="03 · Emotional signature" label="What was felt" />
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {r.emotions.map((e: Emotion, i: number) => (
              <div key={i} className="surface-quiet p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm capitalize text-foreground">{e.emotion}</span>
                  <span className="font-data text-xs text-muted-foreground">
                    {(e.intensity * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="meter-track mt-2">
                  <div
                    className="meter-fill"
                    style={{
                      transform: `scaleX(${e.intensity})`,
                      background: "linear-gradient(90deg, var(--rose), var(--mauve))",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </motion.section>
      )}

      {/* Structured elements */}
      <motion.div variants={fade} custom={4} className="mt-14 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-10">
        <SharedItemGroup title="Symbolic motifs" items={r.motifs} type="symbol" />
        <SharedItemGroup title="Symbols" items={r.symbols} type="symbol" />
        <SharedItemGroup
          title="People & entities"
          items={Array.isArray(r.people) ? r.people.map((p: any) => ({ label: p.name, note: p.role })) : []}
          type="person"
        />
        <SharedItemGroup title="Locations" items={r.locations} type="place" />
        <SharedItemGroup title="Actions" items={r.actions} type="action" />
      </motion.div>

      {/* Meters */}
      <motion.section variants={fade} custom={5} className="mt-14">
        <SharedSectionLabel icon={Sparkles} tag="04 · Lucidity & emotional tone" label="Estimate" />
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-5">
          <SharedMeter label="Lucidity" value={r.lucidity * 100} tone="lucid" />
          <SharedMeter label="Fear / tension" value={r.fear * 100} tone="tense" />
          <SharedMeter label="Uncertainty" value={r.uncertainty * 100} tone="surreal" />
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground italic">
          Estimates are AI-reported and advisory.
        </p>
      </motion.section>

      {/* Interpretations */}
      {Array.isArray(r.interpretations) && r.interpretations.length > 0 && (
        <motion.section variants={fade} custom={6} className="mt-14">
          <SharedSectionLabel icon={Sparkles} tag="05 · Possible interpretation" label="AI-generated reflection" />
          <div className="mt-4 space-y-3">
            {r.interpretations.map((it: Interpretation, i: number) => {
              const c = it.confidence;
              const tag = c < 0.35 ? "tentative" : c < 0.65 ? "moderate" : "considered";
              return (
                <div key={i} className="surface p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] tracking-caps uppercase text-muted-foreground">
                      Possible interpretation
                    </span>
                    <span className="chip font-data">{tag}</span>
                  </div>
                  <p className="text-sm sm:text-base leading-relaxed pretty">{it.text}</p>
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
            })}
          </div>
        </motion.section>
      )}

      {/* CTA */}
      <motion.section variants={fade} custom={7} className="mt-16 surface p-7 sm:p-9 text-center no-print">
        <Compass className="h-6 w-6 mx-auto text-muted-foreground" strokeWidth={1.4} />
        <h3 className="mt-3 font-display text-3xl tracking-display balance">
          Every dream keeps its own shape.
        </h3>
        <p className="mt-2 text-sm text-muted-foreground pretty max-w-md mx-auto">
          DreamWeaver remembers your dreams, finds what returns, and lets you walk back into them.
        </p>
        <StartCtaButtons />
      </motion.section>
    </motion.article>
  );
}

function StartCtaButtons() {
  const navigate = useApp((s) => s.navigate);
  return (
    <div className="mt-6 flex items-center justify-center gap-3">
      <button
        onClick={() => navigate("auth", { authMode: "signup" })}
        className="px-6 py-3 rounded-full text-sm bg-foreground text-background hover:opacity-90 transition focus-ring"
      >
        Begin your dream memory
      </button>
      <button
        onClick={() => navigate("auth", { authMode: "signin" })}
        className="px-5 py-3 rounded-full text-sm text-muted-foreground hover:text-foreground transition focus-ring"
      >
        I have an account
      </button>
    </div>
  );
}

function SharedSectionLabel({ icon: Icon, tag, label }: { icon: any; tag: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
      <div className="text-xs tracking-caps uppercase text-muted-foreground">{tag}</div>
      <span className="h-px flex-1 bg-border" />
      <h2 className="font-display text-2xl tracking-tight">{label}</h2>
    </div>
  );
}

function SharedItemGroup({
  title,
  items,
  type = "symbol",
}: {
  title: string;
  items: LabeledItem[];
  type?: "symbol" | "person" | "place" | "action";
}) {
  const Icon = type === "person" ? User : type === "place" ? MapPin : type === "action" ? Footprints : Sparkles;
  const list = Array.isArray(items) ? items : [];
  return (
    <div>
      <h3 className="text-xs tracking-caps uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
        <Icon className="h-3 w-3" strokeWidth={1.6} />
        {title}
      </h3>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">—</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {list.map((it, i) => (
            <span key={i} className="chip">
              {it.label}
              {it.note && <span className="text-muted-foreground">· {it.note}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SharedMeter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
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
    </div>
  );
}
