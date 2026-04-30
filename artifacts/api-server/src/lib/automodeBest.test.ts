import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  EMPTY_GLOBAL_BEST,
  shouldReplaceGlobalBest,
  updateGlobalBest,
  type IterationBest,
  type GlobalBest,
} from "./automodeBest.js";

const iter = (
  i: number,
  bestGateStreak: number,
  bestCAR: number,
): IterationBest => ({
  sweepId: `s${i}`,
  bestComboIndex: i,
  bestParams: { iter: i },
  bestGateStreak,
  bestCAR,
});

test("first iteration always becomes the global best", () => {
  const next = iter(0, 0, 0);
  const merged = updateGlobalBest(EMPTY_GLOBAL_BEST, next);
  assert.equal(merged.bestSweepId, "s0");
  assert.equal(merged.bestComboIndex, 0);
  assert.deepEqual(merged.bestParams, { iter: 0 });
});

test("higher gate streak wins regardless of CAR", () => {
  const after0 = updateGlobalBest(EMPTY_GLOBAL_BEST, iter(0, 100, 9.99));
  const merged = updateGlobalBest(after0, iter(1, 200, 0.01));
  assert.equal(merged.bestSweepId, "s1");
  assert.equal(merged.bestGateStreak, 200);
  assert.equal(merged.bestCAR, 0.01);
});

test("lower gate streak never wins, even with higher CAR", () => {
  const after0 = updateGlobalBest(EMPTY_GLOBAL_BEST, iter(0, 500, 1.0));
  const merged = updateGlobalBest(after0, iter(1, 100, 99.0));
  assert.equal(merged.bestSweepId, "s0");
  assert.equal(merged.bestGateStreak, 500);
  assert.equal(merged.bestCAR, 1.0);
});

test("on a gate-streak tie, higher CAR wins", () => {
  const after0 = updateGlobalBest(EMPTY_GLOBAL_BEST, iter(0, 300, 2.0));
  const merged = updateGlobalBest(after0, iter(1, 300, 5.0));
  assert.equal(merged.bestSweepId, "s1");
  assert.equal(merged.bestCAR, 5.0);
});

test("on a gate-streak tie, lower CAR is rejected", () => {
  const after0 = updateGlobalBest(EMPTY_GLOBAL_BEST, iter(0, 300, 5.0));
  const merged = updateGlobalBest(after0, iter(1, 300, 2.0));
  assert.equal(merged.bestSweepId, "s0");
  assert.equal(merged.bestCAR, 5.0);
});

// Regression test for the original bug: the buggy implementation compared
// the new iteration's CAR to the *previous* iteration's CAR (length - 2),
// which meant a low-CAR middle iteration could let a moderate-CAR final
// iteration overwrite a genuinely-better first iteration.
//
//   iter0: gateStreak=200 CAR=10  ← real winner
//   iter1: gateStreak=200 CAR=5
//   iter2: gateStreak=200 CAR=8
//
// Buggy logic compared iter2's CAR (8) to iter1's CAR (5) and updated.
// Correct logic compares iter2's CAR (8) to the running max (10) and
// rejects.
test("regression: weak middle iteration cannot be used as a baseline", () => {
  let best: GlobalBest = updateGlobalBest(EMPTY_GLOBAL_BEST, iter(0, 200, 10));
  best = updateGlobalBest(best, iter(1, 200, 5));
  best = updateGlobalBest(best, iter(2, 200, 8));
  assert.equal(best.bestSweepId, "s0", "iter0 should remain the winner");
  assert.equal(best.bestCAR, 10);
});

test("succeeding through all three keys keeps the right winner", () => {
  let best: GlobalBest = EMPTY_GLOBAL_BEST;
  best = updateGlobalBest(best, iter(0, 100, 5));
  best = updateGlobalBest(best, iter(1, 100, 7)); // tie + better CAR
  best = updateGlobalBest(best, iter(2, 50, 99)); // worse streak, ignore
  best = updateGlobalBest(best, iter(3, 800, 1)); // strictly better streak
  assert.equal(best.bestSweepId, "s3");
  assert.equal(best.bestGateStreak, 800);
});

test("shouldReplaceGlobalBest is consistent with updateGlobalBest", () => {
  const cur: GlobalBest = {
    bestSweepId: "s0",
    bestComboIndex: 0,
    bestParams: { a: 1 },
    bestGateStreak: 100,
    bestCAR: 5,
  };
  const winner = iter(1, 100, 6);
  const loser = iter(2, 100, 4);
  assert.equal(shouldReplaceGlobalBest(cur, winner), true);
  assert.equal(shouldReplaceGlobalBest(cur, loser), false);
  assert.equal(updateGlobalBest(cur, loser), cur, "rejected merge returns same ref");
});
