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

// Try to extract a JSON object from a model response that may contain
// surrounding prose / code fences.
function extractJSON(text: string): any | null {
  if (!text) return null;
  // strip code fences
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // find first { ... last }
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    // maybe it's a JSON array
    const af = t.indexOf("[");
    const al = t.lastIndexOf("]");
    if (af !== -1 && al !== -1 && al > af) {
      try {
        return JSON.parse(t.slice(af, al + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
  try {
    return JSON.parse(t.slice(first, last + 1));
  } catch {
    // try to fix trailing commas
    try {
      const fixed = t
        .slice(first, last + 1)
        .replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(fixed);
    } catch {
      return null;
    }
  }
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
    .array(z.object({ text: z.string(), confidence: z.number() }))
    .max(5)
    .default([]),
  relationships: z
    .array(z.object({ from: z.string(), to: z.string(), relation: z.string() }))
    .max(10)
    .default([]),
  mood: z
    .enum(["neutral", "tense", "lucid", "melancholic", "surreal"])
    .default("neutral"),
});

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
  const raw = completion.choices?.[0]?.message?.content ?? "";

  const parsed = extractJSON(raw);
  if (!parsed) {
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
  const raw = completion.choices?.[0]?.message?.content ?? "";

  const parsed = extractJSON(raw);
  if (!parsed) {
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
