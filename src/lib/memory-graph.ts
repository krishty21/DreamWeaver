// DREAM MEMORY GRAPH — r12 flagship module.
//
// The conceptual requirement (directive §8–10): DreamWeaver should evolve from
// "a collection of dream entries" into "a connected personal dream world",
// where different textual mentions of the same dream element can be related,
// motifs can be traced as THREADS through multiple dreams, and the product can
// describe how a motif's ROLE has changed over time.
//
// This module is AUTHORITATIVE and runs APP-SIDE ONLY. The model never produces
// canonical entities, threads, or evolution summaries. The model only proposes
// per-dream motifs (as labeled items inside DreamAnalysis); the reconciler here
// clusters those into canonical Entities and derives the longitudinal layer.
//
// SECURITY: every query is scoped by userId. The reconciler never crosses users.
// A user cannot retrieve another user's entities by any input.

import { getRepository } from "@/lib/data/repository";
import type { DreamThread, EntityMentionPoint, MotifEvolution, Mood } from "@/lib/types";

// ----------------------------------------------------------------------------
// 1. LABEL NORMALISATION + ALIAS MAP
//
// The directive explicitly says: "Do not rely exclusively on exact string
// matching for the conceptual memory system." So normalisation collapses
// trivial surface differences (case, articles, whitespace, simple plurals),
// and a small hand-curated ALIAS_MAP relates common semantic equivalents
// ("faceless figure" ≈ "faceless person" ≈ "faceless man"). The map is
// extensible without code change in the future (it could become a DB table),
// but a curated constant is the right size for the sandbox + demo.
// ----------------------------------------------------------------------------

/** Strip trivia: lowercase, collapse whitespace, drop leading articles, drop
 *  trailing simple plurals (conservative — only -s after a non-s consonant
 *  or vowel, to avoid mangling "series" / "is"). */
export function normalizeLabel(raw: string): string {
  let s = (raw || "").toLowerCase().trim();
  // collapse inner whitespace
  s = s.replace(/\s+/g, " ");
  // drop leading article
  s = s.replace(/^(the|a|an)\s+/, "");
  // strip trailing simple plural (very conservative)
  s = s.replace(/([b-df-hj-np-z]|[aeiou])s$/, "$1");
  // strip possessive
  s = s.replace(/['\u2019]s$/, "");
  return s.trim();
}

/** A hand-curated alias map: each key is the canonical form; the array is the
 *  set of surface forms that should cluster INTO that canonical form.
 *  Matching is performed on the NORMALISED label, so "The Faceless Person"
 *  normalises to "faceless person" then maps to canonical "faceless figure".
 *  Keep this small and editorial — over-merging is worse than under-merging
 *  (the dreamer can always merge manually later; splitting a bad merge is
 *  harder). */
const ALIAS_MAP: Record<string, string[]> = {
  "faceless figure": ["faceless person", "faceless man", "faceless woman", "faceless one", "faceless people"],
  ocean: ["sea", "the sea", "seas"],
  lighthouse: ["light house", "the lighthouse"],
  staircase: ["stairs", "the stairs", "stairwell"],
  hallway: ["hallways", "corridor", "corridors", "passage"],
  door: ["doors", "the door"],
  "endless hallway": ["endless corridor", "infinite hallway", "infinite corridor"],
  pursuit: ["chase", "being chased", "chased", "pursued"],
  "falling": ["fall", "fell", "falls"],
  classroom: ["class room", "school room"],
  "old woman": ["elderly woman", "ancient woman", "grandmother"],
  "mirror": ["mirrors", "reflection", "reflections"],
};

/** Resolve a normalised surface label to its canonical form via the alias map
 *  (reverse lookup). Falls back to the normalised label itself. */
function canonicalFor(normalised: string): string {
  if (ALIAS_MAP[normalised]) return normalised; // already canonical
  for (const [canonical, aliases] of Object.entries(ALIAS_MAP)) {
    if (aliases.includes(normalised)) return canonical;
  }
  return normalised;
}

// ----------------------------------------------------------------------------
// 2. ROLE DERIVATION
//
// For each mention, derive a short editorial role label describing how the
// entity appeared in that dream. This is what powers MOTIF EVOLUTION: "Dream 1:
// fled from · Dream 2: watched · Dream 3: approached · Dream 4: confronted."
//
// The role is derived APP-SIDE from the mention note + the dream's recorded
// actions (which the model already extracted as labeled items). The model
// never assigns the role; it only provides the note + actions, and the app
// interprets them through a small editorial rule set. This keeps the
// "evolution" claim grounded in observed text, not invented.
// ----------------------------------------------------------------------------

const ROLE_RULES: { match: RegExp; role: string }[] = [
  // confrontational / approaching
  { match: /\b(confront|approach|face|speak to|talk to|address|embrace|touch|reach for)\b/i, role: "confronted" },
  // fleeing / avoidance
  { match: /\b(run from|flee|fled|escape|escap|hide|hid|avoid|retreat|run away)\b/i, role: "fled from" },
  // watching / observing
  { match: /\b(watch|stare|observe|look on|gaze|sees? me|watche[ds]?)\b/i, role: "watched" },
  // following / pursuing
  { match: /\b(follow|followed|pursu|chas|tail|stalking)\b/i, role: "pursued" },
  // guiding / leading
  { match: /\b(guid|lead|led|show|ushers?|directs?)\b/i, role: "guided" },
  // transforming / changing
  { match: /\b(transform|chang|shift|morph|becomes?|turns? into)\b/i, role: "transformed" },
  // appearing / present (default)
  { match: /\b(appear|present|there is|stands?|sits?|loom)\b/i, role: "appears" },
];

function deriveRole(args: { note?: string | null; surfaceLabel: string; dreamActions: { label: string; note?: string | null }[] }): string {
  const blob = [
    args.note ?? "",
    args.surfaceLabel,
    ...args.dreamActions.map((a) => `${a.label} ${a.note ?? ""}`),
  ]
    .join(" ")
    .toLowerCase();
  for (const rule of ROLE_RULES) {
    if (rule.match.test(blob)) return rule.role;
  }
  return "appears";
}

// ----------------------------------------------------------------------------
// 3. RECONCILE — cluster a user's motifs into canonical Entities + mentions.
//
// Idempotent: safe to call after every dream analysis. Walks every Motif row
// the user owns, groups by canonical label + type, upserts an Entity, creates
// an EntityMention if one doesn't already exist for (entity, dream, motif),
// and back-links Motif.entityId. Old mentions are preserved; deleted motifs
// (from a re-analyze) have their mentions pruned so the graph never carries
// stale references.
// ----------------------------------------------------------------------------

type ReconcileResult = {
  entitiesTouched: number;
  mentionsCreated: number;
  mentionsPruned: number;
};

export async function reconcileUserGraph(userId: string): Promise<ReconcileResult> {
  const db = await getRepository();
  // Load all the user's motifs + their dreams (we need dream date/mood/fear
  // for the mention telemetry snapshot).
  const motifs = await db.motif.findMany({
    where: { userId },
    include: { dream: { include: { analysis: true } } },
  });

  // Also load the user's existing entities + mentions so we can upsert
  // without nuking the graph on every re-analyze.
  const existingEntities = await db.entity.findMany({
    where: { userId },
    include: { mentions: true },
  });
  const entityByCanonicalKey = new Map<string, (typeof existingEntities)[number]>();
  for (const e of existingEntities) {
    entityByCanonicalKey.set(`${e.type}::${e.label}`, e);
  }

  // Group motifs by canonical (type, label). Each group becomes one Entity.
  const groups = new Map<string, typeof motifs>();
  for (const m of motifs) {
    const norm = normalizeLabel(m.label);
    const canon = canonicalFor(norm);
    const key = `${m.type}::${canon}`;
    const arr = groups.get(key) ?? [];
    arr.push(m);
    groups.set(key, arr);
  }

  let mentionsCreated = 0;
  let entitiesTouched = 0;
  const seenMotifIds = new Set<string>();

  for (const [key, group] of groups) {
    const [type, canonicalLabel] = key.split("::");
    let entity = entityByCanonicalKey.get(key);

    // Aliases: every distinct surface form in the group becomes an alias,
    // plus any pre-existing aliases (preserve manual additions).
    const surfaceForms = Array.from(
      new Set(group.map((m) => m.label.toLowerCase().trim()))
    );
    let aliases: string[] = surfaceForms.filter((s) => s !== canonicalLabel);
    if (entity) {
      const existingAliases: string[] = JSON.parse(entity.aliasesJson || "[]");
      aliases = Array.from(new Set([...aliases, ...existingAliases])).filter(
        (s) => s !== canonicalLabel
      );
    }
    // Build the mention set we expect for this entity (one per (dream, motif)).
    // The mention's role + telemetry come from the dream's analysis snapshot.
    const desiredMentions = group.map((m) => {
      const a = m.dream.analysis;
      const actions: { label: string; note?: string | null }[] = a
        ? JSON.parse(a.actionsJson || "[]")
        : [];
      const role = deriveRole({
        note: m.note,
        surfaceLabel: m.label,
        dreamActions: actions,
      });
      return {
        dreamId: m.dreamId,
        motifId: m.id,
        surfaceLabel: m.label.toLowerCase(),
        note: m.note,
        fear: a?.fear ?? 0,
        lucidity: a?.lucidity ?? 0,
        mood: (m.dream.mood as Mood) || "neutral",
        role,
        createdAt: m.dream.createdAt,
      };
    });

    // Determine the first/last seen across this group.
    const dates = group.map((m) => m.dream.createdAt).sort((a, b) => a.getTime() - b.getTime());
    const firstSeen = dates[0] ?? null;
    const lastSeen = dates[dates.length - 1] ?? null;

    if (!entity) {
      entity = await db.entity.create({
        data: {
          userId,
          label: canonicalLabel,
          type,
          aliasesJson: JSON.stringify(aliases),
          mentionCount: desiredMentions.length,
          firstSeen,
          lastSeen,
        },
        include: { mentions: true },
      });
      entityByCanonicalKey.set(key, entity);
      entitiesTouched++;
    } else {
      // Update aliases + bookkeeping.
      const needsUpdate =
        JSON.stringify(aliases) !== entity.aliasesJson ||
        entity.mentionCount !== desiredMentions.length ||
        (entity.firstSeen?.getTime() ?? null) !== (firstSeen?.getTime() ?? null) ||
        (entity.lastSeen?.getTime() ?? null) !== (lastSeen?.getTime() ?? null);
      if (needsUpdate) {
        entity = await db.entity.update({
          where: { id: entity.id },
          data: {
            aliasesJson: JSON.stringify(aliases),
            mentionCount: desiredMentions.length,
            firstSeen,
            lastSeen,
          },
          include: { mentions: true },
        });
        entityByCanonicalKey.set(key, entity);
        entitiesTouched++;
      }
    }

    // Reconcile mentions: create any that don't exist, and back-link the
    // Motif.entityId. Match on (entityId, dreamId, motifId) so a re-analyze
    // that re-extracts the same motif doesn't create a duplicate mention.
    const existingByMotif = new Map<string, (typeof entity.mentions)[number]>();
    for (const em of entity.mentions) {
      if (em.motifId) existingByMotif.set(em.motifId, em);
    }
    for (const dm of desiredMentions) {
      seenMotifIds.add(dm.motifId);
      if (dm.motifId && existingByMotif.has(dm.motifId)) {
        // update telemetry snapshot + role in case the dream was re-analyzed
        const existing = existingByMotif.get(dm.motifId)!;
        const needsMentionUpdate =
          existing.fear !== dm.fear ||
          existing.lucidity !== dm.lucidity ||
          existing.mood !== dm.mood ||
          existing.role !== dm.role ||
          existing.surfaceLabel !== dm.surfaceLabel ||
          (existing.note ?? null) !== (dm.note ?? null);
        if (needsMentionUpdate) {
          await db.entityMention.update({
            where: { id: existing.id },
            data: {
              fear: dm.fear,
              lucidity: dm.lucidity,
              mood: dm.mood,
              role: dm.role,
              surfaceLabel: dm.surfaceLabel,
              note: dm.note,
            },
          });
        }
      } else {
        await db.entityMention.create({
          data: {
            entityId: entity.id,
            dreamId: dm.dreamId,
            userId,
            motifId: dm.motifId,
            surfaceLabel: dm.surfaceLabel,
            note: dm.note,
            fear: dm.fear,
            lucidity: dm.lucidity,
            mood: dm.mood,
            role: dm.role,
            createdAt: dm.createdAt,
          },
        });
        mentionsCreated++;
      }
      // back-link the motif
      if (dm.motifId) {
        await db.motif.update({
          where: { id: dm.motifId },
          data: { entityId: entity.id },
        });
      }
    }
  }

  // Prune: any EntityMention whose motifId is no longer in `motifs` (e.g. the
  // dream was re-analyzed and the motif dropped). Also prune orphan Entity
  // rows that have zero mentions left after pruning.
  const allMentions = await db.entityMention.findMany({
    where: { userId },
    select: { id: true, motifId: true, entityId: true },
  });
  const toPrune = allMentions.filter((m) => m.motifId && !seenMotifIds.has(m.motifId));
  const prunedEntityIds = new Set<string>();
  for (const m of toPrune) {
    await db.entityMention.delete({ where: { id: m.id } });
    if (m.entityId) prunedEntityIds.add(m.entityId);
  }
  // Re-count + delete entities with zero mentions
  for (const entityId of prunedEntityIds) {
    const count = await db.entityMention.count({ where: { entityId } });
    if (count === 0) {
      await db.entity.delete({ where: { id: entityId } });
    } else {
      await db.entity.update({
        where: { id: entityId },
        data: { mentionCount: count },
      });
    }
  }

  return {
    entitiesTouched,
    mentionsCreated,
    mentionsPruned: toPrune.length,
  };
}

// ----------------------------------------------------------------------------
// 4. COMPUTE THREADS — the longitudinal layer shown in the Threads view.
//
// A DreamThread = one canonical Entity traced through time, with the evolution
// of its role + the co-occurring entities (its associative neighbourhood in
// the graph). Computed from the reconciled EntityMention rows.
// ----------------------------------------------------------------------------

function describeEvolution(roles: string[], fearArc: number[]): MotifEvolution {
  const hasShift =
    roles.length >= 2 &&
    (new Set(roles).size > 1 || (fearArc.length >= 2 && Math.max(...fearArc) - Math.min(...fearArc) > 0.15));
  let summary: string;
  if (roles.length === 0) {
    summary = "First appearance — no history yet.";
  } else if (roles.length === 1) {
    summary = `Observed once — it ${roles[0]}.`;
  } else if (!hasShift) {
    summary = `A steady presence — it ${roles[0]} across every dream so far.`;
  } else {
    const first = roles[0];
    const last = roles[roles.length - 1];
    summary =
      first === last
        ? `Its role has held across your dreams — it ${first}.`
        : `Its role has shifted — first it ${first}, and most recently it ${last}.`;
  }
  return { roles, summary, hasShift, fearArc };
}

export async function computeThreads(userId: string): Promise<DreamThread[]> {
  const db = await getRepository();
  const entities = await db.entity.findMany({
    where: { userId },
    include: {
      mentions: {
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { mentionCount: "desc" },
  });
  if (entities.length === 0) return [];

  // Preload dream titles per user (cheap; one query).
  const dreams = await db.dream.findMany({
    where: { userId },
    select: { id: true, title: true, createdAt: true },
  });
  const dreamTitle = new Map(dreams.map((d) => [d.id, d.title ?? "Untitled dream"]));

  // For co-occurrence: map dreamId -> set of entity labels mentioned there.
  const dreamEntities = new Map<string, Set<string>>();
  for (const e of entities) {
    for (const m of e.mentions) {
      const set = dreamEntities.get(m.dreamId) ?? new Set<string>();
      set.add(e.label);
      dreamEntities.set(m.dreamId, set);
    }
  }

  const threads: DreamThread[] = [];
  for (const e of entities) {
    const mentions: EntityMentionPoint[] = e.mentions
      .slice(0, 30)
      .map((m) => ({
        mentionId: m.id,
        dreamId: m.dreamId,
        dreamTitle: dreamTitle.get(m.dreamId) ?? "Untitled dream",
        date: m.createdAt.toISOString(),
        surfaceLabel: m.surfaceLabel,
        note: m.note ?? null,
        role: m.role,
        fear: m.fear,
        lucidity: m.lucidity,
        mood: (m.mood as Mood) || "neutral",
      }));

    const roles = mentions.map((m) => m.role);
    const fearArc = mentions.map((m) => m.fear);
    const evolution = describeEvolution(roles, fearArc);

    // Associated entities: count co-occurrence across dreams.
    const assocCounts = new Map<string, number>();
    const assocType = new Map<string, string>();
    for (const m of e.mentions) {
      const siblings = dreamEntities.get(m.dreamId);
      if (!siblings) continue;
      for (const sib of siblings) {
        if (sib === e.label) continue;
        assocCounts.set(sib, (assocCounts.get(sib) ?? 0) + 1);
      }
    }
    // resolve type for each associated label
    for (const sib of assocCounts.keys()) {
      const ent = entities.find((x) => x.label === sib);
      if (ent) assocType.set(sib, ent.type);
    }
    const associatedWith = Array.from(assocCounts.entries())
      .map(([label, count]) => ({ label, type: assocType.get(label) ?? "symbol", count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    const dreamIds = Array.from(new Set(e.mentions.map((m) => m.dreamId)));

    threads.push({
      id: e.id,
      label: e.label,
      type: e.type,
      aliases: JSON.parse(e.aliasesJson || "[]"),
      mentionCount: e.mentions.length,
      dreamCount: dreamIds.length,
      firstSeen: e.firstSeen?.toISOString() ?? e.createdAt.toISOString(),
      lastSeen: e.lastSeen?.toISOString() ?? e.createdAt.toISOString(),
      evolution,
      mentions,
      associatedWith,
    });
  }

  return threads;
}

// ----------------------------------------------------------------------------
// 5. MEMORY ECHO — selective historical connection surfaced inside the Arcade.
//
// Given the current dream's motifs + the user's prior dreams (excluding the
// current one), find the single most relevant historical connection: a motif
// that also appeared in an earlier dream. Returns null when nothing qualifies
// (the directive is explicit: "historical retrieval must be selective. Do not
// interrupt gameplay constantly. Do not inject irrelevant memories.")
// ----------------------------------------------------------------------------

export async function computeMemoryEcho(args: {
  userId: string;
  currentDreamId: string;
  sceneMotifs: string[]; // motifs referenced in the model's scene text this turn
}): Promise<{
  motif: string;
  priorDreamId: string;
  priorDreamTitle: string;
  priorDreamDate: string;
  daysApart: number;
  note: string;
} | null> {
  if (args.sceneMotifs.length === 0) return null;
  const db = await getRepository();
  const currentDream = await db.dream.findFirst({
    where: { id: args.currentDreamId, userId: args.userId },
    select: { id: true, createdAt: true, title: true },
  });
  if (!currentDream) return null;

  // Look up canonical entities matching any of the scene motifs (by normalized
  // label or alias). Then find the most recent PRIOR dream (created BEFORE the
  // current dream) that mentions the same entity.
  const targets = new Set<string>();
  for (const raw of args.sceneMotifs) {
    const norm = normalizeLabel(raw);
    targets.add(canonicalFor(norm));
    targets.add(norm);
  }
  const entities = await db.entity.findMany({
    where: { userId: args.userId, label: { in: Array.from(targets) } },
    include: { mentions: { include: { dream: { select: { id: true, title: true, createdAt: true } } } } },
  });
  if (entities.length === 0) return null;

  // Collect candidate prior mentions (createdAt < currentDream.createdAt).
  type Cand = { entityId: string; entityLabel: string; dreamId: string; dreamTitle: string; date: Date };
  const candidates: Cand[] = [];
  for (const e of entities) {
    for (const m of e.mentions) {
      if (m.dreamId === args.currentDreamId) continue;
      if (m.createdAt >= currentDream.createdAt) continue;
      candidates.push({
        entityId: e.id,
        entityLabel: e.label,
        dreamId: m.dreamId,
        dreamTitle: m.dream.title ?? "Untitled dream",
        date: m.createdAt,
      });
    }
  }
  if (candidates.length === 0) return null;

  // Pick the most recent prior mention (closest in time, most resonant).
  candidates.sort((a, b) => b.date.getTime() - a.date.getTime());
  const best = candidates[0];
  const daysApart = Math.max(
    1,
    Math.round((currentDream.createdAt.getTime() - best.date.getTime()) / 86400000)
  );

  return {
    motif: best.entityLabel,
    priorDreamId: best.dreamId,
    priorDreamTitle: best.dreamTitle,
    priorDreamDate: best.date.toISOString(),
    daysApart,
    note: `The “${best.entityLabel}” also appeared in another dream you recorded ${daysApart} day${daysApart === 1 ? "" : "s"} ago.`,
  };
}
