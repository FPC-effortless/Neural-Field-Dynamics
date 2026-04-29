import { Router, type IRouter, type Request, type Response } from "express";
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
} from "@workspace/amisgc-core";
import { runArcBenchmark, type ArcResult, type ArcSample } from "@workspace/amisgc-core";

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
    onStart: (info) => {
      record.start = info;
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

  res.status(201).json({ id, status: record.status });
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
        broadcastSweep(s, "combo_complete", { sweepId: s.id, combo, bestIndex: s.bestIndex });
        resolve();
      },
      onError: (err) => {
        record.status = "error";
        record.error = err.message;
        record.completedAt = Date.now();
        combo.status = "completed";
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

export default router;
