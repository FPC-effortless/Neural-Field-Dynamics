import { createSim, simTick, calcStats, captureAttractor, setTask } from "./sim.js";
import type { Stats, SimState } from "./types.js";
import type { Params } from "./params.js";
import { defaultParams } from "./params.js";
import {
  type ExperimentSpec,
  findExperiment,
  ALL_EXPERIMENTS,
} from "./experiments.js";
import { TASK_ORDER } from "./tasks.js";

export interface RunOptions {
  scale?: 81 | 810 | 81000;
  experimentId?: string;
  customParams?: Partial<Params>;
  ticks?: number;
  // Push a sample every this many ticks
  sampleEvery?: number;
  // Capture an attractor every this many ticks if Phi*SC peaks
  attractorEvery?: number;
  // Cancellation token
  signal?: { cancelled: boolean };
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
  N: number;
  ticks: number;
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
}

export interface RunHandle {
  promise: Promise<RunCompleteEvent>;
  cancel: () => void;
  signal: { cancelled: boolean };
}

const SAMPLE_DEFAULT = 200;
const ATTRACTOR_DEFAULT = 5000;

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
    const baseParams = defaultParams(scale);
    const params: Params = {
      ...baseParams,
      ...(exp?.params ?? {}),
      ...(opts.customParams ?? {}),
    };
    const ticks = opts.ticks ?? exp?.ticks ?? 50000;
    const { sim, ctx } = createSim(params);

    opts.onStart?.({
      experimentId: opts.experimentId ?? null,
      scale,
      N: params.N,
      ticks,
      ...(exp?.hypothesis ? { hypothesis: exp.hypothesis } : {}),
    });

    let lastPhase = sim.phaseRegion;
    const sampleEvery = opts.sampleEvery ?? SAMPLE_DEFAULT;
    const attractorEvery = opts.attractorEvery ?? ATTRACTOR_DEFAULT;

    // Cycle through tasks naturally; advanceTask runs internally based on TASK_TICKS
    setTask(sim, "COPY");

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
          // Yield to event loop so SSE clients can keep up
          if (sim.t % (sampleEvery * 4) === 0) {
            await new Promise((r) => setImmediate(r));
          }
        }

        if (sim.t % attractorEvery === 0 && sim.t > 0) {
          captureAttractor(sim, ctx);
        }

        // After enough learning on the first task, rotate through TASK_ORDER
        if (sim.t > 0 && sim.t % params.TASK_TICKS === 0) {
          // task rotation already handled inside simTick via advanceTask
        }
      }
    } catch (err) {
      opts.onError?.(err as Error);
      throw err;
    }

    const stats = calcStats(sim, ctx);
    let passed = true;
    let measured: number | undefined;
    if (exp) {
      measured = (stats as unknown as Record<string, number>)[exp.metric];
      if (typeof measured === "number" && !Number.isNaN(measured)) {
        passed =
          exp.targetDir === 1
            ? measured >= exp.targetVal
            : measured <= exp.targetVal;
      } else {
        passed = false;
      }
    }
    const result: RunCompleteEvent = {
      t: sim.t,
      stats,
      passed,
      ...(exp ? { hypothesis: exp.hypothesis, metric: exp.metric, target: exp.targetVal } : {}),
      ...(measured !== undefined ? { measured } : {}),
      attractorCount: sim.attractorLibrary.length,
      durationMs: Date.now() - startTime,
    };
    opts.onComplete?.(result);
    return result;
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
