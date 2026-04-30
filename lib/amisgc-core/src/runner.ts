import { createSim, simTick, calcStats, captureAttractor, setTask } from "./sim.js";
import type { Stats, SimState } from "./types.js";
import type { Params } from "./params.js";
import { defaultParams, paramsForNeurons } from "./params.js";
import {
  type ExperimentSpec,
  findExperiment,
  ALL_EXPERIMENTS,
} from "./experiments.js";
import { TASK_ORDER } from "./tasks.js";
import { stabilityCheck, type StabilityResult } from "./stats.js";

export interface RunOptions {
  scale?: 81 | 810 | 81000;
  // Optional neuron-count override. If set, the simulator grid is rebuilt for
  // round(√neurons), ignoring the discrete `scale` enum.
  neurons?: number;
  experimentId?: string;
  customParams?: Partial<Params>;
  ticks?: number;
  // Push a sample every this many ticks
  sampleEvery?: number;
  // Capture an attractor every this many ticks if Phi*SC peaks
  attractorEvery?: number;
  // Cancellation token
  signal?: { cancelled: boolean };
  // Deterministic seed (omit for time-based fallback)
  seed?: number;
  // Periodic stats callback
  onSample?: (event: RunSampleEvent) => void;
  // Phase region transition callback
  onPhase?: (event: RunPhaseEvent) => void;
  onStart?: (info: RunStart) => void;
  onComplete?: (final: RunCompleteEvent) => void;
  onError?: (err: Error) => void;
}

export interface RunStart {
  experimentId: string | null;
  scale: 81 | 810 | 81000;
  // Whether N was forced by an explicit `neurons` override (vs the scale enum).
  neuronsOverride?: number;
  N: number;
  ticks: number;
  seed: number;
  hypothesis?: string;
}

export interface RunSampleEvent {
  t: number;
  stats: Stats;
}

export interface RunPhaseEvent {
  t: number;
  phaseRegion: string;
}

export interface MetricSeriesPoint {
  t: number;
  v: number;
}

export interface RunCompleteEvent {
  t: number;
  stats: Stats;
  passed: boolean;
  hypothesis?: string;
  metric?: string;
  measured?: number;
  target?: number;
  attractorCount: number;
  durationMs: number;
  seed: number;
  // Down-sampled measured-metric series (only present if `experimentId` was set
  // so we know which Stat to follow). Used for stability/convergence analysis.
  metricSeries?: MetricSeriesPoint[];
  stability?: StabilityResult;
}

export interface RunHandle {
  promise: Promise<RunCompleteEvent>;
  cancel: () => void;
  signal: { cancelled: boolean };
}

const SAMPLE_DEFAULT = 200;
const ATTRACTOR_DEFAULT = 5000;
// Cap on how many points we keep in the metric series (memory + payload size).
const METRIC_SERIES_CAP = 400;
// How often (wall-clock ms) the run loop yields to the event loop. This is the
// upper bound on cancellation latency: a DELETE /api/runs/:id (or its sweep /
// batch parent) can take at most this long to be observed by the loop, plus
// the cost of the simTick currently in flight. 30ms keeps the dashboard feeling
// responsive while still giving the simulator plenty of CPU between yields.
const YIELD_INTERVAL_MS = 30;

export function startRun(opts: RunOptions = {}): RunHandle {
  const signal = opts.signal ?? { cancelled: false };
  const cancel = () => {
    signal.cancelled = true;
  };

  const promise = (async () => {
    const startTime = Date.now();
    const scale = opts.scale ?? 81;
    let exp: ExperimentSpec | undefined;
    if (opts.experimentId) {
      exp = findExperiment(opts.experimentId);
    }
    const baseParams =
      typeof opts.neurons === "number" && Number.isFinite(opts.neurons)
        ? paramsForNeurons(opts.neurons)
        : defaultParams(scale);
    const params: Params = {
      ...baseParams,
      ...(exp?.params ?? {}),
      ...(opts.customParams ?? {}),
    };
    const ticks = opts.ticks ?? exp?.ticks ?? 50000;
    const createOpts = typeof opts.seed === "number" ? { seed: opts.seed } : {};
    const { sim, ctx } = createSim(params, createOpts);
    const seed = ctx.seed;

    opts.onStart?.({
      experimentId: opts.experimentId ?? null,
      scale,
      ...(typeof opts.neurons === "number" ? { neuronsOverride: opts.neurons } : {}),
      N: params.N,
      ticks,
      seed,
      ...(exp?.hypothesis ? { hypothesis: exp.hypothesis } : {}),
    });

    let lastPhase = sim.phaseRegion;
    const sampleEvery = opts.sampleEvery ?? SAMPLE_DEFAULT;
    const attractorEvery = opts.attractorEvery ?? ATTRACTOR_DEFAULT;
    const metricKey = exp?.metric;
    const metricSeries: MetricSeriesPoint[] = [];
    // Down-sample to fit METRIC_SERIES_CAP. Estimate stride from total samples.
    const totalSamples = Math.max(1, Math.ceil(ticks / sampleEvery));
    const seriesStride = Math.max(1, Math.ceil(totalSamples / METRIC_SERIES_CAP));
    let sampleCounter = 0;

    // Cycle through tasks naturally; advanceTask runs internally based on TASK_TICKS
    setTask(sim, "COPY");

    // Yield to the event loop before the first simTick so that:
    //   (a) the HTTP handler that called startRun() can send its response
    //       immediately (instead of being blocked for up to YIELD_INTERVAL_MS),
    //   (b) any cancel signal that arrived concurrently is visible before the
    //       very first tick executes.
    await new Promise<void>((r) => setImmediate(r));
    if (signal.cancelled) {
      const stats = calcStats(sim, ctx);
      opts.onComplete?.({
        t: sim.t,
        stats,
        passed: false,
        attractorCount: sim.attractorLibrary.length,
        durationMs: Date.now() - startTime,
        seed,
      });
      return {
        t: sim.t,
        stats,
        passed: false,
        attractorCount: sim.attractorLibrary.length,
        durationMs: Date.now() - startTime,
        seed,
      };
    }

    let lastYieldAt = Date.now();
    // Single try/catch covers BOTH the inner tick loop AND the post-loop
    // tail (calcStats, result construction, onComplete). If anything in the
    // tail throws — e.g. a malformed stat blowing up stabilityCheck, or a
    // bug inside the user's onComplete callback — onError MUST fire so the
    // outer caller's promise can settle. Otherwise sweep / auto-mode
    // orchestrators that resolve only inside onComplete/onError would hang
    // forever on that combo and freeze the whole run.
    try {
      for (let i = 0; i < ticks; i++) {
        if (signal.cancelled) break;
        simTick(sim, ctx);

        if (sim.t % sampleEvery === 0) {
          const stats = calcStats(sim, ctx);
          if (stats.phaseRegion !== lastPhase) {
            opts.onPhase?.({ t: sim.t, phaseRegion: stats.phaseRegion });
            lastPhase = stats.phaseRegion;
          }
          opts.onSample?.({ t: sim.t, stats });
          if (metricKey && sampleCounter % seriesStride === 0) {
            const v = (stats as unknown as Record<string, number>)[metricKey];
            if (typeof v === "number" && Number.isFinite(v)) {
              metricSeries.push({ t: sim.t, v });
            }
          }
          sampleCounter++;
        }

        if (sim.t % attractorEvery === 0 && sim.t > 0) {
          captureAttractor(sim, ctx);
        }
        // (Task rotation is fully handled inside simTick via advanceTask.)

        // Wall-clock-based yield to the event loop. Decoupled from sample
        // timing so heavy grids (large N) — where a single simTick can take
        // many ms — still flush SSE events and pick up DELETE /cancel
        // requests within ~YIELD_INTERVAL_MS. Date.now() is ~20ns; cheap
        // compared to even the smallest simTick.
        if (Date.now() - lastYieldAt >= YIELD_INTERVAL_MS) {
          await new Promise((r) => setImmediate(r));
          if (signal.cancelled) break;
          lastYieldAt = Date.now();
        }
      }

      const stats = calcStats(sim, ctx);
      let passed = !signal.cancelled;
      let measured: number | undefined;
      if (exp) {
        measured = (stats as unknown as Record<string, number>)[exp.metric];
        if (
          !signal.cancelled &&
          typeof measured === "number" &&
          !Number.isNaN(measured)
        ) {
          passed =
            exp.targetDir === 1
              ? measured >= exp.targetVal
              : measured <= exp.targetVal;
        } else {
          passed = false;
        }
        if (typeof measured === "number" && Number.isFinite(measured)) {
          // Make sure the final point is in the series for accurate stability.
          const last = metricSeries[metricSeries.length - 1];
          if (!last || last.t !== sim.t) metricSeries.push({ t: sim.t, v: measured });
        }
      }
      const stability =
        metricSeries.length >= 4 ? stabilityCheck(metricSeries) : undefined;
      const result: RunCompleteEvent = {
        t: sim.t,
        stats,
        passed,
        ...(exp ? { hypothesis: exp.hypothesis, metric: exp.metric, target: exp.targetVal } : {}),
        ...(measured !== undefined ? { measured } : {}),
        attractorCount: sim.attractorLibrary.length,
        durationMs: Date.now() - startTime,
        seed,
        ...(metricSeries.length > 0 ? { metricSeries } : {}),
        ...(stability ? { stability } : {}),
      };
      opts.onComplete?.(result);
      return result;
    } catch (err) {
      opts.onError?.(err as Error);
      throw err;
    }
  })();

  return { promise, cancel, signal };
}

// Run a single tick without instantiating a runner.
export function singleTickDemo(scale: 81 | 810 = 81): { stats: Stats; sim: SimState } {
  const params = defaultParams(scale);
  const { sim, ctx } = createSim(params);
  for (let i = 0; i < 200; i++) simTick(sim, ctx);
  return { stats: calcStats(sim, ctx), sim };
}

export { ALL_EXPERIMENTS, TASK_ORDER };
