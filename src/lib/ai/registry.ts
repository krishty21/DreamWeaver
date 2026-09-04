// AI backend abstraction (registry + interface).
//
// Two real backends implement this interface:
//   • ZAIBackend       — local dev + sandbox QA (z-ai-web-dev-sdk).
//   • GeminiBackend    — production (@google/genai directly).
// Switch via `process.env.AI_BACKEND` (`zai` | `gemini`, default `zai`).
// The Gemini backend is dynamic-imported only when needed so the local-dev
// bundle never loads @google/genai.
//
// CRITICAL PRINCIPLE preserved at this layer:
//   "MODEL OUTPUT IS NEVER TRUSTED AS APPLICATION STATE."
// Both backends use the SAME zod schemas + the SAME clamp/repair logic
// (in src/lib/ai/shared.ts). The model proposes; the app validates.

import type {
  ArcadeMode,
  ArcadeTurnResponse,
  DreamAnalysisData,
  SimulationState,
} from "@/lib/types";

export interface ArcadeTurnOpts {
  mode: ArcadeMode;
  dream: { rawText: string; analysis: any };
  state: SimulationState;
  history: { userAction: string; sceneText: string }[];
  userAction: string;
  dreamMotifs: string[];
  dreamLaws?: { law: string; evidence?: string }[];
  historicalConnections?: { motif: string; priorDreamCount: number }[];
}

export interface AIBackend {
  readonly backend: "zai" | "gemini";
  analyzeDream(
    rawText: string,
    history: { dreamId: string; date: string; motifs: string[]; summary: string }[]
  ): Promise<{ data: DreamAnalysisData; raw: string }>;
  generateArcadeTurn(opts: ArcadeTurnOpts): Promise<{ response: ArcadeTurnResponse; raw: string }>;
  generateArcadeTurnStreaming(
    opts: ArcadeTurnOpts,
    onDelta: (delta: string) => void
  ): Promise<{ response: ArcadeTurnResponse; raw: string }>;
}

let _cached: AIBackend | null = null;
let _cachedBackend: string | null = null;

/** Returns the process-wide AIBackend singleton. Switches on
 *  `process.env.AI_BACKEND` (`zai` | `gemini`, default `zai`). */
export async function getAI(): Promise<AIBackend> {
  const backend = process.env.AI_BACKEND ?? "zai";
  if (_cached && _cachedBackend === backend) return _cached;
  if (backend === "gemini") {
    const mod = await import("./gemini-backend");
    _cached = mod.getGeminiBackend();
  } else {
    const mod = await import("./zai-backend");
    _cached = mod.getZAIBackend();
  }
  _cachedBackend = backend;
  return _cached;
}
