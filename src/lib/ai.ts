// AI service — thin entrypoint that delegates to the active AI backend.
//
// Public API preserved: `analyzeDream`, `generateArcadeTurn`,
// `generateArcadeTurnStreaming` — existing call sites
// (`import { analyzeDream, generateArcadeTurn } from '@/lib/ai'`) keep
// working unchanged. Under the hood the call is routed to whichever
// backend `process.env.AI_BACKEND` selects (`zai` for local + sandbox QA,
// `gemini` for production).
//
// CRITICAL PRINCIPLE: "MODEL OUTPUT IS NEVER TRUSTED AS APPLICATION STATE."
// Both backends use the SAME zod schemas + the SAME clamp/repair logic
// (src/lib/ai/shared.ts). The model proposes; the application validates.
// This file is a pure pass-through — it changes no behavior.

import { getAI, type ArcadeTurnOpts } from "@/lib/ai/registry";
import type {
  ArcadeTurnResponse,
  DreamAnalysisData,
} from "@/lib/types";

export async function analyzeDream(
  rawText: string,
  history: { dreamId: string; date: string; motifs: string[]; summary: string }[]
): Promise<{ data: DreamAnalysisData; raw: string }> {
  const ai = await getAI();
  return ai.analyzeDream(rawText, history);
}

export async function generateArcadeTurn(
  opts: ArcadeTurnOpts
): Promise<{ response: ArcadeTurnResponse; raw: string }> {
  const ai = await getAI();
  return ai.generateArcadeTurn(opts);
}

export async function generateArcadeTurnStreaming(
  opts: ArcadeTurnOpts,
  onDelta: (delta: string) => void
): Promise<{ response: ArcadeTurnResponse; raw: string }> {
  const ai = await getAI();
  return ai.generateArcadeTurnStreaming(opts, onDelta);
}
