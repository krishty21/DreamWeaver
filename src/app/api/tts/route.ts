import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getRepository } from "@/lib/data/repository";
import { getSecret } from "@/lib/secrets";
import { GoogleGenAI } from "@google/genai";

// POST /api/tts — text-to-speech for a dream using Gemini.
// Receives a `text` payload (or a `dreamId` to load the dream's raw text +
// structured summary), returns a WAV audio file the client can <audio> play.
//
// Uses the Gemini API with responseModalities: ['AUDIO'] to synthesise speech.
// The synthesised audio is returned as a WAV audio/wav response.

const MAX_CHARS = 4000; // Gemini TTS cap

async function getGeminiClient(): Promise<GoogleGenAI> {
  const apiKey = await getSecret("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not available");
  return new GoogleGenAI({ apiKey });
}

function ttsModel(): string {
  return "gemini-2.5-flash-preview-tts";
}

// Convert a base64 PCM string from Gemini into a proper WAV buffer.
function base64PcmToWav(b64: string, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const pcm = Buffer.from(b64, "base64");
  const dataLen = pcm.length;
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcm]);
}

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { text?: string; dreamId?: string; voice?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Resolve the text to speak.
  let text = (body.text ?? "").trim();
  if (body.dreamId) {
    const db = await getRepository();
    const dream = await db.dream.findFirst({
      where: { id: body.dreamId, userId },
      include: { analysis: true },
    });
    if (!dream) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const title = dream.title?.trim() ?? "";
    const summary = dream.analysis?.summary?.trim() ?? "";
    const raw = dream.rawText?.trim() ?? "";
    text = [title, summary, raw].filter(Boolean).join("\n\n").slice(0, MAX_CHARS);
  }

  if (!text) {
    return NextResponse.json({ error: "empty_text" }, { status: 400 });
  }

  // Clamp to model limit
  text = text.slice(0, MAX_CHARS);

  try {
    const ai = await getGeminiClient();

    // Gemini TTS: use generateContent with audio response modality
    const response = await ai.models.generateContent({
      model: ttsModel(),
      contents: [{ role: "user", parts: [{ text: `Read the following dream journal entry aloud in a calm, immersive voice:\n\n${text}` }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Kore" }, // calm, measured voice
          },
        },
      } as any,
    });

    // Extract the audio part from the response
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const audioPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("audio/"));

    if (!audioPart?.inlineData?.data) {
      console.error("[tts] No audio data in Gemini response:", JSON.stringify(parts).slice(0, 200));
      return NextResponse.json(
        { error: "synthesis_failed", message: "Gemini returned no audio data." },
        { status: 502 }
      );
    }

    const mimeType: string = audioPart.inlineData.mimeType ?? "audio/wav";
    let audioBuffer: Buffer;

    if (mimeType.includes("pcm") || mimeType.includes("L16")) {
      // Raw PCM — wrap in WAV header
      audioBuffer = base64PcmToWav(audioPart.inlineData.data);
    } else {
      // Already WAV/mp3/etc
      audioBuffer = Buffer.from(audioPart.inlineData.data, "base64");
    }

    const contentType = mimeType.includes("pcm") ? "audio/wav" : mimeType;

    return new NextResponse(audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength) as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": audioBuffer.length.toString(),
        "Cache-Control": "no-store",
        "X-TTS-Cache": "miss",
        "X-TTS-Backend": "gemini",
      },
    });
  } catch (e: any) {
    console.error("[tts] Gemini synthesis failed:", e?.message ?? e);
    return NextResponse.json(
      { error: "synthesis_failed", message: "Could not synthesise this dream. Try again later." },
      { status: 502 }
    );
  }
}
