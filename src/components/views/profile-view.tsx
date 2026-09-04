"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, ShieldCheck, Lock, Layers, LogOut, Database, AlertTriangle, Trophy, Sparkles, Repeat, PenLine, CalendarHeart, Sunrise } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

async function fetchMe() {
  const res = await fetch("/api/me");
  return res.json();
}

async function fetchDreams() {
  const res = await fetch("/api/dreams");
  return res.json();
}

async function fetchPatterns() {
  const res = await fetch("/api/patterns");
  return res.json();
}

export function ProfileView() {
  const navigate = useApp((s) => s.navigate);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const user = data?.user;
  // r9 — records strip. Both queries are already cached by the journal /
  // patterns views (same react-query keys), so this costs nothing extra.
  const { data: dreamsData } = useQuery({ queryKey: ["dreams"], queryFn: fetchDreams });
  const { data: patternsData } = useQuery({ queryKey: ["patterns"], queryFn: fetchPatterns });
  const [wiping, setWiping] = useState(false);

  async function wipeAll() {
    if (!user) return;
    const ok = window.confirm(
      "Delete ALL of your dreams, analyses, motifs, and arcade sessions? This permanently removes every dream record and cannot be undone."
    );
    if (!ok) return;
    setWiping(true);
    try {
      // delete all dreams (cascade handles analysis/motifs/sessions/turns)
      const res = await fetch("/api/dreams");
      if (res.ok) {
        const d = await res.json();
        for (const dream of d.dreams ?? []) {
          await fetch(`/api/dreams/${dream.id}`, { method: "DELETE" });
        }
      }
      qc.invalidateQueries();
      toast({ title: "All dreams deleted", description: "Your dream memory is now empty." });
      navigate("dashboard");
    } catch (e: any) {
      toast({ title: "Failed to wipe", description: e.message, variant: "destructive" });
    } finally {
      setWiping(false);
    }
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center py-28">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-5 sm:px-8 py-10 sm:py-14">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="text-xs tracking-caps uppercase text-muted-foreground mb-2">
          Profile &amp; privacy
        </div>
        <h1 className="font-display tracking-display text-5xl sm:text-6xl leading-[0.95] balance">
          Your dream memory belongs to you.
        </h1>
        <p className="mt-3 text-sm sm:text-base text-muted-foreground pretty max-w-xl">
          DreamWeaver treats dream content as private personal information. Every record is
          isolated to your account, enforced server-side — not just hidden in the UI.
        </p>
      </motion.div>

      {/* r9 — personal records. Computed app-side from the dream memory:
          most lucid dream, longest streak, most recurring motif, total words,
          and the night it all began. A quiet trophy shelf. */}
      <RecordsStrip dreams={dreamsData?.dreams ?? []} patterns={patternsData?.report ?? null} />

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="surface p-6">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
          <h3 className="mt-3 font-display text-2xl">Account</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Email" value={user.email} />
            {user.name && <Row label="Name" value={user.name} />}
            <Row label="Member since" value={new Date(user.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })} />
            <Row label="Dreams" value={user.dreamCount} />
            <Row label="Sessions" value={user.sessionCount} />
          </dl>
          <Button
            onClick={() => signOut({ redirect: false })}
            variant="outline"
            className="mt-5 h-10"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.6} />
            Sign out
          </Button>
        </div>

        <div className="surface p-6">
          <Lock className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
          <h3 className="mt-3 font-display text-2xl">Private by default</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground pretty">
            <li>· Every dream record is scoped to your account at the database level.</li>
            <li>· API routes verify ownership before any read or write.</li>
            <li>· AI credentials are used server-side only; never shipped to the browser.</li>
            <li>· A malicious user attempting another person's record is rejected.</li>
          </ul>
        </div>

        <div className="surface p-6">
          <Layers className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
          <h3 className="mt-3 font-display text-2xl">Observed · Inferred · Generated</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground pretty">
            <li>· <strong className="text-foreground">Observed</strong> — your raw dream text, preserved verbatim.</li>
            <li>· <strong className="text-foreground">Inferred</strong> — Gemini's structured reflection, always labelled.</li>
            <li>· <strong className="text-foreground">Generated</strong> — arcade scenes, clearly creative.</li>
            <li>· <strong className="text-foreground">State</strong> — authoritative application data; the model never writes it directly.</li>
          </ul>
        </div>

        <div className="surface p-6">
          <Database className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
          <h3 className="mt-3 font-display text-2xl">Transparent AI handling</h3>
          <p className="mt-3 text-sm text-muted-foreground pretty">
            DreamWeaver is reflective, not clinical. Interpretations are labelled "possible",
            confidence is shown where it exists, and the raw model response is preserved per
            dream for audit. Nothing here is medical or psychiatric advice.
          </p>
        </div>
      </div>

      {/* danger zone */}
      <div className="mt-8 surface p-6 border-destructive/40">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" strokeWidth={1.5} />
          <h3 className="font-display text-2xl">Data management</h3>
        </div>
        <p className="mt-2 text-sm text-muted-foreground pretty max-w-xl">
          Remove individual dreams from their detail page, or wipe your entire dream history
          below. Account credentials are not affected.
        </p>
        <Button
          onClick={wipeAll}
          disabled={wiping || user.dreamCount === 0}
          variant="outline"
          className="mt-5 h-10 border-destructive/50 text-destructive hover:bg-destructive/[0.06]"
        >
          {wiping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" strokeWidth={1.6} />}
          Delete all dreams
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-data text-sm text-right truncate max-w-[60%]">{value}</dd>
    </div>
  );
}

// r9 — Records strip: five tiles of personal bests. Each tile is a button
// where it makes sense (most lucid dream opens it; recurring motif opens the
// atlas). Returns null until the queries resolve.
function RecordsStrip({ dreams, patterns }: { dreams: any[]; patterns: any }) {
  const navigate = useApp((s) => s.navigate);
  if (!patterns || dreams.length === 0) return null;

  // most lucid dream with an analysis
  let mostLucid: any = null;
  for (const d of dreams) {
    const l = d.analysis?.lucidity ?? 0;
    if (!mostLucid || l > (mostLucid.analysis?.lucidity ?? 0)) mostLucid = d;
  }

  // longest streak of consecutive nights with dreams
  const days = Array.from(
    new Set(
      dreams.map((d) => {
        const dt = new Date(d.createdAt);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      })
    )
  ).sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1] + "T12:00:00").getTime();
    const cur = new Date(days[i] + "T12:00:00").getTime();
    run = cur - prev === 86_400_000 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const topMotif = patterns.topMotifs?.[0] ?? null;
  const totalWords = dreams.reduce(
    (sum, d) => sum + ((d.rawText ?? "").trim().match(/\S+/g) ?? []).length,
    0
  );
  const firstDream = dreams.reduce(
    (acc: any, d) => (!acc || new Date(d.createdAt) < new Date(acc.createdAt) ? d : acc),
    null as any
  );

  const tiles = [
    {
      key: "lucid",
      icon: Sunrise,
      label: "most lucid dream",
      value: mostLucid?.analysis ? `${Math.round((mostLucid.analysis.lucidity ?? 0) * 100)}%` : "—",
      sub: mostLucid?.title ?? "no analysis yet",
      onClick: mostLucid ? () => navigate("dream", { dreamId: mostLucid.id }) : undefined,
    },
    {
      key: "streak",
      icon: Sparkles,
      label: "longest streak",
      value: `${longest} ${longest === 1 ? "night" : "nights"}`,
      sub: `${days.length} night${days.length === 1 ? "" : "s"} remembered overall`,
      onClick: undefined,
    },
    {
      key: "motif",
      icon: Repeat,
      label: "most recurring motif",
      value: topMotif ? topMotif.label : "—",
      sub: topMotif ? `returned ${topMotif.count} times` : "still surfacing",
      onClick: () => navigate("atlas"),
    },
    {
      key: "words",
      icon: PenLine,
      label: "words dreamed",
      value: totalWords.toLocaleString(),
      sub: `across ${dreams.length} dream${dreams.length === 1 ? "" : "s"}`,
      onClick: undefined,
    },
    {
      key: "first",
      icon: CalendarHeart,
      label: "where it began",
      value: firstDream
        ? new Date(firstDream.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        : "—",
      sub: firstDream?.title ?? "",
      onClick: firstDream ? () => navigate("dream", { dreamId: firstDream.id }) : undefined,
    },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.05 }}
      className="mt-10"
      aria-label="Your dream records"
    >
      <div className="flex items-center gap-2 mb-4 text-xs tracking-caps uppercase text-muted-foreground">
        <Trophy className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
        Records — kept by the app, not the model
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {tiles.map((t) => {
          const Icon = t.icon;
          const inner = (
            <>
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-foreground/[0.05]">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
              </span>
              <span className="digest-stat-value text-xl sm:text-2xl truncate capitalize" title={typeof t.value === "string" ? t.value : undefined}>
                {t.value}
              </span>
              <span className="digest-stat-label">{t.label}</span>
              <span className="text-[11px] text-muted-foreground/80 italic truncate" title={t.sub}>{t.sub}</span>
            </>
          );
          return t.onClick ? (
            <button key={t.key} onClick={t.onClick} className="record-tile text-left focus-ring">
              {inner}
            </button>
          ) : (
            <div key={t.key} className="record-tile">
              {inner}
            </div>
          );
        })}
      </div>
    </motion.section>
  );
}
