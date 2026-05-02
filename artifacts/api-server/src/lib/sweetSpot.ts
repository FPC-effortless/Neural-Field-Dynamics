// Sweet Spot Discovery — multi-objective Pareto front analysis over sweep combos.
//
// Architecture note (Replit free tier): this runs entirely in the Node.js process
// as a pure in-memory computation over already-stored sweep data. No new simulations
// are launched, no heavy ML libraries are required. O(n^2) Pareto sort is fine
// because sweep sizes cap at 1000 combos.

export interface SweepComboSlim {
  index: number;
  params: Record<string, number | boolean | string>;
  gateOpened: boolean;
  gateStreak: number;
  finalPhi: number;
  finalSC: number;
  finalPU: number;
  finalCAR: number;
  ticksDone: number;
}

export type Objective = "phi" | "pu" | "sc" | "car" | "gateStreak";

export interface SweetSpotConstraints {
  // Minimum Phi for a combo to qualify
  minPhi?: number;
  // Minimum PU
  minPU?: number;
  // Minimum S_C
  minSC?: number;
  // Minimum gate streak (ticks)
  minGateStreak?: number;
}

export interface SweetSpotConfig {
  objectives: Objective[];
  constraints: SweetSpotConstraints;
  // Weight per objective for weighted-sum scoring (0.0–1.0, normalised internally)
  weights?: Partial<Record<Objective, number>>;
}

export interface ParetoEntry {
  combo: SweepComboSlim;
  // Composite score (weighted sum of normalised objectives)
  score: number;
  // Human-readable summary
  summary: string;
  // True if this combo is on the Pareto front (not dominated in any objective)
  paretoFront: boolean;
}

export interface SweetSpotResult {
  total: number;
  qualified: number;
  paretoFront: ParetoEntry[];
  // Top 10 by weighted score regardless of strict Pareto status
  topByScore: ParetoEntry[];
  bestConfig: Record<string, number | boolean | string> | null;
  verdict: string;
}

// Objective extractor
function getObjectiveValue(combo: SweepComboSlim, obj: Objective): number {
  switch (obj) {
    case "phi": return combo.finalPhi;
    case "pu": return combo.finalPU;
    case "sc": return combo.finalSC;
    case "car": return combo.finalCAR;
    case "gateStreak": return combo.gateStreak;
  }
}

// Non-dominated sorting: a dominates b if a is >= b on all objectives and > b on at least one.
function dominates(a: SweepComboSlim, b: SweepComboSlim, objectives: Objective[]): boolean {
  let atLeastOneBetter = false;
  for (const obj of objectives) {
    const av = getObjectiveValue(a, obj);
    const bv = getObjectiveValue(b, obj);
    if (av < bv) return false;
    if (av > bv) atLeastOneBetter = true;
  }
  return atLeastOneBetter;
}

// Normalise a value into [0, 1] given the observed range.
function normalise(v: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.max(0, Math.min(1, (v - min) / (max - min)));
}

function buildSummary(combo: SweepComboSlim): string {
  const params = Object.entries(combo.params)
    .map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed(2) : String(v)}`)
    .join(", ");
  return `Phi=${combo.finalPhi.toFixed(3)}, PU=${combo.finalPU.toFixed(3)}, S_C=${combo.finalSC.toFixed(3)}, CAR=${combo.finalCAR.toFixed(3)}, streak=${combo.gateStreak} [${params}]`;
}

export function findSweetSpots(
  combos: SweepComboSlim[],
  config: SweetSpotConfig,
): SweetSpotResult {
  const { objectives, constraints, weights = {} } = config;

  // Filter to completed combos only
  const completed = combos.filter((c) => c.ticksDone > 0);

  // Apply constraints
  const qualified = completed.filter((c) => {
    if (constraints.minPhi !== undefined && c.finalPhi < constraints.minPhi) return false;
    if (constraints.minPU !== undefined && c.finalPU < constraints.minPU) return false;
    if (constraints.minSC !== undefined && c.finalSC < constraints.minSC) return false;
    if (constraints.minGateStreak !== undefined && c.gateStreak < constraints.minGateStreak) return false;
    return true;
  });

  if (qualified.length === 0) {
    return {
      total: combos.length,
      qualified: 0,
      paretoFront: [],
      topByScore: [],
      bestConfig: null,
      verdict: "No combos satisfied the biological plausibility constraints. Try relaxing thresholds or running a longer sweep.",
    };
  }

  // Compute per-objective min/max for normalisation
  const ranges: Record<Objective, { min: number; max: number }> = {} as never;
  for (const obj of objectives) {
    const vals = qualified.map((c) => getObjectiveValue(c, obj));
    ranges[obj] = { min: Math.min(...vals), max: Math.max(...vals) };
  }

  // Normalise weights
  const totalWeight = objectives.reduce((s, o) => s + (weights[o] ?? 1), 0);

  // Score each combo
  const scored = qualified.map((combo) => {
    let score = 0;
    for (const obj of objectives) {
      const w = (weights[obj] ?? 1) / totalWeight;
      score += w * normalise(getObjectiveValue(combo, obj), ranges[obj].min, ranges[obj].max);
    }
    return { combo, score, summary: buildSummary(combo), paretoFront: false };
  });

  // Find Pareto front (non-dominated set)
  for (let i = 0; i < qualified.length; i++) {
    let dominated = false;
    for (let j = 0; j < qualified.length; j++) {
      if (i === j) continue;
      if (dominates(qualified[j], qualified[i], objectives)) {
        dominated = true;
        break;
      }
    }
    if (!dominated) scored[i].paretoFront = true;
  }

  const paretoFront = scored
    .filter((e) => e.paretoFront)
    .sort((a, b) => b.score - a.score);

  const topByScore = [...scored].sort((a, b) => b.score - a.score).slice(0, 10);

  const best = topByScore[0];
  const bestConfig = best?.combo.params ?? null;

  const verdict = paretoFront.length > 0
    ? `Sweet spot found: ${paretoFront.length} Pareto-optimal config${paretoFront.length > 1 ? "s" : ""} from ${qualified.length} qualified combos. Best: ${best.summary}`
    : `${qualified.length} combos qualified. No strict Pareto front found (all combos show trade-offs). Top scored: ${best?.summary ?? "—"}`;

  return {
    total: combos.length,
    qualified: qualified.length,
    paretoFront,
    topByScore,
    bestConfig,
    verdict,
  };
}
