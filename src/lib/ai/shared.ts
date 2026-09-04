// Shared AI helpers: JSON parsing + repair, zod schemas, clamp logic.
// Used by BOTH the z-ai-web-dev-sdk backend (local) AND the @google/genai
// backend (production). The exact-same validation/retry/clamp logic runs
// regardless of which model serves the request — the application remains
// authoritative over what gets persisted.
//
// CRITICAL PRINCIPLE: "MODEL OUTPUT IS NEVER TRUSTED AS APPLICATION STATE."
// These helpers are the defensive boundary that enforces that principle
// regardless of the underlying model SDK.

import { z } from "zod";
import type {
  ArcadeTurnResponse,
  DreamAnalysisData,
  ProposedDelta,
} from "@/lib/types";

// ---------- Numeric clamping ----------

export function clamp(n: unknown, lo = 0, hi = 1): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

// ---------- JSON source normalisation + repair ----------

export function normalizeJSONSource(t: string): string {
  return t
    .replace(/\uFEFF/g, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

export function parseWithRepairs(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {}
  try {
    return JSON.parse(s.replace(/,\s*([}\]])/g, "$1"));
  } catch {}
  try {
    const repaired = repairTruncated(s.replace(/,\s*([}\]])/g, "$1"));
    if (repaired) return JSON.parse(repaired);
  } catch {}
  return null;
}

export function repairTruncated(s: string): string | null {
  let inString = false;
  let escape = false;
  const stack: string[] = [];
  let lastSafe = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
    else if (ch === "," && stack.length > 0) lastSafe = i;
  }
  if (stack.length === 0) return null;
  let out: string;
  if (lastSafe > 0) {
    out = s.slice(0, lastSafe).replace(/[,\s]+$/, "");
  } else {
    out = s.replace(/[,\s]+$/, "");
    if (inString) out += '"';
  }
  let inStr2 = false;
  let esc2 = false;
  const stack2: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (esc2) {
      esc2 = false;
      continue;
    }
    if (ch === "\\" && inStr2) {
      esc2 = true;
      continue;
    }
    if (ch === '"') {
      inStr2 = !inStr2;
      continue;
    }
    if (inStr2) continue;
    if (ch === "{" || ch === "[") stack2.push(ch);
    else if (ch === "}" || ch === "]") stack2.pop();
  }
  if (inStr2) return null;
  while (stack2.length > 0) {
    const open = stack2.pop();
    out += open === "{" ? "}" : "]";
  }
  return out;
}

export function extractJSON(text: string): any | null {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  t = normalizeJSONSource(t);
  const firstBrace = t.indexOf("{");
  const firstBracket = t.indexOf("[");
  const arrayFirst =
    firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace);
  if (arrayFirst) {
    const lastBracket = t.lastIndexOf("]");
    const candidate =
      lastBracket > firstBracket
        ? t.slice(firstBracket, lastBracket + 1)
        : t.slice(firstBracket);
    const parsedArr = parseWithRepairs(candidate);
    if (parsedArr !== null) return parsedArr;
  }
  const first = firstBrace;
  const last = t.lastIndexOf("}");
  if (first === -1) return null;
  if (last > first) {
    const parsed = parseWithRepairs(t.slice(first, last + 1));
    if (parsed !== null) return parsed;
  }
  return parseWithRepairs(t.slice(first));
}

// ---------- Brief (for warning logs — no PII) ----------

export function brief(raw: string): string {
  const s = JSON.stringify(raw);
  if (s.length <= 700) return s;
  return `${s.slice(0, 400)} …[len ${s.length}]… ${s.slice(-260)}`;
}

// ---------- Zod schemas (shared by both backends) ----------

export const analysisSchema = z.object({
  title: z.string().max(120).default("Untitled dream"),
  summary: z.string().max(600),
  emotions: z
    .array(
      z.object({
        emotion: z.string(),
        intensity: z.number(),
        confidence: z.number().optional(),
      })
    )
    .max(10)
    .default([]),
  symbols: z
    .array(z.object({ label: z.string(), note: z.string().optional(), confidence: z.number().optional() }))
    .max(20)
    .default([]),
  motifs: z
    .array(z.object({ label: z.string(), note: z.string().optional(), confidence: z.number().optional() }))
    .max(20)
    .default([]),
  people: z
    .array(
      z.object({
        name: z.string(),
        role: z.string().optional(),
        note: z.string().optional(),
        confidence: z.number().optional(),
      })
    )
    .max(20)
    .default([]),
  locations: z
    .array(z.object({ label: z.string(), note: z.string().optional(), confidence: z.number().optional() }))
    .max(20)
    .default([]),
  actions: z
    .array(z.object({ label: z.string(), note: z.string().optional(), confidence: z.number().optional() }))
    .max(20)
    .default([]),
  lucidity: z.number().default(0.3),
  lucidityNote: z.string().optional(),
  fear: z.number().default(0.2),
  uncertainty: z.number().default(0.3),
  interpretations: z
    .array(
      z.object({
        text: z.string(),
        confidence: z.number(),
        evidence: z.array(z.string().max(200)).max(4).optional(),
      })
    )
    .max(5)
    .default([]),
  dreamLaws: z
    .array(
      z.object({
        law: z.string().max(160),
        evidence: z.string().max(200).optional(),
      })
    )
    .max(3)
    .default([]),
  relationships: z
    .array(z.object({ from: z.string(), to: z.string(), relation: z.string() }))
    .max(10)
    .default([]),
  mood: z
    .enum(["neutral", "tense", "lucid", "melancholic", "surreal"])
    .default("neutral"),
});

export const turnSchema = z.object({
  sceneText: z.string(),
  choices: z
    .array(
      z.object({
        id: z.string(),
        label: z.string().max(120),
        hint: z.string().optional(),
      })
    )
    .max(5)
    .default([]),
  proposedDelta: z
    .object({
      fear: z.number().optional(),
      lucidity: z.number().optional(),
      stability: z.number().optional(),
      agency: z.number().optional(),
      discoveredMotifs: z.array(z.string()).max(8).optional(),
      visitedScene: z.string().optional(),
      inventoryAdd: z.array(z.string()).max(5).optional(),
      phase: z.enum(["opening", "developing", "climax", "resolving"]).optional(),
      ending: z
        .enum(["collapse", "escape", "control", "unresolved", "transformed"])
        .nullable()
        .optional(),
      reasoning: z.string().optional(),
    })
    .default({}),
});

// ---------- Post-parse shaping (clamp + truncate) ----------

export function shapeAnalysis(safe: z.infer<typeof analysisSchema>): DreamAnalysisData {
  return {
    title: safe.title.slice(0, 120),
    summary: safe.summary.slice(0, 600),
    emotions: safe.emotions.map((e) => ({
      emotion: String(e.emotion).slice(0, 60),
      intensity: clamp(e.intensity),
      confidence: clamp(e.confidence),
    })),
    symbols: safe.symbols.map((s) => ({
      label: String(s.label).slice(0, 60).toLowerCase(),
      note: s.note ? String(s.note).slice(0, 200) : undefined,
      confidence: clamp(s.confidence),
    })),
    motifs: safe.motifs.map((s) => ({
      label: String(s.label).slice(0, 60).toLowerCase(),
      note: s.note ? String(s.note).slice(0, 200) : undefined,
      confidence: clamp(s.confidence),
    })),
    people: safe.people.map((p) => ({
      name: String(p.name).slice(0, 60),
      role: p.role ? String(p.role).slice(0, 60) : undefined,
      note: p.note ? String(p.note).slice(0, 200) : undefined,
      confidence: clamp(p.confidence),
    })),
    locations: safe.locations.map((s) => ({
      label: String(s.label).slice(0, 60).toLowerCase(),
      note: s.note ? String(s.note).slice(0, 200) : undefined,
      confidence: clamp(s.confidence),
    })),
    actions: safe.actions.map((s) => ({
      label: String(s.label).slice(0, 60).toLowerCase(),
      note: s.note ? String(s.note).slice(0, 200) : undefined,
      confidence: clamp(s.confidence),
    })),
    lucidity: clamp(safe.lucidity),
    lucidityNote: safe.lucidityNote ? String(safe.lucidityNote).slice(0, 300) : undefined,
    fear: clamp(safe.fear),
    uncertainty: clamp(safe.uncertainty),
    interpretations: safe.interpretations.map((i) => ({
      text: String(i.text).slice(0, 400),
      confidence: clamp(i.confidence),
      evidence: Array.isArray(i.evidence)
        ? i.evidence.map((e) => String(e).slice(0, 200)).slice(0, 4)
        : undefined,
    })),
    dreamLaws: safe.dreamLaws.map((l) => ({
      law: String(l.law).slice(0, 160),
      evidence: l.evidence ? String(l.evidence).slice(0, 200) : undefined,
    })),
    relationships: safe.relationships.map((r) => ({
      from: String(r.from).slice(0, 60),
      to: String(r.to).slice(0, 60),
      relation: String(r.relation).slice(0, 60),
    })),
    historicalConnections: [],
    mood: safe.mood,
  };
}

export function clampDelta(d: any): ProposedDelta {
  const out: ProposedDelta = {};
  if (typeof d.fear === "number") out.fear = clamp(d.fear, 0, 100);
  if (typeof d.lucidity === "number") out.lucidity = clamp(d.lucidity, 0, 100);
  if (typeof d.stability === "number") out.stability = clamp(d.stability, 0, 100);
  if (typeof d.agency === "number") out.agency = clamp(d.agency, 0, 100);
  if (Array.isArray(d.discoveredMotifs))
    out.discoveredMotifs = d.discoveredMotifs.map((s: any) => String(s).slice(0, 60).toLowerCase()).slice(0, 8);
  if (typeof d.visitedScene === "string") out.visitedScene = String(d.visitedScene).slice(0, 80);
  if (Array.isArray(d.inventoryAdd))
    out.inventoryAdd = d.inventoryAdd.map((s: any) => String(s).slice(0, 60)).slice(0, 5);
  if (
    d.phase === "opening" ||
    d.phase === "developing" ||
    d.phase === "climax" ||
    d.phase === "resolving"
  )
    out.phase = d.phase;
  if (
    d.ending === "collapse" ||
    d.ending === "escape" ||
    d.ending === "control" ||
    d.ending === "unresolved" ||
    d.ending === "transformed"
  )
    out.ending = d.ending;
  if (typeof d.reasoning === "string") out.reasoning = String(d.reasoning).slice(0, 400);
  return out;
}

export function buildArcadeResponse(safe: z.infer<typeof turnSchema>): ArcadeTurnResponse {
  return {
    sceneText: String(safe.sceneText).slice(0, 2000),
    choices: safe.choices.map((c, i) => ({
      id: c.id || `choice-${i + 1}`,
      label: String(c.label).slice(0, 120),
      hint: c.hint ? String(c.hint).slice(0, 200) : undefined,
    })),
    proposedDelta: clampDelta(safe.proposedDelta),
    discoveredMotifs: (safe.proposedDelta.discoveredMotifs || [])
      .map((s) => String(s).slice(0, 60).toLowerCase())
      .slice(0, 8),
  };
}

// ---------- Fallbacks (graceful failure — never let a malformed response crash the app) ----------

export function fallbackAnalysis(raw: string): { data: DreamAnalysisData; raw: string } {
  const data: DreamAnalysisData = {
    title: "A dream, partially recalled",
    summary:
      "The model returned an unexpected response. The raw dream is preserved; you can re-analyze later.",
    emotions: [],
    symbols: [],
    motifs: [],
    people: [],
    locations: [],
    actions: [],
    lucidity: 0.3,
    lucidityNote: "Analysis unavailable; default lucidity applied.",
    fear: 0.2,
    uncertainty: 0.5,
    interpretations: [
      {
        text: "AI reflection could not be produced reliably this time. The original dream is still saved.",
        confidence: 0.1,
      },
    ],
    dreamLaws: [],
    relationships: [],
    historicalConnections: [],
    mood: "neutral",
  };
  return { data, raw };
}

export function fallbackTurn(): ArcadeTurnResponse {
  return {
    sceneText:
      "The dream stutters for a moment — the scene is still forming. Try describing what you do next.",
    choices: [
      { id: "continue", label: "Press onward into the dream", hint: "Move deeper" },
      { id: "observe", label: "Pause and observe your surroundings" },
    ],
    proposedDelta: { reasoning: "Model response was malformed; no state change applied." },
    discoveredMotifs: [],
  };
}

// ---------- Streaming partial-scene extractor ----------

export function extractPartialSceneText(buffer: string): { text: string; complete: boolean } {
  const key = `"sceneText"`;
  const idx = buffer.indexOf(key);
  if (idx === -1) return { text: "", complete: false };
  let i = idx + key.length;
  while (i < buffer.length && /\s/.test(buffer[i])) i++;
  if (i >= buffer.length || buffer[i] !== ":") return { text: "", complete: false };
  i++;
  while (i < buffer.length && /\s/.test(buffer[i])) i++;
  if (i >= buffer.length) return { text: "", complete: false };
  if (buffer[i] !== '"') return { text: "", complete: false };
  i++;
  let out = "";
  let complete = false;
  while (i < buffer.length) {
    const ch = buffer[i];
    if (ch === "\\") {
      if (i + 1 >= buffer.length) break;
      const next = buffer[i + 1];
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === "r") out += "\r";
      else if (next === '"') out += '"';
      else if (next === "\\") out += "\\";
      else if (next === "/") out += "/";
      else if (next === "b") out += "\b";
      else if (next === "f") out += "\f";
      else if (next === "u") {
        if (i + 5 >= buffer.length) break;
        const hex = buffer.slice(i + 2, i + 6);
        try {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } catch {
          out += next;
        }
      } else {
        out += next;
      }
      i += 2;
    } else if (ch === '"') {
      complete = true;
      break;
    } else {
      out += ch;
      i++;
    }
  }
  return { text: out, complete };
}

// ---------- SSE stream parser (OpenAI chat-completions shape) ----------

export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array> | NodeJS.ReadableStream | any
): AsyncGenerator<string> {
  const reader = (stream as any).getReader?.();
  if (!reader) {
    const iter = (stream as any)[Symbol.asyncIterator]?.();
    if (iter) {
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await iter.next();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of chunk.split("\n")) {
            const m = line.match(/^data:\s?(.*)$/);
            if (!m) continue;
            const data = m[1];
            if (data === "[DONE]") return;
            try {
              const json = JSON.parse(data);
              const delta = json?.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta) yield delta;
            } catch {
              /* skip malformed */
            }
          }
        }
      }
    }
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        const m = line.match(/^data:\s?(.*)$/);
        if (!m) continue;
        const data = m[1];
        if (data === "[DONE]") return;
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) yield delta;
        } catch {
          /* skip malformed */
        }
      }
    }
  }
}
