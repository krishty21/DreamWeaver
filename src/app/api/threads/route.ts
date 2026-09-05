import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getRepository } from "@/lib/data/repository";
import { reconcileUserGraph, computeThreads } from "@/lib/memory-graph";

// GET /api/threads — the Dream Memory Graph: canonical entities traced through
// time with motif evolution + co-occurrence. Computed app-side (the model is
// never involved). Lazy-backfills the graph on first access if the user has
// dreams but no entities yet, so the Threads view works immediately for
// accounts whose dreams predate the r12 reconciler wiring.
//
// SECURITY: ownership is enforced at every layer — requireUser() (401 if not
// signed in), then reconcileUserGraph/computeThreads both scope by userId.
// No dream/entity/mention from another user can ever be returned here.
export async function GET() {
  let userId: string;
  try {
    userId = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Lazy backfill: if the user has motifs but no entities, reconcile once so
  // accounts created before r12 get their graph on first visit. Idempotent.
  try {
    const db = await getRepository();
    const [motifCount, entityCount] = await Promise.all([
      db.motif.count({ where: { userId } }),
      db.entity.count({ where: { userId } }),
    ]);
    if (motifCount > 0 && entityCount === 0) {
      await reconcileUserGraph(userId);
    }
  } catch (e) {
    console.warn("[threads] lazy backfill failed (non-fatal):", e instanceof Error ? e.message : e);
  }

  try {
    const threads = await computeThreads(userId);
    return NextResponse.json({ threads });
  } catch (e) {
    console.warn("[threads] compute failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ threads: [] });
  }
}
