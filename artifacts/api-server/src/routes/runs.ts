import { Router, type IRouter, type Request, type Response } from "express";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

interface RunRecord {
  id: string;
  experimentId: string | null;
  scale: 81 | 810 | 81000;
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

const router: IRouter = Router();

router.get("/experiments", (_req, res) => {
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
    })),
    groups: PHASE_GROUPS.map((g) => ({
      phase: g.phase,
      label: g.label,
      experimentIds: g.experiments.map((e) => e.id),
    })),
  });
});

router.post("/runs", (req, res) => {
  const body = (req.body ?? {}) as {
    experimentId?: string;
    scale?: 81 | 810 | 81000;
    ticks?: number;
    customParams?: Record<string, number | boolean>;
    type?: "experiment" | "arc";
    arc?: { numTasks?: number; trainTicksPerTask?: number; testInputs?: number };
    seed?: number;
  };
  const id = `r${nextId++}`;
  const scale = (body.scale ?? 81) as 81 | 810 | 81000;
  const isArc = body.type === "arc";

  const exp = body.experimentId ? findExperiment(body.experimentId) : undefined;
  const requestedTicks = body.ticks ?? exp?.ticks ?? 5000;
  const ticks = Math.min(Math.max(requestedTicks, 100), 200000);

  const record: RunRecord = {
    id,
    experimentId: body.experimentId ?? null,
    scale,
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
      numTasks: body.arc?.numTasks ?? 20,
      trainTicksPerTask: body.arc?.trainTicksPerTask ?? 1500,
      testInputs: body.arc?.testInputs ?? 3,
      signal,
      onProgress: (done, total, sample) => {
        record.ticksDone = done;
        record.ticks = total;
        broadcast(record, "arc_sample", { done, total, sample });
      },
    })
      .then((result) => {
        record.arcResult = result;
        record.status = signal.cancelled ? "cancelled" : "completed";
        record.completedAt = Date.now();
        record.latestStats = result.finalStats;
        record.passed = result.solveRate >= 0.5;
        record.measured = result.solveRate;
        record.target = 0.5;
        record.metric = "solveRate";
        broadcast(record, "complete", {
          id,
          result: {
            solveRate: result.solveRate,
            correct: result.correct,
            total: result.total,
            finalStats: result.finalStats,
          },
        });
        for (const sub of record.subscribers) {
          try {
            sub.end();
          } catch {
            /* */
          }
        }
        record.subscribers.clear();
      })
      .catch((err) => {
        record.status = "error";
        record.error = (err as Error).message;
        record.completedAt = Date.now();
        broadcast(record, "error", { message: record.error });
      });

    res.status(201).json({ id, status: record.status, type: "arc" });
    return;
  }

  const handle = startRun({
    scale,
    ...(body.experimentId ? { experimentId: body.experimentId } : {}),
    ticks,
    ...(body.customParams ? { customParams: body.customParams as Record<string, never> } : {}),
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
      broadcast(record, "complete", e);
      for (const sub of record.subscribers) {
        try {
          sub.end();
        } catch {
          /* */
        }
      }
      record.subscribers.clear();
    },
    onError: (err) => {
      record.status = "error";
      record.error = err.message;
      record.completedAt = Date.now();
      broadcast(record, "error", { message: err.message });
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
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
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
    writeFileSync(
      join(SWEEPS_DIR, `${s.id}.json`),
      JSON.stringify(serializeSweep(s), null, 2),
      "utf8",
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
        combos: data.combos,
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

function serializeSweep(s: SweepRecord) {
  return {
    id: s.id,
    status: s.status,
    createdAt: s.createdAt,
    completedAt: s.completedAt,
    ticksPerCombo: s.ticksPerCombo,
    scale: s.scale,
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
        // Update best by gateStreak (tiebreaker: higher Φ then higher PU)
        const cur = s.combos[s.bestIndex];
        const better =
          !cur ||
          combo.gateStreak > cur.gateStreak ||
          (combo.gateStreak === cur.gateStreak && combo.finalPhi > cur.finalPhi) ||
          (combo.gateStreak === cur.gateStreak &&
            combo.finalPhi === cur.finalPhi &&
            combo.finalPU > cur.finalPU);
        if (better) s.bestIndex = combo.index;
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
    handle.promise.catch(() => undefined);
  });
}

router.post("/sweeps", (req, res) => {
  const body = (req.body ?? {}) as {
    ranges?: Record<string, number[]>;
    ticksPerCombo?: number;
    scale?: 81 | 810 | 81000;
  };
  // Default sweep: hunt the soft attractor sweet spot.
  const ranges: Record<string, number[]> = body.ranges ?? {
    TAU_ATT: [0.4, 0.7, 1.0],
    GAMMA_GLOBAL: [0.5, 1.0, 1.5],
    BETA_ENTROPY: [0.1, 0.3],
  };
  const ticksPerCombo = Math.min(Math.max(body.ticksPerCombo ?? 2500, 500), 20000);
  const scale = (body.scale ?? 81) as 81 | 810 | 81000;
  const grid = cartesian(ranges);
  if (grid.length === 0 || grid.length > 64) {
    res.status(400).json({ error: "ranges must produce 1..64 combinations" });
    return;
  }
  const id = `s${nextSweepId++}`;
  const sweep: SweepRecord = {
    id,
    status: "pending",
    createdAt: Date.now(),
    completedAt: null,
    ticksPerCombo,
    scale,
    combos: grid.map((p, i) => ({
      index: i,
      params: { ATTN_MODE: "soft", USE_BOTTLENECK: false, ...p },
      status: "pending",
      gateOpened: false,
      gateStreak: 0,
      finalPhi: 0,
      finalSC: 0,
      finalPU: 0,
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
    for (const sub of sweep.subscribers) {
      try {
        sub.end();
      } catch {
        /* */
      }
    }
    sweep.subscribers.clear();
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
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
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
    writeFileSync(
      join(BATCHES_DIR, `${b.id}.json`),
      JSON.stringify(snapshot, null, 2),
      "utf8",
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

      const handle = startRun({
        scale: b.scale,
        experimentId: exp.id,
        ticks,
        seed: seedForRun,
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
  const scale = (body.scale ?? 81) as 81 | 810 | 81000;
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
    for (const sub of batch.subscribers) {
      try {
        sub.end();
      } catch {
        /* */
      }
    }
    batch.subscribers.clear();
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
    for (const sub of batch.subscribers) {
      try {
        sub.end();
      } catch {
        /* */
      }
    }
    batch.subscribers.clear();
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
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    b.subscribers.delete(res);
  });
});

function serializeRun(r: RunRecord, full: boolean) {
  return {
    id: r.id,
    experimentId: r.experimentId,
    scale: r.scale,
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
  return { batches: touchedBatches, sweeps: touchedSweeps };
}

export default router;
