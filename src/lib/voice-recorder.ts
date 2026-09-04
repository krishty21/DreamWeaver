"use client";

// VoiceRecorder — client-side microphone capture that produces a standard
// 16 kHz mono 16-bit PCM WAV (base64) for the /api/asr transcription route.
//
// Why raw WAV instead of MediaRecorder? MediaRecorder emits webm/opus, which
// many ASR backends reject; a hand-encoded WAV is universally accepted and
// lets us downsample deterministically in the browser.
//
// The recorder never touches the network or the database — it only produces
// audio. What happens with the transcript stays in the caller's control.

const TARGET_RATE = 16000;
const MAX_SECONDS = 120; // hard cap, auto-flushes the recording

export type RecordingResult = {
  base64: string;
  durationSec: number;
  sampleRate: number;
};

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private totalSamples = 0;
  private inputRate = TARGET_RATE;
  private startedAt = 0;
  private levelLoop: number | null = null;
  private onLevel: ((level: number) => void) | null = null;

  static isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof AudioContext !== "undefined"
    );
  }

  get recording(): boolean {
    return !!this.processor;
  }

  async start(opts?: { onLevel?: (level: number) => void }): Promise<void> {
    if (this.processor) return;
    if (!VoiceRecorder.isSupported()) {
      throw new Error("unsupported");
    }
    this.onLevel = opts?.onLevel ?? null;
    this.chunks = [];
    this.totalSamples = 0;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    // Prefer a 16 kHz context so no resampling is needed; fall back to the
    // device rate (Safari) and downsample on stop instead.
    try {
      this.ctx = new AudioContext({ sampleRate: TARGET_RATE });
    } catch {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.inputRate = this.ctx.sampleRate;

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.processor) return;
      const input = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(input));
      this.totalSamples += input.length;
      if (this.totalSamples / this.inputRate >= MAX_SECONDS) {
        // hard cap — UI also enforces its own limit
        this.silenceTracks();
      }
    };

    // Route through a zero-gain node so nothing is played back audibly.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.source.connect(this.processor);
    this.processor.connect(mute);
    mute.connect(this.ctx.destination);

    this.startedAt = performance.now();
    this.runLevelLoop();
  }

  private runLevelLoop() {
    const tick = () => {
      if (!this.ctx || !this.onLevel) return;
      // Cheap level estimate from the most recent chunk.
      const last = this.chunks[this.chunks.length - 1];
      if (last) {
        let sum = 0;
        for (let i = 0; i < last.length; i++) sum += last[i] * last[i];
        const rms = Math.sqrt(sum / last.length);
        // Perceptual-ish mapping: 0 → 0, ~0.25 rms → ~1
        this.onLevel(Math.min(1, rms * 4));
      }
      this.levelLoop = requestAnimationFrame(tick);
    };
    this.levelLoop = requestAnimationFrame(tick);
  }

  private silenceTracks() {
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.levelLoop !== null) cancelAnimationFrame(this.levelLoop);
    this.levelLoop = null;
    try {
      if (this.processor) this.processor.onaudioprocess = null;
      this.processor?.disconnect();
      this.source?.disconnect();
    } catch {
      /* noop */
    }
    this.processor = null;
  }

  /** Stop and return the WAV as base64. Returns null when nothing was captured. */
  async stop(): Promise<RecordingResult | null> {
    if (!this.ctx) return null;
    this.silenceTracks();
    const durationSec = this.totalSamples / this.inputRate;
    if (this.totalSamples === 0) {
      await this.ctx.close().catch(() => {});
      this.ctx = null;
      return null;
    }

    // Merge chunks.
    const merged = new Float32Array(this.totalSamples);
    let offset = 0;
    for (const c of this.chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    this.chunks = [];

    // Downsample to 16 kHz if the context ran at the device rate.
    const pcm = this.inputRate === TARGET_RATE ? merged : downsample(merged, this.inputRate, TARGET_RATE);

    const wav = encodeWav16(pcm, TARGET_RATE);
    await this.ctx.close().catch(() => {});
    this.ctx = null;
    this.onLevel = null;
    return {
      base64: uint8ToBase64(wav),
      durationSec,
      sampleRate: TARGET_RATE,
    };
  }

  /** Discard the recording without encoding. */
  async cancel(): Promise<void> {
    this.silenceTracks();
    this.chunks = [];
    this.totalSamples = 0;
    this.onLevel = null;
    if (this.ctx) {
      await this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return input;
  const ratio = from / to;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
