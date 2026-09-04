// DreamWeaver — Data-access abstraction layer (the contract).
//
// The Repository interface mirrors EXACTLY the Prisma-client access patterns
// the existing API routes use, so the route refactor is mechanical:
//   db.dream.findFirst({...})  →  repo.dream.findFirst({...})
//
// Two real adapters implement this contract:
//   • PrismaAdapter     — local dev + sandbox QA (SQLite). Behavior is
//                          byte-for-byte identical to the prior direct-Prisma
//                          usage; every query still scopes by userId.
//   • FirestoreAdapter  — production (firebase-admin Firestore). Enforces
//                          per-user isolation in EVERY query (composite
//                          filter `userId == sessionUserId` on all user-scoped
//                          collections). Uses Firestore transactions for
//                          multi-document atomic writes.
//
// Switch via `process.env.DATA_BACKEND` (`sqlite` | `firestore`, default
// `sqlite`). The Firestore adapter is never imported in local mode (the
// factory does a dynamic import so firebase-admin doesn't load).
//
// CRITICAL PRINCIPLE preserved at this layer:
//   "MODEL OUTPUT IS NEVER TRUSTED AS APPLICATION STATE."
// The Repository is a data-access contract only — it does not interpret model
// output. The routes + simulation.ts remain authoritative over what gets
// written. Both adapters enforce ownership scoping; a user can never retrieve
// or modify another user's records by any input.
//
// SECURITY: every method that touches a user-scoped entity (dream, motif,
// entity, entityMention, arcadeSession, sessionTurn, lexiconIgnore) requires
// `where.userId` (or `data.userId` on create) — both adapters read it from
// the args and use it as the composite filter. If the userId is missing the
// adapter throws, because the only safe assumption is "user-scoped operations
// must carry a userId." A client cannot spoof the userId: `requireUser()`
// (auth.ts) supplies it server-side from the verified session, and the
// adapter ignores any client-supplied override.

import type { PrismaClient } from "@prisma/client";

// The Repository interface is a structural subset of PrismaClient covering
// every method the routes call. Method args mirror the Prisma call shapes so
// the route refactor is a pure `db.` → `repo.` rename. The Prisma adapter
// passes through; the Firestore adapter interprets the same arg shapes.
//
// We intentionally keep the args loose (Record<string, any>) at the contract
// boundary so the Firestore adapter can interpret them without fighting
// Prisma's complex inferred types. Per-method JSDoc documents the expected
// shapes; the routes already pass exactly those shapes.

export interface UserRepo {
  /** findUnique on id or email. Args: { where: { id? | email? }, select? } */
  findUnique(args: { where: { id?: string; email?: string }; select?: Record<string, boolean> }): Promise<any>;
  /** findFirst by arbitrary where. Args: { where, select? } */
  findFirst(args: { where: Record<string, any>; select?: Record<string, boolean> }): Promise<any>;
  /** Create a user. Args: { data: { email, name?, password }, select? } */
  create(args: { data: { email: string; name?: string | null; password: string }; select?: Record<string, boolean> }): Promise<any>;
}

export interface DreamRepo {
  /** List dreams by user, with optional include. Args: { where: { userId, id?: { not?: string } }, include?, orderBy?, take? } */
  findMany(args: {
    where: { userId: string; id?: { not?: string }; shareToken?: string };
    include?: Record<string, any>;
    select?: Record<string, boolean>;
    orderBy?: { createdAt: "asc" | "desc" };
    take?: number;
  }): Promise<any[]>;
  /** Single dream by id+userId (or by shareToken for public reads). Args: { where, include?, select? } */
  findFirst(args: {
    where: { id?: string; userId?: string; shareToken?: string };
    include?: Record<string, any>;
    select?: Record<string, boolean>;
  }): Promise<any>;
  /** findUnique by id (the caller already verified ownership). Args: { where: { id }, include?, select? } */
  findUnique(args: { where: { id: string }; include?: Record<string, any>; select?: Record<string, boolean> }): Promise<any>;
  /** Create a dream. Args: { data: { userId, rawText, title, mood }, include?, select? } */
  create(args: { data: { userId: string; rawText: string; title: string; mood: string }; include?: Record<string, any>; select?: Record<string, boolean> }): Promise<any>;
  /** Update a dream. Args: { where: { id }, data: { title?, mood?, shareToken?, shareIncludeRaw?, sharedAt?, shareExpiresAt? } } */
  update(args: { where: { id: string }; data: Record<string, any> }): Promise<any>;
  /** Delete a dream + cascade (analysis, motifs, sessions, turns). Args: { where: { id } } */
  delete(args: { where: { id: string } }): Promise<any>;
  /** Count dreams by user. Args: { where: { userId } } */
  count(args: { where: { userId: string } }): Promise<number>;
}

export interface DreamAnalysisRepo {
  /** Create analysis. Args: { data: { dreamId, summary, ...Json, lucidity, fear, ... } } */
  create(args: { data: Record<string, any> }): Promise<any>;
  /** Delete analysis by dreamId. Args: { where: { dreamId: string } } */
  delete(args: { where: { dreamId: string } }): Promise<any>;
}

export interface MotifRepo {
  /** Create many motifs. Args: { data: Array<{ dreamId, userId, label, type, note?, confidence? }> } */
  createMany(args: { data: Array<Record<string, any>> }): Promise<{ count: number }>;
  /** Delete motifs by dreamId (used on re-analyze). Args: { where: { dreamId: string } } */
  deleteMany(args: { where: { dreamId: string } }): Promise<{ count: number }>;
  /** Update a motif (back-link entityId). Args: { where: { id }, data: { entityId?: string | null } } */
  update(args: { where: { id: string }; data: Record<string, any> }): Promise<any>;
  /** List motifs by user with optional include(dream). Args: { where: { userId }, include? } */
  findMany(args: { where: { userId: string }; include?: Record<string, any> }): Promise<any[]>;
  /** Count motifs by user. Args: { where: { userId: string } } */
  count(args: { where: { userId: string } }): Promise<number>;
}

export interface EntityRepo {
  /** Create a canonical entity. Args: { data: { userId, label, type, aliasesJson, mentionCount, firstSeen?, lastSeen? }, include? } */
  create(args: { data: Record<string, any>; include?: Record<string, any> }): Promise<any>;
  /** Update a canonical entity. Args: { where: { id }, data, include? } */
  update(args: { where: { id: string }; data: Record<string, any>; include?: Record<string, any> }): Promise<any>;
  /** Delete a canonical entity. Args: { where: { id: string } } */
  delete(args: { where: { id: string } }): Promise<any>;
  /** List entities by user (with optional include(mentions)). Args: { where: { userId, label?: { in?: string[] } }, include?, orderBy? } */
  findMany(args: {
    where: { userId: string; label?: { in?: string[] } };
    include?: Record<string, any>;
    orderBy?: Record<string, "asc" | "desc">;
  }): Promise<any[]>;
  /** Count entities by user. Args: { where: { userId: string } } */
  count(args: { where: { userId: string } }): Promise<number>;
}

export interface EntityMentionRepo {
  /** Create an entity mention. Args: { data: { entityId, dreamId, userId, motifId?, surfaceLabel, note?, fear, lucidity, mood, role, createdAt? } } */
  create(args: { data: Record<string, any> }): Promise<any>;
  /** Update an entity mention. Args: { where: { id }, data } */
  update(args: { where: { id: string }; data: Record<string, any> }): Promise<any>;
  /** Delete an entity mention. Args: { where: { id: string } } */
  delete(args: { where: { id: string } }): Promise<any>;
  /** List mentions by user. Args: { where: { userId }, select? } */
  findMany(args: { where: { userId: string }; select?: Record<string, boolean> }): Promise<any[]>;
  /** Count mentions by entityId. Args: { where: { entityId: string } } */
  count(args: { where: { entityId: string } }): Promise<number>;
}

export interface ArcadeSessionRepo {
  /** List sessions by user (with optional include(dream, turns)). Args: { where: { userId }, include?, orderBy? } */
  findMany(args: {
    where: { userId: string };
    include?: Record<string, any>;
    select?: Record<string, boolean>;
    orderBy?: { createdAt: "asc" | "desc" };
  }): Promise<any[]>;
  /** Single session by id+userId (or by shareToken for public reads). Args: { where, include?, select? } */
  findFirst(args: {
    where: { id?: string; userId?: string; shareToken?: string };
    include?: Record<string, any>;
    select?: Record<string, boolean>;
  }): Promise<any>;
  /** Create a session. Args: { data: { userId, dreamId, mode, status, stateJson } } */
  create(args: { data: Record<string, any> }): Promise<any>;
  /** Update a session (status, ending, stateJson, share fields). Args: { where: { id }, data } */
  update(args: { where: { id: string }; data: Record<string, any> }): Promise<any>;
  /** Delete a session + cascade turns. Args: { where: { id: string } } */
  delete(args: { where: { id: string } }): Promise<any>;
  /** Count sessions by user. Args: { where: { userId: string } } */
  count(args: { where: { userId: string } }): Promise<number>;
}

export interface SessionTurnRepo {
  /** Create a turn. Args: { data: { sessionId, turnNumber, userAction, sceneText, choicesJson, ...Json, isEnding, endingType } } */
  create(args: { data: Record<string, any> }): Promise<any>;
  /** Delete a single turn by id (compensating write on failed state update).
   *  Scoped by the session's userId is the caller's responsibility (the route
   *  already verified ownership before creating the turn). */
  delete(args: { where: { id: string } }): Promise<any>;
}

export interface LexiconIgnoreRepo {
  /** List muted words by user. Args: { where: { userId }, orderBy?, select? } */
  findMany(args: {
    where: { userId: string };
    orderBy?: { createdAt: "asc" | "desc" };
    select?: Record<string, boolean>;
  }): Promise<any[]>;
  /** Upsert a muted word (idempotent). Args: { where: { userId_word: { userId, word } }, create, update } */
  upsert(args: {
    where: { userId_word: { userId: string; word: string } };
    create: { userId: string; word: string };
    update: Record<string, any>;
  }): Promise<any>;
  /** Delete muted words by user+word. Args: { where: { userId: string; word: string } } */
  deleteMany(args: { where: { userId: string; word: string } }): Promise<{ count: number }>;
}

export interface Repository {
  readonly backend: "sqlite" | "firestore";
  user: UserRepo;
  dream: DreamRepo;
  dreamAnalysis: DreamAnalysisRepo;
  motif: MotifRepo;
  entity: EntityRepo;
  entityMention: EntityMentionRepo;
  arcadeSession: ArcadeSessionRepo;
  sessionTurn: SessionTurnRepo;
  lexiconIgnore: LexiconIgnoreRepo;
  /** Run a multi-document atomic write (e.g. dream create + analysis + motifs).
   *  Prisma adapter: db.$transaction. Firestore adapter: db.batch(). */
  tx<T>(fn: (t: Repository) => Promise<T>): Promise<T>;
}

// ---------- Factory ----------

let _cached: Repository | null = null;
let _cachedBackend: string | null = null;

/**
 * Returns the process-wide Repository singleton. Switches on
 * `process.env.DATA_BACKEND` (`sqlite` | `firestore`, default `sqlite`).
 *
 * The Firestore adapter is loaded via dynamic import so firebase-admin is
 * never pulled into the local-dev bundle (zero Google credentials needed
 * for local QA).
 */
export async function getRepository(): Promise<Repository> {
  const backend = process.env.DATA_BACKEND ?? "sqlite";
  if (_cached && _cachedBackend === backend) return _cached;

  if (backend === "firestore") {
    // Dynamic import — never loaded in local mode.
    const mod = await import("./firestore-adapter");
    _cached = mod.getFirestoreRepository();
  } else {
    // Local path: the Prisma singleton from src/lib/db.ts.
    const { PrismaAdapterImpl } = await import("./prisma-adapter");
    const { db } = await import("@/lib/db");
    _cached = new PrismaAdapterImpl(db as PrismaClient);
  }
  _cachedBackend = backend;
  return _cached;
}

/**
 * Synchronous variant for routes that have already awaited getRepository()
 * once in the request lifecycle. Returns the cached instance or throws.
 * Use only after `await getRepository()` has primed the cache.
 */
export function repositorySync(): Repository {
  if (!_cached) {
    throw new Error("repositorySync() called before getRepository() — prime the cache first");
  }
  return _cached;
}
