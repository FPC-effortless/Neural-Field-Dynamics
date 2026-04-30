import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findExperiment } from "@workspace/amisgc-core";
import { DATA_DIR } from "./store.js";
import { writeFileAtomicSync } from "./atomicWrite.js";

// v13 spec §3.2: every phase above PH0 is LOCKED until the Existence Gate
// (Φ>0.05 ∧ PU>0.1 ∧ S_C>0.1) has held continuously for ≥ 1000 ticks in at
// least one Phase-0 run. We persist the unlock event so it survives restarts
// and so subsequent batch / run requests can be rejected at the API boundary
// instead of silently producing meaningless data.
//
// The required gate streak threshold (1000 ticks) is the canonical default
// from the spec; callers may also pass a lower target if they're triggering
// the unlock from automode, but never higher than the on-disk record.

interface PhaseLockState {
  gateOpened: boolean;
  gateOpenedAt: number | null;
  openedByRunId: string | null;
  openedByExperimentId: string | null;
  openingGateStreak: number;
  // Manual override (set via POST /api/phase-status/override). Lets a
  // researcher unblock higher phases for debugging without having to first
  // hit the gate. Logged but not strictly enforced.
  manualOverride: boolean;
  manualOverrideAt: number | null;
  history: Array<{
    ts: number;
    runId: string;
    experimentId: string | null;
    gateStreak: number;
  }>;
}

const FILE = join(DATA_DIR, "phase-status.json");
const GATE_STREAK_REQUIRED = 1000;

function defaultState(): PhaseLockState {
  return {
    gateOpened: false,
    gateOpenedAt: null,
    openedByRunId: null,
    openedByExperimentId: null,
    openingGateStreak: 0,
    manualOverride: false,
    manualOverrideAt: null,
    history: [],
  };
}

function load(): PhaseLockState {
  if (!existsSync(FILE)) return defaultState();
  try {
    const raw = readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<PhaseLockState>;
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

function save(state: PhaseLockState): void {
  // writeFileAtomicSync handles mkdir + atomic rename, so a crash during
  // the write can never leave a corrupted phase-status.json behind.
  writeFileAtomicSync(FILE, JSON.stringify(state, null, 2));
}

let cache: PhaseLockState = load();

export function getPhaseStatus(): PhaseLockState {
  return { ...cache, history: [...cache.history] };
}

// Returns true iff higher phases are currently runnable (gate opened OR
// manual override set).
export function isUnlocked(): boolean {
  return cache.gateOpened || cache.manualOverride;
}

// Returns true if running this experiment is currently blocked by the lock.
// PH0 (and unknown / null phase) is always allowed.
export function isExperimentLocked(experimentId: string | null | undefined): boolean {
  if (isUnlocked()) return false;
  if (!experimentId) return false;
  const exp = findExperiment(experimentId);
  if (!exp) return false;
  return exp.phase !== "PH0";
}

// Called when a run finishes (or samples) with a long enough gate streak.
// Idempotent — only records the *first* qualifying event.
export function maybeMarkGateOpened(args: {
  runId: string;
  experimentId: string | null;
  gateStreak: number;
}): boolean {
  if (cache.gateOpened) return false;
  if (args.gateStreak < GATE_STREAK_REQUIRED) return false;
  cache = {
    ...cache,
    gateOpened: true,
    gateOpenedAt: Date.now(),
    openedByRunId: args.runId,
    openedByExperimentId: args.experimentId,
    openingGateStreak: args.gateStreak,
    history: [
      ...cache.history,
      {
        ts: Date.now(),
        runId: args.runId,
        experimentId: args.experimentId,
        gateStreak: args.gateStreak,
      },
    ].slice(-50),
  };
  save(cache);
  return true;
}

export function setManualOverride(enabled: boolean): PhaseLockState {
  cache = {
    ...cache,
    manualOverride: enabled,
    manualOverrideAt: enabled ? Date.now() : null,
  };
  save(cache);
  return getPhaseStatus();
}

// Reset the entire lock state. Intended for tests / starting a fresh study.
export function resetPhaseStatus(): PhaseLockState {
  cache = defaultState();
  save(cache);
  return getPhaseStatus();
}

export const PHASE_LOCK_GATE_STREAK_REQUIRED = GATE_STREAK_REQUIRED;
