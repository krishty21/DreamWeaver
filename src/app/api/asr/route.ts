import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";

// POST /api/asr — speech-to-text for voice dream capture.
// Receives a base64-encoded audio file (16kHz mono WAV recorded in the browser)
// and returns the transcribed text. The model transcribes; it never writes to
// the database — the caller stays in control of the raw text.
//
// BACKEND GATING: voice capture uses the z-ai-web-dev-sdk, which is the
// LOCAL + SANDBOX QA AI backend. When AI_BACKEND=gemini (the production
// path) this route returns 503 — z-ai-web-dev-sdk is never imported at
// runtime in production (the dynamic import is gated, so the package is
// not loaded into the production server bundle's hot path). This keeps
// the production runtime free of sandbox-only SDK dependencies.
//
// (Wiring Gemini-based speech-to-text would be a new feature; this is a
// release-engineering pass, not a feature pass. The gate is the honest
// behavior: voice capture is a local-backend affordance.)

function isLocalAI(): boolean {
  return (process.env.AI_BACKEND ?? "zai") === "zai";
}

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  void userId; // ownership is enforced here; transcription itself is stateless

  if (!isLocalAI()) {
    return NextResponse.json(
      {
        error: "voice_unavailable",
        message: "Voice capture is available on the local AI backend.",
      },
      { status: 503 }
    );
  }

  let body: { audioBase64?: string };
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
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(audioBase64)) {
    return NextResponse.json({ error: "invalid_audio" }, { status: 400 });
  }

  try {
    // Dynamic import — gated by the AI_BACKEND check above. The
    // z-ai-web-dev-sdk package is only resolved+loaded when AI_BACKEND=zai
    // (local dev + sandbox QA). In production it is never imported.
    const ZAIModule = await import("z-ai-web-dev-sdk");
    const ZAI = ZAIModule.default;
    const zai = await ZAI.create();
    const response = await zai.audio.asr.create({ file_base64: audioBase64 });
    const text = typeof response?.text === "string" ? response.text.trim() : "";
    if (!text) {
      return NextResponse.json(
        { error: "empty_transcription", message: "No speech was recognised in the recording." },
        { status: 422 }
      );
    }
    return NextResponse.json({ text });
  } catch (e: any) {
    console.error("[asr] transcription failed:", e?.message ?? e);
    return NextResponse.json(
      { error: "transcription_failed", message: "Could not transcribe this recording. Try again or type instead." },
      { status: 502 }
    );
  }
}
