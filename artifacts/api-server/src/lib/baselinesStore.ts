import { JsonFileStore, DATA_DIR } from "./store.js";

// A "baseline" is a named pointer to a specific batch. Leaderboard rows can
// then show "delta vs baseline" so researchers can quickly see whether a code
// change improved or regressed each experiment.
export interface BaselineRecord {
  id: string;
  name: string;
  batchId: string;
  createdAt: number;
  notes?: string;
}

export const baselinesStore = new JsonFileStore<BaselineRecord>({
  baseDir: DATA_DIR,
  subdir: "baselines",
});

let nextBaselineNum = (() => {
  let max = 0;
  for (const b of baselinesStore.list()) {
    const n = Number(b.id.replace(/^bl/, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
})();

export function nextBaselineId(): string {
  return `bl${nextBaselineNum++}`;
}
