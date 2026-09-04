// Dream journal export — builds a Markdown document from dream records.
// Pure functions: the caller (client) already holds the data from /api/dreams.
// The generated file belongs to the dreamer; it contains OBSERVED raw memory
// plus the AI reflection clearly labelled as such.

import type { Mood } from "@/lib/types";

type AnalysisLike = {
  summary?: string | null;
  emotionsJson?: string | null;
  symbolsJson?: string | null;
  motifsJson?: string | null;
  peopleJson?: string | null;
  locationsJson?: string | null;
  actionsJson?: string | null;
  interpretationsJson?: string | null;
  lucidity?: number | null;
  lucidityNote?: string | null;
  fear?: number | null;
  uncertainty?: number | null;
};

export type ExportableDream = {
  id: string;
  title?: string | null;
  mood?: string | null;
  rawText: string;
  createdAt: string;
  analysis?: AnalysisLike | null;
};

function parseArr(json: string | null | undefined): any[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const pct = (v: number | null | undefined) => `${((v ?? 0) * 100).toFixed(0)}%`;

// ---------- single dream ----------

export function buildDreamMarkdown(dream: ExportableDream): string {
  const a = dream.analysis ?? null;
  const lines: string[] = [];

  lines.push(`# ${dream.title || "A dream, partially recalled"}`);
  lines.push("");
  lines.push(`_${fmtDate(dream.createdAt)}${dream.mood ? ` · mood: ${dream.mood}` : ""}_`);
  lines.push("");
  lines.push("## Observed — the raw memory");
  lines.push("");
  lines.push(`> ${dream.rawText.split("\n").join("\n> ")}`);
  lines.push("");

  if (a) {
    lines.push("## Reflection (AI-generated, advisory)");
    lines.push("");
    lines.push(a.summary || "");
    lines.push("");

    const emotions = parseArr(a.emotionsJson);
    if (emotions.length) {
      lines.push(`**Emotions:** ${emotions.map((e) => `${e.emotion} ${pct(e.intensity)}`).join(" · ")}`);
      lines.push("");
    }

    const groups: [string, any[]][] = [
      ["Motifs", parseArr(a.motifsJson)],
      ["Symbols", parseArr(a.symbolsJson)],
      ["People", parseArr(a.peopleJson)],
      ["Locations", parseArr(a.locationsJson)],
      ["Actions", parseArr(a.actionsJson)],
    ];
    for (const [label, items] of groups) {
      if (items.length) {
        lines.push(`**${label}:** ${items.map((i) => i.label ?? i.name).join(", ")}`);
        lines.push("");
      }
    }

    lines.push(
      `**Lucidity** ${pct(a.lucidity)} · **Fear / tension** ${pct(a.fear)} · **Uncertainty** ${pct(a.uncertainty)}`
    );
    if (a.lucidityNote) lines.push(`\n> ${a.lucidityNote}`);
    lines.push("");

    const interps = parseArr(a.interpretationsJson);
    if (interps.length) {
      lines.push("### Possible interpretations");
      lines.push("");
      for (const it of interps) {
        lines.push(`- (${pct(it.confidence)}) ${it.text}`);
      }
      lines.push("");
    }
  } else {
    lines.push("_No structured reflection was produced for this dream._");
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("_Kept in DreamWeaver. AI reflection is advisory, never clinical._");
  return lines.join("\n");
}

// ---------- whole journal ----------

export function buildJournalMarkdown(
  dreams: ExportableDream[],
  author?: string | null
): string {
  const sorted = [...dreams].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const lines: string[] = [];
  const nights = new Set(sorted.map((d) => d.createdAt.slice(0, 10))).size;

  lines.push("# Dream Journal");
  lines.push("");
  lines.push(
    `${author ? `**${author}** · ` : ""}**${sorted.length} dreams** across **${nights} night${nights === 1 ? "" : "s"}** · exported ${fmtDate(new Date().toISOString())} from DreamWeaver`
  );
  lines.push("");
  lines.push("> Raw memories are OBSERVED (your words). Reflections are AI-generated and advisory.");
  lines.push("");
  lines.push("---");
  lines.push("");

  // group by month
  const months = new Map<string, ExportableDream[]>();
  for (const d of sorted) {
    const key = d.createdAt.slice(0, 7); // YYYY-MM
    if (!months.has(key)) months.set(key, []);
    months.get(key)!.push(d);
  }
  for (const [key, list] of months) {
    const label = new Date(key + "-01T00:00:00").toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    lines.push(`# ${label}`);
    lines.push("");
    for (const d of list) {
      lines.push(buildDreamMarkdown(d));
      lines.push("");
    }
  }
  return lines.join("\n");
}

// ---------- download helper ----------

export function downloadMarkdown(markdown: string, filename: string) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "dream"
  );
}
