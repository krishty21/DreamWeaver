// AI service — Gemini stand-in via z-ai-web-dev-sdk.
// CRITICAL PRINCIPLE: "Model output is never trusted as application state."
// The model proposes; the application validates and applies. All structured
// output is parsed defensively and clamped to safe ranges before persistence.

import ZAI from "z-ai-web-dev-sdk";
import { z } from "zod";
import type {
  ArcadeMode,
  ArcadeTurnResponse,
  DreamAnalysisData,
  SimulationState,
  ProposedDelta,
} from "@/lib/types";
import { DREAM_ANALYSIS_PROMPT, ARCADE_SYSTEM_PROMPT } from "@/lib/prompts";

let _zai: any = null;
async function zai() {
  if (!_zai) _zai = await ZAI.create();
  return _zai;
}

// ---------- Helpers ----------

function clamp(n: unknown, lo = 0, hi = 1): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

// Normalize common model quirks before parsing: smart quotes, // and /* */
// comments, BOM, zero-width chars.
function normalizeJSONSource(t: string): string {
  return t
    .replace(/\uFEFF/g, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    // line comments (only outside strings — the crude strip below is safe
    // enough for model output where // almost always starts a comment)
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

// Attempt JSON.parse with progressively more aggressive repairs.
function parseWithRepairs(s: string): any | null {
  // 1. direct parse
  try {
    return JSON.parse(s);
  } catch {}

  // 2. trailing commas
  try {
    return JSON.parse(s.replace(/,\s*([}\]])/g, "$1"));
  } catch {}

  // 3. truncated output — cut back to the last value that parsed cleanly,
  //    then close any open brackets/braces.
  try {
    const repaired = repairTruncated(s.replace(/,\s*([}\]])/g, "$1"));
    if (repaired) return JSON.parse(repaired);
  } catch {}

  return null;
}

// Repair a truncated JSON document: terminate a dangling string, strip the
// tail after the last complete value if possible, then close open structures.
function repairTruncated(s: string): string | null {
  // Walk the string tracking string-state and open brackets.
  let inString = false;
  let escape = false;
  const stack: string[] = [];
  let lastSafe = -1; // index of the last "clean value boundary" outside strings
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
  if (stack.length === 0) return null; // nothing to close — not truncation-shaped

  // Cut at the last comma that sat inside an open structure (drops the
  // incomplete trailing value), unless that would discard the only content.
  let out: string;
  if (lastSafe > 0) {
    out = s.slice(0, lastSafe).replace(/[,\s]+$/, "");
  } else {
    // No safe comma boundary — keep everything; if we're mid-string,
    // terminate the string so the document can still be closed.
    out = s.replace(/[,\s]+$/, "");
    if (inString) out += '"';
  }

  // Recompute the open-structure stack on the trimmed source.
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
  if (inStr2) return null; // still malformed (e.g. stray quote) — give up
  while (stack2.length > 0) {
    const open = stack2.pop();
    out += open === "{" ? "}" : "]";
  }
  return out;
}

// Try to extract a JSON object from a model response that may contain
// surrounding prose / code fences / truncation.
function extractJSON(text: string): any | null {
  if (!text) return null;
  // strip code fences
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  t = normalizeJSONSource(t);

  const firstBrace = t.indexOf("{");
  const firstBracket = t.indexOf("[");
  // A top-level array starts before any object — try the array first.
  const arrayFirst =
    firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace);
  if (arrayFirst) {
    const lastBracket = t.lastIndexOf("]");
    const candidate =
      lastBracket > firstBracket
        ? t.slice(firstBracket, lastBracket + 1) // possibly complete array
        : t.slice(firstBracket); // truncated array (final ] dropped)
    const parsedArr = parseWithRepairs(candidate);
    if (parsedArr !== null) return parsedArr;
  }

  // Object extraction: first { ... last }, with truncation fallbacks.
  const first = firstBrace;
  const last = t.lastIndexOf("}");
  if (first === -1) return null;
  if (last > first) {
    const parsed = parseWithRepairs(t.slice(first, last + 1));
    if (parsed !== null) return parsed;
  }
  // Last resort: everything after the first { is a truncated object.
  return parseWithRepairs(t.slice(first));
}

// ---------- Dream Analysis ----------

const analysisSchema = z.object({
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
  // r12 — DREAM LAWS: recurring internal rules of the dream itself. Advisory;
  // the Arcade uses them for internal consistency, never as authoritative state.
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

function brief(raw: string): string {
  const s = JSON.stringify(raw);
  if (s.length <= 700) return s;
  // head + tail: truncation diagnosis needs the end of the response
  return `${s.slice(0, 400)} …[len ${s.length}]… ${s.slice(-260)}`;
}

export async function analyzeDream(
  rawText: string,
  history: { dreamId: string; date: string; motifs: string[]; summary: string }[]
): Promise<{ data: DreamAnalysisData; raw: string }> {
  const prompt = DREAM_ANALYSIS_PROMPT(rawText, history);
  const client = await zai();
  const completion = await client.chat.completions.create({
    messages: [
      { role: "assistant", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    thinking: { type: "disabled" },
  });
  let raw = completion.choices?.[0]?.message?.content ?? "";

  let parsed = extractJSON(raw);
  if (!parsed) {
    // One repair attempt: show the model its own invalid output and ask for
    // strict JSON only. Much cheaper for the user than losing the analysis.
    console.warn("[ai] analysis response was not parseable JSON — retrying once. head:", brief(raw));
    try {
      const retry = await client.chat.completions.create({
        messages: [
          { role: "assistant", content: prompt.system },
          { role: "user", content: prompt.user },
          { role: "assistant", content: raw.slice(0, 6000) },
          {
            role: "user",
            content:
              "Your previous response was not valid JSON (it may have contained prose, markdown, or was truncated). Return ONLY the JSON object — no prose, no code fences, no commentary. If some fields must be empty, use empty arrays or zero.",
          },
        ],
        thinking: { type: "disabled" },
      });
      raw = retry.choices?.[0]?.message?.content ?? "";
      parsed = extractJSON(raw);
    } catch (e) {
      console.warn("[ai] analysis repair attempt failed:", e);
    }
  }
  if (!parsed) {
    console.warn("[ai] analysis fallback engaged. head:", brief(raw));
    // graceful fallback — never let a malformed model response crash the app
    const fallback: DreamAnalysisData = {
      title: "A dream, partially recalled",
      summary: "The model returned an unexpected response. The raw dream is preserved; you can re-analyze later.",
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
    return { data: fallback, raw };
  }

  const safe = analysisSchema.parse(parsed);

  // normalise + clamp (never trust model numbers blindly)
  const data: DreamAnalysisData = {
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
    historicalConnections: [], // computed app-side (authoritative), not from model
    mood: safe.mood,
  };

  return { data, raw };
}

// ---------- Arcade ----------

const turnSchema = z.object({
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

export async function generateArcadeTurn(opts: {
  mode: ArcadeMode;
  dream: { rawText: string; analysis: any };
  state: SimulationState;
  history: { userAction: string; sceneText: string }[];
  userAction: string;
  dreamMotifs: string[];
  // r12 — Dream Laws: recurring internal rules of the source dream, passed
  // to the model for internal consistency (advisory; never authoritative).
  dreamLaws?: { law: string; evidence?: string }[];
  // r12 — Historical connections: motifs in this dream that also appear in
  // prior dreams. The model may naturally reference them; the app decides
  // whether to surface a MEMORY ECHO notice (never the model).
  historicalConnections?: { motif: string; priorDreamCount: number }[];
}): Promise<{ response: ArcadeTurnResponse; raw: string }> {
  const prompt = ARCADE_SYSTEM_PROMPT(opts);
  const client = await zai();
  const completion = await client.chat.completions.create({
    messages: [
      { role: "assistant", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    thinking: { type: "disabled" },
  });
  let raw = completion.choices?.[0]?.message?.content ?? "";

  let parsed = extractJSON(raw);
  if (!parsed) {
    // One repair attempt: show the model its invalid output, ask for strict JSON.
    // Without this a single malformed response burns a turn of the simulation.
    console.warn("[ai] arcade turn response was not parseable JSON — retrying once. head:", brief(raw));
    try {
      const retry = await client.chat.completions.create({
        messages: [
          { role: "assistant", content: prompt.system },
          { role: "user", content: prompt.user },
          { role: "assistant", content: raw.slice(0, 6000) },
          {
            role: "user",
            content:
              "Your previous response was not valid JSON. Return ONLY the JSON object matching the schema — no prose, no code fences. Keep sceneText vivid but finish the object.",
          },
        ],
        thinking: { type: "disabled" },
      });
      raw = retry.choices?.[0]?.message?.content ?? "";
      parsed = extractJSON(raw);
    } catch (e) {
      console.warn("[ai] arcade turn repair attempt failed:", e);
    }
  }
  if (!parsed) {
    console.warn("[ai] arcade turn fallback engaged. head:", brief(raw));
    // graceful fallback: a minimal, neutral turn so the session never hard-crashes
    const fallback: ArcadeTurnResponse = {
      sceneText:
        "The dream stutters for a moment — the scene is still forming. Try describing what you do next.",
      choices: [
        { id: "continue", label: "Press onward into the dream", hint: "Move deeper" },
        { id: "observe", label: "Pause and observe your surroundings" },
      ],
      proposedDelta: { reasoning: "Model response was malformed; no state change applied." },
      discoveredMotifs: [],
    };
    return { response: fallback, raw };
  }

  const safe = turnSchema.parse(parsed);

  const response: ArcadeTurnResponse = {
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

  return { response, raw };
}

function clampDelta(d: any): ProposedDelta {
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

// ---------- Streaming arcade turn (r6) ----------
//
// Streams the model's sceneText to the client as it is produced. The SDK
// returns the raw fetch Response.body (a ReadableStream) when stream:true
// is requested AND the server responds with text/event-stream; otherwise it
// returns the parsed JSON (we fall back to a single delta emit).
//
// The model emits the response as a JSON object whose first field is
// `sceneText`. As chunks arrive we incrementally extract the partial
// sceneText from the partial JSON buffer (handling escapes) and emit each
// newly-completed slice via onDelta. The complete JSON is parsed at end
// and the structured response returned, exactly like generateArcadeTurn.

function buildArcadeResponse(safe: z.infer<typeof turnSchema>): ArcadeTurnResponse {
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

// Extract the partial sceneText value from a partial JSON buffer.
// Returns { text, complete } where complete=true if the closing quote was seen.
function extractPartialSceneText(buffer: string): { text: string; complete: boolean } {
  const key = `"sceneText"`;
  const idx = buffer.indexOf(key);
  if (idx === -1) return { text: "", complete: false };

  // skip whitespace
  let i = idx + key.length;
  while (i < buffer.length && /\s/.test(buffer[i])) i++;
  if (i >= buffer.length || buffer[i] !== ":") return { text: "", complete: false };
  i++;
  while (i < buffer.length && /\s/.test(buffer[i])) i++;
  if (i >= buffer.length) return { text: "", complete: false };
  if (buffer[i] !== '"') return { text: "", complete: false };

  // string content
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

// Parse an SSE stream (text/event-stream) and yield content deltas.
// Tolerates \n\n and \r\n\r\n separators; ignores keep-alive lines.
async function* parseSSEStream(
  stream: ReadableStream<Uint8Array> | NodeJS.ReadableStream | any
): AsyncGenerator<string> {
  const reader = (stream as any).getReader?.();
  if (!reader) {
    // Node stream fallback
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
              // skip malformed
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
          // skip malformed
        }
      }
    }
  }
}

export async function generateArcadeTurnStreaming(
  opts: {
    mode: ArcadeMode;
    dream: { rawText: string; analysis: any };
    state: SimulationState;
    history: { userAction: string; sceneText: string }[];
    userAction: string;
    dreamMotifs: string[];
    dreamLaws?: { law: string; evidence?: string }[];
    historicalConnections?: { motif: string; priorDreamCount: number }[];
  },
  onDelta: (delta: string) => void
): Promise<{ response: ArcadeTurnResponse; raw: string }> {
  const prompt = ARCADE_SYSTEM_PROMPT(opts);
  const client = await zai();

  let raw = "";
  try {
    const completion = await client.chat.completions.create({
      messages: [
        { role: "assistant", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      stream: true,
      thinking: { type: "disabled" },
    });

    // The SDK returns response.body (ReadableStream) when stream:true and
    // text/event-stream; otherwise returns parsed JSON.
    const stream =
      completion && (completion.body instanceof ReadableStream
        ? completion.body
        : completion instanceof ReadableStream
        ? completion
        : null);

    if (stream) {
      let sentText = "";
      for await (const delta of parseSSEStream(stream)) {
        raw += delta;
        const { text } = extractPartialSceneText(raw);
        if (text.length > sentText.length) {
          // emit only the newly completed slice
          onDelta(text.slice(sentText.length));
          sentText = text;
        }
      }
    } else {
      // non-streaming fallback (server didn't honour stream:true)
      raw = completion?.choices?.[0]?.message?.content ?? "";
      const { text } = extractPartialSceneText(raw);
      if (text) onDelta(text);
    }
  } catch (e) {
    console.warn("[ai] arcade streaming turn failed:", e);
    throw e;
  }

  let parsed = extractJSON(raw);
  if (!parsed) {
    // One repair attempt with non-streaming
    console.warn("[ai] streaming arcade turn JSON unparseable — retrying once. head:", brief(raw));
    try {
      const retry = await client.chat.completions.create({
        messages: [
          { role: "assistant", content: prompt.system },
          { role: "user", content: prompt.user },
          { role: "assistant", content: raw.slice(0, 6000) },
          {
            role: "user",
            content:
              "Your previous response was not valid JSON. Return ONLY the JSON object matching the schema — no prose, no code fences. Keep sceneText vivid but finish the object.",
          },
        ],
        thinking: { type: "disabled" },
      });
      raw = retry?.choices?.[0]?.message?.content ?? "";
      parsed = extractJSON(raw);
      if (parsed) {
        // emit the repaired sceneText in one chunk so the client catches up
        const { text } = extractPartialSceneText(raw);
        if (text) onDelta(text);
      }
    } catch (e) {
      console.warn("[ai] streaming arcade turn repair attempt failed:", e);
    }
  }
  if (!parsed) {
    console.warn("[ai] streaming arcade turn fallback engaged. head:", brief(raw));
    const fallback: ArcadeTurnResponse = {
      sceneText:
        "The dream stutters for a moment — the scene is still forming. Try describing what you do next.",
      choices: [
        { id: "continue", label: "Press onward into the dream", hint: "Move deeper" },
        { id: "observe", label: "Pause and observe your surroundings" },
      ],
      proposedDelta: { reasoning: "Model response was malformed; no state change applied." },
      discoveredMotifs: [],
    };
    onDelta(fallback.sceneText);
    return { response: fallback, raw };
  }

  const safe = turnSchema.parse(parsed);
  const response = buildArcadeResponse(safe);
  return { response, raw };
}
