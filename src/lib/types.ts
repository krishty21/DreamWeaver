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
  mood: Mood;
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
};
