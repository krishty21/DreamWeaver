import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getSecret } from "@/lib/secrets";
import { GoogleGenAI } from "@google/genai";

// POST /api/asr — speech-to-text for voice dream capture using Gemini.
// Receives a base64-encoded audio file (WAV recorded in the browser) and
// returns the transcribed text.
//
// Uses Gemini's multimodal capabilities: the audio is passed as an inlineData
// Part and Gemini transcribes it. This replaces the z.ai sandbox-only backend
// so voice capture works in production.

async function getGeminiClient(): Promise<GoogleGenAI> {
  const apiKey = await getSecret("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not available");
  return new GoogleGenAI({ apiKey });
}

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  void userId; // ownership enforced above; transcription itself is stateless

  let body: { audioBase64?: string; mimeType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
  if (!audioBase64) {
    return NextResponse.json({ error: "no_audio" }, { status: 400 });
  }

  // ~8MB base64 ≈ 6MB raw ≈ 3 minutes of 16kHz mono WAV. Generous but bounded.
  if (audioBase64.length > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "audio_too_large" }, { status: 413 });
  }

  // Defensive: only standard base64 characters.
  if (!/^[A-Za-z0-9+/]+=*$/.test(audioBase64)) {
    return NextResponse.json({ error: "invalid_audio" }, { status: 400 });
  }

  const audioMimeType = (typeof body.mimeType === "string" ? body.mimeType : null) ?? "audio/wav";

  try {
    const ai = await getGeminiClient();

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: audioMimeType,
                data: audioBase64,
              },
            } as any,
            {
              text: "Transcribe exactly what is spoken in this audio recording. Output only the transcribed text with no preamble, labels, or commentary.",
            },
          ],
        },
      ],
      config: {
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0,
      } as any,
    });

    const text = (response.text ?? "").trim();
    if (!text) {
      return NextResponse.json(
        { error: "empty_transcription", message: "No speech was recognised in the recording." },
        { status: 422 }
      );
    }

    return NextResponse.json({ text });
  } catch (e: any) {
    console.error("[asr] Gemini transcription failed:", e?.message ?? e);
    return NextResponse.json(
      { error: "transcription_failed", message: "Could not transcribe this recording. Try again or type instead." },
      { status: 502 }
    );
  }
}
