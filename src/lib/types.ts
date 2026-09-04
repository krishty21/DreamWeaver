// Shared types for DreamWeaver.
// These mirror the JSON shapes persisted in Prisma (which uses string-encoded JSON
// because SQLite has no native list/scalar-json type).

export type Emotion = {
  emotion: string;
  intensity: number; // 0..1
  confidence?: number; // 0..1, advisory
};

export type LabeledItem = {
  label: string; // normalised, lowercase where useful
  note?: string;
  confidence?: number; // 0..1, advisory
};

export type EntityItem = {
  name: string;
  role?: string;
  note?: string;
  confidence?: number;
};

export type Interpretation = {
  text: string;
  confidence: number; // 0..1, advisory
  // r12 — short quote(s) from the raw dream text that grounded this
  // interpretation, so the dreamer can see WHY it was offered. Advisory.
  evidence?: string[];
};

export type Relationship = {
  from: string;
  to: string;
  relation: string;
};

export type HistoricalConnection = {
  motif: string;
  dreamIds: string[]; // previous dreams where this motif also appeared
  note?: string;
};

export type DreamAnalysisData = {
  title: string;
  summary: string;
  emotions: Emotion[];
  symbols: LabeledItem[];
  motifs: LabeledItem[];
  people: EntityItem[];
  locations: LabeledItem[];
  actions: LabeledItem[];
  lucidity: number; // 0..1
  lucidityNote?: string;
  fear: number; // 0..1
  uncertainty: number; // 0..1
  interpretations: Interpretation[];
  relationships: Relationship[];
  historicalConnections: HistoricalConnection[];
  // r12 — DREAM LAWS: a small number of recurring internal rules the model
  // believes govern this dream. Advisory only; the Arcade uses them as
  // context for internal consistency, never as authoritative state.
  dreamLaws?: DreamLaw[];
  mood: Mood;
};

// r12 — a recurring internal rule derived from the dream's source material
// (e.g. "every clock shows the same time", "doors lead unexpectedly somewhere").
// `evidence` is a short quote from the raw dream supporting the law.
export type DreamLaw = {
  law: string;
  evidence?: string;
};

export type Mood = "neutral" | "tense" | "lucid" | "melancholic" | "surreal";

// ---- Arcade simulation state (authoritative) ----
export type SimulationState = {
  fear: number; // 0..100
  lucidity: number; // 0..100
  stability: number; // 0..100 (dream coherence; 0 => collapse)
  agency: number; // 0..100 (player's control over the dream)
  turn: number;
  discoveredMotifs: string[]; // labels discovered this session
  visitedScenes: string[]; // short scene titles
  inventory: string[];
  phase: "opening" | "developing" | "climax" | "resolving";
  // For Confront sessions: the app-selected motif this session centres on.
  confrontMotif?: string;
};

// AI-proposed delta for a turn. App validates/clamps before applying.
export type ProposedDelta = {
  fear?: number;
  lucidity?: number;
  stability?: number;
  agency?: number;
  discoveredMotifs?: string[];
  visitedScene?: string;
  inventoryAdd?: string[];
  phase?: SimulationState["phase"];
  ending?: EndingType | null;
  // reasons, shown to the user as "AI reflection", not authoritative
  reasoning?: string;
};

export type EndingType = "collapse" | "escape" | "control" | "unresolved" | "transformed";

export type ArcadeChoice = {
  id: string;
  label: string;
  hint?: string;
};

export type ArcadeTurnResponse = {
  sceneText: string;
  choices: ArcadeChoice[];
  proposedDelta: ProposedDelta;
  discoveredMotifs: string[];
  // r12 — MEMORY ECHO: when the model references an element that also appears
  // in the dreamer's prior recorded dreams, the app may attach a subtle
  // historical-connection notice. This is APP-COMPUTED (never trusted from
  // model text) and surfaced to the UI as a restrained, optional aside —
  // never interrupting gameplay, never injecting irrelevant memories.
  memoryEcho?: MemoryEcho;
};

// r12 — a subtle historical-connection notice shown inside the Arcade when a
// motif or element in the current scene also appears in a prior dream.
// "The lighthouse appeared in another dream you recorded 11 days ago."
// `selective` = true means the app decided this echo is worth surfacing
// (the model never decides; it only proposes narrative that may reference
// historically-significant elements, and the app checks + attaches).
export type MemoryEcho = {
  motif: string; // the canonical entity label that connects the dreams
  priorDreamId: string;
  priorDreamTitle: string;
  priorDreamDate: string; // ISO
  daysApart: number;
  note: string; // editorial one-liner
};

export type ArcadeMode = "replay" | "rewrite" | "confront";

// ---- Longitudinal patterns ----
export type MotifFrequency = {
  label: string;
  type: string;
  count: number;
  dreamIds: string[];
  firstSeen: string; // ISO date
  lastSeen: string;
  avgFear: number;
  trend: "rising" | "falling" | "stable"; // emotional intensity trend
};

export type EmotionalTrendPoint = {
  dreamId: string;
  date: string; // ISO
  fear: number;
  lucidity: number;
  uncertainty: number;
};

// One calendar day with dreams recorded. `mood` is the dominant mood of the
// day's dreams (ties → the most recent dream's mood). `titles` carries the
// (up to 3) dream titles for that night so the calendar can preview them on
// hover without an extra round-trip. (r6 — calendar hover popover.)
export type CalendarDay = {
  date: string; // YYYY-MM-DD
  count: number;
  mood: Mood;
  titles: string[];
};

// r7: timeline point — one dream's place in the longitudinal arc, used by
// the Atlas view to render a chronological motif map.
export type TimelinePoint = {
  dreamId: string;
  date: string; // ISO
  title: string;
  mood: Mood;
  motifCount: number;
  fear: number; // 0..1
  lucidity: number; // 0..1
};

// r7: full motif catalog (Atlas view) — every motif/person/place/action the
// user has ever recorded, with the same frequency shape as topMotifs. The
// Atlas view groups by `type` ("symbol" | "person" | "place" | "action").
export type AtlasEntry = MotifFrequency & {
  moodBreakdown: { mood: Mood; count: number }[];
  note?: string | null;
};

// r9: lexicon — the words the dreamer's own memory reaches for most often.
// Computed app-side from raw dream texts (stopwords removed); the model is
// never involved. `count` = total occurrences, `dreamCount` = how many
// distinct dreams contain the word.
export type LexiconWord = {
  word: string;
  count: number;
  dreamCount: number;
};

export type PatternReport = {
  totalDreams: number;
  totalSessions: number;
  topMotifs: MotifFrequency[];
  emotionalTrend: EmotionalTrendPoint[];
  moodDistribution: { mood: Mood; count: number }[];
  dreamCalendar: CalendarDay[];
  recurringPairs: { a: string; b: string; count: number }[];
  earliestDream: string | null;
  latestDream: string | null;
  // r7 — exhaustive catalog used by the Atlas view
  atlas: AtlasEntry[];
  timeline: TimelinePoint[];
  // r9 — word-frequency across raw dream texts (Patterns view lexicon cloud)
  lexicon: LexiconWord[];
  // r11 — words the dreamer muted from the lexicon cloud, newest first.
  // Carried on the report so the restore affordance needs no extra fetch.
  lexiconIgnored?: string[];
  // r12 — DREAM MEMORY GRAPH: canonical entities (the unified dream-memory
  // nodes) with their longitudinal threads + evolution. Computed app-side
  // by the memory-graph reconciler; the model is never involved.
  threads: DreamThread[];
};

// r12 — DREAM MEMORY GRAPH types.

// A canonical entity: the conceptual node unifying different surface forms
// of the same dream element ("faceless figure" ≈ "faceless person").
export type EntityCluster = {
  id: string;
  label: string; // canonical label
  type: string; // symbol | person | place | action | emotion
  aliases: string[]; // other surface forms clustered in
  mentionCount: number;
  dreamCount: number;
  dreamIds: string[];
  firstSeen: string; // ISO
  lastSeen: string; // ISO
  // Per-mention emotional telemetry, oldest-first (for the evolution chart).
  mentions: EntityMentionPoint[];
};

// One mention of an entity inside one dream — the longitudinal point shape.
export type EntityMentionPoint = {
  mentionId: string;
  dreamId: string;
  dreamTitle: string;
  date: string; // ISO
  surfaceLabel: string; // the form used in this dream
  note?: string | null;
  role: string; // reconciler-assigned editorial role
  fear: number; // 0..1
  lucidity: number; // 0..1
  mood: Mood;
};

// A Dream Thread = a canonical entity traced through time, with the
// evolution of its role. This is what the Threads view renders: "this thing
// has appeared in N dreams; its role has changed across them."
export type DreamThread = {
  id: string;
  label: string;
  type: string;
  aliases: string[];
  mentionCount: number;
  dreamCount: number;
  firstSeen: string;
  lastSeen: string;
  // Evolution summary — how the entity's role shifted across dreams.
  // e.g. "first it was fled; now it is confronted."
  evolution: MotifEvolution;
  // Chronological mentions (oldest-first), capped at ~30 for UI weight.
  mentions: EntityMentionPoint[];
  // Co-occurring entities — other elements that frequently appear in the
  // same dreams as this one (the associative neighbourhood in the graph).
  associatedWith: { label: string; type: string; count: number }[];
};

// A description of how a motif's role has changed across dreams. Editorial,
// non-clinical — describes the dreamer's recorded narratives, not the dreamer.
export type MotifEvolution = {
  // Short editorial phrases, oldest-first: ["fled from", "watched", "approached", "confronted"].
  roles: string[];
  // One-line human-readable summary, e.g. "its role has shifted from fleeing to confronting."
  summary: string;
  // Whether the telemetry suggests a meaningful shift (>0.15 fear delta or role text changed).
  hasShift: boolean;
  // Fear telemetry across mentions, oldest-first (for the sparkline).
  fearArc: number[];
};
