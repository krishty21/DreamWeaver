// Simulation state machine for the Subconscious Arcade.
// AUTHORITATIVE: the app applies AI-proposed deltas here after validation.
// "Model output is never trusted as application state" — every change is clamped,
// bounded, and the app may reject endings that don't fit the rules.

import type {
  SimulationState,
  ProposedDelta,
  EndingType,
} from "@/lib/types";

export function initialState(): SimulationState {
  return {
    fear: 25,
    lucidity: 40,
    stability: 70,
    agency: 35,
    turn: 0,
    discoveredMotifs: [],
    visitedScenes: [],
    inventory: [],
    phase: "opening",
  };
}

// Apply a proposed delta with clamping + sanity rules.
// Returns the new state and the *actually applied* delta (for transparency).
export function applyDelta(
  prev: SimulationState,
  delta: ProposedDelta
): { state: SimulationState; applied: ProposedDelta; ending: EndingType | null } {
  const applied: ProposedDelta = {};
  let { fear, lucidity, stability, agency } = prev;
  let { discoveredMotifs, visitedScenes, inventory, phase, turn } = {
    discoveredMotifs: prev.discoveredMotifs,
    visitedScenes: prev.visitedScenes,
    inventory: prev.inventory,
    phase: prev.phase,
    turn: prev.turn,
  };

  // Clamp each proposed change to a max swing of ±25 per turn so the model
  // cannot arbitrarily destroy or inflate state.
  const swing = (cur: number, proposed?: number) => {
    if (proposed === undefined) return cur;
    const d = proposed - cur;
    const clamped = Math.max(-25, Math.min(25, d));
    return Math.max(0, Math.min(100, cur + clamped));
  };

  if (delta.fear !== undefined) {
    fear = swing(fear, delta.fear);
    applied.fear = fear;
  }
  if (delta.lucidity !== undefined) {
    lucidity = swing(lucidity, delta.lucidity);
    applied.lucidity = lucidity;
  }
  if (delta.stability !== undefined) {
    stability = swing(stability, delta.stability);
    applied.stability = stability;
  }
  if (delta.agency !== undefined) {
    agency = swing(agency, delta.agency);
    applied.agency = agency;
  }
  if (delta.discoveredMotifs && delta.discoveredMotifs.length) {
    const merged = Array.from(new Set([...discoveredMotifs, ...delta.discoveredMotifs]));
    discoveredMotifs = merged.slice(0, 40);
    applied.discoveredMotifs = delta.discoveredMotifs;
  }
  if (delta.visitedScene) {
    const scene = delta.visitedScene.slice(0, 80);
    visitedScenes = [...visitedScenes, scene].slice(-12);
    applied.visitedScene = scene;
  }
  if (delta.inventoryAdd && delta.inventoryAdd.length) {
    inventory = [...inventory, ...delta.inventoryAdd].slice(0, 12);
    applied.inventoryAdd = delta.inventoryAdd;
  }
  if (delta.phase) {
    phase = delta.phase;
    applied.phase = phase;
  }

  turn = prev.turn + 1;
  applied.reasoning = delta.reasoning;

  const state: SimulationState = {
    fear,
    lucidity,
    stability,
    agency,
    turn,
    discoveredMotifs,
    visitedScenes,
    inventory,
    phase,
  };
  // Carry forward the app-selected confront motif for the whole session —
  // it is pinned at creation and never changes mid-session.
  if (prev.confrontMotif) state.confrontMotif = prev.confrontMotif;

  // ---- Ending determination (AUTHORITATIVE, app-side) ----
  // The model may propose an ending, but the app decides if it actually fires
  // based on authoritative state thresholds. This prevents premature or
  // model-manufactured endings.
  let ending: EndingType | null = null;

  const proposedEnding = delta.ending ?? null;
  const turnCap = 18;

  // Collapse: stability <= 8 OR fear >= 98. Authoritative.
  if (state.stability <= 8 || state.fear >= 98) {
    ending = "collapse";
  } else if (state.agency >= 85 && state.lucidity >= 75) {
    // Conscious control achieved.
    ending = "control";
  } else if (proposedEnding === "escape" && state.turn >= 4) {
    ending = "escape";
  } else if (proposedEnding === "transformed" && state.turn >= 6) {
    ending = "transformed";
  } else if (state.turn >= turnCap) {
    ending = "unresolved";
  }

  return { state, applied, ending };
}

export function endingText(ending: EndingType): { title: string; body: string } {
  switch (ending) {
    case "collapse":
      return {
        title: "The dream collapsed",
        body: "The dream's coherence frayed past recovery. The scene dissolved into fragments and you surfaced, holding only echoes.",
      };
    case "escape":
      return {
        title: "You escaped the dream",
        body: "A threshold opened — a door, a staircase, a parting — and you crossed it. The dream released you, still holding its motifs.",
      };
    case "control":
      return {
        title: "Conscious control achieved",
        body: "Lucidity crested. You saw the dream for what it was — yours — and shaped it deliberately before the waking world returned.",
      };
    case "transformed":
      return {
        title: "The dream transformed",
        body: "Rather than escape or collapse, the dream transmuted. Its central tension resolved into something you had not anticipated, and you carry it forward.",
      };
    case "unresolved":
    default:
      return {
        title: "The dream drifts unresolved",
        body: "No single resolution emerged. The dream simply thinned, the way dreams do, leaving you somewhere between memory and morning.",
      };
  }
}
