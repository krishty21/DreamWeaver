// @google/genai (Gemini direct) AI backend — PRODUCTION path.
//
// Implements the SAME AIBackend interface as the zai backend using the
// official `@google/genai` SDK. Loaded ONLY when
// `process.env.AI_BACKEND === 'gemini'`; otherwise never imported.
//
// Replicates the SAME prompt engineering (injection-fenced UNTRUSTED
// CONTENT blocks), the SAME zod schemas, the SAME repair+retry on malformed
// JSON, the SAME clamping. The model proposes; the app validates. Both
// backends are behaviorally interchangeable from the routes' perspective.
//
// INITIALIZATION: the API key is fetched from `getSecret('GEMINI_API_KEY')`
// (see src/lib/secrets.ts). In production that resolves via Google Cloud
// Secret Manager; in local-env mode it reads `process.env.GEMINI_API_KEY`.
// The key is server-only — never shipped to the client.
//
// MODEL: a current Gemini model (`gemini-2.5-flash` by default; override
// with GEMINI_MODEL env). Generates structured JSON with
// `responseMimeType: 'application/json'` so the SDK coerces the response
// into well-formed JSON without prose wrapping.

import { GoogleGenAI } from "@google/genai";
import type { AIBackend, ArcadeTurnOpts } from "./registry";
import type { ArcadeTurnResponse, DreamAnalysisData } from "@/lib/types";
import { DREAM_ANALYSIS_PROMPT, ARCADE_SYSTEM_PROMPT } from "@/lib/prompts";
import { getSecret } from "@/lib/secrets";
import {
  analysisSchema,
  buildArcadeResponse,
  extractJSON,
  extractPartialSceneText,
  fallbackAnalysis,
  fallbackTurn,
  brief,
  shapeAnalysis,
  turnSchema,
} from "./shared";

let _client: GoogleGenAI | null = null;

async function client(): Promise<GoogleGenAI> {
  if (_client) return _client;
  const apiKey = await getSecret("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error(
      "[gemini-backend] GEMINI_API_KEY not available via getSecret() — set GEMINI_API_KEY env or configure Secret Manager access"
    );
  }
  _client = new GoogleGenAI({ apiKey });
  return _client;
}

function model(): string {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

function repairContents(originalPrompt: string, raw: string, instruction: string) {
  return [
    { role: "user", parts: [{ text: originalPrompt }] },
    { role: "model", parts: [{ text: raw.slice(0, 6000) }] },
    { role: "user", parts: [{ text: instruction }] },
  ];
}

class GeminiBackendImpl implements AIBackend {
  readonly backend = "gemini" as const;

  async analyzeDream(
    rawText: string,
    history: { dreamId: string; date: string; motifs: string[]; summary: string }[]
  ): Promise<{ data: DreamAnalysisData; raw: string }> {
    const prompt = DREAM_ANALYSIS_PROMPT(rawText, history);
    const ai = await client();
    let raw = "";

    try {
      const response = await ai.models.generateContent({
        model: model(),
        contents: prompt.user,
        config: {
          systemInstruction: prompt.system,
          // Force JSON-only output — no prose wrapping, no markdown fences.
          responseMimeType: "application/json",
          // Disable Gemini's "thinking" surface (we want the JSON directly).
          // The genai SDK config field for this is `thinkingConfig`.
          thinkingConfig: { thinkingBudget: 0 },
          temperature: 0.7,
        },
      });
      raw = response.text ?? "";
    } catch (e) {
      console.warn("[gemini] analyzeDream first attempt failed:", e);
      throw e;
    }

    let parsed = extractJSON(raw);
    if (!parsed) {
      console.warn("[gemini] analysis response was not parseable JSON — retrying once. head:", brief(raw));
      try {
        const retry = await ai.models.generateContent({
          model: model(),
          contents: repairContents(
            prompt.user,
            raw,
            "Your previous response was not valid JSON (it may have contained prose, markdown, or was truncated). Return ONLY the JSON object — no prose, no code fences, no commentary. If some fields must be empty, use empty arrays or zero."
          ),
          config: {
            systemInstruction: prompt.system,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 },
            temperature: 0.5,
          },
        });
        raw = retry.text ?? "";
        parsed = extractJSON(raw);
      } catch (e) {
        console.warn("[gemini] analysis repair attempt failed:", e);
      }
    }
    if (!parsed) {
      console.warn("[gemini] analysis fallback engaged. head:", brief(raw));
      return fallbackAnalysis(raw);
    }
    const safe = analysisSchema.parse(parsed);
    return { data: shapeAnalysis(safe), raw };
  }

  async generateArcadeTurn(opts: ArcadeTurnOpts): Promise<{ response: ArcadeTurnResponse; raw: string }> {
    const prompt = ARCADE_SYSTEM_PROMPT(opts);
    const ai = await client();
    const response = await ai.models.generateContent({
      model: model(),
      contents: prompt.user,
      config: {
        systemInstruction: prompt.system,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0.85,
      },
    });
    let raw = response.text ?? "";

    let parsed = extractJSON(raw);
    if (!parsed) {
      console.warn("[gemini] arcade turn response was not parseable JSON — retrying once. head:", brief(raw));
      try {
        const retry = await ai.models.generateContent({
          model: model(),
          contents: repairContents(
            prompt.user,
            raw,
            "Your previous response was not valid JSON. Return ONLY the JSON object matching the schema — no prose, no code fences. Keep sceneText vivid but finish the object."
          ),
          config: {
            systemInstruction: prompt.system,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 },
            temperature: 0.6,
          },
        });
        raw = retry.text ?? "";
        parsed = extractJSON(raw);
      } catch (e) {
        console.warn("[gemini] arcade turn repair attempt failed:", e);
      }
    }
    if (!parsed) {
      console.warn("[gemini] arcade turn fallback engaged. head:", brief(raw));
      return { response: fallbackTurn(), raw };
    }
    const safe = turnSchema.parse(parsed);
    return { response: buildArcadeResponse(safe), raw };
  }

  async generateArcadeTurnStreaming(
    opts: ArcadeTurnOpts,
    onDelta: (delta: string) => void
  ): Promise<{ response: ArcadeTurnResponse; raw: string }> {
    const prompt = ARCADE_SYSTEM_PROMPT(opts);
    const ai = await client();
    let raw = "";

    try {
      const streamResponse = await ai.models.generateContentStream({
        model: model(),
        contents: prompt.user,
        config: {
          systemInstruction: prompt.system,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
          temperature: 0.85,
        },
      });

      let sentText = "";
      for await (const chunk of streamResponse) {
        const delta = chunk.text ?? "";
        if (!delta) continue;
        raw += delta;
        const { text } = extractPartialSceneText(raw);
        if (text.length > sentText.length) {
          onDelta(text.slice(sentText.length));
          sentText = text;
        }
      }
    } catch (e) {
      console.warn("[gemini] arcade streaming turn failed:", e);
      throw e;
    }

    let parsed = extractJSON(raw);
    if (!parsed) {
      console.warn("[gemini] streaming arcade turn JSON unparseable — retrying once. head:", brief(raw));
      try {
        const retry = await ai.models.generateContent({
          model: model(),
          contents: repairContents(
            prompt.user,
            raw,
            "Your previous response was not valid JSON. Return ONLY the JSON object matching the schema — no prose, no code fences. Keep sceneText vivid but finish the object."
          ),
          config: {
            systemInstruction: prompt.system,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 },
            temperature: 0.6,
          },
        });
        raw = retry.text ?? "";
        parsed = extractJSON(raw);
        if (parsed) {
          const { text } = extractPartialSceneText(raw);
          if (text) onDelta(text);
        }
      } catch (e) {
        console.warn("[gemini] streaming arcade turn repair attempt failed:", e);
      }
    }
    if (!parsed) {
      console.warn("[gemini] streaming arcade turn fallback engaged. head:", brief(raw));
      const fb = fallbackTurn();
      onDelta(fb.sceneText);
      return { response: fb, raw };
    }
    const safe = turnSchema.parse(parsed);
    return { response: buildArcadeResponse(safe), raw };
  }
}

let _inst: GeminiBackendImpl | null = null;
export function getGeminiBackend(): AIBackend {
  if (!_inst) _inst = new GeminiBackendImpl();
  return _inst;
}
