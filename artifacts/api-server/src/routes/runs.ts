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
