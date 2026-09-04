import { NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ttsCacheGet, ttsCacheKey, ttsCacheSet } from "@/lib/tts-cache";

// POST /api/tts — text-to-speech for a dream.
// Receives a `text` payload (or a `dreamId` to load the dream's raw text +
// structured summary), returns a WAV audio file the client can <audio> play.
// The model speaks; it never writes back to the database.
//
// Input constraints (z-ai-web-dev-sdk):
//   - max 1024 chars per request → we chunk longer dream text into segments
//     and concatenate the resulting WAV buffers. The chunks are split on
//     sentence boundaries when possible, never mid-word.
//   - voices: tongtong, chuichui, xiaochen, jam, kazi, douji, luodo.
//     Default voice: tongtong (warm, low — a good fit for dream narration).
//   - speed: 0.5..2.0 (default 0.9 — slightly slower than conversational).
//
// r7 — pairs with voice capture (ASR). A user who woke up and spoke their
// dream into the capture field can later have the same memory read back to
// them by a calm voice — closing the loop on voice-in / voice-out.

const MAX_CHUNK = 1000; // safe under the 1024 limit, leaves room for punctuation

function splitIntoChunks(text: string, max = MAX_CHUNK): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return [clean];
  // Split on sentence boundaries, then group.
  const sentences = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [clean];
  const chunks: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length <= max) {
      cur += s;
    } else {
      if (cur) chunks.push(cur.trim());
      // If a single sentence is longer than `max`, hard-split it on word
      // boundaries so we never feed the model >1024 chars.
      if (s.length > max) {
        const words = s.split(" ");
        let buf = "";
        for (const w of words) {
          if ((buf + " " + w).length > max) {
            if (buf) chunks.push(buf.trim());
            buf = w;
          } else {
            buf = buf ? buf + " " + w : w;
          }
        }
        if (buf) cur = buf;
        else cur = "";
      } else {
        cur = s;
      }
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

// WAV header for empty + concat: we stitch the WAV files produced by the SDK
// by removing the 44-byte header from every chunk except the first, then
// re-writing the master header with the total data length. This keeps the
// output a single playable WAV rather than a brittle multipart blob.
function writeWavHeader(dataLen: number, sampleRate = 24000, bitsPerSample = 16, channels = 1): Buffer {
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
  return header;
}

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { text?: string; dreamId?: string; voice?: string; speed?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Resolve the text to speak. If a dreamId is provided, prefer the dream's
  // narratable text (title + summary + raw). Otherwise use the supplied text.
  let text = (body.text ?? "").trim();
  if (body.dreamId) {
    const dream = await db.dream.findFirst({
      where: { id: body.dreamId, userId },
      include: { analysis: true },
    });
    if (!dream) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const summary = dream.analysis?.summary?.trim() ?? "";
    const title = dream.title?.trim() ?? "";
    const raw = dream.rawText?.trim() ?? "";
    // Speak title + summary + raw, in that order. Bounded to ~4000 chars so
    // we never produce a 30-minute audio file by accident.
    const parts = [title, summary, raw].filter(Boolean);
    text = parts.join("\n\n").slice(0, 4000);
  }

  if (!text) {
    return NextResponse.json({ error: "empty_text" }, { status: 400 });
  }

  const voice = typeof body.voice === "string" ? body.voice : "tongtong";
  const speed =
    typeof body.speed === "number" && body.speed >= 0.5 && body.speed <= 2.0
      ? body.speed
      : 0.9;

  const chunks = splitIntoChunks(text);

  // r8 — server-side audio cache. Keyed by the spoken text + voice + speed so
  // a re-reflect (which changes the summary + title) invalidates correctly.
  // The first listen synthesises (~12-15s); subsequent listens return the
  // cached WAV in sub-100ms. The cache is in-memory only — restarting the
  // dev server cold-starts it.
  const cacheKey = ttsCacheKey(text, voice, speed);
  const cached = ttsCacheGet(cacheKey);
  if (cached) {
    return new NextResponse(cached, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": cached.length.toString(),
        // The browser shouldn't store the audio locally — the in-memory
        // server cache is the source of truth and a re-reflect invalidates
        // it. no-store keeps the client re-checking the server.
        "Cache-Control": "no-store",
        // Surface the cache state so the client UI can show a "cached"
        // affordance (helps the user trust that the second listen is
        // genuinely faster, not just buffered).
        "X-TTS-Cache": "hit",
      },
    });
  }

  let zai: any;
  try {
    zai = await ZAI.create();
  } catch (e: any) {
    console.error("[tts] sdk init failed:", e?.message ?? e);
    return NextResponse.json(
      { error: "tts_unavailable", message: "Voice synthesis is unavailable right now." },
      { status: 503 }
    );
  }

  try {
    const audioBuffers: Buffer[] = [];
    for (const chunk of chunks) {
      const response = await zai.audio.tts.create({
        input: chunk,
        voice,
        speed,
        response_format: "wav",
        stream: false,
      });
      const arrayBuffer = await response.arrayBuffer();
      audioBuffers.push(Buffer.from(new Uint8Array(arrayBuffer)));
    }

    // Single chunk — return as-is.
    if (audioBuffers.length === 1) {
      const out = audioBuffers[0];
      ttsCacheSet(cacheKey, out);
      return new NextResponse(out, {
        status: 200,
        headers: {
          "Content-Type": "audio/wav",
          "Content-Length": out.length.toString(),
          "Cache-Control": "no-store",
          "X-TTS-Cache": "miss",
        },
      });
    }

    // Multi-chunk — strip WAV headers from chunks 1..n and re-stitch.
    // WAV header is always 44 bytes for PCM.
    const STRIP = 44;
    const bodies = audioBuffers.map((b, i) => (i === 0 ? b.subarray(STRIP) : b.subarray(STRIP)));
    const totalLen = bodies.reduce((s, b) => s + b.length, 0);
    const header = writeWavHeader(totalLen);
    const out = Buffer.concat([header, ...bodies], header.length + totalLen);
    ttsCacheSet(cacheKey, out);
    return new NextResponse(out, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": out.length.toString(),
        "Cache-Control": "no-store",
        "X-TTS-Cache": "miss",
      },
    });
  } catch (e: any) {
    console.error("[tts] synthesis failed:", e?.message ?? e);
    return NextResponse.json(
      { error: "synthesis_failed", message: "Could not synthesise this dream. Try again later." },
      { status: 502 }
    );
  }
}
