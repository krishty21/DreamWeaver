"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/lib/store";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2, ShieldCheck, Lock, Layers, LogOut, Database, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

async function fetchMe() {
  const res = await fetch("/api/me");
  return res.json();
}

export function ProfileView() {
  const navigate = useApp((s) => s.navigate);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const user = data?.user;
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
    <div className="mx-auto max-w-4xl px-5 sm:px-8 py-10 sm:py-14">
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

      <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-4">
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
