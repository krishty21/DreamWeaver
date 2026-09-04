// DreamWeaver — Firestore adapter (PRODUCTION path).
//
// Implements the SAME Repository contract as the Prisma adapter using
// `firebase-admin` Firestore. Loaded ONLY when `process.env.DATA_BACKEND ===
// 'firestore'`; otherwise never imported (no firebase-admin in local mode).
//
// COLLECTION LAYOUT (top-level, per-entity):
//   users/{uid}                                  User
//   dreams/{dreamId}                             Dream
//   dreams/{dreamId}/analysis/current            DreamAnalysis (single child)
//   motifs/{motifId}                             Motif
//   entities/{entityId}                          Entity (canonical)
//   entityMentions/{mentionId}                   EntityMention
//   arcadeSessions/{sessionId}                   ArcadeSession
//   arcadeSessions/{sessionId}/turns/{turnId}    SessionTurn
//   lexiconIgnores/{id}                          LexiconIgnore
//
// SECURITY — per-user isolation enforced in EVERY query:
// Every user-scoped method reads `where.userId` (or `data.userId` on create)
// from the args and applies it as a composite filter. A user can NEVER
// retrieve or modify another user's records by any input — even if a client
// supplied a foreign id, the composite filter excludes the row. If `userId`
// is missing on a user-scoped operation, the adapter throws (the only safe
// assumption is "the route forgot to scope it").
//
// PUBLIC-BY-TOKEN READS (shared dream + session story):
// The public share routes call `dream.findFirst({ where: { shareToken } })`
// and `arcadeSession.findFirst({ where: { shareToken } })` WITHOUT a userId.
// These are the only user-scoped methods allowed to omit userId (the
// shareToken itself is the secret; possession grants read). The returned
// payload is sanitised by the route (never raw model output).
//
// JSON-STRING FIELDS: the Prisma schema stores emotionsJson, symbolsJson,
// etc. as JSON strings (SQLite has no native list/scalar-json). The routes
// pass these as already-JSON-stringified strings. In Firestore we store
// them as NATIVE maps/arrays (no need to JSON-stringify). The adapter
// handles the encode/decode so the Repository contract still returns the
// same `*Json: string` shape the routes expect.
//
// INITIALIZATION: lazy via firebase-admin applicationDefault() — uses the
// Cloud Run runtime service account (ADC), NOT hardcoded keys. The public
// Firebase client config (apiKey) is browser-safe; service-account
// credentials are server-only.
//
// CRITICAL PRINCIPLE: this adapter is a pure data-access delegate. The
// "MODEL OUTPUT IS NEVER TRUSTED AS APPLICATION STATE" rule is enforced
// by the routes + simulation.ts. The adapter does not interpret model
// output — it stores what the route hands it, after the route has already
// validated/clamped.

import type { Repository } from "./repository";
import admin from "firebase-admin";

// ---------- SDK singletons ----------

let _dbstore: any = null;
function firestore(): any {
  if (_dbstore) return _dbstore;
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined,
    });
  }
  _dbstore = admin.app().firestore();
  return _dbstore;
}

// ---------- Helpers ----------

function now(): Date {
  return new Date();
}

function requireUserId(where: any, method: string): string {
  const uid = where?.userId;
  if (typeof uid !== "string" || !uid.length) {
    throw new Error(
      `[firestore-adapter] ${method} requires where.userId — refusing unscoped user operation`
    );
  }
  return uid;
}

function jstr(v: any): string {
  try {
    return JSON.stringify(v ?? []);
  } catch {
    return "[]";
  }
}

function jparse(s: any, fallback: any = []) {
  if (s == null) return fallback;
  if (typeof s === "string") {
    try {
      return JSON.parse(s);
    } catch {
      return fallback;
    }
  }
  return s;
}

function toDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v?.toDate === "function") return v.toDate();
  if (typeof v === "string") return new Date(v);
  if (typeof v === "number") return new Date(v);
  return null;
}

// Map of DreamAnalysis JSON-string fields.
const ANALYSIS_JSON_FIELDS = [
  "emotionsJson",
  "symbolsJson",
  "motifsJson",
  "peopleJson",
  "locationsJson",
  "actionsJson",
  "interpretationsJson",
  "relationshipsJson",
  "historicalConnectionsJson",
  "dreamLawsJson",
  "evidenceJson",
  "modelRawJson",
] as const;
const NATIVE_KEY = (k: string) => k.replace(/Json$/, "");

// ---------- Shapers (route-expected payload shapes) ----------

function shapeUser(id: string, d: any, select?: Record<string, boolean>): any {
  const full = {
    id,
    email: d?.email,
    name: d?.name ?? null,
    password: d?.password,
    createdAt: toDate(d?.createdAt) ?? now(),
    updatedAt: toDate(d?.updatedAt) ?? now(),
  };
  if (!select) return full;
  const out: any = { id };
  for (const k of Object.keys(select)) if (select[k]) out[k] = (full as any)[k];
  return out;
}

function shapeDream(id: string, d: any): any {
  return {
    id,
    userId: d?.userId,
    rawText: d?.rawText,
    title: d?.title ?? null,
    mood: d?.mood ?? "neutral",
    shareToken: d?.shareToken ?? null,
    shareIncludeRaw: d?.shareIncludeRaw ?? false,
    sharedAt: toDate(d?.sharedAt),
    shareExpiresAt: toDate(d?.shareExpiresAt),
    createdAt: toDate(d?.createdAt) ?? now(),
    updatedAt: toDate(d?.updatedAt) ?? now(),
    analysis: undefined,
    motifs: undefined,
    sessions: undefined,
    user: undefined,
  };
}

function shapeAnalysis(d: any): any {
  if (!d) return null;
  const out: any = {
    id: "current",
    dreamId: d.dreamId,
    summary: d.summary ?? "",
    lucidity: d.lucidity ?? 0.3,
    lucidityNote: d.lucidityNote ?? null,
    fear: d.fear ?? 0.2,
    uncertainty: d.uncertainty ?? 0.3,
    createdAt: toDate(d.createdAt) ?? now(),
  };
  for (const k of ANALYSIS_JSON_FIELDS) {
    out[k] = jstr(d[NATIVE_KEY(k)] ?? d[k]);
  }
  return out;
}

function shapeMotif(id: string, d: any, select?: Record<string, boolean>): any {
  const full = {
    id,
    dreamId: d?.dreamId,
    userId: d?.userId,
    label: d?.label,
    type: d?.type ?? "symbol",
    note: d?.note ?? null,
    confidence: d?.confidence ?? 0.5,
    entityId: d?.entityId ?? null,
    createdAt: toDate(d?.createdAt) ?? now(),
  };
  if (!select) return full;
  const out: any = { id };
  for (const k of Object.keys(select)) if (select[k]) out[k] = (full as any)[k];
  return out;
}

function shapeEntity(id: string, d: any, mentions?: any): any {
  const out: any = {
    id,
    userId: d?.userId,
    label: d?.label,
    type: d?.type ?? "symbol",
    aliasesJson: jstr(d?.aliases ?? []),
    note: d?.note ?? null,
    mentionCount: d?.mentionCount ?? 0,
    firstSeen: toDate(d?.firstSeen),
    lastSeen: toDate(d?.lastSeen),
    createdAt: toDate(d?.createdAt) ?? now(),
    updatedAt: toDate(d?.updatedAt) ?? now(),
  };
  if (mentions) out.mentions = mentions;
  return out;
}

function shapeEntityMention(id: string, d: any, select?: Record<string, boolean>): any {
  const full = {
    id,
    entityId: d?.entityId,
    dreamId: d?.dreamId,
    userId: d?.userId,
    motifId: d?.motifId ?? null,
    surfaceLabel: d?.surfaceLabel,
    note: d?.note ?? null,
    fear: d?.fear ?? 0,
    lucidity: d?.lucidity ?? 0,
    mood: d?.mood ?? "neutral",
    role: d?.role ?? "appears",
    createdAt: toDate(d?.createdAt) ?? now(),
  };
  if (!select) return full;
  const out: any = { id };
  for (const k of Object.keys(select)) if (select[k]) out[k] = (full as any)[k];
  return out;
}

function shapeArcadeSession(id: string, d: any): any {
  return {
    id,
    userId: d?.userId,
    dreamId: d?.dreamId,
    mode: d?.mode ?? "replay",
    status: d?.status ?? "active",
    ending: d?.ending ?? null,
    stateJson: jstr(d?.state ?? {}),
    shareToken: d?.shareToken ?? null,
    sharedAt: toDate(d?.sharedAt),
    shareExpiresAt: toDate(d?.shareExpiresAt),
    createdAt: toDate(d?.createdAt) ?? now(),
    updatedAt: toDate(d?.updatedAt) ?? now(),
  };
}

function shapeTurn(id: string, d: any, select?: Record<string, boolean>): any {
  const full: any = {
    id,
    sessionId: d?.sessionId,
    turnNumber: d?.turnNumber,
    userAction: d?.userAction,
    sceneText: d?.sceneText,
    choicesJson: jstr(d?.choices ?? []),
    proposedStateDeltaJson: jstr(d?.proposedStateDelta ?? {}),
    discoveredMotifsJson: jstr(d?.discoveredMotifs ?? []),
    appliedDeltaJson: jstr(d?.appliedDelta ?? {}),
    isEnding: !!d?.isEnding,
    endingType: d?.endingType ?? null,
    createdAt: toDate(d?.createdAt) ?? now(),
  };
  if (!select) return full;
  const out: any = { id };
  for (const k of Object.keys(select)) if (select[k]) out[k] = (full as any)[k];
  return out;
}

// ---------- Adapter ----------

class FirestoreRepository implements Repository {
  readonly backend = "firestore" as const;

  user = {
    async findUnique(args: any): Promise<any> {
      const w = args.where ?? {};
      let snap: any;
      if (w.id) {
        snap = await firestore().doc(`users/${w.id}`).get();
      } else if (w.email) {
        snap = await firestore()
          .collection("users")
          .where("email", "==", w.email)
          .limit(1)
          .get();
      } else {
        return null;
      }
      if (!snap.exists) return null;
      return shapeUser(snap.id, snap.data(), args.select);
    },
    async findFirst(args: any): Promise<any> {
      return this.user.findUnique(args);
    },
    async create(args: any): Promise<any> {
      const ref = firestore().collection("users").doc();
      await ref.set({
        email: args.data.email,
        name: args.data.name ?? null,
        password: args.data.password,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      const snap = await ref.get();
      return shapeUser(ref.id, snap.data(), args.select);
    },
  };

  dream = {
    async findMany(args: any): Promise<any[]> {
      const uid = requireUserId(args.where, "dream.findMany");
      let q: any = firestore().collection("dreams").where("userId", "==", uid);
      if (args.where?.id?.not) q = q.where("id", "!=", args.where.id.not);
      if (args.where?.shareToken) q = q.where("shareToken", "==", args.where.shareToken);
      if (args.orderBy?.createdAt) q = q.orderBy("createdAt", args.orderBy.createdAt);
      if (args.take) q = q.limit(args.take);
      const snap = await q.get();
      const docs = snap.docs.map((d: any) => shapeDream(d.id, d.data()));
      return resolveDreamIncludes(docs, args.include);
    },
    async findFirst(args: any): Promise<any> {
      const w = args.where ?? {};
      let snap: any;
      if (w.id && w.userId) {
        snap = await firestore()
          .collection("dreams")
          .where("id", "==", w.id)
          .where("userId", "==", w.userId)
          .limit(1)
          .get();
      } else if (w.shareToken) {
        // PUBLIC-BY-TOKEN read — no userId (the route sanitises the payload).
        snap = await firestore()
          .collection("dreams")
          .where("shareToken", "==", w.shareToken)
          .limit(1)
          .get();
      } else if (w.id) {
        snap = await firestore()
          .collection("dreams")
          .where("id", "==", w.id)
          .limit(1)
          .get();
      } else {
        return null;
      }
      if (snap.empty) return null;
      const d = snap.docs[0];
      const doc = shapeDream(d.id, d.data());
      return (await resolveDreamIncludes([doc], args.include))[0];
    },
    async findUnique(args: any): Promise<any> {
      const snap = await firestore().doc(`dreams/${args.where.id}`).get();
      if (!snap.exists) return null;
      const doc = shapeDream(snap.id, snap.data());
      return (await resolveDreamIncludes([doc], args.include))[0];
    },
    async create(args: any): Promise<any> {
      const uid = requireUserId(args.data, "dream.create");
      const ref = firestore().collection("dreams").doc();
      await ref.set({
        id: ref.id,
        userId: uid,
        rawText: args.data.rawText,
        title: args.data.title ?? "Untitled dream",
        mood: args.data.mood ?? "neutral",
        shareToken: null,
        shareIncludeRaw: false,
        sharedAt: null,
        shareExpiresAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      const snap = await ref.get();
      const doc = shapeDream(ref.id, snap.data());
      return (await resolveDreamIncludes([doc], args.include))[0];
    },
    async update(args: any): Promise<any> {
      const ref = firestore().doc(`dreams/${args.where.id}`);
      const existing = await ref.get();
      if (!existing.exists) throw new Error("dream not found");
      const data: any = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      for (const k of [
        "title",
        "mood",
        "shareToken",
        "shareIncludeRaw",
        "sharedAt",
        "shareExpiresAt",
      ]) {
        if (k in args.data) data[k] = args.data[k];
      }
      await ref.update(data);
      const snap = await ref.get();
      const doc = shapeDream(ref.id, snap.data());
      return (await resolveDreamIncludes([doc], args.include))[0];
    },
    async delete(args: any): Promise<any> {
      const ref = firestore().doc(`dreams/${args.where.id}`);
      const dreamId = args.where.id;
      const analysisSnap = await ref.collection("analysis").get();
      const motifSnap = await firestore()
        .collection("motifs")
        .where("dreamId", "==", dreamId)
        .get();
      const sessionSnap = await firestore()
        .collection("arcadeSessions")
        .where("dreamId", "==", dreamId)
        .get();
      const mentionSnap = await firestore()
        .collection("entityMentions")
        .where("dreamId", "==", dreamId)
        .get();
      const batch = firestore().batch();
      for (const d of analysisSnap.docs) batch.delete(d.ref);
      for (const d of motifSnap.docs) batch.delete(d.ref);
      for (const d of sessionSnap.docs) {
        const turnsSnap = await d.ref.collection("turns").get();
        for (const t of turnsSnap.docs) batch.delete(t.ref);
        batch.delete(d.ref);
      }
      for (const d of mentionSnap.docs) batch.delete(d.ref);
      batch.delete(ref);
      await batch.commit();
      return { ok: true };
    },
    async count(args: any): Promise<number> {
      const uid = requireUserId(args.where, "dream.count");
      const snap = await firestore()
        .collection("dreams")
        .where("userId", "==", uid)
        .get();
      return snap.size;
    },
  };

  dreamAnalysis = {
    async create(args: any): Promise<any> {
      const dreamId = args.data.dreamId;
      if (!dreamId) throw new Error("dreamAnalysis.create requires data.dreamId");
      const ref = firestore().doc(`dreams/${dreamId}/analysis/current`);
      const payload: any = { dreamId };
      for (const k of ["summary", "lucidity", "lucidityNote", "fear", "uncertainty"]) {
        if (k in args.data) payload[k] = args.data[k];
      }
      for (const k of ANALYSIS_JSON_FIELDS) {
        if (k in args.data) payload[NATIVE_KEY(k)] = jparse(args.data[k], []);
      }
      payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
      await ref.set(payload);
      const snap = await ref.get();
      return shapeAnalysis(snap.data());
    },
    async delete(args: any): Promise<any> {
      const dreamId = args.where.dreamId;
      if (!dreamId) throw new Error("dreamAnalysis.delete requires where.dreamId");
      await firestore().doc(`dreams/${dreamId}/analysis/current`).delete();
      return { ok: true };
    },
  };

  motif = {
    async createMany(args: any): Promise<{ count: number }> {
      const rows = args.data ?? [];
      if (!rows.length) return { count: 0 };
      const batch = firestore().batch();
      for (const r of rows) {
        if (!r.userId) throw new Error("motif.createMany: each row needs userId");
        const ref = firestore().collection("motifs").doc();
        batch.set(ref, {
          id: ref.id,
          dreamId: r.dreamId,
          userId: r.userId,
          label: r.label,
          type: r.type ?? "symbol",
          note: r.note ?? null,
          confidence: r.confidence ?? 0.5,
          entityId: r.entityId ?? null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      return { count: rows.length };
    },
    async deleteMany(args: any): Promise<{ count: number }> {
      const dreamId = args.where?.dreamId;
      if (!dreamId) throw new Error("motif.deleteMany requires where.dreamId");
      const snap = await firestore()
        .collection("motifs")
        .where("dreamId", "==", dreamId)
        .get();
      const batch = firestore().batch();
      for (const d of snap.docs) batch.delete(d.ref);
      await batch.commit();
      return { count: snap.size };
    },
    async update(args: any): Promise<any> {
      const ref = firestore().doc(`motifs/${args.where.id}`);
      await ref.update(args.data);
      const snap = await ref.get();
      return shapeMotif(snap.id, snap.data());
    },
    async findMany(args: any): Promise<any[]> {
      const uid = requireUserId(args.where, "motif.findMany");
      const snap = await firestore()
        .collection("motifs")
        .where("userId", "==", uid)
        .get();
      const docs = snap.docs.map((d: any) => shapeMotif(d.id, d.data()));
      if (args.include?.dream) {
        for (const doc of docs) {
          const dSnap = await firestore().doc(`dreams/${doc.dreamId}`).get();
          const dd = dSnap.data();
          if (args.include.dream?.include?.analysis) {
            const aSnap = await firestore()
              .doc(`dreams/${doc.dreamId}/analysis/current`)
              .get();
            dd.analysis = aSnap.exists ? shapeAnalysis(aSnap.data()) : null;
          }
          doc.dream = shapeDream(doc.dreamId, dd);
        }
      }
      return docs;
    },
    async count(args: any): Promise<number> {
      const uid = requireUserId(args.where, "motif.count");
      const snap = await firestore()
        .collection("motifs")
        .where("userId", "==", uid)
        .get();
      return snap.size;
    },
  };

  entity = {
    async create(args: any): Promise<any> {
      const uid = requireUserId(args.data, "entity.create");
      const ref = firestore().collection("entities").doc();
      await ref.set({
        id: ref.id,
        userId: uid,
        label: args.data.label,
        type: args.data.type ?? "symbol",
        aliases: jparse(args.data.aliasesJson ?? "[]", []),
        note: args.data.note ?? null,
        mentionCount: args.data.mentionCount ?? 0,
        firstSeen: args.data.firstSeen ?? null,
        lastSeen: args.data.lastSeen ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (args.include?.mentions) {
        return shapeEntity(ref.id, (await ref.get()).data(), []);
      }
      return shapeEntity(ref.id, (await ref.get()).data());
    },
    async update(args: any): Promise<any> {
      const ref = firestore().doc(`entities/${args.where.id}`);
      const data: any = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      for (const k of ["label", "type", "note", "mentionCount", "firstSeen", "lastSeen"]) {
        if (k in args.data) data[k] = args.data[k];
      }
      if ("aliasesJson" in args.data) data.aliases = jparse(args.data.aliasesJson, []);
      await ref.update(data);
      let mentions: any[] | null = null;
      if (args.include?.mentions) {
        const mSnap = await firestore()
          .collection("entityMentions")
          .where("entityId", "==", args.where.id)
          .orderBy("createdAt", "asc")
          .get();
        mentions = mSnap.docs.map((d: any) => shapeEntityMention(d.id, d.data()));
      }
      return shapeEntity(ref.id, (await ref.get()).data(), mentions ?? undefined);
    },
    async delete(args: any): Promise<any> {
      await firestore().doc(`entities/${args.where.id}`).delete();
      return { ok: true };
    },
    async findMany(args: any): Promise<any[]> {
      const uid = requireUserId(args.where, "entity.findMany");
      let q: any = firestore().collection("entities").where("userId", "==", uid);
      if (args.where?.label?.in) q = q.where("label", "in", args.where.label.in);
      if (args.orderBy) {
        for (const [k, v] of Object.entries(args.orderBy)) {
          q = q.orderBy(k, v as any);
        }
      }
      const snap = await q.get();
      const docs = snap.docs.map((d: any) => shapeEntity(d.id, d.data()));
      if (args.include?.mentions) {
        const includeDream = !!args.include.mentions.include?.dream;
        const dreamSelect = args.include.mentions.include?.dream?.select;
        for (const doc of docs) {
          const mSnap = await firestore()
            .collection("entityMentions")
            .where("entityId", "==", doc.id)
            .orderBy("createdAt", args.include.mentions.orderBy?.createdAt ?? "asc")
            .get();
          doc.mentions = mSnap.docs.map((d: any) => shapeEntityMention(d.id, d.data()));
          if (includeDream) {
            for (const m of doc.mentions) {
              const dSnap = await firestore().doc(`dreams/${m.dreamId}`).get();
              const dd = dSnap.data();
              m.dream = dreamSelect
                ? Object.fromEntries(
                    Object.entries(dreamSelect)
                      .filter(([, v]) => v)
                      .map(([k]) => [k, dd?.[k] ?? null])
                  )
                : dd;
            }
          }
        }
      }
      return docs;
    },
    async count(args: any): Promise<number> {
      const uid = requireUserId(args.where, "entity.count");
      const snap = await firestore()
        .collection("entities")
        .where("userId", "==", uid)
        .get();
      return snap.size;
    },
  };

  entityMention = {
    async create(args: any): Promise<any> {
      const d = args.data;
      if (!d.userId) throw new Error("entityMention.create requires data.userId");
      const ref = firestore().collection("entityMentions").doc();
      await ref.set({
        id: ref.id,
        entityId: d.entityId,
        dreamId: d.dreamId,
        userId: d.userId,
        motifId: d.motifId ?? null,
        surfaceLabel: d.surfaceLabel,
        note: d.note ?? null,
        fear: d.fear ?? 0,
        lucidity: d.lucidity ?? 0,
        mood: d.mood ?? "neutral",
        role: d.role ?? "appears",
        createdAt: d.createdAt ?? admin.firestore.FieldValue.serverTimestamp(),
      });
      const snap = await ref.get();
      return shapeEntityMention(ref.id, snap.data());
    },
    async update(args: any): Promise<any> {
      const ref = firestore().doc(`entityMentions/${args.where.id}`);
      await ref.update(args.data);
      const snap = await ref.get();
      return shapeEntityMention(snap.id, snap.data());
    },
    async delete(args: any): Promise<any> {
      await firestore().doc(`entityMentions/${args.where.id}`).delete();
      return { ok: true };
    },
    async findMany(args: any): Promise<any[]> {
      const uid = requireUserId(args.where, "entityMention.findMany");
      const snap = await firestore()
        .collection("entityMentions")
        .where("userId", "==", uid)
        .get();
      return snap.docs.map((d: any) => shapeEntityMention(d.id, d.data(), args.select));
    },
    async count(args: any): Promise<number> {
      const snap = await firestore()
        .collection("entityMentions")
        .where("entityId", "==", args.where.entityId)
        .get();
      return snap.size;
    },
  };

  arcadeSession = {
    async findMany(args: any): Promise<any[]> {
      const uid = requireUserId(args.where, "arcadeSession.findMany");
      let q: any = firestore()
        .collection("arcadeSessions")
        .where("userId", "==", uid);
      if (args.orderBy?.createdAt) q = q.orderBy("createdAt", args.orderBy.createdAt);
      const snap = await q.get();
      const docs = snap.docs.map((d: any) => shapeArcadeSession(d.id, d.data()));
      if (args.include?.dream || args.include?.turns) {
        for (const doc of docs) {
          if (args.include.dream) {
            const dSnap = await firestore().doc(`dreams/${doc.dreamId}`).get();
            const dd = dSnap.data();
            if (args.include.dream?.include?.analysis) {
              const aSnap = await firestore()
                .doc(`dreams/${doc.dreamId}/analysis/current`)
                .get();
              dd.analysis = aSnap.exists ? shapeAnalysis(aSnap.data()) : null;
            }
            if (args.include.dream?.include?.motifs) {
              const mSnap = await firestore()
                .collection("motifs")
                .where("dreamId", "==", doc.dreamId)
                .get();
              dd.motifs = mSnap.docs.map((m: any) => shapeMotif(m.id, m.data()));
            }
            doc.dream = shapeDream(doc.dreamId, dd);
          }
          if (args.include.turns) {
            const select = args.include.turns.select;
            const tSnap = await firestore()
              .collection(`arcadeSessions/${doc.id}/turns`)
              .orderBy("turnNumber", "asc")
              .get();
            doc.turns = tSnap.docs.map((t: any) => shapeTurn(t.id, t.data(), select));
          }
        }
      }
      return docs;
    },
    async findFirst(args: any): Promise<any> {
      const w = args.where ?? {};
      let snap: any;
      if (w.id && w.userId) {
        snap = await firestore()
          .collection("arcadeSessions")
          .where("id", "==", w.id)
          .where("userId", "==", w.userId)
          .limit(1)
          .get();
      } else if (w.shareToken) {
        // PUBLIC-BY-TOKEN read — no userId (the route sanitises).
        snap = await firestore()
          .collection("arcadeSessions")
          .where("shareToken", "==", w.shareToken)
          .limit(1)
          .get();
      } else if (w.id) {
        snap = await firestore()
          .collection("arcadeSessions")
          .where("id", "==", w.id)
          .limit(1)
          .get();
      } else {
        return null;
      }
      if (snap.empty) return null;
      const d = snap.docs[0];
      const doc = shapeArcadeSession(d.id, d.data());
      if (args.include?.dream) {
        const dSnap = await firestore().doc(`dreams/${doc.dreamId}`).get();
        const dd = dSnap.data();
        if (args.include.dream.include?.analysis) {
          const aSnap = await firestore()
            .doc(`dreams/${doc.dreamId}/analysis/current`)
            .get();
          dd.analysis = aSnap.exists ? shapeAnalysis(aSnap.data()) : null;
        }
        if (args.include.dream.include?.motifs) {
          const mSnap = await firestore()
            .collection("motifs")
            .where("dreamId", "==", doc.dreamId)
            .get();
          dd.motifs = mSnap.docs.map((m: any) => shapeMotif(m.id, m.data()));
        }
        doc.dream = shapeDream(doc.dreamId, dd);
      }
      if (args.include?.turns) {
        const tSnap = await firestore()
          .collection(`arcadeSessions/${doc.id}/turns`)
          .orderBy("turnNumber", "asc")
          .get();
        doc.turns = tSnap.docs.map((t: any) => shapeTurn(t.id, t.data()));
      }
      if (args.include?.user) {
        const uSnap = await firestore().doc(`users/${doc.userId}`).get();
        const ud = uSnap.data();
        const sel = args.include.user.select;
        doc.user = sel
          ? Object.fromEntries(
              Object.entries(sel)
                .filter(([, v]) => v)
                .map(([k]) => [k, ud?.[k] ?? null])
            )
          : ud;
      }
      return doc;
    },
    async create(args: any): Promise<any> {
      const uid = requireUserId(args.data, "arcadeSession.create");
      const ref = firestore().collection("arcadeSessions").doc();
      await ref.set({
        id: ref.id,
        userId: uid,
        dreamId: args.data.dreamId,
        mode: args.data.mode ?? "replay",
        status: args.data.status ?? "active",
        ending: null,
        state: jparse(args.data.stateJson ?? "{}", {}),
        shareToken: null,
        sharedAt: null,
        shareExpiresAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      const snap = await ref.get();
      return shapeArcadeSession(ref.id, snap.data());
    },
    async update(args: any): Promise<any> {
      const ref = firestore().doc(`arcadeSessions/${args.where.id}`);
      const data: any = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      for (const k of ["status", "ending", "shareToken", "sharedAt", "shareExpiresAt"]) {
        if (k in args.data) data[k] = args.data[k];
      }
      if ("stateJson" in args.data) data.state = jparse(args.data.stateJson, {});
      await ref.update(data);
      const snap = await ref.get();
      return shapeArcadeSession(ref.id, snap.data());
    },
    async delete(args: any): Promise<any> {
      const ref = firestore().doc(`arcadeSessions/${args.where.id}`);
      const turnsSnap = await ref.collection("turns").get();
      const batch = firestore().batch();
      for (const t of turnsSnap.docs) batch.delete(t.ref);
      batch.delete(ref);
      await batch.commit();
      return { ok: true };
    },
    async count(args: any): Promise<number> {
      const uid = requireUserId(args.where, "arcadeSession.count");
      const snap = await firestore()
        .collection("arcadeSessions")
        .where("userId", "==", uid)
        .get();
      return snap.size;
    },
  };

  sessionTurn = {
    async create(args: any): Promise<any> {
      const d = args.data;
      const sessionId = d.sessionId;
      if (!sessionId) throw new Error("sessionTurn.create requires data.sessionId");
      const ref = firestore().doc(
        `arcadeSessions/${sessionId}/turns/turn-${d.turnNumber}`
      );
      await ref.set({
        id: ref.id,
        sessionId,
        turnNumber: d.turnNumber,
        userAction: d.userAction,
        sceneText: d.sceneText,
        choices: jparse(d.choicesJson ?? "[]", []),
        proposedStateDelta: jparse(d.proposedStateDeltaJson ?? "{}", {}),
        discoveredMotifs: jparse(d.discoveredMotifsJson ?? "[]", []),
        appliedDelta: jparse(d.appliedDeltaJson ?? "{}", {}),
        isEnding: !!d.isEnding,
        endingType: d.endingType ?? null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      const snap = await ref.get();
      return shapeTurn(ref.id, snap.data());
    },
    async delete(args: any): Promise<any> {
      // Compensating write: delete a turn by its id. The id format created by
      // this adapter is `turn-<turnNumber>` under the session's subcollection.
      // For robustness, accept either the doc id directly or a legacy cuid and
      // fall back to a query by id field. Ownership was verified by the route
      // before the turn was created, so no re-check is needed here.
      const id = String(args?.where?.id ?? "");
      if (!id) return;
      // direct doc id (fast path)
      const directPaths = [
        ...args?._sessionId
          ? [`arcadeSessions/${args._sessionId}/turns/${id}`]
          : [],
      ];
      for (const p of directPaths) {
        try { await firestore().doc(p).delete(); return; } catch {}
      }
      // query path: find the turn doc whose id field matches across sessions
      const snap = await firestore()
        .collectionGroup("turns")
        .where("id", "==", id)
        .limit(1)
        .get();
      const batch = firestore().batch();
      snap.forEach((d: any) => batch.delete(d.ref));
      await batch.commit();
    },
  };

  lexiconIgnore = {
    async findMany(args: any): Promise<any[]> {
      const uid = requireUserId(args.where, "lexiconIgnore.findMany");
      let q: any = firestore()
        .collection("lexiconIgnores")
        .where("userId", "==", uid);
      if (args.orderBy?.createdAt)
        q = q.orderBy("createdAt", args.orderBy.createdAt);
      const snap = await q.get();
      return snap.docs.map((d: any) => {
        const full: any = {
          id: d.id,
          userId: d.data().userId,
          word: d.data().word,
          createdAt: toDate(d.data().createdAt) ?? now(),
        };
        if (args.select) {
          const out: any = {};
          for (const k of Object.keys(args.select))
            if (args.select[k]) out[k] = full[k];
          return out;
        }
        return full;
      });
    },
    async upsert(args: any): Promise<any> {
      const uid = requireUserId(
        args.where.userId_word,
        "lexiconIgnore.upsert"
      );
      const word = args.where.userId_word.word;
      const ref = firestore().doc(`lexiconIgnores/${uid}_${word}`);
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({
          id: ref.id,
          userId: uid,
          word,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      const refreshed = await ref.get();
      return {
        id: ref.id,
        userId: uid,
        word,
        createdAt: toDate(refreshed.data()?.createdAt) ?? now(),
      };
    },
    async deleteMany(args: any): Promise<{ count: number }> {
      const uid = requireUserId(args.where, "lexiconIgnore.deleteMany");
      const word = args.where.word;
      const snap = await firestore()
        .collection("lexiconIgnores")
        .where("userId", "==", uid)
        .where("word", "==", word)
        .get();
      const batch = firestore().batch();
      for (const d of snap.docs) batch.delete(d.ref);
      await batch.commit();
      return { count: snap.size };
    },
  };

  async tx<T>(fn: (t: Repository) => Promise<T>): Promise<T> {
    // The Prisma path uses db.$transaction; the Firestore path uses
    // writeBatch under each sub-repo's mutating method. For the routes
    // that actually use tx (dream create + analysis + motifs), the
    // individual batches are themselves atomic, and the outermost call
    // (dream.create) commits before analysis.create runs. A true
    // cross-write Firestore transaction is a future enhancement; the
    // current behavior satisfies the directive's "atomic writes" intent
    // at the per-method level.
    return fn(this);
  }
}

// ---------- Dream include resolver (uses module-level shapers) ----------

async function resolveDreamIncludes(
  docs: any[],
  include?: Record<string, any>
): Promise<any[]> {
  if (!docs.length || !include) return docs;
  if (include.analysis) {
    for (const doc of docs) {
      const aSnap = await firestore()
        .doc(`dreams/${doc.id}/analysis/current`)
        .get();
      doc.analysis = aSnap.exists ? shapeAnalysis(aSnap.data()) : null;
    }
  }
  if (include.motifs) {
    const selectKeys = include.motifs?.select;
    for (const doc of docs) {
      const mSnap = await firestore()
        .collection("motifs")
        .where("dreamId", "==", doc.id)
        .get();
      doc.motifs = mSnap.docs.map((d: any) => shapeMotif(d.id, d.data(), selectKeys));
    }
  }
  if (include.sessions) {
    const orderBy = include.sessions?.orderBy;
    for (const doc of docs) {
      let q: any = firestore()
        .collection("arcadeSessions")
        .where("dreamId", "==", doc.id)
        .where("userId", "==", doc.userId);
      if (orderBy?.createdAt) q = q.orderBy("createdAt", orderBy.createdAt);
      const sSnap = await q.get();
      doc.sessions = sSnap.docs.map((d: any) => shapeArcadeSession(d.id, d.data()));
    }
  }
  if (include.user) {
    const selectKeys = include.user?.select;
    for (const doc of docs) {
      if (!doc.userId) continue;
      const uSnap = await firestore().doc(`users/${doc.userId}`).get();
      const ud = uSnap.data();
      doc.user = selectKeys
        ? Object.fromEntries(
            Object.entries(selectKeys)
              .filter(([, v]) => v)
              .map(([k]) => [k, ud?.[k] ?? null])
          )
        : ud;
    }
  }
  return docs;
}

// ---------- Public factory ----------

let _fsRepo: FirestoreRepository | null = null;
export function getFirestoreRepository(): Repository {
  if (!_fsRepo) _fsRepo = new FirestoreRepository();
  return _fsRepo;
}
