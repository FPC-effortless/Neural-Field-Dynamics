// Plain-English explainability layer for the layman shell.
//
// All functions here are pure: they take the same shape of stats / combos
// the rest of the API already exposes, and return strings + classification
// codes that the dashboard can render directly. No I/O, no clocks, no
// external state — so the unit tests can be exhaustive and cheap.

export type GateColor = "red" | "yellow" | "green";

export interface GateVerdict {
  color: GateColor;
  label: string;
  // One-sentence verdict the dashboard can drop straight into a card.
  summary: string;
}

export interface FailureReason {
  // Stable enum the UI / tests can switch on.
  code:
    | "OK"
    | "NO_DATA"
    | "GATE_NEVER_OPENED"
    | "PARTICIPATION_COLLAPSED"
    | "WEAK_GLOBAL_FIELD"
    | "TEMPORAL_INSTABILITY"
    | "ATTRACTOR_TOO_SPARSE"
    | "GATE_OPENED_BUT_STREAK_SHORT"
    | "LOCAL_PASS_GLOBAL_FAIL";
  // Human-readable explanation, suitable for a card body.
  plain: string;
}

export interface NextStep {
  // Stable enum so the UI can choose iconography / tone.
  action:
    | "RUN_FIRST"
    | "PROCEED_TO_NEXT_PHASE"
    | "INCREASE_GLOBAL_COUPLING"
    | "INCREASE_TEMPERATURE"
    | "REDUCE_NOISE"
    | "MORE_SEEDS"
    | "WAIT"
    | "EXTEND_TICKS"
    | "GIVE_UP_AND_REVISIT";
  plain: string;
}

// Minimal shape of a sweep combo's tail metrics, as the existing serializer
// already exposes. Anything not provided is treated as zero/absent.
export interface ComboMetrics {
  finalPhi?: number;
  finalSC?: number;
  finalPU?: number;
  finalCAR?: number;
  bestCAR?: number;
  gateOpened?: boolean;
  gateStreak?: number;
  ticksDone?: number;
}

// Per the v13 spec: Gate I requires Φ > 0.05, PU > 0.1, S_C > 0.1 sustained
// for ≥ gateStreakTarget ticks (default 1000). We expose the same constants
// here so the classifier and UI are consistent.
export const PHI_MIN = 0.05;
export const PU_MIN = 0.1;
export const SC_MIN = 0.1;

// "Yellow" band: the run is showing real signal — at least one of the three
// pillars is comfortably above its floor — but the gate has not held the
// full streak yet. "Red" means none of the pillars even cleared the floor.
export function classifyGate(
  best: ComboMetrics | null | undefined,
  gateStreakTarget: number,
): GateVerdict {
  if (!best || (best.ticksDone ?? 0) === 0) {
    return {
      color: "red",
      label: "No data",
      summary: "Nothing has run yet.",
    };
  }
  const phi = best.finalPhi ?? 0;
  const sc = best.finalSC ?? 0;
  const pu = best.finalPU ?? 0;
  const streak = best.gateStreak ?? 0;
  const opened = !!best.gateOpened;

  if (opened && streak >= gateStreakTarget) {
    return {
      color: "green",
      label: "Gate open",
      summary: `Existence Gate held for ${streak.toLocaleString()} ticks — integration confirmed.`,
    };
  }
  const anyPillarUp = phi >= PHI_MIN || sc >= SC_MIN || pu >= PU_MIN;
  if (opened || anyPillarUp) {
    return {
      color: "yellow",
      label: "Partial",
      summary:
        opened
          ? `Gate opened but only held for ${streak.toLocaleString()} / ${gateStreakTarget.toLocaleString()} ticks.`
          : "Some integration metrics moved, but the Existence Gate never opened.",
    };
  }
  return {
    color: "red",
    label: "Gate closed",
    summary: "No integration detected — the gate never came close to opening.",
  };
}

export function classifyFailureReason(
  best: ComboMetrics | null | undefined,
  gateStreakTarget: number,
): FailureReason {
  if (!best || (best.ticksDone ?? 0) === 0) {
    return { code: "NO_DATA", plain: "Run has not produced any samples yet." };
  }
  const phi = best.finalPhi ?? 0;
  const sc = best.finalSC ?? 0;
  const pu = best.finalPU ?? 0;
  const streak = best.gateStreak ?? 0;
  const opened = !!best.gateOpened;

  if (opened && streak >= gateStreakTarget) {
    return { code: "OK", plain: "Run satisfied the Existence Gate." };
  }
  if (opened) {
    return {
      code: "GATE_OPENED_BUT_STREAK_SHORT",
      plain: `The gate opened but only held for ${streak.toLocaleString()} of the ${gateStreakTarget.toLocaleString()} ticks required. The system is alive but unstable.`,
    };
  }
  // None of the three pillars cleared their floor — the network never
  // produced anything resembling integrated activity.
  if (phi < PHI_MIN && sc < SC_MIN && pu < PU_MIN) {
    return {
      code: "PARTICIPATION_COLLAPSED",
      plain:
        "Almost every neuron stayed silent. Try lowering Top-K (so attention spreads) or raising temperature.",
    };
  }
  // Only Φ is missing — the local activity is fine, but nothing is binding
  // it together into one global state.
  if (phi < PHI_MIN && (sc >= SC_MIN || pu >= PU_MIN)) {
    return {
      code: "WEAK_GLOBAL_FIELD",
      plain:
        "Local activity is healthy but the network never integrates. Try raising global coupling (γ) or attention sharpness (τ).",
    };
  }
  // Φ moved but stability collapsed — the integration was a transient.
  if (phi >= PHI_MIN && sc < SC_MIN) {
    return {
      code: "TEMPORAL_INSTABILITY",
      plain:
        "Integration appeared in flashes but the network couldn't hold a stable state. Try lowering noise (σ) or increasing temporal coherence (δ).",
    };
  }
  // PU is missing — pieces of the network agree on something but it doesn't
  // predict the next state.
  if (pu < PU_MIN && phi >= PHI_MIN) {
    return {
      code: "LOCAL_PASS_GLOBAL_FAIL",
      plain:
        "The network is integrated but its activity isn't predictive. Try a lower noise floor or longer ticks per combo.",
    };
  }
  return {
    code: "GATE_NEVER_OPENED",
    plain:
      "The network produced some signal but never crossed all three Existence-Gate thresholds.",
  };
}

// Minimal shape of an auto-mode record needed to recommend a next action.
export interface AutoModeView {
  status: "pending" | "running" | "completed" | "cancelled" | "succeeded";
  iterations: ComboMetrics[];
  gateStreakTarget: number;
  maxIterations: number;
  bestGateStreak: number;
  bestCAR: number;
}

export function nextStepRecommendation(
  view: AutoModeView,
): NextStep {
  if (view.iterations.length === 0) {
    if (view.status === "running" || view.status === "pending") {
      return {
        action: "WAIT",
        plain: "The first iteration is still warming up — give it a moment.",
      };
    }
    return {
      action: "RUN_FIRST",
      plain: "No data yet. Pick a preset and click Start.",
    };
  }
  if (view.status === "running" || view.status === "pending") {
    return {
      action: "WAIT",
      plain: "Currently running — the dashboard will update live.",
    };
  }
  // Aggregate the best across iterations.
  const best = view.iterations.reduce<ComboMetrics | null>((acc, it) => {
    if (!acc) return it;
    const a = acc.gateStreak ?? 0;
    const b = it.gateStreak ?? 0;
    if (b > a) return it;
    if (b === a && (it.bestCAR ?? 0) > (acc.bestCAR ?? 0)) return it;
    return acc;
  }, null);
  const reason = classifyFailureReason(best, view.gateStreakTarget);

  if (reason.code === "OK") {
    return {
      action: "PROCEED_TO_NEXT_PHASE",
      plain:
        "Phase 0 passed. You can move on to Phase 1 (memory & retrieval) safely.",
    };
  }
  // Budget check comes BEFORE the failure-mode-specific advice. If Auto-Mode
  // already used every refinement iteration without success, telling the
  // user "tweak this knob" is misleading — there's no iteration left to
  // tweak it in. The honest answer is: pick a different preset or revisit
  // the parameter ranges yourself.
  if (view.iterations.length >= view.maxIterations) {
    return {
      action: "GIVE_UP_AND_REVISIT",
      plain:
        "Auto-Mode used its full iteration budget without finding the gate. Try the Phase-0-Expanded preset, or revisit the parameter ranges.",
    };
  }
  if (reason.code === "GATE_OPENED_BUT_STREAK_SHORT") {
    return {
      action: "EXTEND_TICKS",
      plain:
        "The gate is opening but not holding. Re-run with more ticks per combo (e.g. 50 000) or more seeds for replication.",
    };
  }
  if (reason.code === "WEAK_GLOBAL_FIELD") {
    return {
      action: "INCREASE_GLOBAL_COUPLING",
      plain:
        "Increase global coupling strength (γ) in the next sweep. The Phase-0-Expanded preset already covers higher γ values.",
    };
  }
  if (reason.code === "PARTICIPATION_COLLAPSED") {
    return {
      action: "INCREASE_TEMPERATURE",
      plain:
        "Raise attention temperature (τ) so more neurons participate. The Phase-0-Expanded preset spans τ up to 3.0.",
    };
  }
  if (reason.code === "TEMPORAL_INSTABILITY") {
    return {
      action: "REDUCE_NOISE",
      plain:
        "Reduce noise (σ) and/or raise temporal coherence (δ) so transient integration can stabilize.",
    };
  }
  if (reason.code === "LOCAL_PASS_GLOBAL_FAIL") {
    return {
      action: "MORE_SEEDS",
      plain:
        "The integration may be a single-seed artifact. Re-run with the Replication preset to confirm across seeds.",
    };
  }
  // Used the full iteration budget without progress.
  if (view.iterations.length >= view.maxIterations) {
    return {
      action: "GIVE_UP_AND_REVISIT",
      plain:
        "Auto-Mode used its full iteration budget without finding the gate. Try the Phase-0-Expanded preset, or revisit the parameter ranges.",
    };
  }
  return {
    action: "INCREASE_GLOBAL_COUPLING",
    plain:
      "The gate hasn't opened yet — the Phase-0-Expanded preset is the natural next try.",
  };
}
