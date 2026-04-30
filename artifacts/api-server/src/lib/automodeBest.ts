// Pure, testable helper for the Auto-Mode "global best" decision.
//
// An auto-mode session runs N successive sweeps and keeps a single
// "winner candidate" across iterations. Picking the winner correctly is
// non-trivial because two iterations can tie on the primary key
// (`bestGateStreak`). The earlier inline implementation compared the
// new iteration's CAR to the *previous* iteration's CAR rather than the
// running global maximum — which let a weaker later run overwrite a
// genuinely-better earlier winner. This module locks the right
// behaviour down behind a single function so a regression is caught by
// `node --test` instead of by an experiment dataset gone bad.

export interface IterationBest {
  sweepId: string;
  bestComboIndex: number;
  bestParams: Record<string, number | boolean | string> | null;
  bestGateStreak: number;
  bestCAR: number;
}

export interface GlobalBest {
  bestSweepId: string | null;
  bestComboIndex: number;
  bestParams: Record<string, number | boolean | string> | null;
  bestGateStreak: number;
  bestCAR: number;
}

export const EMPTY_GLOBAL_BEST: GlobalBest = {
  bestSweepId: null,
  bestComboIndex: -1,
  bestParams: null,
  bestGateStreak: 0,
  bestCAR: 0,
};

// Decide whether the new iteration should replace the running global best.
// Primary key: gate streak (closer to the v13 ≥1000 target wins).
// Tiebreaker: CAR — Coherence Amplification Ratio. Higher CAR means Φ rose
// because the network genuinely integrated, not because a few neurons
// synchronised by accident, so it's a sensible secondary score.
export function shouldReplaceGlobalBest(
  current: GlobalBest,
  next: IterationBest,
): boolean {
  if (current.bestParams === null) return true;
  if (next.bestGateStreak > current.bestGateStreak) return true;
  if (
    next.bestGateStreak === current.bestGateStreak &&
    next.bestCAR > current.bestCAR
  ) {
    return true;
  }
  return false;
}

export function updateGlobalBest(
  current: GlobalBest,
  next: IterationBest,
): GlobalBest {
  if (!shouldReplaceGlobalBest(current, next)) return current;
  return {
    bestSweepId: next.sweepId,
    bestComboIndex: next.bestComboIndex,
    bestParams: next.bestParams,
    bestGateStreak: next.bestGateStreak,
    bestCAR: next.bestCAR,
  };
}
