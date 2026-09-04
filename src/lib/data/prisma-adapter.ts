// DreamWeaver — Prisma adapter (LOCAL + SANDBOX QA path).
//
// Implements the Repository contract by delegating to the existing PrismaClient
// singleton from src/lib/db.ts. Behavior is byte-for-byte identical to the
// prior direct-Prisma usage — every method passes args through verbatim.
//
// SECURITY: every method that touches a user-scoped entity requires
// `where.userId` (or `data.userId` on create). This adapter does NOT add an
// additional enforcement layer because Prisma scopes by what the route passes;
// the routes already include `userId` in every where clause (the userId comes
// from `requireUser()`, never from the client). The Firestore adapter adds a
// defensive double-check because Firestore queries are more error-prone, but
// here in the Prisma path the existing behavior is preserved exactly.
//
// CRITICAL PRINCIPLE: this adapter is a pure data-access delegate. It does not
// interpret model output. "MODEL OUTPUT IS NEVER TRUSTED AS APPLICATION STATE"
// is enforced by the routes + simulation.ts, not by this layer.

import type { PrismaClient } from "@prisma/client";
import type { Repository } from "./repository";

export class PrismaAdapterImpl implements Repository {
  readonly backend = "sqlite" as const;
  constructor(private readonly db: PrismaClient) {}

  user = {
    findUnique: (args: any) => this.db.user.findUnique(args as any),
    findFirst: (args: any) => this.db.user.findFirst(args as any),
    create: (args: any) => this.db.user.create(args as any),
  };

  dream = {
    findMany: (args: any) => this.db.dream.findMany(args as any),
    findFirst: (args: any) => this.db.dream.findFirst(args as any),
    findUnique: (args: any) => this.db.dream.findUnique(args as any),
    create: (args: any) => this.db.dream.create(args as any),
    update: (args: any) => this.db.dream.update(args as any),
    delete: (args: any) => this.db.dream.delete(args as any),
    count: (args: any) => this.db.dream.count(args as any),
  };

  dreamAnalysis = {
    create: (args: any) => this.db.dreamAnalysis.create(args as any),
    delete: (args: any) => this.db.dreamAnalysis.delete(args as any),
  };

  motif = {
    createMany: (args: any) => this.db.motif.createMany(args as any),
    deleteMany: (args: any) => this.db.motif.deleteMany(args as any),
    update: (args: any) => this.db.motif.update(args as any),
    findMany: (args: any) => this.db.motif.findMany(args as any),
    count: (args: any) => this.db.motif.count(args as any),
  };

  entity = {
    create: (args: any) => this.db.entity.create(args as any),
    update: (args: any) => this.db.entity.update(args as any),
    delete: (args: any) => this.db.entity.delete(args as any),
    findMany: (args: any) => this.db.entity.findMany(args as any),
    count: (args: any) => this.db.entity.count(args as any),
  };

  entityMention = {
    create: (args: any) => this.db.entityMention.create(args as any),
    update: (args: any) => this.db.entityMention.update(args as any),
    delete: (args: any) => this.db.entityMention.delete(args as any),
    findMany: (args: any) => this.db.entityMention.findMany(args as any),
    count: (args: any) => this.db.entityMention.count(args as any),
  };

  arcadeSession = {
    findMany: (args: any) => this.db.arcadeSession.findMany(args as any),
    findFirst: (args: any) => this.db.arcadeSession.findFirst(args as any),
    create: (args: any) => this.db.arcadeSession.create(args as any),
    update: (args: any) => this.db.arcadeSession.update(args as any),
    delete: (args: any) => this.db.arcadeSession.delete(args as any),
    count: (args: any) => this.db.arcadeSession.count(args as any),
  };

  sessionTurn = {
    create: (args: any) => this.db.sessionTurn.create(args as any),
    delete: (args: any) => this.db.sessionTurn.delete(args as any),
  };

  lexiconIgnore = {
    findMany: (args: any) => this.db.lexiconIgnore.findMany(args as any),
    upsert: (args: any) => this.db.lexiconIgnore.upsert(args as any),
    deleteMany: (args: any) => this.db.lexiconIgnore.deleteMany(args as any),
  };

  async tx<T>(fn: (t: Repository) => Promise<T>): Promise<T> {
    // Prisma interactive transactions pass a tx client with the same shape.
    return this.db.$transaction(async (tx: PrismaClient) => {
      const txRepo = new PrismaAdapterImpl(tx);
      return fn(txRepo as Repository);
    }) as Promise<T>;
  }
}
