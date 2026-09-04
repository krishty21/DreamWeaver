// r8 — server-side in-memory LRU cache for synthesised TTS audio.
//
// TTS synthesis (Gemini) takes 12-15s for a typical dream. The result is
// deterministic for a given (text, voice, speed) tuple — but the spoken
// text (title + summary + raw) can change after a re-reflect (the analysis
// summary and the dream title are both replaced). So the cache key MUST
// incorporate a hash of the actual text being spoken, not just the dreamId.
// We use a fast non-cryptographic hash (FNV-1a, 32-bit) — its only job is
// to detect that the text changed; collisions at 32 bits are vanishingly
// rare for natural-language dream text and the worst case is a re-synth.
//
// Bounded: max 32 entries. Each entry is a Buffer (200-400KB for a typical
// dream). Total memory ceiling ≈ 12MB. LRU eviction when full.
//
// Pure in-memory — no Redis, no DB. Sandbox-friendly. Survives a single dev
// server lifetime. If the dev server restarts, the cache cold-starts (the
// first listen after restart re-synthesises), which is acceptable.

type Entry = {
  buffer: Buffer;
  size: number;
};

const MAX_ENTRIES = 32;

// Map preserves insertion order. Re-inserting on read moves the entry to the
// end → the oldest entry at the head is the LRU victim.
const store = new Map<string, Entry>();

let stats = { hits: 0, misses: 0, evictions: 0 };

// FNV-1a 32-bit. Returns the hash as a base36 string so it's safe in a key
// without delimiters colliding. Fast and dependency-free.
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // JavaScript's bitwise ops are 32-bit; the multiply is mod 2^32 by
    // default on the ToInt32 conversion. We add `>>> 0` to coerce to
    // unsigned.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// Build a cache key from the spoken text + voice + speed. The dreamId is
// included for traceability in logs/debug but doesn't affect identity —
// the text hash is what detects a re-reflect.
export function ttsCacheKey(spokenText: string, voice: string, speed: number): string {
  return `tts:${fnv1a(spokenText)}::${voice}::${speed.toFixed(2)}`;
}

export function ttsCacheGet(key: string): Buffer | null {
  const entry = store.get(key);
  if (!entry) {
    stats.misses += 1;
    return null;
  }
  // Touch: delete + re-insert moves the entry to the end (most-recently-used).
  store.delete(key);
  store.set(key, entry);
  stats.hits += 1;
  return entry.buffer;
}

export function ttsCacheSet(key: string, buffer: Buffer): void {
  // If the entry already exists, just replace + touch.
  if (store.has(key)) {
    store.delete(key);
  }
  store.set(key, { buffer, size: buffer.length });
  // Evict oldest (head of Map) while over capacity.
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
    stats.evictions += 1;
  }
}

export function ttsCacheStats() {
  return { ...stats, size: store.size, max: MAX_ENTRIES };
}

// Test-only: reset the cache + stats (used by lint-clean helpers, not by app
// code). Exported so future tests can reset between cases without restarting
// the process.
export function __ttsCacheReset(): void {
  store.clear();
  stats = { hits: 0, misses: 0, evictions: 0 };
}
