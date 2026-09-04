// Rate limiting + concurrency guard for expensive model-backed operations.
// (directive §25 CONCURRENCY, §26 RATE LIMITING / ABUSE RESISTANCE)
//
// Two complementary primitives, both in-memory (the sandbox runs a single
// process; no Redis needed):
//
//  1. rateLimit(key, opts) — sliding-window rate limiter. Returns
//     { ok, retryAfter } so the caller can 429 with a clear Retry-After.
//
//  2. concurrencyGuard(key, opts) — per-key single-flight lock. Prevents a
//     user from creating conflicting Arcade state through double-submits,
//     parallel requests, refreshes, or duplicated network calls. Returns
//     { acquired, release } (only one concurrent caller acquires; the rest
//     get acquired:false and the caller returns 409/429).
//
// Both are scoped by userId (passed in by the caller; never trusted from the
// client). Memory is bounded by a periodic sweep of stale entries.

type RateBucket = { timestamps: number[] };
const rateBuckets = new Map<string, RateBucket>();

type LockEntry = { acquiredAt: number; expiresAt: number };
const locks = new Map<string, LockEntry>();

const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = Date.now();
function maybeSweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  // prune expired locks
  for (const [k, v] of locks) {
    if (v.expiresAt <= now) locks.delete(k);
  }
  // prune empty rate buckets
  for (const [k, b] of rateBuckets) {
    b.timestamps = b.timestamps.filter((t) => t > now - 120_000);
    if (b.timestamps.length === 0) rateBuckets.delete(k);
  }
}

/** Sliding-window rate limit. `max` calls per `windowMs`. */
export function rateLimit(
  key: string,
  opts: { max: number; windowMs: number }
): { ok: boolean; retryAfterMs: number; remaining: number } {
  const now = Date.now();
  maybeSweep(now);
  const bucket = rateBuckets.get(key) ?? { timestamps: [] };
  // drop timestamps outside the window
  bucket.timestamps = bucket.timestamps.filter((t) => t > now - opts.windowMs);
  if (bucket.timestamps.length >= opts.max) {
    // oldest still-valid timestamp tells us when a slot frees up
    const oldest = bucket.timestamps[0];
    const retryAfterMs = Math.max(1000, oldest + opts.windowMs - now);
    rateBuckets.set(key, bucket);
    return { ok: false, retryAfterMs, remaining: 0 };
  }
  bucket.timestamps.push(now);
  rateBuckets.set(key, bucket);
  return { ok: true, retryAfterMs: 0, remaining: opts.max - bucket.timestamps.length };
}

/** Per-key single-flight lock. Call release() when the operation completes.
 *  Auto-expires after `ttlMs` as a safety net against crashed calls. */
export function acquireLock(
  key: string,
  opts: { ttlMs: number }
): { acquired: boolean; release: () => void; heldForMs: number } {
  const now = Date.now();
  maybeSweep(now);
  const existing = locks.get(key);
  if (existing && existing.expiresAt > now) {
    return {
      acquired: false,
      release: () => {},
      heldForMs: now - existing.acquiredAt,
    };
  }
  const entry: LockEntry = { acquiredAt: now, expiresAt: now + opts.ttlMs };
  locks.set(key, entry);
  return {
    acquired: true,
    release: () => {
      // Only delete if it's still our entry (not a newer re-acquire).
      const cur = locks.get(key);
      if (cur === entry) locks.delete(key);
    },
    heldForMs: 0,
  };
}

/** Convenience: rate-limit key builder for model-backed operations. */
export function rateKey(scope: string, userId: string) {
  return `rl:${scope}:${userId}`;
}
/** Convenience: lock key builder for per-resource single-flight. */
export function lockKey(scope: string, resourceId: string) {
  return `lk:${scope}:${resourceId}`;
}
