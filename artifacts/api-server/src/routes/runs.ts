import { Router, type IRouter, type Request, type Response } from "express";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomicSync } from "../lib/atomicWrite.js";
import {
  startRun,
  ALL_EXPERIMENTS,
  PHASE_GROUPS,
  findExperiment,
  type RunCompleteEvent,
  type RunSampleEvent,
  type RunPhaseEvent,
  type RunStart,
  type Stats,
  type ExperimentSpec,
  bootstrapCI,
  welchT,
  bestMeasured as bestMeasuredCore,
} from "@workspace/amisgc-core";
import { runArcBenchmark, type ArcResult, type ArcSample } from "@workspace/amisgc-core";
import { notesStore } from "../lib/notesStore.js";
import { baselinesStore } from "../lib/baselinesStore.js";
import {
  isExperimentLocked,
  maybeMarkGateOpened,
  getPhaseStatus,
  setManualOverride,
  resetPhaseStatus,
  PHASE_LOCK_GATE_STREAK_REQUIRED,
} from "../lib/phaseLockStore.js";
import { updateGlobalBest } from "../lib/automodeBest.js";
import {
  classifyGate,
  classifyFailureReason,
  nextStepRecommendation,
  type ComboMetrics,
} from "../lib/plainEnglish.js";
import { PRESETS } from "../lib/presets.js";

interface RunRecord {
  id: string;
  experimentId: string | null;
  scale: 81 | 810 | 81000;
  // Optional neuron-count override (rebuilds the simulator grid). When set, it
  // takes precedence over `scale` for sizing.
  neurons?: number;
  // Optional Top-K override (absolute number of conscious neurons). When set,
  // converted to TOPK_FRACTION = topK / N at run time.
  topK?: number;
  status: "pending" | "running" | "completed" | "cancelled" | "error";
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  start?: RunStart;
  ticks: number;
  ticksDone: number;
  latestStats: Stats | null;
  result: RunCompleteEvent | null;
  arcResult: ArcResult | null;
  error: string | null;
  hypothesis?: string;
  passed?: boolean;
  metric?: string;
  measured?: number;
  target?: number;
  seed?: number;
  // SSE clients listening to this run
  subscribers: Set<Response>;
  // Last 200 sampled stats for backfill
  history: Array<{ t: number; stats: Stats }>;
  cancel: () => void;
}

const runs = new Map<string, RunRecord>();
let nextId = 1;
const MAX_HISTORY = 240;
const MAX_RUNS = 50;

// Clamp arbitrary neuron-count overrides from the UI/clients to a safe range.
// Returns undefined if no override was supplied (caller falls back to scale).
const NEURONS_MIN = 9;
const NEURONS_MAX = 102_400;
function clampNeurons(n: unknown): number | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  return Math.max(NEURONS_MIN, Math.min(NEURONS_MAX, Math.floor(n)));
}

// Clamp arbitrary Top-K overrides. Top-K is the absolute number of conscious
// neurons selected per tick (the top of the soft-attention distribution that
// the bottleneck/top-K attractor path uses). The value is clamped against the
// neuron-count ceiling and converted to a TOPK_FRACTION at apply time using
// the *resolved* N for that run, so the same `topK` works across scales.
const TOPK_MIN = 1;
const TOPK_MAX = NEURONS_MAX;
function clampTopK(n: unknown): number | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  return Math.max(TOPK_MIN, Math.min(TOPK_MAX, Math.floor(n)));
}

// Compute the effective neuron count N that the simulator will build for a
// given (scale, neurons-override) pair. Mirrors `paramsForNeurons` /
// `defaultParams` in the core: neurons override wins; otherwise scale picks G.
function effectiveN(scale: 81 | 810 | 81000, neurons: number | undefined): number {
  let G: number;
  if (typeof neurons === "number" && Number.isFinite(neurons)) {
    const clamped = Math.max(NEURONS_MIN, Math.min(NEURONS_MAX, Math.floor(neurons)));
    G = Math.max(3, Math.round(Math.sqrt(clamped)));
  } else if (scale === 81) G = 9;
  else if (scale === 810) G = Math.round(Math.sqrt(810));
  else G = Math.round(Math.sqrt(81000));
  return G * G;
}

// Merge a Top-K override into a customParams payload by computing
// TOPK_FRACTION = topK / N (clamped to (0, 1]). Returns the (possibly new)
// customParams object. If `topK` is undefined the original is returned as-is.
function applyTopKOverride(
  customParams: Record<string, number | boolean> | undefined,
  topK: number | undefined,
  scale: 81 | 810 | 81000,
  neurons: number | undefined,
): Record<string, number | boolean> | undefined {
  if (topK === undefined) return customParams;
  const N = effectiveN(scale, neurons);
  const fraction = Math.max(1 / N, Math.min(1, topK / N));
  return { ...(customParams ?? {}), TOPK_FRACTION: fraction };
}

function broadcast(run: RunRecord, event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const sub of run.subscribers) {
    try {
      sub.write(payload);
    } catch {
      run.subscribers.delete(sub);
    }
  }
}

function pruneRuns(): void {
  if (runs.size <= MAX_RUNS) return;
  const sortable = [...runs.values()].sort((a, b) => a.createdAt - b.createdAt);
  for (const r of sortable) {
    if (runs.size <= MAX_RUNS) break;
    if (r.status === "running" || r.status === "pending") continue;
    runs.delete(r.id);
  }
}

// ─── Input sanitisation ─────────────────────────────────────────────────────
// Everything from the wire goes through one of these. We accept only known
// scalar shapes; NaN, Infinity, strings inside numeric slots, and stray
// nested objects are silently dropped so the simulator's math layer never
// sees a bad value. Any limit (key length, array length) is generous enough
// for normal use but small enough that a malicious payload can't allocate
// gigabytes server-side before we even look at it.
const MAX_PARAM_KEY_LEN = 64;
const MAX_RANGE_VALUES = 16;

function sanitizeCustomParams(
  input: unknown,
): Record<string, number | boolean> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const out: Record<string, number | boolean> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof k !== "string" || k.length === 0 || k.length > MAX_PARAM_KEY_LEN) {
      continue;
    }
    if (typeof v === "boolean") {
      out[k] = v;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = v;
    }
    // Strings, NaN, Infinity, nested objects, null — all dropped.
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeRanges(input: unknown): Record<string, number[]> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const out: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof k !== "string" || k.length === 0 || k.length > MAX_PARAM_KEY_LEN) {
      continue;
    }
    if (!Array.isArray(v)) continue;
    const nums: number[] = [];
    for (const x of v) {
      if (typeof x === "number" && Number.isFinite(x)) nums.push(x);
      if (nums.length >= MAX_RANGE_VALUES) break;
    }
    if (nums.length > 0) out[k] = nums;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// ─── SSE heartbeat helpers ───────────────────────────────────────────────────
// Every /stream endpoint installs a 15s heartbeat to keep the proxied SSE
// connection alive. Earlier the interval was only cleared when the client
// closed the request — but if a run / sweep / batch / automode finished
// first, the orchestrator called `sub.end()` and forgot the timer, leaving
// it running until its own write throw eventually self-cleared. With many
// short-lived runs this leaks both heap and timer slots.
//
// We now stash the timer on the response object and clear it from a single
// helper that's called everywhere a subscriber is removed — both on the
// orchestrator's "all done, kick everyone off" path and on the per-client
// "tab closed" path.
const HEARTBEAT_INTERVAL_MS = 15000;
type ResWithHeartbeat = Response & { __heartbeat?: NodeJS.Timeout };

function installHeartbeat(res: Response): void {
  const r = res as ResWithHeartbeat;
  const interval = setInterval(() => {
    try {
      r.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      clearInterval(interval);
      delete r.__heartbeat;
    }
  }, HEARTBEAT_INTERVAL_MS);
  r.__heartbeat = interval;
}

function stopHeartbeat(res: Response): void {
  const r = res as ResWithHeartbeat;
  if (r.__heartbeat) {
    clearInterval(r.__heartbeat);
    delete r.__heartbeat;
  }
}

function endAllSubscribers(subs: Set<Response>): void {
  for (const sub of subs) {
    stopHeartbeat(sub);
    try {
      sub.end();
    } catch {
      /* ignore — already closed */
    }
  }
  subs.clear();
}

const router: IRouter = Router();

router.get("/experiments", (_req, res) => {
  const status = getPhaseStatus();
  const unlocked = status.gateOpened || status.manualOverride;
  res.json({
    experiments: ALL_EXPERIMENTS.map((e) => ({
      id: e.id,
      name: e.name,
      phase: e.phase,
      desc: e.desc,
      hypothesis: e.hypothesis,
      ticks: e.ticks,
      metric: e.metric,
      targetVal: e.targetVal,
      targetDir: e.targetDir,
      // v13 — let the UI grey-out locked phases without making a second call.
      locked: !unlocked && e.phase !== "PH0",
    })),
    groups: PHASE_GROUPS.map((g) => ({
      phase: g.phase,
      label: g.label,
      experimentIds: g.experiments.map((e) => e.id),
      locked: !unlocked && g.phase !== "PH0",
    })),
    phaseStatus: status,
  });
});

// v13 spec §3.2 — phase-lock state. The Existence Gate must be held for at
// least PHASE_LOCK_GATE_STREAK_REQUIRED consecutive ticks in a Phase-0 run
// before any higher-phase experiment / batch is allowed to start.
router.get("/phase-status", (_req, res) => {
  res.json({
    ...getPhaseStatus(),
    gateStreakRequired: PHASE_LOCK_GATE_STREAK_REQUIRED,
  });
});

// Manual override — for researcher debugging only. Does NOT count as the
// gate having been opened; just bypasses the lock check.
router.post("/phase-status/override", (req, res) => {
  const enabled = !!(req.body && (req.body as { enabled?: unknown }).enabled);
  res.json({
    ...setManualOverride(enabled),
    gateStreakRequired: PHASE_LOCK_GATE_STREAK_REQUIRED,
  });
});

// Reset the lock back to its initial (locked) state. Useful when starting a
// brand-new study or re-validating that the protocol works end-to-end.
router.post("/phase-status/reset", (_req, res) => {
  res.json({
    ...resetPhaseStatus(),
    gateStreakRequired: PHASE_LOCK_GATE_STREAK_REQUIRED,
  });
});

router.post("/runs", (req, res) => {
  const body = (req.body ?? {}) as {
    experimentId?: string;
    scale?: 81 | 810 | 81000;
    neurons?: number;
    topK?: number;
    ticks?: number;
    customParams?: Record<string, number | boolean>;
    type?: "experiment" | "arc";
    arc?: { numTasks?: number; trainTicksPerTask?: number; testInputs?: number };
    seed?: number;
  };
  const id = `r${nextId++}`;
  const scale = (body.scale ?? 81) as 81 | 810 | 81000;
  const neurons = clampNeurons(body.neurons);
  const topK = clampTopK(body.topK);
  const isArc = body.type === "arc";

  // v13 spec §3.2 — block runs of higher-phase experiments until the
  // Existence Gate has been opened in a Phase-0 run. ARC harness runs and
  // ad-hoc / Phase-0 / null-experiment runs are always allowed.
  if (!isArc && body.experimentId && isExperimentLocked(body.experimentId)) {
    const status = getPhaseStatus();
    res.status(423).json({
      error: "phase_locked",
      message:
        `Experiment ${body.experimentId} is in a higher phase that is locked ` +
        `until the Existence Gate has been held for ` +
        `≥ ${PHASE_LOCK_GATE_STREAK_REQUIRED} ticks in a Phase-0 run.`,
      phaseStatus: status,
    });
    return;
  }

  const exp = body.experimentId ? findExperiment(body.experimentId) : undefined;
  const requestedTicks = body.ticks ?? exp?.ticks ?? 5000;
  const ticks = Math.min(Math.max(requestedTicks, 100), 200000);

  // Top-K override merges into customParams as TOPK_FRACTION = topK / N.
  // sanitizeCustomParams strips NaN / Infinity / non-scalar values before
  // they ever reach the simulator's math layer.
  const cleanCustomParams = sanitizeCustomParams(body.customParams);
  const customParams = applyTopKOverride(cleanCustomParams, topK, scale, neurons);

  const record: RunRecord = {
    id,
    experimentId: body.experimentId ?? null,
    scale,
    ...(neurons !== undefined ? { neurons } : {}),
    ...(topK !== undefined ? { topK } : {}),
    status: "pending",
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
    ticks,
    ticksDone: 0,
    latestStats: null,
    result: null,
    arcResult: null,
    error: null,
    ...(exp?.hypothesis ? { hypothesis: exp.hypothesis } : {}),
    subscribers: new Set(),
    history: [],
    cancel: () => undefined,
  };
  runs.set(id, record);
  pruneRuns();

  if (isArc) {
    const signal = { cancelled: false };
    record.cancel = () => {
      signal.cancelled = true;
      record.status = "cancelled";
      broadcast(record, "cancelled", { id });
    };
    record.status = "running";
    record.startedAt = Date.now();

    runArcBenchmark({
      scale,
      ...(neurons !== undefined ? { neurons } : {}),
      numTasks: body.arc?.numTasks ?? 20,
      trainTicksPerTask: body.arc?.trainTicksPerTask ?? 1500,
      testInputs: body.arc?.testInputs ?? 3,
      // Thread the run-level seed through so ARC probe inputs are
      // reproducible across reruns of the same configuration.
      ...(typeof body.seed === "number" && Number.isFinite(body.seed)
        ? { seed: Math.floor(body.seed) }
        : {}),
      signal,
      onProgress: (done, total, sample) => {
        record.ticksDone = done;
        record.ticks = total;
        broadcast(record, "arc_sample", { done, total, sample });
      },
    })
      .then((result) => {
        record.arcResult = result;
        record.completedAt = Date.now();
        record.latestStats = result.finalStats;
        record.passed = result.solveRate >= 0.5;
        record.measured = result.solveRate;
        record.target = 0.5;
        record.metric = "solveRate";
        if (!signal.cancelled) {
          record.status = "completed";
          broadcast(record, "complete", {
            id,
            result: {
              solveRate: result.solveRate,
              correct: result.correct,
              total: result.total,
              finalStats: result.finalStats,
            },
          });
        } else {
          record.status = "cancelled";
        }
        endAllSubscribers(record.subscribers);
      })
      .catch((err) => {
        record.status = "error";
        record.error = (err as Error).message;
        record.completedAt = Date.now();
        broadcast(record, "error", { message: record.error });
        endAllSubscribers(record.subscribers);
      });

    res.status(201).json({ id, status: record.status, type: "arc" });
    return;
  }

  const handle = startRun({
    scale,
    ...(neurons !== undefined ? { neurons } : {}),
    ...(body.experimentId ? { experimentId: body.experimentId } : {}),
    ticks,
    ...(customParams ? { customParams: customParams as Record<string, never> } : {}),
    ...(typeof body.seed === "number" && Number.isFinite(body.seed)
      ? { seed: Math.floor(body.seed) }
      : {}),
    onStart: (info) => {
      record.start = info;
      record.seed = info.seed;
      record.status = "running";
      record.startedAt = Date.now();
      broadcast(record, "start", info);
    },
    onSample: (e: RunSampleEvent) => {
      record.ticksDone = e.t;
      record.latestStats = e.stats;
      record.history.push({ t: e.t, stats: e.stats });
      if (record.history.length > MAX_HISTORY) record.history.shift();
      broadcast(record, "sample", e);
    },
    onPhase: (e: RunPhaseEvent) => {
      broadcast(record, "phase", e);
    },
    onComplete: (e: RunCompleteEvent) => {
      record.result = e;
      record.passed = e.passed;
      if (e.metric) record.metric = e.metric;
      if (e.measured !== undefined) record.measured = e.measured;
      if (e.target !== undefined) record.target = e.target;
      record.completedAt = Date.now();
      record.status = record.status === "cancelled" ? "cancelled" : "completed";
      // v13 spec §3.2 — if this run held the gate long enough, unlock all
      // higher phases for subsequent runs/batches/sweeps.
      const finalStreak = record.latestStats?.gateStreak ?? 0;
      maybeMarkGateOpened({
        runId: record.id,
        experimentId: record.experimentId,
        gateStreak: finalStreak,
      });
      broadcast(record, "complete", e);
      endAllSubscribers(record.subscribers);
    },
    onError: (err) => {
      record.status = "error";
      record.error = err.message;
      record.completedAt = Date.now();
      broadcast(record, "error", { message: err.message });
      endAllSubscribers(record.subscribers);
    },
  });
  record.cancel = () => {
    handle.cancel();
    if (record.status === "running" || record.status === "pending") {
      record.status = "cancelled";
      broadcast(record, "cancelled", { id });
    }
  };
  // Don't await — return run id immediately
  handle.promise.catch(() => undefined);

  res.status(201).json({ id, status: record.status, seed: record.seed ?? null });
});

router.get("/runs", (_req, res) => {
  res.json({
    runs: [...runs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => serializeRun(r, false)),
  });
});

router.get("/runs/:id", (req, res) => {
  const r = runs.get(req.params.id as string);
  if (!r) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(serializeRun(r, true));
});

router.delete("/runs/:id", (req, res) => {
  const r = runs.get(req.params.id as string);
  if (!r) {
    res.status(404).json({ error: "not found" });
    return;
  }
  r.cancel();
  res.json({ id: r.id, status: r.status });
});

router.get("/runs/:id/stream", (req, res) => {
  const r = runs.get(req.params.id as string);
  if (!r) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  // Initial snapshot
  res.write(`event: snapshot\ndata: ${JSON.stringify(serializeRun(r, true))}\n\n`);
  // Backfill last few samples
  for (const h of r.history.slice(-30)) {
    res.write(`event: sample\ndata: ${JSON.stringify(h)}\n\n`);
  }
  if (r.status === "completed" || r.status === "error" || r.status === "cancelled") {
    res.write(`event: complete\ndata: ${JSON.stringify(r.result ?? {})}\n\n`);
    res.end();
    return;
  }
  r.subscribers.add(res);
  // Heartbeat to prevent idle disconnect
  installHeartbeat(res);
  req.on("close", () => {
    stopHeartbeat(res);
    r.subscribers.delete(res);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auto-sweep — serial cartesian product over a small set of ranges.
// Tracks the best (highest gateStreak) configuration seen so far.
// ─────────────────────────────────────────────────────────────────────────────

interface SweepCombo {
  index: number;
  params: Record<string, number | boolean | string>;
  status: "pending" | "running" | "completed" | "skipped";
  gateOpened: boolean;
  gateStreak: number;
  finalPhi: number;
  finalSC: number;
  finalPU: number;
  // Coherence Amplification Ratio (Φ / (1 − H_C/H_max + ε)). The sweep table
  // surfaces both the *current* CAR (last sample) and the running max so the
  // UI can sort live by which combos are amplifying coherence the most.
  finalCAR: number;
  bestCAR: number;
  ticksDone: number;
  runId: string | null;
}

interface SweepRecord {
  id: string;
  status: "pending" | "running" | "completed" | "cancelled";
  createdAt: number;
  completedAt: number | null;
  ticksPerCombo: number;
  scale: 81 | 810 | 81000;
  // Optional neuron-count override for every combo in this sweep. When set it
  // takes precedence over `scale` when sizing the simulator grid.
  neurons?: number;
  // Optional Top-K override (absolute count). Stored on the sweep so reruns
  // and refines preserve it; applied to each combo's params via TOPK_FRACTION.
  topK?: number;
  // Optional reference to an auto-mode session. Set when this sweep was
  // launched as one iteration of an /api/automode session, so the UI can
  // group sweep history by session and the auto-loop can resume cleanly.
  autoModeId?: string;
  autoModeIteration?: number;
  combos: SweepCombo[];
  currentIndex: number;
  bestIndex: number;
  cancelled: boolean;
  subscribers: Set<Response>;
}

const sweeps = new Map<string, SweepRecord>();
let nextSweepId = 1;
const MAX_SWEEPS = 10;

// ─── Sweep disk persistence (mirrors batches) ────────────────────────────────
const SWEEPS_DIR = join(process.cwd(), "data", "sweeps");
try {
  mkdirSync(SWEEPS_DIR, { recursive: true });
} catch {
  /* best-effort */
}

function persistSweep(s: SweepRecord): void {
  try {
    writeFileAtomicSync(
      join(SWEEPS_DIR, `${s.id}.json`),
      JSON.stringify(serializeSweep(s), null, 2),
    );
  } catch {
    /* best-effort */
  }
}

function loadPersistedSweeps(): void {
  let entries: string[];
  try {
    entries = readdirSync(SWEEPS_DIR);
  } catch {
    return;
  }
  let maxId = 0;
  for (const file of entries) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = readFileSync(join(SWEEPS_DIR, file), "utf8");
      const data = JSON.parse(raw) as ReturnType<typeof serializeSweep>;
      const reloadStatus =
        data.status === "running" || data.status === "pending"
          ? "cancelled"
          : data.status;
      const rec: SweepRecord = {
        id: data.id,
        status: reloadStatus,
        createdAt: data.createdAt,
        completedAt: data.completedAt ?? Date.now(),
        ticksPerCombo: data.ticksPerCombo,
        scale: data.scale,
        ...(typeof (data as { neurons?: number }).neurons === "number"
          ? { neurons: (data as { neurons: number }).neurons }
          : {}),
        ...(typeof (data as { topK?: number }).topK === "number"
          ? { topK: (data as { topK: number }).topK }
          : {}),
        ...(typeof (data as { autoModeId?: string }).autoModeId === "string"
          ? { autoModeId: (data as { autoModeId: string }).autoModeId }
          : {}),
        ...(typeof (data as { autoModeIteration?: number }).autoModeIteration === "number"
          ? {
              autoModeIteration: (data as { autoModeIteration: number })
                .autoModeIteration,
            }
          : {}),
        combos: data.combos.map((c) => ({
          ...c,
          finalCAR: typeof c.finalCAR === "number" ? c.finalCAR : 0,
          bestCAR: typeof c.bestCAR === "number" ? c.bestCAR : 0,
        })),
        currentIndex: data.currentIndex,
        bestIndex: data.bestIndex,
        cancelled: reloadStatus === "cancelled",
        subscribers: new Set(),
      };
      sweeps.set(rec.id, rec);
      const num = Number(rec.id.replace(/^s/, ""));
      if (Number.isFinite(num) && num > maxId) maxId = num;
    } catch {
      /* skip corrupt */
    }
  }
  if (maxId >= nextSweepId) nextSweepId = maxId + 1;
}
loadPersistedSweeps();

function broadcastSweep(s: SweepRecord, event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const sub of s.subscribers) {
    try {
      sub.write(payload);
    } catch {
      s.subscribers.delete(sub);
    }
  }
}

function pruneSweeps(): void {
  if (sweeps.size <= MAX_SWEEPS) return;
  const sortable = [...sweeps.values()].sort((a, b) => a.createdAt - b.createdAt);
  for (const s of sortable) {
    if (sweeps.size <= MAX_SWEEPS) break;
    if (s.status === "running" || s.status === "pending") continue;
    sweeps.delete(s.id);
  }
}

function cartesian(
  ranges: Record<string, number[]>
): Array<Record<string, number>> {
  const keys = Object.keys(ranges);
  if (keys.length === 0) return [{}];
  let acc: Array<Record<string, number>> = [{}];
  for (const k of keys) {
    const next: Array<Record<string, number>> = [];
    for (const a of acc) {
      for (const v of ranges[k] as number[]) next.push({ ...a, [k]: v });
    }
    acc = next;
  }
  return acc;
}

// "Better" = larger gateStreak first, then higher max-CAR, then higher Φ,
// then higher PU. CAR is the new tiebreaker because the UI sorts on it
// live and we want the surface "best" to track the table's leader.
function isBetterCombo(a: SweepCombo, b: SweepCombo): boolean {
  if (a.gateStreak !== b.gateStreak) return a.gateStreak > b.gateStreak;
  if (a.bestCAR !== b.bestCAR) return a.bestCAR > b.bestCAR;
  if (a.finalPhi !== b.finalPhi) return a.finalPhi > b.finalPhi;
  return a.finalPU > b.finalPU;
}

function serializeSweep(s: SweepRecord) {
  return {
    id: s.id,
    status: s.status,
    createdAt: s.createdAt,
    completedAt: s.completedAt,
    ticksPerCombo: s.ticksPerCombo,
    scale: s.scale,
    ...(s.neurons !== undefined ? { neurons: s.neurons } : {}),
    ...(s.topK !== undefined ? { topK: s.topK } : {}),
    ...(s.autoModeId !== undefined ? { autoModeId: s.autoModeId } : {}),
    ...(s.autoModeIteration !== undefined
      ? { autoModeIteration: s.autoModeIteration }
      : {}),
    currentIndex: s.currentIndex,
    bestIndex: s.bestIndex,
    total: s.combos.length,
    combos: s.combos,
  };
}

async function runSweepCombo(
  s: SweepRecord,
  combo: SweepCombo
): Promise<void> {
  return new Promise((resolve) => {
    if (s.cancelled) {
      combo.status = "skipped";
      resolve();
      return;
    }
    combo.status = "running";
    broadcastSweep(s, "combo_start", { sweepId: s.id, combo });

    const id = `r${nextId++}`;
    const record: RunRecord = {
      id,
      experimentId: `sweep:${s.id}:${combo.index}`,
      scale: s.scale,
      ...(s.neurons !== undefined ? { neurons: s.neurons } : {}),
      ...(s.topK !== undefined ? { topK: s.topK } : {}),
      status: "pending",
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      ticks: s.ticksPerCombo,
      ticksDone: 0,
      latestStats: null,
      result: null,
      arcResult: null,
      error: null,
      subscribers: new Set(),
      history: [],
      cancel: () => undefined,
    };
    runs.set(id, record);
    pruneRuns();
    combo.runId = id;

    const handle = startRun({
      scale: s.scale,
      ...(s.neurons !== undefined ? { neurons: s.neurons } : {}),
      ticks: s.ticksPerCombo,
      customParams: combo.params as Record<string, never>,
      onStart: (info) => {
        record.start = info;
        record.status = "running";
        record.startedAt = Date.now();
      },
      onSample: (e: RunSampleEvent) => {
        record.ticksDone = e.t;
        record.latestStats = e.stats;
        combo.ticksDone = e.t;
        combo.gateStreak = Math.max(combo.gateStreak, e.stats.gateStreak ?? 0);
        if (e.stats.existenceGate === 1) combo.gateOpened = true;
        combo.finalPhi = e.stats.networkPhi;
        combo.finalSC = e.stats.networkSC;
        combo.finalPU = e.stats.networkPU ?? 0;
        const car = e.stats.networkCAR ?? 0;
        combo.finalCAR = car;
        if (Number.isFinite(car) && car > combo.bestCAR) combo.bestCAR = car;
        // Live-update bestIndex on every sample so the UI's CAR-sorted view
        // surfaces leaders before any combo finishes.
        const cur = s.combos[s.bestIndex];
        if (!cur || isBetterCombo(combo, cur)) s.bestIndex = combo.index;
        if (record.history.length === 0 || e.t - (record.history.at(-1)?.t ?? 0) >= 200) {
          record.history.push({ t: e.t, stats: e.stats });
          if (record.history.length > MAX_HISTORY) record.history.shift();
        }
        if (e.t % 1000 === 0)
          broadcastSweep(s, "combo_progress", { sweepId: s.id, combo });
      },
      onPhase: () => undefined,
      onComplete: (e: RunCompleteEvent) => {
        record.result = e;
        record.passed = e.passed;
        record.metric = e.metric;
        record.measured = e.measured;
        record.target = e.target;
        record.completedAt = Date.now();
        record.status = "completed";
        combo.status = "completed";
        const cur = s.combos[s.bestIndex];
        if (!cur || isBetterCombo(combo, cur)) s.bestIndex = combo.index;
        // v13 spec §3.2 — Phase-0 sweeps are the path that opens the gate.
        // Promote the unlock as soon as any combo qualifies.
        const finalStreak = record.latestStats?.gateStreak ?? combo.gateStreak;
        maybeMarkGateOpened({
          runId: record.id,
          experimentId: record.experimentId,
          gateStreak: finalStreak,
        });
        persistSweep(s);
        broadcastSweep(s, "combo_complete", { sweepId: s.id, combo, bestIndex: s.bestIndex });
        resolve();
      },
      onError: (err) => {
        record.status = "error";
        record.error = err.message;
        record.completedAt = Date.now();
        combo.status = "completed";
        persistSweep(s);
        broadcastSweep(s, "combo_complete", { sweepId: s.id, combo, bestIndex: s.bestIndex });
        resolve();
      },
    });
    record.cancel = () => handle.cancel();
    // Safety net: if the runner promise settles abnormally (e.g. a future
    // bug causes neither onComplete nor onError to fire), we still resolve
    // the combo so the orchestrator's for-loop can advance instead of
    // deadlocking. resolve() is idempotent — extra calls are no-ops.
    handle.promise
      .catch((err: unknown) => {
        if (record.status === "running" || record.status === "pending") {
          record.status = "error";
          record.error = err instanceof Error ? err.message : String(err);
          record.completedAt = Date.now();
        }
        if (combo.status === "running" || combo.status === "pending") {
          combo.status = "completed";
          persistSweep(s);
          broadcastSweep(s, "combo_complete", {
            sweepId: s.id,
            combo,
            bestIndex: s.bestIndex,
          });
        }
      })
      .finally(() => resolve());
  });
}

// v13 final Phase-0 grid (spec §5.1) — designed to force strong global
// coupling. 5 × 4 × 4 × 3 × 3 = 720 combinations.
//   τ ∈ {0.7, 1.0, 1.5, 2.0, 3.0}   attention sharpness
//   γ ∈ {1.0, 1.5, 2.0, 3.0}        global coupling strength
//   β ∈ {0.1, 0.3, 0.5, 0.8}        broad-participation reward
//   δ ∈ {0.2, 0.4, 0.6}             temporal coherence
//   σ ∈ {0.01, 0.02, 0.05}          noise level
const PHASE0_DEFAULT_RANGES: Record<string, number[]> = {
  TAU_ATT: [0.7, 1.0, 1.5, 2.0, 3.0],
  GAMMA_GLOBAL: [1.0, 1.5, 2.0, 3.0],
  BETA_ENTROPY: [0.1, 0.3, 0.5, 0.8],
  DELTA_TEMPORAL: [0.2, 0.4, 0.6],
  NOISE_SIGMA: [0.01, 0.02, 0.05],
};
// v13 spec: each combo runs for 30 000 ticks by default; runs are auto-
// extended to PHASE0_MAX_TICKS when Φ shows a clear upward trend in the
// final 5 000 ticks (see maybeExtendTicks). 50× headroom over the 1 000-tick
// gate streak target.
const PHASE0_DEFAULT_TICKS = 30000;
const PHASE0_MAX_TICKS = 50000;
// Sweep cap raised from 400 → 1000 to fit the 720-combo v13 grid plus
// hand-edited explorations.
const SWEEP_MAX_COMBOS = 1000;

router.post("/sweeps", (req, res) => {
  const body = (req.body ?? {}) as {
    ranges?: Record<string, number[]>;
    ticksPerCombo?: number;
    scale?: 81 | 810 | 81000;
    neurons?: number;
    topK?: number;
    autoModeId?: string;
    autoModeIteration?: number;
  };
  // sanitizeRanges drops bad numeric values (NaN/Infinity/strings) and
  // caps each axis at MAX_RANGE_VALUES so a malicious client can't ask
  // for a 10⁹-cell grid.
  const ranges: Record<string, number[]> =
    sanitizeRanges(body.ranges) ?? PHASE0_DEFAULT_RANGES;
  const ticksPerCombo = Math.min(
    Math.max(body.ticksPerCombo ?? PHASE0_DEFAULT_TICKS, 500),
    PHASE0_MAX_TICKS,
  );
  const scale = (body.scale ?? 81) as 81 | 810 | 81000;
  const neurons = clampNeurons(body.neurons);
  const topK = clampTopK(body.topK);
  const grid = cartesian(ranges);
  if (grid.length === 0 || grid.length > SWEEP_MAX_COMBOS) {
    res.status(400).json({
      error: `ranges must produce 1..${SWEEP_MAX_COMBOS} combinations`,
    });
    return;
  }
  const id = `s${nextSweepId++}`;
  // Top-K override is converted to TOPK_FRACTION using the resolved N once and
  // stamped into every combo's params, so it travels with the saved sweep.
  const N = effectiveN(scale, neurons);
  const topkFraction =
    topK !== undefined ? Math.max(1 / N, Math.min(1, topK / N)) : undefined;
  const sweep: SweepRecord = {
    id,
    status: "pending",
    createdAt: Date.now(),
    completedAt: null,
    ticksPerCombo,
    scale,
    ...(neurons !== undefined ? { neurons } : {}),
    ...(topK !== undefined ? { topK } : {}),
    ...(typeof body.autoModeId === "string" ? { autoModeId: body.autoModeId } : {}),
    ...(typeof body.autoModeIteration === "number"
      ? { autoModeIteration: body.autoModeIteration }
      : {}),
    combos: grid.map((p, i) => ({
      index: i,
      params: {
        ATTN_MODE: "soft",
        USE_BOTTLENECK: false,
        ...(topkFraction !== undefined ? { TOPK_FRACTION: topkFraction } : {}),
        ...p,
      },
      status: "pending",
      gateOpened: false,
      gateStreak: 0,
      finalPhi: 0,
      finalSC: 0,
      finalPU: 0,
      finalCAR: 0,
      bestCAR: 0,
      ticksDone: 0,
      runId: null,
    })),
    currentIndex: 0,
    bestIndex: 0,
    cancelled: false,
    subscribers: new Set(),
  };
  sweeps.set(id, sweep);
  pruneSweeps();

  // Kick off serial execution
  (async () => {
    sweep.status = "running";
    broadcastSweep(sweep, "sweep_start", serializeSweep(sweep));
    for (let i = 0; i < sweep.combos.length; i++) {
      if (sweep.cancelled) break;
      sweep.currentIndex = i;
      await runSweepCombo(sweep, sweep.combos[i] as SweepCombo);
    }
    sweep.status = sweep.cancelled ? "cancelled" : "completed";
    sweep.completedAt = Date.now();
    persistSweep(sweep);
    broadcastSweep(sweep, "sweep_complete", serializeSweep(sweep));
    endAllSubscribers(sweep.subscribers);
  })().catch(() => undefined);

  res.status(201).json({ id, total: sweep.combos.length });
});

router.get("/sweeps", (_req, res) => {
  res.json({
    sweeps: [...sweeps.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(serializeSweep),
  });
});

router.get("/sweeps/:id", (req, res) => {
  const s = sweeps.get(req.params.id as string);
  if (!s) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(serializeSweep(s));
});

router.delete("/sweeps/:id", (req, res) => {
  const s = sweeps.get(req.params.id as string);
  if (!s) {
    res.status(404).json({ error: "not found" });
    return;
  }
  s.cancelled = true;
  // Cancel current child run if any
  const cur = s.combos[s.currentIndex];
  if (cur?.runId) {
    const r = runs.get(cur.runId);
    if (r) r.cancel();
  }
  // Eagerly flip status + broadcast so SSE-subscribed UIs reflect the cancel
  // within milliseconds, instead of waiting for the runner's next yield to
  // unwind the orchestrator loop. The orchestrator will set the final status
  // when its `for` loop exits, but in the interim "cancelled" is correct.
  if (s.status === "running" || s.status === "pending") {
    s.status = "cancelled";
    broadcastSweep(s, "sweep_cancelled", serializeSweep(s));
  }
  res.json({ id: s.id, status: "cancelled" });
});

router.get("/sweeps/:id/stream", (req, res) => {
  const s = sweeps.get(req.params.id as string);
  if (!s) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(`event: snapshot\ndata: ${JSON.stringify(serializeSweep(s))}\n\n`);
  if (s.status === "completed" || s.status === "cancelled") {
    res.write(`event: sweep_complete\ndata: ${JSON.stringify(serializeSweep(s))}\n\n`);
    res.end();
    return;
  }
  s.subscribers.add(res);
  installHeartbeat(res);
  req.on("close", () => {
    stopHeartbeat(res);
    s.subscribers.delete(res);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Batches — run a list of experiments serially, with optional repeats per
// experiment (multi-run for variance), with live progress + cancellation.
// ─────────────────────────────────────────────────────────────────────────────

interface BatchItem {
  index: number;
  experimentId: string;
  experimentName: string;
  phase: string;
  metric: string;
  target: number;
  targetDir: 1 | -1;
  hypothesis: string;
  runIds: string[];
  measuredValues: number[];
  // Seeds actually used for each repeat (in order). Lets us replay exactly.
  seeds: number[];
  passes: number;
  totalRuns: number;
  status: "pending" | "running" | "completed" | "skipped" | "error";
  meanMeasured: number | null;
  stdMeasured: number | null;
  ticksDone: number;
  ticksTotal: number;
  durationMs: number;
}

interface BatchRecord {
  id: string;
  status: "pending" | "running" | "completed" | "cancelled" | "interrupted";
  scale: 81 | 810 | 81000;
  // Optional neuron-count override applied to every item/repeat in this batch.
  neurons?: number;
  // Optional Top-K override (absolute count) applied to every item via
  // TOPK_FRACTION = topK / N. Stored on the batch so reruns preserve it.
  topK?: number;
  ticksPerExperiment: number | null;
  repeats: number;
  // Base seed; per-repeat seeds derived as deriveSeed(baseSeed, item.index, r).
  // Persisting this lets a batch be re-run byte-for-byte identically.
  baseSeed: number;
  createdAt: number;
  completedAt: number | null;
  currentIndex: number;
  totalCompleted: number;
  totalPassed: number;
  cancelled: boolean;
  items: BatchItem[];
  subscribers: Set<Response>;
  cancelChild: () => void;
}

function deriveSeed(base: number, itemIndex: number, repeatIndex: number): number {
  // Mix using xorshift-like steps so adjacent items don't share entropy.
  let x = (base ^ ((itemIndex + 1) * 0x9E3779B1) ^ ((repeatIndex + 1) * 0x85EBCA77)) >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) || 1;
}

const batches = new Map<string, BatchRecord>();
let nextBatchId = 1;
const MAX_BATCHES = 10;

// ─── Disk persistence (batches survive API restarts) ─────────────────────────
const BATCHES_DIR = join(process.cwd(), "data", "batches");
try {
  mkdirSync(BATCHES_DIR, { recursive: true });
} catch {
  /* best-effort */
}

function persistBatch(b: BatchRecord): void {
  try {
    const snapshot = serializeBatch(b);
    writeFileAtomicSync(
      join(BATCHES_DIR, `${b.id}.json`),
      JSON.stringify(snapshot, null, 2),
    );
  } catch {
    /* best-effort */
  }
}

function loadPersistedBatches(): void {
  let entries: string[];
  try {
    entries = readdirSync(BATCHES_DIR);
  } catch {
    return;
  }
  let maxId = 0;
  for (const file of entries) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = readFileSync(join(BATCHES_DIR, file), "utf8");
      const data = JSON.parse(raw) as ReturnType<typeof serializeBatch>;
      // Crashed mid-flight batches reload as "interrupted" so leaderboard /
      // dashboard can flag them differently from user-cancelled.
      const reloadStatus =
        data.status === "running" || data.status === "pending"
          ? "interrupted"
          : data.status;
      const rec: BatchRecord = {
        id: data.id,
        status: reloadStatus,
        scale: data.scale,
        ...(typeof (data as { neurons?: number }).neurons === "number"
          ? { neurons: (data as { neurons: number }).neurons }
          : {}),
        ...(typeof (data as { topK?: number }).topK === "number"
          ? { topK: (data as { topK: number }).topK }
          : {}),
        ticksPerExperiment: data.ticksPerExperiment,
        repeats: data.repeats,
        baseSeed: typeof data.baseSeed === "number" ? data.baseSeed : 0,
        createdAt: data.createdAt,
        completedAt: data.completedAt ?? Date.now(),
        currentIndex: data.currentIndex,
        totalCompleted: data.totalCompleted,
        totalPassed: data.totalPassed,
        cancelled: reloadStatus === "cancelled" || reloadStatus === "interrupted",
        items: (data.items ?? []).map((it: BatchItem) => ({
          ...it,
          seeds: Array.isArray(it.seeds) ? it.seeds : [],
        })),
        subscribers: new Set(),
        cancelChild: () => undefined,
      };
      batches.set(rec.id, rec);
      const num = Number(rec.id.replace(/^b/, ""));
      if (Number.isFinite(num) && num > maxId) maxId = num;
    } catch {
      /* skip corrupt file */
    }
  }
  if (maxId >= nextBatchId) nextBatchId = maxId + 1;
}
loadPersistedBatches();

function broadcastBatch(b: BatchRecord, event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const sub of b.subscribers) {
    try {
      sub.write(payload);
    } catch {
      b.subscribers.delete(sub);
    }
  }
}

function pruneBatches(): void {
  if (batches.size <= MAX_BATCHES) return;
  const sortable = [...batches.values()].sort((a, b) => a.createdAt - b.createdAt);
  for (const b of sortable) {
    if (batches.size <= MAX_BATCHES) break;
    if (b.status === "running" || b.status === "pending") continue;
    batches.delete(b.id);
  }
}

function meanStd(xs: number[]): { mean: number | null; std: number | null } {
  const valid = xs.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return { mean: null, std: null };
  const m = valid.reduce((a, b) => a + b, 0) / valid.length;
  if (valid.length < 2) return { mean: m, std: 0 };
  const v = valid.reduce((a, b) => a + (b - m) ** 2, 0) / (valid.length - 1);
  return { mean: m, std: Math.sqrt(v) };
}

function serializeBatch(b: BatchRecord) {
  return {
    id: b.id,
    status: b.status,
    scale: b.scale,
    ...(b.neurons !== undefined ? { neurons: b.neurons } : {}),
    ...(b.topK !== undefined ? { topK: b.topK } : {}),
    ticksPerExperiment: b.ticksPerExperiment,
    repeats: b.repeats,
    baseSeed: b.baseSeed,
    createdAt: b.createdAt,
    completedAt: b.completedAt,
    currentIndex: b.currentIndex,
    totalCompleted: b.totalCompleted,
    totalPassed: b.totalPassed,
    total: b.items.length,
    items: b.items,
  };
}

function pickExperiments(body: {
  experimentIds?: string[];
  phase?: string;
  all?: boolean;
}): ExperimentSpec[] {
  if (body.experimentIds && body.experimentIds.length > 0) {
    const out: ExperimentSpec[] = [];
    for (const id of body.experimentIds) {
      const exp = findExperiment(id);
      if (exp) out.push(exp);
    }
    return out;
  }
  if (body.phase) {
    return ALL_EXPERIMENTS.filter((e) => e.phase === body.phase);
  }
  if (body.all) return [...ALL_EXPERIMENTS];
  return [];
}

async function runBatchItem(
  b: BatchRecord,
  item: BatchItem,
  exp: ExperimentSpec,
): Promise<void> {
  const startTime = Date.now();
  for (let r = 0; r < item.totalRuns; r++) {
    if (b.cancelled) {
      item.status = "skipped";
      return;
    }
    const seedForRun = deriveSeed(b.baseSeed, item.index, r);
    item.seeds[r] = seedForRun;
    await new Promise<void>((resolve) => {
      const id = `r${nextId++}`;
      const ticks = b.ticksPerExperiment ?? exp.ticks;
      const record: RunRecord = {
        id,
        experimentId: `batch:${b.id}:${item.index}:${r}`,
        scale: b.scale,
        status: "pending",
        createdAt: Date.now(),
        startedAt: null,
        completedAt: null,
        ticks,
        ticksDone: 0,
        latestStats: null,
        result: null,
        arcResult: null,
        error: null,
        hypothesis: exp.hypothesis,
        seed: seedForRun,
        subscribers: new Set(),
        history: [],
        cancel: () => undefined,
      };
      runs.set(id, record);
      pruneRuns();
      item.runIds.push(id);
      item.ticksTotal = ticks;

      // Top-K override at the batch level merges into customParams as
      // TOPK_FRACTION (resolved against the run's effective N). When a chosen
      // experiment is specifically a top-K ablation it may overwrite the
      // experiment's own TOPK_FRACTION — that's the documented behaviour of
      // the override, mirroring how `neurons` overrides per-experiment N.
      const customParams = applyTopKOverride(undefined, b.topK, b.scale, b.neurons);

      const handle = startRun({
        scale: b.scale,
        ...(b.neurons !== undefined ? { neurons: b.neurons } : {}),
        experimentId: exp.id,
        ticks,
        seed: seedForRun,
        ...(customParams ? { customParams: customParams as Record<string, never> } : {}),
        onStart: (info) => {
          record.start = info;
          record.seed = info.seed;
          record.status = "running";
          record.startedAt = Date.now();
        },
        onSample: (e: RunSampleEvent) => {
          record.ticksDone = e.t;
          record.latestStats = e.stats;
          item.ticksDone = e.t;
          // Keep a coarse history for inspection
          if (
            record.history.length === 0 ||
            e.t - (record.history.at(-1)?.t ?? 0) >= 200
          ) {
            record.history.push({ t: e.t, stats: e.stats });
            if (record.history.length > MAX_HISTORY) record.history.shift();
          }
          if (e.t % 1000 === 0) {
            broadcastBatch(b, "item_progress", { batchId: b.id, item });
          }
        },
        onPhase: () => undefined,
        onComplete: (e: RunCompleteEvent) => {
          record.result = e;
          record.passed = e.passed;
          record.metric = e.metric;
          record.measured = e.measured;
          record.target = e.target;
          record.completedAt = Date.now();
          record.status = "completed";
          if (typeof e.measured === "number") {
            item.measuredValues.push(e.measured);
          }
          if (e.passed) item.passes += 1;
          resolve();
        },
        onError: (err) => {
          record.status = "error";
          record.error = err.message;
          record.completedAt = Date.now();
          item.status = "error";
          resolve();
        },
      });
      record.cancel = () => handle.cancel();
      b.cancelChild = () => handle.cancel();
      handle.promise.catch(() => undefined);
    });
  }
  const stats = meanStd(item.measuredValues);
  item.meanMeasured = stats.mean;
  item.stdMeasured = stats.std;
  item.durationMs = Date.now() - startTime;
  if (item.status !== "error" && item.status !== "skipped") {
    item.status = "completed";
  }
  b.cancelChild = () => undefined;
}

router.post("/batches", (req, res) => {
  const body = (req.body ?? {}) as {
    experimentIds?: string[];
    phase?: string;
    all?: boolean;
    scale?: 81 | 810 | 81000;
    neurons?: number;
    topK?: number;
    ticksPerExperiment?: number;
    repeats?: number;
    seed?: number;
  };
  const experiments = pickExperiments(body);
  if (experiments.length === 0) {
    res.status(400).json({
      error:
        "no experiments selected — provide experimentIds, phase, or all=true",
    });
    return;
  }
  if (experiments.length > 200) {
    res.status(400).json({ error: "too many experiments (max 200)" });
    return;
  }
  // v13 spec §3.2 — block batches that contain any locked higher-phase
  // experiment until the Existence Gate has been opened. We surface ALL
  // offending experiment IDs so the caller can either drop them or
  // explicitly switch to a Phase-0-only batch.
  const lockedExpIds = experiments
    .filter((e) => isExperimentLocked(e.id))
    .map((e) => e.id);
  if (lockedExpIds.length > 0) {
    const status = getPhaseStatus();
    res.status(423).json({
      error: "phase_locked",
      message:
        `Batch contains ${lockedExpIds.length} experiment(s) in locked ` +
        `higher phases. Open the Existence Gate (≥ ` +
        `${PHASE_LOCK_GATE_STREAK_REQUIRED} consecutive ticks of ` +
        `Φ>0.05 ∧ PU>0.1 ∧ S_C>0.1) in a Phase-0 run first.`,
      lockedExperimentIds: lockedExpIds,
      phaseStatus: status,
    });
    return;
  }
  const scale = (body.scale ?? 81) as 81 | 810 | 81000;
  const neurons = clampNeurons(body.neurons);
  const topK = clampTopK(body.topK);
  const repeats = Math.min(Math.max(body.repeats ?? 1, 1), 5);
  const ticksPerExperiment =
    typeof body.ticksPerExperiment === "number"
      ? Math.min(Math.max(body.ticksPerExperiment, 100), 200000)
      : null;

  const id = `b${nextBatchId++}`;
  const baseSeed =
    typeof body.seed === "number" && Number.isFinite(body.seed)
      ? Math.floor(body.seed) >>> 0
      : ((Date.now() & 0x7fffffff) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  const items: BatchItem[] = experiments.map((exp, i) => ({
    index: i,
    experimentId: exp.id,
    experimentName: exp.name,
    phase: exp.phase,
    metric: exp.metric,
    target: exp.targetVal,
    targetDir: exp.targetDir,
    hypothesis: exp.hypothesis,
    runIds: [],
    measuredValues: [],
    seeds: [],
    passes: 0,
    totalRuns: repeats,
    status: "pending",
    meanMeasured: null,
    stdMeasured: null,
    ticksDone: 0,
    ticksTotal: ticksPerExperiment ?? exp.ticks,
    durationMs: 0,
  }));

  const batch: BatchRecord = {
    id,
    status: "pending",
    scale,
    ...(neurons !== undefined ? { neurons } : {}),
    ...(topK !== undefined ? { topK } : {}),
    ticksPerExperiment,
    repeats,
    baseSeed,
    createdAt: Date.now(),
    completedAt: null,
    currentIndex: 0,
    totalCompleted: 0,
    totalPassed: 0,
    cancelled: false,
    items,
    subscribers: new Set(),
    cancelChild: () => undefined,
  };
  batches.set(id, batch);
  pruneBatches();

  (async () => {
    batch.status = "running";
    broadcastBatch(batch, "batch_start", serializeBatch(batch));
    for (let i = 0; i < batch.items.length; i++) {
      if (batch.cancelled) break;
      const item = batch.items[i] as BatchItem;
      const exp = findExperiment(item.experimentId);
      if (!exp) {
        item.status = "skipped";
        continue;
      }
      batch.currentIndex = i;
      item.status = "running";
      broadcastBatch(batch, "item_start", { batchId: batch.id, item });
      await runBatchItem(batch, item, exp);
      // runBatchItem mutates item.status; widen the narrowed type for TS.
      const itemStatus = item.status as BatchItem["status"];
      if (itemStatus === "completed" || itemStatus === "error") {
        batch.totalCompleted += 1;
        // Pass = at least 50% of repeats passed
        if (item.passes * 2 >= item.totalRuns) batch.totalPassed += 1;
      }
      broadcastBatch(batch, "item_complete", {
        batchId: batch.id,
        item,
        totalCompleted: batch.totalCompleted,
        totalPassed: batch.totalPassed,
      });
      persistBatch(batch);
    }
    batch.status = batch.cancelled ? "cancelled" : "completed";
    batch.completedAt = Date.now();
    persistBatch(batch);
    broadcastBatch(batch, "batch_complete", serializeBatch(batch));
    endAllSubscribers(batch.subscribers);
  })().catch(() => undefined);

  res.status(201).json({
    id,
    total: batch.items.length,
    repeats,
    baseSeed: batch.baseSeed,
  });
});

router.get("/batches", (_req, res) => {
  res.json({
    batches: [...batches.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(serializeBatch),
  });
});

router.get("/batches/:id", (req, res) => {
  const b = batches.get(req.params.id as string);
  if (!b) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(serializeBatch(b));
});

router.delete("/batches/:id", (req, res) => {
  const b = batches.get(req.params.id as string);
  if (!b) {
    res.status(404).json({ error: "not found" });
    return;
  }
  b.cancelled = true;
  b.cancelChild();
  // Eagerly flip status + broadcast so SSE-subscribed UIs reflect the cancel
  // within milliseconds. The orchestrator will set the final status as its
  // `for` loop unwinds, but the user-visible state should not lag the click.
  if (b.status === "running" || b.status === "pending") {
    b.status = "cancelled";
    broadcastBatch(b, "batch_cancelled", serializeBatch(b));
  }
  res.json({ id: b.id, status: "cancelled" });
});

// ─── Leaderboard ─────────────────────────────────────────────────────────────
// Aggregates persisted batches by experimentId. Optional query params:
//   ?phase=PH0           – restrict to a single phase
//   ?search=word         – substring match on id / name / hypothesis (case-insensitive)
//   ?baseline=<id>       – include delta vs that baseline batch (mean diff + Welch p)
//   ?minRuns=N           – drop rows with fewer than N total simulator runs
//   ?excludeInterrupted=1 – ignore batches that crashed mid-flight

interface BaselineDelta {
  baselineId: string;
  delta: number | null;       // currentMean − baselineMean
  pTwoSided: number | null;   // Welch's t two-sided p
  baselineMean: number | null;
  baselineN: number;
  sign: "better" | "worse" | "tie" | null; // direction-aware vs target
}

interface LeaderboardRow {
  experimentId: string;
  experimentName: string;
  phase: string;
  metric: string;
  target: number;
  targetDir: 1 | -1;
  totalRuns: number;
  totalPasses: number;
  passRate: number;
  bestMeasured: number | null;
  meanMeasured: number | null;
  stdMeasured: number | null;
  ci95Lo: number | null;
  ci95Hi: number | null;
  lastSeen: number;
  batchCount: number;
  hypothesis: string;
  pinned: boolean;
  noteText: string | null;
  noteTags: string[];
  baselineDelta: BaselineDelta | null;
}

interface AccRow {
  experimentName: string;
  phase: string;
  metric: string;
  target: number;
  targetDir: 1 | -1;
  hypothesis: string;
  values: number[];
  totalRuns: number;
  totalPasses: number;
  lastSeen: number;
  batchIds: Set<string>;
}

function aggregateBatch(
  acc: Map<string, AccRow>,
  b: BatchRecord,
): void {
  for (const it of b.items) {
    let row = acc.get(it.experimentId);
    if (!row) {
      row = {
        experimentName: it.experimentName,
        phase: it.phase,
        metric: it.metric,
        target: it.target,
        targetDir: it.targetDir,
        hypothesis: it.hypothesis,
        values: [],
        totalRuns: 0,
        totalPasses: 0,
        lastSeen: 0,
        batchIds: new Set(),
      };
      acc.set(it.experimentId, row);
    }
    row.values.push(...it.measuredValues);
    row.totalRuns += it.totalRuns;
    row.totalPasses += it.passes;
    row.lastSeen = Math.max(row.lastSeen, b.completedAt ?? b.createdAt);
    row.batchIds.add(b.id);
  }
}

router.get("/leaderboard", (req, res) => {
  const phaseFilter = typeof req.query["phase"] === "string" ? String(req.query["phase"]) : "";
  const searchFilter = typeof req.query["search"] === "string"
    ? String(req.query["search"]).toLowerCase()
    : "";
  const baselineId = typeof req.query["baseline"] === "string"
    ? String(req.query["baseline"])
    : "";
  const minRuns = Math.max(0, Number(req.query["minRuns"] ?? 0) || 0);
  const excludeInterrupted = req.query["excludeInterrupted"] === "1";

  const acc = new Map<string, AccRow>();
  let included = 0;
  for (const b of batches.values()) {
    if (excludeInterrupted && b.status === "interrupted") continue;
    aggregateBatch(acc, b);
    included++;
  }

  // Baseline batch (optional). We aggregate only the baseline batch to compute
  // a per-experiment reference distribution.
  let baselineAcc: Map<string, AccRow> | null = null;
  if (baselineId) {
    const baseBatch = batches.get(baselineId);
    if (baseBatch) {
      baselineAcc = new Map();
      aggregateBatch(baselineAcc, baseBatch);
    }
  }
  const allNotes = notesStore.all();

  const out: LeaderboardRow[] = [];
  for (const [experimentId, row] of acc.entries()) {
    if (phaseFilter && row.phase !== phaseFilter) continue;
    if (row.totalRuns < minRuns) continue;
    if (
      searchFilter &&
      !(
        experimentId.toLowerCase().includes(searchFilter) ||
        row.experimentName.toLowerCase().includes(searchFilter) ||
        row.hypothesis.toLowerCase().includes(searchFilter)
      )
    ) {
      continue;
    }
    const stats = meanStd(row.values);
    const ci = bootstrapCI(row.values, 600);
    const note = allNotes[experimentId];
    let baselineDelta: BaselineDelta | null = null;
    if (baselineAcc) {
      const ref = baselineAcc.get(experimentId);
      if (ref && ref.values.length > 0 && row.values.length > 0) {
        const t = welchT(row.values, ref.values);
        const refStats = meanStd(ref.values);
        const delta = t.delta ?? null;
        let sign: BaselineDelta["sign"] = "tie";
        if (delta !== null && Math.abs(delta) > 1e-9) {
          sign = (row.targetDir === 1 ? delta > 0 : delta < 0) ? "better" : "worse";
        }
        baselineDelta = {
          baselineId,
          delta,
          pTwoSided: t.pTwoSided,
          baselineMean: refStats.mean,
          baselineN: ref.values.length,
          sign,
        };
      }
    }
    out.push({
      experimentId,
      experimentName: row.experimentName,
      phase: row.phase,
      metric: row.metric,
      target: row.target,
      targetDir: row.targetDir,
      totalRuns: row.totalRuns,
      totalPasses: row.totalPasses,
      passRate: row.totalRuns > 0 ? row.totalPasses / row.totalRuns : 0,
      bestMeasured: bestMeasuredCore(row.values, row.targetDir),
      meanMeasured: stats.mean,
      stdMeasured: stats.std,
      ci95Lo: ci.ci95Lo,
      ci95Hi: ci.ci95Hi,
      lastSeen: row.lastSeen,
      batchCount: row.batchIds.size,
      hypothesis: row.hypothesis,
      pinned: Boolean(note?.pinned),
      noteText: note?.text ? note.text : null,
      noteTags: note?.tags ?? [],
      baselineDelta,
    });
  }
  out.sort((a, b) => {
    // Pinned rows always float to the top
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.passRate - a.passRate || b.totalRuns - a.totalRuns;
  });
  res.json({
    rows: out,
    totalBatches: batches.size,
    includedBatches: included,
    ...(baselineId ? { baselineId, baselineFound: Boolean(baselineAcc) } : {}),
  });
});

// ─── Diff: compare two batches experiment-by-experiment with Welch's t ───────
router.get("/batches/:id/diff/:other", (req, res) => {
  const a = batches.get(String(req.params.id ?? ""));
  const b = batches.get(String(req.params.other ?? ""));
  if (!a || !b) {
    res.status(404).json({ error: "one or both batches not found" });
    return;
  }
  const aMap = new Map(a.items.map((it) => [it.experimentId, it]));
  const bMap = new Map(b.items.map((it) => [it.experimentId, it]));
  const ids = new Set<string>([...aMap.keys(), ...bMap.keys()]);
  type DiffRow = {
    experimentId: string;
    experimentName: string;
    phase: string;
    metric: string;
    target: number;
    targetDir: 1 | -1;
    aMean: number | null;
    bMean: number | null;
    aN: number;
    bN: number;
    delta: number | null;
    pTwoSided: number | null;
    sign: "better" | "worse" | "tie" | null;
  };
  const rows: DiffRow[] = [];
  for (const id of ids) {
    const ai = aMap.get(id);
    const bi = bMap.get(id);
    const ref = ai ?? bi;
    if (!ref) continue;
    const aStats = ai ? meanStd(ai.measuredValues) : { mean: null, std: null };
    const bStats = bi ? meanStd(bi.measuredValues) : { mean: null, std: null };
    let t: ReturnType<typeof welchT> = { t: null, df: null, pTwoSided: null, delta: null };
    if (ai && bi) t = welchT(ai.measuredValues, bi.measuredValues);
    let sign: DiffRow["sign"] = null;
    if (t.delta !== null && Math.abs(t.delta) > 1e-9) {
      sign = (ref.targetDir === 1 ? t.delta > 0 : t.delta < 0) ? "better" : "worse";
    } else if (t.delta === 0) {
      sign = "tie";
    }
    rows.push({
      experimentId: id,
      experimentName: ref.experimentName,
      phase: ref.phase,
      metric: ref.metric,
      target: ref.target,
      targetDir: ref.targetDir,
      aMean: aStats.mean,
      bMean: bStats.mean,
      aN: ai?.measuredValues.length ?? 0,
      bN: bi?.measuredValues.length ?? 0,
      delta: t.delta,
      pTwoSided: t.pTwoSided,
      sign,
    });
  }
  rows.sort((x, y) => {
    const xs = (y.pTwoSided ?? 1) - (x.pTwoSided ?? 1);
    if (xs !== 0) return -xs;
    return Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0);
  });
  res.json({
    aId: a.id,
    bId: b.id,
    aCreatedAt: a.createdAt,
    bCreatedAt: b.createdAt,
    rows,
  });
});

// ─── Re-run: launch a fresh batch with the same experiments + same seed ──────
router.post("/batches/:id/rerun", (req, res) => {
  const src = batches.get(String(req.params.id ?? ""));
  if (!src) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const body = (req.body ?? {}) as { keepSeed?: boolean; repeats?: number };
  const id = `b${nextBatchId++}`;
  // keepSeed defaults to true — but if the source has no real baseSeed
  // (legacy batches stored before the seed work, baseSeed === 0), always
  // mint a fresh one so we don't run with a degenerate "0" seed.
  const freshSeed = ((Date.now() & 0x7fffffff) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  const baseSeed =
    body.keepSeed === false || !src.baseSeed ? freshSeed : src.baseSeed;
  const repeats = Math.min(Math.max(body.repeats ?? src.repeats, 1), 5);
  const items: BatchItem[] = src.items.map((it) => ({
    index: it.index,
    experimentId: it.experimentId,
    experimentName: it.experimentName,
    phase: it.phase,
    metric: it.metric,
    target: it.target,
    targetDir: it.targetDir,
    hypothesis: it.hypothesis,
    runIds: [],
    measuredValues: [],
    seeds: [],
    passes: 0,
    totalRuns: repeats,
    status: "pending",
    meanMeasured: null,
    stdMeasured: null,
    ticksDone: 0,
    ticksTotal: it.ticksTotal,
    durationMs: 0,
  }));
  const batch: BatchRecord = {
    id,
    status: "pending",
    scale: src.scale,
    ...(src.neurons !== undefined ? { neurons: src.neurons } : {}),
    // Re-runs preserve the source batch's Top-K override so the new batch is
    // a faithful replay (same neurons, same Top-K, same ticks per experiment).
    ...(src.topK !== undefined ? { topK: src.topK } : {}),
    ticksPerExperiment: src.ticksPerExperiment,
    repeats,
    baseSeed,
    createdAt: Date.now(),
    completedAt: null,
    currentIndex: 0,
    totalCompleted: 0,
    totalPassed: 0,
    cancelled: false,
    items,
    subscribers: new Set(),
    cancelChild: () => undefined,
  };
  batches.set(id, batch);
  pruneBatches();

  (async () => {
    batch.status = "running";
    broadcastBatch(batch, "batch_start", serializeBatch(batch));
    for (let i = 0; i < batch.items.length; i++) {
      if (batch.cancelled) break;
      const item = batch.items[i] as BatchItem;
      const exp = findExperiment(item.experimentId);
      if (!exp) {
        item.status = "skipped";
        continue;
      }
      batch.currentIndex = i;
      item.status = "running";
      broadcastBatch(batch, "item_start", { batchId: batch.id, item });
      await runBatchItem(batch, item, exp);
      const itemStatus = item.status as BatchItem["status"];
      if (itemStatus === "completed" || itemStatus === "error") {
        batch.totalCompleted += 1;
        if (item.passes * 2 >= item.totalRuns) batch.totalPassed += 1;
      }
      broadcastBatch(batch, "item_complete", {
        batchId: batch.id,
        item,
        totalCompleted: batch.totalCompleted,
        totalPassed: batch.totalPassed,
      });
      persistBatch(batch);
    }
    batch.status = batch.cancelled ? "cancelled" : "completed";
    batch.completedAt = Date.now();
    persistBatch(batch);
    broadcastBatch(batch, "batch_complete", serializeBatch(batch));
    endAllSubscribers(batch.subscribers);
  })().catch(() => undefined);

  res.status(201).json({
    id,
    sourceBatchId: src.id,
    total: batch.items.length,
    repeats,
    baseSeed,
  });
});

router.get("/batches/:id/stream", (req, res) => {
  const b = batches.get(req.params.id as string);
  if (!b) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(`event: snapshot\ndata: ${JSON.stringify(serializeBatch(b))}\n\n`);
  if (b.status === "completed" || b.status === "cancelled") {
    res.write(`event: batch_complete\ndata: ${JSON.stringify(serializeBatch(b))}\n\n`);
    res.end();
    return;
  }
  b.subscribers.add(res);
  installHeartbeat(res);
  req.on("close", () => {
    stopHeartbeat(res);
    b.subscribers.delete(res);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auto-Mode — chains parameter sweeps that refine around the best combo until
// the Existence Gate streak target is hit (default ≥1000 ticks per v13) or a
// max-iterations cap is reached. Each iteration is a stored Sweep record so
// every combo's full history persists to data/sweeps for later inspection;
// the AutoMode record itself stores the orchestration metadata under
// data/automode/<id>.json. Both survive API restarts.
// ─────────────────────────────────────────────────────────────────────────────

interface AutoModeIteration {
  index: number;
  sweepId: string;
  ranges: Record<string, number[]>;
  ticksPerCombo: number;
  status: "pending" | "running" | "completed" | "cancelled";
  bestComboIndex: number;
  bestParams: Record<string, number | boolean | string> | null;
  bestPhi: number;
  bestSC: number;
  bestPU: number;
  bestCAR: number;
  bestGateStreak: number;
  passedTarget: boolean;
  startedAt: number;
  completedAt: number | null;
}

interface AutoModeRecord {
  id: string;
  status: "pending" | "running" | "completed" | "cancelled" | "succeeded";
  createdAt: number;
  completedAt: number | null;
  scale: 81 | 810 | 81000;
  neurons?: number;
  topK?: number;
  ticksPerCombo: number;
  maxIterations: number;
  gateStreakTarget: number;
  baseRanges: Record<string, number[]>;
  iterations: AutoModeIteration[];
  currentIteration: number;
  // Snapshot of the best combo across all iterations (winner candidate).
  bestSweepId: string | null;
  bestComboIndex: number;
  bestParams: Record<string, number | boolean | string> | null;
  bestGateStreak: number;
  // Highest CAR observed across every iteration's best combo. Used as the
  // tiebreaker when two iterations hit the same gate streak — without it,
  // the orchestrator would compare against the wrong reference (the prior
  // iteration's CAR rather than the running global maximum) and could
  // overwrite a genuinely-better winner with a later, weaker one.
  bestCAR: number;
  passed: boolean;
  cancelled: boolean;
  subscribers: Set<Response>;
}

const automodes = new Map<string, AutoModeRecord>();
let nextAutoModeId = 1;
const MAX_AUTOMODES = 10;

const AUTOMODE_DIR = join(process.cwd(), "data", "automode");
try {
  mkdirSync(AUTOMODE_DIR, { recursive: true });
} catch {
  /* best-effort */
}

function serializeAutoMode(a: AutoModeRecord) {
  // Map each iteration to the ComboMetrics shape the explainer expects.
  // The explainer is a pure helper; we attach its outputs to every
  // serialization so dashboard cards never have to recompute classification.
  const metricIterations: ComboMetrics[] = a.iterations.map((it) => ({
    finalPhi: it.bestPhi,
    finalSC: it.bestSC,
    finalPU: it.bestPU,
    finalCAR: it.bestCAR,
    bestCAR: it.bestCAR,
    gateOpened: it.passedTarget || (it.bestGateStreak ?? 0) > 0,
    gateStreak: it.bestGateStreak,
    ticksDone: it.ticksPerCombo,
  }));
  // Pick the iteration with the best gate streak (CAR as tiebreaker) for
  // verdict/failure-reason classification — same priority the orchestrator
  // uses to choose the global best.
  const bestForVerdict = metricIterations.reduce<ComboMetrics | null>(
    (acc, it) => {
      if (!acc) return it;
      const a = acc.gateStreak ?? 0;
      const b = it.gateStreak ?? 0;
      if (b > a) return it;
      if (b === a && (it.bestCAR ?? 0) > (acc.bestCAR ?? 0)) return it;
      return acc;
    },
    null,
  );
  const gate = classifyGate(bestForVerdict, a.gateStreakTarget);
  const failureReason = classifyFailureReason(
    bestForVerdict,
    a.gateStreakTarget,
  );
  const nextStep = nextStepRecommendation({
    status: a.status,
    iterations: metricIterations,
    gateStreakTarget: a.gateStreakTarget,
    maxIterations: a.maxIterations,
    bestGateStreak: a.bestGateStreak,
    bestCAR: a.bestCAR,
  });
  return {
    id: a.id,
    status: a.status,
    createdAt: a.createdAt,
    completedAt: a.completedAt,
    scale: a.scale,
    ...(a.neurons !== undefined ? { neurons: a.neurons } : {}),
    ...(a.topK !== undefined ? { topK: a.topK } : {}),
    ticksPerCombo: a.ticksPerCombo,
    maxIterations: a.maxIterations,
    gateStreakTarget: a.gateStreakTarget,
    baseRanges: a.baseRanges,
    currentIteration: a.currentIteration,
    bestSweepId: a.bestSweepId,
    bestComboIndex: a.bestComboIndex,
    bestParams: a.bestParams,
    bestGateStreak: a.bestGateStreak,
    bestCAR: a.bestCAR,
    passed: a.passed,
    iterations: a.iterations,
    // Plain-English explainer fields the layman dashboard renders directly.
    gate,
    failureReason,
    nextStep,
  };
}

function persistAutoMode(a: AutoModeRecord): void {
  try {
    writeFileAtomicSync(
      join(AUTOMODE_DIR, `${a.id}.json`),
      JSON.stringify(serializeAutoMode(a), null, 2),
    );
  } catch {
    /* best-effort */
  }
}

function loadPersistedAutoModes(): void {
  let entries: string[];
  try {
    entries = readdirSync(AUTOMODE_DIR);
  } catch {
    return;
  }
  let maxId = 0;
  for (const file of entries) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = readFileSync(join(AUTOMODE_DIR, file), "utf8");
      const data = JSON.parse(raw) as ReturnType<typeof serializeAutoMode>;
      const reloadStatus =
        data.status === "running" || data.status === "pending"
          ? "cancelled"
          : data.status;
      const rec: AutoModeRecord = {
        id: data.id,
        status: reloadStatus,
        createdAt: data.createdAt,
        completedAt: data.completedAt ?? Date.now(),
        scale: data.scale,
        ...(typeof (data as { neurons?: number }).neurons === "number"
          ? { neurons: (data as { neurons: number }).neurons }
          : {}),
        ...(typeof (data as { topK?: number }).topK === "number"
          ? { topK: (data as { topK: number }).topK }
          : {}),
        ticksPerCombo: data.ticksPerCombo,
        maxIterations: data.maxIterations,
        gateStreakTarget: data.gateStreakTarget,
        baseRanges: data.baseRanges,
        iterations: data.iterations ?? [],
        currentIteration: data.currentIteration,
        bestSweepId: data.bestSweepId ?? null,
        bestComboIndex: data.bestComboIndex ?? -1,
        bestParams: data.bestParams ?? null,
        bestGateStreak: data.bestGateStreak ?? 0,
        bestCAR: (data as { bestCAR?: number }).bestCAR ?? 0,
        passed: data.passed ?? false,
        cancelled: reloadStatus === "cancelled",
        subscribers: new Set(),
      };
      automodes.set(rec.id, rec);
      const num = Number(rec.id.replace(/^a/, ""));
      if (Number.isFinite(num) && num > maxId) maxId = num;
    } catch {
      /* skip corrupt */
    }
  }
  if (maxId >= nextAutoModeId) nextAutoModeId = maxId + 1;
}
loadPersistedAutoModes();

function broadcastAutoMode(a: AutoModeRecord, event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const sub of a.subscribers) {
    try {
      sub.write(payload);
    } catch {
      a.subscribers.delete(sub);
    }
  }
}

function pruneAutoModes(): void {
  if (automodes.size <= MAX_AUTOMODES) return;
  const sortable = [...automodes.values()].sort((a, b) => a.createdAt - b.createdAt);
  for (const a of sortable) {
    if (automodes.size <= MAX_AUTOMODES) break;
    if (a.status === "running" || a.status === "pending") continue;
    automodes.delete(a.id);
  }
}

// Refine a numeric parameter range around `center` by halving the spread each
// iteration. Returns 3 values: center − step, center, center + step. The
// minimum is clamped to a small positive epsilon so noise / fractions stay
// > 0. Iteration 1 uses the full base spread; iteration 2 uses ½; etc.
function refineRange(
  baseValues: number[],
  center: number,
  iteration: number,
): number[] {
  if (baseValues.length < 2) return [center];
  const sorted = [...baseValues].sort((a, b) => a - b);
  const baseStep =
    (sorted[sorted.length - 1] as number) - (sorted[0] as number);
  if (baseStep <= 0) return [center];
  const stepFactor = Math.pow(0.5, Math.max(0, iteration - 1));
  const step = (baseStep / 2) * stepFactor;
  const eps = 1e-4;
  const lo = Math.max(eps, center - step);
  const hi = center + step;
  // Deduplicate (after clamping the lo could equal center).
  const candidates = [lo, center, hi].map((v) => Number(v.toFixed(6)));
  return Array.from(new Set(candidates));
}

function refineRangesAroundCombo(
  baseRanges: Record<string, number[]>,
  bestParams: Record<string, number | boolean | string>,
  iteration: number,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [key, values] of Object.entries(baseRanges)) {
    const center = bestParams[key];
    if (typeof center !== "number" || !Number.isFinite(center)) {
      out[key] = values;
      continue;
    }
    out[key] = refineRange(values, center, iteration);
  }
  return out;
}

// Run one auto-mode iteration: launches a sweep with the supplied ranges and
// awaits its completion. Returns the resulting AutoModeIteration record (with
// the best combo summary) so the orchestrator can decide whether to refine.
async function runAutoModeIteration(
  a: AutoModeRecord,
  iterIndex: number,
  ranges: Record<string, number[]>,
): Promise<AutoModeIteration> {
  const grid = cartesian(ranges);
  // Top-K → TOPK_FRACTION conversion mirrors POST /sweeps so the iteration's
  // sweep is a faithful self-contained record.
  const N = effectiveN(a.scale, a.neurons);
  const topkFraction =
    a.topK !== undefined ? Math.max(1 / N, Math.min(1, a.topK / N)) : undefined;

  const sweepId = `s${nextSweepId++}`;
  const sweep: SweepRecord = {
    id: sweepId,
    status: "pending",
    createdAt: Date.now(),
    completedAt: null,
    ticksPerCombo: a.ticksPerCombo,
    scale: a.scale,
    ...(a.neurons !== undefined ? { neurons: a.neurons } : {}),
    ...(a.topK !== undefined ? { topK: a.topK } : {}),
    autoModeId: a.id,
    autoModeIteration: iterIndex,
    combos: grid.map((p, i) => ({
      index: i,
      params: {
        ATTN_MODE: "soft",
        USE_BOTTLENECK: false,
        ...(topkFraction !== undefined ? { TOPK_FRACTION: topkFraction } : {}),
        ...p,
      },
      status: "pending",
      gateOpened: false,
      gateStreak: 0,
      finalPhi: 0,
      finalSC: 0,
      finalPU: 0,
      finalCAR: 0,
      bestCAR: 0,
      ticksDone: 0,
      runId: null,
    })),
    currentIndex: 0,
    bestIndex: 0,
    cancelled: false,
    subscribers: new Set(),
  };
  sweeps.set(sweepId, sweep);
  pruneSweeps();

  const iteration: AutoModeIteration = {
    index: iterIndex,
    sweepId,
    ranges,
    ticksPerCombo: a.ticksPerCombo,
    status: "running",
    bestComboIndex: -1,
    bestParams: null,
    bestPhi: 0,
    bestSC: 0,
    bestPU: 0,
    bestCAR: 0,
    bestGateStreak: 0,
    passedTarget: false,
    startedAt: Date.now(),
    completedAt: null,
  };
  a.iterations.push(iteration);
  broadcastAutoMode(a, "iteration_start", {
    autoModeId: a.id,
    iteration,
    sweep: serializeSweep(sweep),
  });

  sweep.status = "running";
  broadcastSweep(sweep, "sweep_start", serializeSweep(sweep));
  for (let i = 0; i < sweep.combos.length; i++) {
    if (sweep.cancelled || a.cancelled) break;
    sweep.currentIndex = i;
    await runSweepCombo(sweep, sweep.combos[i] as SweepCombo);
    // Forward live progress to auto-mode subscribers as well so the UI can
    // render combo-level progress without needing a second SSE connection.
    const combo = sweep.combos[i] as SweepCombo;
    broadcastAutoMode(a, "combo_complete", {
      autoModeId: a.id,
      iterationIndex: iterIndex,
      sweepId,
      combo,
      bestIndex: sweep.bestIndex,
    });
  }
  sweep.status = sweep.cancelled || a.cancelled ? "cancelled" : "completed";
  sweep.completedAt = Date.now();
  persistSweep(sweep);
  broadcastSweep(sweep, "sweep_complete", serializeSweep(sweep));

  const best = sweep.combos[sweep.bestIndex] ?? null;
  iteration.status = a.cancelled ? "cancelled" : "completed";
  iteration.completedAt = Date.now();
  iteration.bestComboIndex = sweep.bestIndex;
  iteration.bestParams = best ? best.params : null;
  iteration.bestPhi = best?.finalPhi ?? 0;
  iteration.bestSC = best?.finalSC ?? 0;
  iteration.bestPU = best?.finalPU ?? 0;
  iteration.bestCAR = best?.bestCAR ?? 0;
  iteration.bestGateStreak = best?.gateStreak ?? 0;
  iteration.passedTarget =
    !!best && best.gateOpened && (best.gateStreak ?? 0) >= a.gateStreakTarget;
  return iteration;
}

// Layman-facing preset registry. The Lab Home in the dashboard reads this
// once on mount and renders one card per preset — clicking "Start" POSTs
// the preset's `body` straight back to /automode below.
router.get("/presets", (_req, res) => {
  res.json({ presets: PRESETS });
});

router.post("/automode", (req, res) => {
  const body = (req.body ?? {}) as {
    scale?: 81 | 810 | 81000;
    neurons?: number;
    topK?: number;
    ticksPerCombo?: number;
    maxIterations?: number;
    gateStreakTarget?: number;
    baseRanges?: Record<string, number[]>;
  };
  const scale = (body.scale ?? 81) as 81 | 810 | 81000;
  const neurons = clampNeurons(body.neurons);
  const topK = clampTopK(body.topK);
  const ticksPerCombo = Math.min(
    Math.max(body.ticksPerCombo ?? PHASE0_DEFAULT_TICKS, 500),
    PHASE0_MAX_TICKS,
  );
  const maxIterations = Math.min(Math.max(body.maxIterations ?? 4, 1), 10);
  const gateStreakTarget = Math.min(
    Math.max(body.gateStreakTarget ?? 1000, 1),
    PHASE0_MAX_TICKS,
  );
  const baseRanges = sanitizeRanges(body.baseRanges) ?? PHASE0_DEFAULT_RANGES;

  // Validate that the first iteration won't blow past the global combo cap.
  const initialGrid = cartesian(baseRanges);
  if (initialGrid.length === 0 || initialGrid.length > SWEEP_MAX_COMBOS) {
    res.status(400).json({
      error: `baseRanges must produce 1..${SWEEP_MAX_COMBOS} combinations`,
    });
    return;
  }

  const id = `a${nextAutoModeId++}`;
  const record: AutoModeRecord = {
    id,
    status: "pending",
    createdAt: Date.now(),
    completedAt: null,
    scale,
    ...(neurons !== undefined ? { neurons } : {}),
    ...(topK !== undefined ? { topK } : {}),
    ticksPerCombo,
    maxIterations,
    gateStreakTarget,
    baseRanges,
    iterations: [],
    currentIteration: 0,
    bestSweepId: null,
    bestComboIndex: -1,
    bestParams: null,
    bestGateStreak: 0,
    bestCAR: 0,
    passed: false,
    cancelled: false,
    subscribers: new Set(),
  };
  automodes.set(id, record);
  pruneAutoModes();

  (async () => {
    record.status = "running";
    broadcastAutoMode(record, "automode_start", serializeAutoMode(record));
    try {
      let nextRanges: Record<string, number[]> = baseRanges;
      for (let i = 0; i < maxIterations; i++) {
        if (record.cancelled) break;
        record.currentIteration = i;
        const it = await runAutoModeIteration(record, i, nextRanges);
        // Pure helper picks the running global best with gate streak as
        // primary key and CAR as tiebreaker. See lib/automodeBest.ts.
        const merged = updateGlobalBest(
          {
            bestSweepId: record.bestSweepId,
            bestComboIndex: record.bestComboIndex,
            bestParams: record.bestParams,
            bestGateStreak: record.bestGateStreak,
            bestCAR: record.bestCAR,
          },
          {
            sweepId: it.sweepId,
            bestComboIndex: it.bestComboIndex,
            bestParams: it.bestParams,
            bestGateStreak: it.bestGateStreak,
            bestCAR: it.bestCAR,
          },
        );
        record.bestSweepId = merged.bestSweepId;
        record.bestComboIndex = merged.bestComboIndex;
        record.bestParams = merged.bestParams;
        record.bestGateStreak = merged.bestGateStreak;
        record.bestCAR = merged.bestCAR;
        persistAutoMode(record);
        broadcastAutoMode(record, "iteration_complete", {
          autoModeId: record.id,
          iteration: it,
          bestSweepId: record.bestSweepId,
          bestParams: record.bestParams,
          bestGateStreak: record.bestGateStreak,
        });
        if (it.passedTarget) {
          record.passed = true;
          break;
        }
        // Refine for the next iteration around this iteration's best combo.
        if (it.bestParams) {
          nextRanges = refineRangesAroundCombo(baseRanges, it.bestParams, i + 1);
          // If refinement collapsed every dimension to a single value, we
          // can't make progress — bail out.
          const collapsedGrid = cartesian(nextRanges);
          if (collapsedGrid.length === 0) break;
        }
      }
      record.status = record.cancelled
        ? "cancelled"
        : record.passed
          ? "succeeded"
          : "completed";
    } catch (err) {
      record.status = "completed";
      broadcastAutoMode(record, "error", {
        message: (err as Error).message,
      });
    } finally {
      record.completedAt = Date.now();
      persistAutoMode(record);
      broadcastAutoMode(record, "automode_complete", serializeAutoMode(record));
      endAllSubscribers(record.subscribers);
    }
  })().catch(() => undefined);

  res.status(201).json({
    id,
    maxIterations,
    gateStreakTarget,
    initialCombos: initialGrid.length,
  });
});

router.get("/automode", (_req, res) => {
  res.json({
    automodes: [...automodes.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(serializeAutoMode),
  });
});

router.get("/automode/:id", (req, res) => {
  const a = automodes.get(req.params.id as string);
  if (!a) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(serializeAutoMode(a));
});

router.delete("/automode/:id", (req, res) => {
  const a = automodes.get(req.params.id as string);
  if (!a) {
    res.status(404).json({ error: "not found" });
    return;
  }
  a.cancelled = true;
  // Cancel the in-flight sweep (if any) and its child run; the orchestrator
  // loop checks `a.cancelled` between iterations and bails out cleanly.
  const cur = a.iterations[a.iterations.length - 1];
  if (cur) {
    const sw = sweeps.get(cur.sweepId);
    if (sw) {
      sw.cancelled = true;
      const combo = sw.combos[sw.currentIndex];
      if (combo?.runId) {
        const child = runs.get(combo.runId);
        if (child) child.cancel();
      }
      // Eagerly flip the inner sweep's status too so anyone watching the
      // sweep stream (not just the auto-mode stream) sees it cancel.
      if (sw.status === "running" || sw.status === "pending") {
        sw.status = "cancelled";
        broadcastSweep(sw, "sweep_cancelled", serializeSweep(sw));
      }
    }
  }
  if (a.status === "running" || a.status === "pending") {
    a.status = "cancelled";
    broadcastAutoMode(a, "automode_cancelled", serializeAutoMode(a));
  }
  res.json({ id: a.id, status: "cancelled" });
});

router.get("/automode/:id/stream", (req, res) => {
  const a = automodes.get(req.params.id as string);
  if (!a) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(`event: snapshot\ndata: ${JSON.stringify(serializeAutoMode(a))}\n\n`);
  if (
    a.status === "completed" ||
    a.status === "cancelled" ||
    a.status === "succeeded"
  ) {
    res.write(
      `event: automode_complete\ndata: ${JSON.stringify(serializeAutoMode(a))}\n\n`,
    );
    res.end();
    return;
  }
  a.subscribers.add(res);
  installHeartbeat(res);
  req.on("close", () => {
    stopHeartbeat(res);
    a.subscribers.delete(res);
  });
});

function serializeRun(r: RunRecord, full: boolean) {
  return {
    id: r.id,
    experimentId: r.experimentId,
    scale: r.scale,
    ...(r.neurons !== undefined ? { neurons: r.neurons } : {}),
    ...(r.topK !== undefined ? { topK: r.topK } : {}),
    // Effective grid size as actually built by the simulator (N = G*G).
    ...(r.start ? { N: r.start.N, G: Math.round(Math.sqrt(r.start.N)) } : {}),
    status: r.status,
    ticks: r.ticks,
    ticksDone: r.ticksDone,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    latestStats: r.latestStats,
    hypothesis: r.hypothesis,
    passed: r.passed,
    metric: r.metric,
    measured: r.measured,
    target: r.target,
    seed: r.seed ?? null,
    error: r.error,
    result: full ? r.result : null,
    arcResult: full
      ? r.arcResult
        ? {
            total: r.arcResult.total,
            correct: r.arcResult.correct,
            solveRate: r.arcResult.solveRate,
            samples: r.arcResult.samples.slice(-50) as ArcSample[],
            finalStats: r.arcResult.finalStats,
          }
        : null
      : null,
    history: full ? r.history : null,
  };
}

// ─── Graceful-shutdown helpers ──────────────────────────────────────────────
// Called from index.ts on SIGTERM/SIGINT so any batch or sweep that was
// running gets persisted with a clear "interrupted" status before exit. Lets
// the dashboard distinguish a crashed run from a user-cancelled one.
export function markRunningWorkInterrupted(): {
  batches: number;
  sweeps: number;
} {
  let touchedBatches = 0;
  let touchedSweeps = 0;
  const now = Date.now();
  for (const b of batches.values()) {
    if (b.status === "running" || b.status === "pending") {
      b.status = "interrupted";
      b.cancelled = true;
      b.completedAt = now;
      try {
        b.cancelChild();
      } catch {
        /* */
      }
      persistBatch(b);
      touchedBatches++;
    }
  }
  for (const s of sweeps.values()) {
    if (s.status === "running" || s.status === "pending") {
      s.status = "cancelled";
      s.cancelled = true;
      s.completedAt = now;
      const cur = s.combos[s.currentIndex];
      if (cur?.runId) {
        const child = runs.get(cur.runId);
        try {
          child?.cancel();
        } catch {
          /* */
        }
      }
      persistSweep(s);
      touchedSweeps++;
    }
  }
  for (const a of automodes.values()) {
    if (a.status === "running" || a.status === "pending") {
      a.status = "cancelled";
      a.cancelled = true;
      a.completedAt = now;
      persistAutoMode(a);
    }
  }
  return { batches: touchedBatches, sweeps: touchedSweeps };
}

export default router;
