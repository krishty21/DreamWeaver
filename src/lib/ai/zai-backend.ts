// z-ai-web-dev-sdk AI backend (LOCAL + SANDBOX QA path).
//
// Implements the AIBackend interface using the existing z-ai-web-dev-sdk
// chat-completions client. Uses the shared zod schemas + clamp/repair logic
// from src/lib/ai/shared.ts — behavior is byte-for-byte identical to the
// prior direct-zai usage. This is the LOCAL + SANDBOX QA path.
//
// CRITICAL PRINCIPLE: the model proposes; the application validates + clamps.
// Every parsed response goes through `analysisSchema.parse` /
// `turnSchema.parse` + the post-parse shape helpers. Malformed output
// triggers ONE repair retry, then a graceful fallback. No model number is
// ever trusted blindly; all are clamped to safe ranges.

import ZAI from "z-ai-web-dev-sdk";
import type { AIBackend, ArcadeTurnOpts } from "./registry";
import type {
  ArcadeTurnResponse,
  DreamAnalysisData,
} from "@/lib/types";
import { DREAM_ANALYSIS_PROMPT, ARCADE_SYSTEM_PROMPT } from "@/lib/prompts";
import {
  analysisSchema,
  buildArcadeResponse,
  extractJSON,
  extractPartialSceneText,
  fallbackAnalysis,
  fallbackTurn,
  brief,
  parseSSEStream,
  shapeAnalysis,
  turnSchema,
} from "./shared";

let _zai: any = null;
async function zai(): Promise<any> {
  if (!_zai) _zai = await ZAI.create();
  return _zai;
}

class ZAIBackendImpl implements AIBackend {
  readonly backend = "zai" as const;

  async analyzeDream(
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
      return fallbackAnalysis(raw);
    }
    const safe = analysisSchema.parse(parsed);
    return { data: shapeAnalysis(safe), raw };
  }

  async generateArcadeTurn(opts: ArcadeTurnOpts): Promise<{ response: ArcadeTurnResponse; raw: string }> {
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
            onDelta(text.slice(sentText.length));
            sentText = text;
          }
        }
      } else {
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
          const { text } = extractPartialSceneText(raw);
          if (text) onDelta(text);
        }
      } catch (e) {
        console.warn("[ai] streaming arcade turn repair attempt failed:", e);
      }
    }
    if (!parsed) {
      console.warn("[ai] streaming arcade turn fallback engaged. head:", brief(raw));
      const fb = fallbackTurn();
      onDelta(fb.sceneText);
      return { response: fb, raw };
    }
    const safe = turnSchema.parse(parsed);
    return { response: buildArcadeResponse(safe), raw };
  }
}

let _inst: ZAIBackendImpl | null = null;
export function getZAIBackend(): AIBackend {
  if (!_inst) _inst = new ZAIBackendImpl();
  return _inst;
}
