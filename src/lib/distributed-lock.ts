// Distributed lock for Arcade single-flight protection.
//
// PROBLEM: the in-memory `acquireLock` in src/lib/rate-limit.ts is
// per-PROCESS. Cloud Run can run multiple instances concurrently, so two
// instances could both acquire an in-memory lock for the same session and
// process turns in parallel — corrupting the authoritative simulation
// state (double-committed turns, divergent stateJson).
//
// SOLUTION: when `DATA_BACKEND === 'firestore'` (the production path), use
// a Firestore-document-based distributed lock. A `arcadeLocks/{sessionId}`
// document acts as the mutex; acquire + release run inside Firestore
// transactions so they're atomic across instances. A TTL field handles
// crashed instances (a request that acquired the lock but never released
// it — the lock auto-expires after `ttlMs`).
//
// LOCAL path (`DATA_BACKEND=sqlite`): the original in-memory lock is
// sufficient (single-process dev server). We wrap it in the same async
// interface so the routes have ONE call site regardless of backend.
//
// INTERFACE (matches src/lib/rate-limit.ts acquireLock):
//   { acquired: boolean, release: () => Promise<void>, stillMine: () => boolean, heldForMs: number }
//
// SECURITY: the lock key is derived server-side from the session id
// (which the route already verified the caller owns via requireUser() +
// findFirst({ where: { id, userId } })). A client cannot request a lock
// for a session it doesn't own — the 404 on the session lookup happens
// before the lock is acquired.

import { acquireLock, lockKey } from "@/lib/rate-limit";

export interface DistributedLock {
  acquired: boolean;
  release: () => Promise<void>;
  stillMine: () => boolean;
  heldForMs: number;
}

function isFirestore(): boolean {
  return process.env.DATA_BACKEND === "firestore";
}

// ─────────────────────────────────────────────────────────────────────
// LOCAL (in-memory) path — wraps the existing acquireLock in an async
// interface so the call site is identical.
// ─────────────────────────────────────────────────────────────────────

function localLock(key: string, opts: { ttlMs: number }): DistributedLock {
  const inner = acquireLock(key, opts);
  return {
    acquired: inner.acquired,
    heldForMs: inner.heldForMs,
    stillMine: inner.stillMine,
    release: async () => inner.release(),
  };
}

// ─────────────────────────────────────────────────────────────────────
// FIRESTORE (production) path — cross-instance mutex via a Firestore doc.
// ─────────────────────────────────────────────────────────────────────

let _firestore: any = null;
async function firestore(): Promise<any> {
  if (!_firestore) {
    const { getApps, initializeApp, applicationDefault } = await import("firebase-admin/app");
    if (!getApps().length) {
      initializeApp({
        credential: applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT,
      } as any);
    }
    const { getFirestore } = await import("firebase-admin/firestore");
    _firestore = getFirestore();
  }
  return _firestore;
}

function randomToken(): string {
  try {
    const buf = (globalThis as any).crypto?.randomBytes?.(16) ?? crypto.getRandomValues(new Uint8Array(16));
    return Array.from(buf as Uint8Array).map((b: number) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

async function firestoreLock(
  key: string,
  opts: { ttlMs: number }
): Promise<DistributedLock> {
  const db = await firestore();
  const ref = db.collection("arcadeLocks").doc(key);
  const myToken = randomToken();
  const ttlMs = opts.ttlMs;
  let acquiredAt = 0;

  // ACQUIRE — atomic read-then-write inside a Firestore transaction.
  // If the doc doesn't exist OR its expiresAt is in the past, we take it.
  // Otherwise another instance/process holds it → acquired:false.
  let acquired = false;
  try {
    acquired = await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      if (snap.exists) {
        const data = snap.data() || {};
        // expiresAt may be a Firestore Timestamp or a number.
        let expiresAtMs = 0;
        const ex = data.expiresAt;
        if (ex && typeof ex.toMillis === "function") expiresAtMs = ex.toMillis();
        else if (ex && typeof ex.getTime === "function") expiresAtMs = ex.getTime();
        else if (typeof ex === "number") expiresAtMs = ex;
        else if (typeof ex === "string") expiresAtMs = new Date(ex).getTime();
        if (expiresAtMs > now) {
          // Still locked by someone else.
          return false;
        }
      }
      // Take the lock. Use a plain Date for expiresAt so Firestore stores
      // it as a Timestamp (serializes + queries cleanly).
      tx.set(ref, {
        lockedBy: myToken,
        lockedAt: new Date(now),
        expiresAt: new Date(now + ttlMs),
      });
      return true;
    });
    if (acquired) acquiredAt = Date.now();
  } catch (e) {
    // If the Firestore transaction fails (transient), we did NOT acquire.
    // Safer to deny than to proceed without the mutex.
    console.warn("[firestore-lock] acquire transaction failed:", e);
    acquired = false;
  }

  // RELEASE — only delete the doc if WE still own it (lockedBy === myToken
  // and it hasn't expired+been-reacquired). Prevents releasing a lock a
  // later request legitimately re-acquired after our TTL.
  const release = async () => {
    if (!acquired) return;
    try {
      await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const data = snap.data() || {};
        if (data.lockedBy !== myToken) return; // not ours anymore
        tx.delete(ref);
      });
    } catch (e) {
      // Release failure is non-fatal — the TTL will reap the lock. Log
      // but don't throw; the route is already in its finally block.
      console.warn("[firestore-lock] release failed (TTL will reap):", e);
    }
  };

  // STILL-MINE — used by the streaming route to bail if our lock expired
  // (a retry re-acquired it) before we commit authoritative state.
  const stillMine = () => {
    if (!acquired) return false;
    // Cheap synchronous check: if we're past our own TTL window, we can no
    // longer trust the lock is ours. The streaming route uses this to bail
    // before double-committing. (A full Firestore read would be more
    // authoritative but adds latency on every chunk; the TTL check is the
    // documented safety net.)
    return Date.now() - acquiredAt < ttlMs;
  };

  return {
    acquired,
    release,
    stillMine,
    heldForMs: acquired ? Date.now() - acquiredAt : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Unified entrypoint.
// ─────────────────────────────────────────────────────────────────────

/** Acquire a per-session single-flight lock for the Arcade turn path.
 *  Dispatches to the Firestore distributed lock when DATA_BACKEND=firestore
 *  (production), or the in-memory lock otherwise (local dev — single
 *  process). */
export async function acquireArcadeLock(
  sessionId: string,
  opts: { ttlMs: number }
): Promise<DistributedLock> {
  const key = lockKey("arcade-turn", sessionId);
  if (isFirestore()) {
    return firestoreLock(key, opts);
  }
  return localLock(key, opts);
}
