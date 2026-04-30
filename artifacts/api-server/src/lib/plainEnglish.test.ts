import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyGate,
  classifyFailureReason,
  nextStepRecommendation,
  PHI_MIN,
  PU_MIN,
  SC_MIN,
  type ComboMetrics,
  type AutoModeView,
} from "./plainEnglish.js";

const TARGET = 1000;

const empty: ComboMetrics = { ticksDone: 0 };
const passing: ComboMetrics = {
  ticksDone: 30000,
  finalPhi: 0.2,
  finalSC: 0.3,
  finalPU: 0.25,
  finalCAR: 0.5,
  bestCAR: 0.6,
  gateOpened: true,
  gateStreak: 1500,
};
const shortStreak: ComboMetrics = {
  ...passing,
  gateStreak: 600,
};
const collapsed: ComboMetrics = {
  ticksDone: 30000,
  finalPhi: 0,
  finalSC: 0,
  finalPU: 0,
  gateOpened: false,
  gateStreak: 0,
};
const weakGlobal: ComboMetrics = {
  ticksDone: 30000,
  finalPhi: 0.01,
  finalSC: 0.4,
  finalPU: 0.2,
  gateOpened: false,
  gateStreak: 0,
};
const unstable: ComboMetrics = {
  ticksDone: 30000,
  finalPhi: 0.2,
  finalSC: 0.01,
  finalPU: 0.2,
  gateOpened: false,
  gateStreak: 0,
};
const integratedNotPredictive: ComboMetrics = {
  ticksDone: 30000,
  finalPhi: 0.2,
  finalSC: 0.3,
  finalPU: 0.01,
  gateOpened: false,
  gateStreak: 0,
};

test("classifyGate: no data → red", () => {
  const v = classifyGate(empty, TARGET);
  assert.equal(v.color, "red");
});

test("classifyGate: gate held for full streak → green", () => {
  const v = classifyGate(passing, TARGET);
  assert.equal(v.color, "green");
  assert.match(v.summary, /confirmed/);
});

test("classifyGate: gate opened but streak short → yellow", () => {
  const v = classifyGate(shortStreak, TARGET);
  assert.equal(v.color, "yellow");
  assert.match(v.summary, /600/);
});

test("classifyGate: total collapse → red", () => {
  const v = classifyGate(collapsed, TARGET);
  assert.equal(v.color, "red");
});

test("classifyGate: signal but no gate → yellow", () => {
  const v = classifyGate(weakGlobal, TARGET);
  assert.equal(v.color, "yellow");
});

test("classifyFailureReason: passing run → OK", () => {
  assert.equal(classifyFailureReason(passing, TARGET).code, "OK");
});

test("classifyFailureReason: opened-but-short → GATE_OPENED_BUT_STREAK_SHORT", () => {
  assert.equal(
    classifyFailureReason(shortStreak, TARGET).code,
    "GATE_OPENED_BUT_STREAK_SHORT",
  );
});

test("classifyFailureReason: total collapse → PARTICIPATION_COLLAPSED", () => {
  assert.equal(
    classifyFailureReason(collapsed, TARGET).code,
    "PARTICIPATION_COLLAPSED",
  );
});

test("classifyFailureReason: weak Φ only → WEAK_GLOBAL_FIELD", () => {
  assert.equal(
    classifyFailureReason(weakGlobal, TARGET).code,
    "WEAK_GLOBAL_FIELD",
  );
});

test("classifyFailureReason: weak SC only → TEMPORAL_INSTABILITY", () => {
  assert.equal(
    classifyFailureReason(unstable, TARGET).code,
    "TEMPORAL_INSTABILITY",
  );
});

test("classifyFailureReason: weak PU only → LOCAL_PASS_GLOBAL_FAIL", () => {
  assert.equal(
    classifyFailureReason(integratedNotPredictive, TARGET).code,
    "LOCAL_PASS_GLOBAL_FAIL",
  );
});

test("classifyFailureReason: thresholds are inclusive at the floor", () => {
  // Right on the floor for every pillar should NOT trip the collapse branch.
  const onFloor: ComboMetrics = {
    ticksDone: 30000,
    finalPhi: PHI_MIN,
    finalSC: SC_MIN,
    finalPU: PU_MIN,
    gateOpened: false,
    gateStreak: 0,
  };
  assert.equal(
    classifyFailureReason(onFloor, TARGET).code,
    "GATE_NEVER_OPENED",
  );
});

const baseView: Omit<AutoModeView, "iterations" | "status"> = {
  gateStreakTarget: TARGET,
  maxIterations: 4,
  bestGateStreak: 0,
  bestCAR: 0,
};

test("nextStepRecommendation: empty + idle → RUN_FIRST", () => {
  const r = nextStepRecommendation({
    ...baseView,
    status: "completed",
    iterations: [],
  });
  assert.equal(r.action, "RUN_FIRST");
});

test("nextStepRecommendation: running → WAIT", () => {
  const r = nextStepRecommendation({
    ...baseView,
    status: "running",
    iterations: [collapsed],
  });
  assert.equal(r.action, "WAIT");
});

test("nextStepRecommendation: passed → PROCEED_TO_NEXT_PHASE", () => {
  const r = nextStepRecommendation({
    ...baseView,
    status: "succeeded",
    iterations: [collapsed, passing],
  });
  assert.equal(r.action, "PROCEED_TO_NEXT_PHASE");
});

test("nextStepRecommendation: gate flickered → EXTEND_TICKS", () => {
  const r = nextStepRecommendation({
    ...baseView,
    status: "completed",
    iterations: [collapsed, shortStreak],
  });
  assert.equal(r.action, "EXTEND_TICKS");
});

test("nextStepRecommendation: weak global field → INCREASE_GLOBAL_COUPLING", () => {
  const r = nextStepRecommendation({
    ...baseView,
    status: "completed",
    iterations: [weakGlobal],
  });
  assert.equal(r.action, "INCREASE_GLOBAL_COUPLING");
});

test("nextStepRecommendation: budget exhausted with collapse → GIVE_UP_AND_REVISIT", () => {
  const r = nextStepRecommendation({
    ...baseView,
    status: "completed",
    maxIterations: 2,
    iterations: [collapsed, collapsed],
  });
  assert.equal(r.action, "GIVE_UP_AND_REVISIT");
});

test("nextStepRecommendation: best-iteration tiebreaker uses CAR", () => {
  const a: ComboMetrics = { ...weakGlobal, gateStreak: 0, bestCAR: 0.1 };
  const b: ComboMetrics = { ...weakGlobal, gateStreak: 0, bestCAR: 0.5 };
  // Both classify as WEAK_GLOBAL_FIELD; if we pick by CAR tiebreak the
  // recommendation is still INCREASE_GLOBAL_COUPLING (verifies the helper
  // picked one without crashing rather than left `best` null).
  const r = nextStepRecommendation({
    ...baseView,
    status: "completed",
    iterations: [a, b],
  });
  assert.equal(r.action, "INCREASE_GLOBAL_COUPLING");
});
