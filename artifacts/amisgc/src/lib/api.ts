// Lightweight API client for the AMISGC backend.
// All requests are routed via BASE_URL (vite injects the artifact prefix).

const RAW = import.meta.env.BASE_URL ?? "/";
const BASE = RAW.endsWith("/") ? RAW : RAW + "/";

export const API_PREFIX = `${BASE}api`;

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export interface ExperimentSummary {
  id: string;
  name: string;
  phase: string;
  desc: string;
  hypothesis: string;
  ticks: number;
  metric: string;
  targetVal: number;
  targetDir: 1 | -1;
  // v13 spec §3.2 — true when this experiment is in a phase above PH0 and the
  // Existence Gate has not yet been opened (or manually overridden).
  locked?: boolean;
}

export interface PhaseGroup {
  phase: string;
  label: string;
  experimentIds: string[];
  locked?: boolean;
}

// v13 spec §3.2 — phase-lock state surfaced to the UI.
export interface PhaseStatus {
  gateOpened: boolean;
  gateOpenedAt: number | null;
  openedByRunId: string | null;
  openedByExperimentId: string | null;
  openingGateStreak: number;
  manualOverride: boolean;
  manualOverrideAt: number | null;
  history: Array<{
    ts: number;
    runId: string;
    experimentId: string | null;
    gateStreak: number;
  }>;
  gateStreakRequired?: number;
}

export interface Stats {
  healthy: number;
  stressed: number;
  atrophied: number;
  alarming: number;
  refractory: number;
  drifted: number;
  avgAtp: number;
  avgH: number;
  avgV: number;
  networkMI: number;
  networkSE: number;
  networkCR: number;
  ats: number | null;
  C_chollet: number;
  networkCoh: number;
  networkSself: number;
  networkAgency: number;
  C_bach: number;
  J_score: number;
  networkPhi: number;
  networkSC: number;
  networkAS: number;
  networkR: number;
  networkControl: number;
  networkM: number;
  networkDopamine: number;
  V_td: number;
  J_star: number;
  J_emb: number;
  networkIC: number;
  networkPD: number;
  networkFSI: number;
  networkSbody: number;
  networkCtrl: number;
  body_energy: number;
  body_health: number;
  eps_body: number;
  networkAtpVar: number;
  networkEE: number;
  networkBPS: number;
  FS: number;
  networkClustering: number;
  avgDeff: number;
  branchB: number;
  networkDU: number;
  hPhiSeen: boolean;
  h16Confirmed: boolean;
  h17Confirmed: boolean;
  taskKey: string;
  taskProgress: number;
  totalPruned: number;
  totalGrown: number;
  converged: boolean;
  convergedAt: number;
  phaseTimeCOG: number;
  phaseTimePRED: number;
  win_Jstar: number;
  win_Phi: number;
  win_SC: number;
  win_Coh: number;
  win_Ctrl: number;
  win_IC: number;
  exp_maxPhi: number;
  exp_phiPhase: boolean;
  phaseRegion: string;
  attractorCount: number;
  networkPU?: number;
  networkH_C?: number;
  networkCAR?: number;
  existenceGate?: 0 | 1;
  gateStreak?: number;
  failureReason?: string;
}

export interface RunSummary {
  id: string;
  experimentId: string | null;
  scale: 81 | 810 | 81000;
  status: "pending" | "running" | "completed" | "cancelled" | "error";
  ticks: number;
  ticksDone: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  latestStats: Stats | null;
  hypothesis?: string;
  passed?: boolean;
  metric?: string;
  measured?: number;
  target?: number;
  seed?: number | null;
  error: string | null;
}

export interface ArcSample {
  id: string;
  transformName: string;
  input: number[];
  expected: number[];
  predicted: number[];
  correct: boolean;
  similarity: number;
}

export interface RunDetail extends RunSummary {
  result: {
    t: number;
    stats: Stats;
    passed: boolean;
    hypothesis?: string;
    metric?: string;
    measured?: number;
    target?: number;
    attractorCount: number;
    durationMs: number;
  } | null;
  arcResult: {
    total: number;
    correct: number;
    solveRate: number;
    samples: ArcSample[];
    finalStats: Stats;
  } | null;
  history: Array<{ t: number; stats: Stats }> | null;
}

export interface CreateRunRequest {
  experimentId?: string;
  scale?: 81 | 810 | 81000;
  // Optional override of total neuron count (rebuilds the simulator grid).
  // Server clamps to [9, 102_400]; takes precedence over `scale` when set.
  neurons?: number;
  // Optional Top-K override (absolute count of conscious neurons per tick).
  // Server converts to TOPK_FRACTION = topK / N at run time. Clamped to
  // [1, 102_400]. Wins over any TOPK_FRACTION supplied via customParams.
  topK?: number;
  ticks?: number;
  customParams?: Record<string, number | boolean>;
  type?: "experiment" | "arc";
  arc?: { numTasks?: number; trainTicksPerTask?: number; testInputs?: number };
  seed?: number;
}

export const api = {
  experiments: () =>
    jsonFetch<{
      experiments: ExperimentSummary[];
      groups: PhaseGroup[];
      phaseStatus?: PhaseStatus;
    }>(`${API_PREFIX}/experiments`),
  phaseStatus: () =>
    jsonFetch<PhaseStatus>(`${API_PREFIX}/phase-status`),
  setPhaseOverride: (enabled: boolean) =>
    jsonFetch<PhaseStatus>(`${API_PREFIX}/phase-status/override`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),
  resetPhaseStatus: () =>
    jsonFetch<PhaseStatus>(`${API_PREFIX}/phase-status/reset`, {
      method: "POST",
    }),
  listRuns: () =>
    jsonFetch<{ runs: RunSummary[] }>(`${API_PREFIX}/runs`),
  getRun: (id: string) =>
    jsonFetch<RunDetail>(`${API_PREFIX}/runs/${id}`),
  createRun: (body: CreateRunRequest) =>
    jsonFetch<{ id: string; status: string; type?: string; seed?: number | null }>(
      `${API_PREFIX}/runs`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
  cancelRun: (id: string) =>
    jsonFetch<{ id: string; status: string }>(`${API_PREFIX}/runs/${id}`, {
      method: "DELETE",
    }),
  streamUrl: (id: string) => `${API_PREFIX}/runs/${id}/stream`,
};

export interface SseHandlers {
  onSnapshot?: (snapshot: RunDetail) => void;
  onSample?: (event: { t: number; stats: Stats }) => void;
  onPhase?: (event: { t: number; phaseRegion: string }) => void;
  onStart?: (info: unknown) => void;
  onComplete?: (event: unknown) => void;
  onArcSample?: (event: { done: number; total: number; sample: ArcSample }) => void;
  onError?: (msg: string) => void;
}

// ─── Reconnecting SSE helper ─────────────────────────────────────────────────
// Wraps EventSource with exponential-backoff reconnection so transient network
// drops don't permanently break a live run, sweep, batch or auto-mode stream.
//
// The browser's built-in reconnect uses a fixed delay from the SSE `retry:`
// field; this gives us 1 s → 2 s → 4 s → … → 30 s (capped) instead.
//
// Terminal-event handlers must call `sse.close()` (the wrapper's close, not the
// raw EventSource's) to prevent reconnection after the server intentionally ends
// the stream.

const SSE_RECONNECT_BASE_MS = 1_000;
const SSE_RECONNECT_MAX_MS = 30_000;

interface ReconnectingSse {
  addEventListener(event: string, handler: (ev: MessageEvent) => void): void;
  close(): void;
}

function openSseWithReconnect(url: string): ReconnectingSse {
  let terminated = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: EventSource | null = null;

  const listeners: Array<{ event: string; handler: (ev: MessageEvent) => void }> = [];

  function connect() {
    if (terminated) return;
    const es = new EventSource(url);
    current = es;
    for (const { event, handler } of listeners) {
      es.addEventListener(event, handler);
    }
    es.addEventListener("error", () => {
      if (terminated) return;
      es.close();
      current = null;
      const delay = Math.min(SSE_RECONNECT_BASE_MS * 2 ** attempt, SSE_RECONNECT_MAX_MS);
      attempt++;
      timer = setTimeout(connect, delay);
    });
  }

  function close() {
    terminated = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    current?.close();
    current = null;
  }

  function addEventListener(event: string, handler: (ev: MessageEvent) => void) {
    // Wrap so any received message resets the backoff counter.
    const wrapped = (ev: MessageEvent) => {
      attempt = 0;
      handler(ev);
    };
    listeners.push({ event, handler: wrapped });
    current?.addEventListener(event, wrapped);
  }

  connect();
  return { addEventListener, close };
}

export function subscribeRun(id: string, handlers: SseHandlers): () => void {
  const url = api.streamUrl(id);
  const sse = openSseWithReconnect(url);
  if (handlers.onSnapshot) {
    sse.addEventListener("snapshot", (ev: MessageEvent) => {
      try {
        handlers.onSnapshot?.(JSON.parse(ev.data) as RunDetail);
      } catch {
        /* ignore malformed */
      }
    });
  }
  if (handlers.onSample) {
    sse.addEventListener("sample", (ev: MessageEvent) => {
      try {
        handlers.onSample?.(JSON.parse(ev.data) as { t: number; stats: Stats });
      } catch {
        /* ignore */
      }
    });
  }
  if (handlers.onPhase) {
    sse.addEventListener("phase", (ev: MessageEvent) => {
      try {
        handlers.onPhase?.(JSON.parse(ev.data) as { t: number; phaseRegion: string });
      } catch {
        /* ignore */
      }
    });
  }
  if (handlers.onStart) {
    sse.addEventListener("start", (ev: MessageEvent) => {
      try {
        handlers.onStart?.(JSON.parse(ev.data));
      } catch {
        /* ignore */
      }
    });
  }
  // Terminal: complete — refresh run detail from server and stop reconnecting.
  sse.addEventListener("complete", (ev: MessageEvent) => {
    try {
      handlers.onComplete?.(JSON.parse(ev.data));
    } catch {
      /* ignore */
    }
    sse.close();
  });
  // The server broadcasts `cancelled` immediately when a DELETE arrives, before
  // the runner loop unwinds and emits the final `complete` event. Treating it
  // as a terminal event mirrors the complete path: call onComplete (so the UI
  // refreshes the run detail) and stop reconnecting.
  sse.addEventListener("cancelled", (ev: MessageEvent) => {
    try {
      handlers.onComplete?.(JSON.parse(ev.data));
    } catch {
      /* ignore */
    }
    sse.close();
  });
  if (handlers.onArcSample) {
    sse.addEventListener("arc_sample", (ev: MessageEvent) => {
      try {
        handlers.onArcSample?.(
          JSON.parse(ev.data) as { done: number; total: number; sample: ArcSample },
        );
      } catch {
        /* ignore */
      }
    });
  }
  return () => sse.close();
}

// ─── Sweep client ────────────────────────────────────────────────────────────

export interface SweepCombo {
  index: number;
  params: Record<string, number | boolean | string>;
  status: "pending" | "running" | "completed" | "skipped";
  gateOpened: boolean;
  gateStreak: number;
  finalPhi: number;
  finalSC: number;
  finalPU: number;
  // Coherence Amplification Ratio: latest sample (finalCAR) and running max
  // (bestCAR). Both are populated as combos stream progress.
  finalCAR: number;
  bestCAR: number;
  ticksDone: number;
  runId: string | null;
}

export interface SweepDetail {
  id: string;
  status: "pending" | "running" | "completed" | "cancelled";
  createdAt: number;
  completedAt: number | null;
  ticksPerCombo: number;
  scale: 81 | 810 | 81000;
  neurons?: number;
  // Top-K override (absolute count) the sweep was launched with. Each combo's
  // params already carry the converted TOPK_FRACTION; this field surfaces the
  // user-supplied integer for display / re-launch.
  topK?: number;
  // Set when this sweep was launched as one iteration of an auto-mode session.
  autoModeId?: string;
  autoModeIteration?: number;
  currentIndex: number;
  bestIndex: number;
  total: number;
  combos: SweepCombo[];
}

export interface CreateSweepRequest {
  ranges?: Record<string, number[]>;
  ticksPerCombo?: number;
  scale?: 81 | 810 | 81000;
  neurons?: number;
  topK?: number;
}

export const sweepApi = {
  list: () => jsonFetch<{ sweeps: SweepDetail[] }>(`${API_PREFIX}/sweeps`),
  get: (id: string) => jsonFetch<SweepDetail>(`${API_PREFIX}/sweeps/${id}`),
  create: (body: CreateSweepRequest) =>
    jsonFetch<{ id: string; total: number }>(`${API_PREFIX}/sweeps`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cancel: (id: string) =>
    jsonFetch<{ id: string; status: string }>(`${API_PREFIX}/sweeps/${id}`, {
      method: "DELETE",
    }),
  streamUrl: (id: string) => `${API_PREFIX}/sweeps/${id}/stream`,
};

export interface SweepHandlers {
  onSnapshot?: (s: SweepDetail) => void;
  onComboStart?: (e: { sweepId: string; combo: SweepCombo }) => void;
  onComboProgress?: (e: { sweepId: string; combo: SweepCombo }) => void;
  onComboComplete?: (e: { sweepId: string; combo: SweepCombo; bestIndex: number }) => void;
  onSweepStart?: (s: SweepDetail) => void;
  onSweepComplete?: (s: SweepDetail) => void;
  onError?: (msg: string) => void;
}

// ─── Batch client ────────────────────────────────────────────────────────────

export interface BatchItem {
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
  seeds?: number[];
  passes: number;
  totalRuns: number;
  status: "pending" | "running" | "completed" | "skipped" | "error";
  meanMeasured: number | null;
  stdMeasured: number | null;
  ticksDone: number;
  ticksTotal: number;
  durationMs: number;
}

export type BatchStatus =
  | "pending"
  | "running"
  | "completed"
  | "cancelled"
  | "interrupted";

export interface BatchDetail {
  id: string;
  status: BatchStatus;
  scale: 81 | 810 | 81000;
  neurons?: number;
  // Top-K override (absolute count) applied to every item in the batch.
  topK?: number;
  ticksPerExperiment: number | null;
  repeats: number;
  baseSeed?: number;
  createdAt: number;
  completedAt: number | null;
  currentIndex: number;
  totalCompleted: number;
  totalPassed: number;
  total: number;
  items: BatchItem[];
}

export interface CreateBatchRequest {
  experimentIds?: string[];
  phase?: string;
  all?: boolean;
  scale?: 81 | 810 | 81000;
  neurons?: number;
  topK?: number;
  ticksPerExperiment?: number;
  repeats?: number;
  seed?: number;
}

// ─── Leaderboard / notes / baselines / version / diff ────────────────────────

export interface BaselineDelta {
  baselineId: string;
  delta: number | null;
  pTwoSided: number | null;
  baselineMean: number | null;
  baselineN: number;
  sign: "better" | "worse" | "tie" | null;
}

export interface LeaderboardRow {
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

export interface LeaderboardQuery {
  phase?: string;
  search?: string;
  baseline?: string;
  minRuns?: number;
  excludeInterrupted?: boolean;
}

function buildQuery(q: LeaderboardQuery): string {
  const sp = new URLSearchParams();
  if (q.phase) sp.set("phase", q.phase);
  if (q.search) sp.set("search", q.search);
  if (q.baseline) sp.set("baseline", q.baseline);
  if (typeof q.minRuns === "number" && q.minRuns > 0) sp.set("minRuns", String(q.minRuns));
  if (q.excludeInterrupted) sp.set("excludeInterrupted", "1");
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const leaderboardApi = {
  get: (q: LeaderboardQuery = {}) =>
    jsonFetch<{
      rows: LeaderboardRow[];
      totalBatches: number;
      includedBatches: number;
      baselineId?: string;
      baselineFound?: boolean;
    }>(`${API_PREFIX}/leaderboard${buildQuery(q)}`),
};

export interface ExperimentNote {
  text: string;
  tags: string[];
  pinned: boolean;
  updatedAt: number;
}

export const notesApi = {
  list: () =>
    jsonFetch<{ notes: Record<string, ExperimentNote> }>(`${API_PREFIX}/notes`),
  put: (experimentId: string, patch: Partial<ExperimentNote>) =>
    jsonFetch<ExperimentNote & { experimentId: string }>(
      `${API_PREFIX}/notes/${encodeURIComponent(experimentId)}`,
      {
        method: "PUT",
        body: JSON.stringify(patch),
      },
    ),
  remove: (experimentId: string) =>
    jsonFetch<{ experimentId: string; removed: boolean }>(
      `${API_PREFIX}/notes/${encodeURIComponent(experimentId)}`,
      { method: "DELETE" },
    ),
};

export interface BaselineRecord {
  id: string;
  name: string;
  batchId: string;
  createdAt: number;
  notes?: string;
}

export const baselinesApi = {
  list: () =>
    jsonFetch<{ baselines: BaselineRecord[] }>(`${API_PREFIX}/baselines`),
  create: (body: { name?: string; batchId: string; notes?: string }) =>
    jsonFetch<BaselineRecord>(`${API_PREFIX}/baselines`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    jsonFetch<{ id: string; removed: boolean }>(
      `${API_PREFIX}/baselines/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
};

export interface VersionInfo {
  version: string;
  gitSha: string | null;
  buildTime: string | null;
  nodeEnv: string;
  startedAt: number;
  uptimeMs: number;
  authRequired: boolean;
}

export const systemApi = {
  version: () => jsonFetch<VersionInfo>(`${API_PREFIX}/version`),
};

export interface DiffRow {
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
}

export interface DiffResponse {
  aId: string;
  bId: string;
  aCreatedAt: number;
  bCreatedAt: number;
  rows: DiffRow[];
}

export const batchApi = {
  list: () => jsonFetch<{ batches: BatchDetail[] }>(`${API_PREFIX}/batches`),
  get: (id: string) => jsonFetch<BatchDetail>(`${API_PREFIX}/batches/${id}`),
  create: (body: CreateBatchRequest) =>
    jsonFetch<{ id: string; total: number; repeats: number; baseSeed: number }>(
      `${API_PREFIX}/batches`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
  cancel: (id: string) =>
    jsonFetch<{ id: string; status: string }>(`${API_PREFIX}/batches/${id}`, {
      method: "DELETE",
    }),
  rerun: (id: string, body: { keepSeed?: boolean; repeats?: number } = {}) =>
    jsonFetch<{
      id: string;
      sourceBatchId: string;
      total: number;
      repeats: number;
      baseSeed: number;
    }>(`${API_PREFIX}/batches/${encodeURIComponent(id)}/rerun`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  diff: (a: string, b: string) =>
    jsonFetch<DiffResponse>(
      `${API_PREFIX}/batches/${encodeURIComponent(a)}/diff/${encodeURIComponent(b)}`,
    ),
  streamUrl: (id: string) => `${API_PREFIX}/batches/${id}/stream`,
};

export interface BatchHandlers {
  onSnapshot?: (b: BatchDetail) => void;
  onBatchStart?: (b: BatchDetail) => void;
  onItemStart?: (e: { batchId: string; item: BatchItem }) => void;
  onItemProgress?: (e: { batchId: string; item: BatchItem }) => void;
  onItemComplete?: (e: {
    batchId: string;
    item: BatchItem;
    totalCompleted: number;
    totalPassed: number;
  }) => void;
  onBatchComplete?: (b: BatchDetail) => void;
  onError?: (msg: string) => void;
}

export function subscribeBatch(id: string, handlers: BatchHandlers): () => void {
  const sse = openSseWithReconnect(batchApi.streamUrl(id));
  const bind = <T,>(name: string, fn?: (data: T) => void) => {
    if (!fn) return;
    sse.addEventListener(name, (ev: MessageEvent) => {
      try {
        fn(JSON.parse(ev.data) as T);
      } catch {
        /* ignore */
      }
    });
  };
  bind<BatchDetail>("snapshot", handlers.onSnapshot);
  bind<BatchDetail>("batch_start", handlers.onBatchStart);
  bind<{ batchId: string; item: BatchItem }>("item_start", handlers.onItemStart);
  bind<{ batchId: string; item: BatchItem }>("item_progress", handlers.onItemProgress);
  bind<{ batchId: string; item: BatchItem; totalCompleted: number; totalPassed: number }>(
    "item_complete",
    handlers.onItemComplete,
  );
  const onBatchTerminal = (ev: MessageEvent) => {
    try {
      handlers.onBatchComplete?.(JSON.parse(ev.data) as BatchDetail);
    } catch {
      /* ignore */
    }
    sse.close();
  };
  sse.addEventListener("batch_complete", onBatchTerminal);
  sse.addEventListener("batch_cancelled", onBatchTerminal);
  return () => sse.close();
}

export function subscribeSweep(id: string, handlers: SweepHandlers): () => void {
  const sse = openSseWithReconnect(sweepApi.streamUrl(id));
  const bind = <T,>(name: string, fn?: (data: T) => void) => {
    if (!fn) return;
    sse.addEventListener(name, (ev: MessageEvent) => {
      try {
        fn(JSON.parse(ev.data) as T);
      } catch {
        /* ignore */
      }
    });
  };
  bind<SweepDetail>("snapshot", handlers.onSnapshot);
  bind<SweepDetail>("sweep_start", handlers.onSweepStart);
  bind<{ sweepId: string; combo: SweepCombo }>("combo_start", handlers.onComboStart);
  bind<{ sweepId: string; combo: SweepCombo }>("combo_progress", handlers.onComboProgress);
  bind<{ sweepId: string; combo: SweepCombo; bestIndex: number }>(
    "combo_complete",
    handlers.onComboComplete,
  );
  // Treat `sweep_cancelled` as a terminal event equivalent to `sweep_complete`:
  // the server emits it the moment a DELETE arrives so the UI can flip to
  // "cancelled" immediately, instead of waiting for the runner to unwind.
  const onTerminal = (ev: MessageEvent) => {
    try {
      handlers.onSweepComplete?.(JSON.parse(ev.data) as SweepDetail);
    } catch {
      /* ignore */
    }
    sse.close();
  };
  sse.addEventListener("sweep_complete", onTerminal);
  sse.addEventListener("sweep_cancelled", onTerminal);
  return () => sse.close();
}

// ─── Auto-Mode client ────────────────────────────────────────────────────────
// Auto-Mode chains parameter sweeps that progressively refine around the
// best combo until the Existence Gate is held for ≥`gateStreakTarget` ticks
// (1000 by v13 spec) or `maxIterations` is reached. Each iteration is itself
// a normal Sweep (so its combos persist alongside hand-launched sweeps).

export interface AutoModeIterationSummary {
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

export interface AutoModeDetail {
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
  currentIteration: number;
  bestSweepId: string | null;
  bestComboIndex: number;
  bestParams: Record<string, number | boolean | string> | null;
  bestGateStreak: number;
  bestCAR?: number;
  passed: boolean;
  iterations: AutoModeIterationSummary[];
  // Plain-English explainer fields populated server-side by serializeAutoMode.
  // Optional so older persisted records (loaded from disk) still parse.
  gate?: {
    color: "green" | "yellow" | "red" | "grey";
    label: string;
    headline: string;
  };
  failureReason?: {
    code:
      | "OK"
      | "WEAK_GLOBAL_FIELD"
      | "PARTICIPATION_COLLAPSED"
      | "TEMPORAL_INSTABILITY"
      | "GATE_OPENED_BUT_STREAK_SHORT"
      | "LOCAL_PASS_GLOBAL_FAIL"
      | "BUDGET_EXHAUSTED"
      | "NOT_RUN_YET";
    plain: string;
  };
  nextStep?: {
    action:
      | "PROCEED_TO_NEXT_PHASE"
      | "EXTEND_TICKS"
      | "INCREASE_GLOBAL_COUPLING"
      | "INCREASE_TEMPERATURE"
      | "REDUCE_NOISE"
      | "MORE_SEEDS"
      | "GIVE_UP_AND_REVISIT"
      | "WAIT";
    plain: string;
  };
}

export interface PresetDisplay {
  scaleLabel: string;
  ticksLabel: string;
  iterationsLabel: string;
  expectedRuntime: string;
}

export interface Preset {
  id: string;
  name: string;
  tagline: string;
  description: string;
  difficulty: "quick" | "standard" | "deep" | "debug";
  body: CreateAutoModeRequest & { scale: 81 | 810 | 81000 };
  display: PresetDisplay;
  recommended?: boolean;
  // True when this preset requires Gate I (Existence Gate) to be open.
  // The lab home greys out and locks the card while the gate is closed.
  requiresGateOpen?: boolean;
}

export interface CreateAutoModeRequest {
  scale?: 81 | 810 | 81000;
  neurons?: number;
  topK?: number;
  ticksPerCombo?: number;
  maxIterations?: number;
  gateStreakTarget?: number;
  baseRanges?: Record<string, number[]>;
}

export const autoModeApi = {
  presets: () =>
    jsonFetch<{ presets: Preset[] }>(`${API_PREFIX}/presets`),
  list: () =>
    jsonFetch<{ automodes: AutoModeDetail[] }>(`${API_PREFIX}/automode`),
  get: (id: string) => jsonFetch<AutoModeDetail>(`${API_PREFIX}/automode/${id}`),
  create: (body: CreateAutoModeRequest) =>
    jsonFetch<{
      id: string;
      maxIterations: number;
      gateStreakTarget: number;
      initialCombos: number;
    }>(`${API_PREFIX}/automode`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cancel: (id: string) =>
    jsonFetch<{ id: string; status: string }>(`${API_PREFIX}/automode/${id}`, {
      method: "DELETE",
    }),
  streamUrl: (id: string) => `${API_PREFIX}/automode/${id}/stream`,
};

export interface AutoModeHandlers {
  onSnapshot?: (a: AutoModeDetail) => void;
  onAutoModeStart?: (a: AutoModeDetail) => void;
  onIterationStart?: (e: {
    autoModeId: string;
    iteration: AutoModeIterationSummary;
    sweep: SweepDetail;
  }) => void;
  onComboComplete?: (e: {
    autoModeId: string;
    iterationIndex: number;
    sweepId: string;
    combo: SweepCombo;
    bestIndex: number;
  }) => void;
  onIterationComplete?: (e: {
    autoModeId: string;
    iteration: AutoModeIterationSummary;
    bestSweepId: string | null;
    bestParams: Record<string, number | boolean | string> | null;
    bestGateStreak: number;
  }) => void;
  onAutoModeComplete?: (a: AutoModeDetail) => void;
  onError?: (msg: string) => void;
}

export function subscribeAutoMode(
  id: string,
  handlers: AutoModeHandlers,
): () => void {
  const sse = openSseWithReconnect(autoModeApi.streamUrl(id));
  const bind = <T,>(name: string, fn?: (data: T) => void) => {
    if (!fn) return;
    sse.addEventListener(name, (ev: MessageEvent) => {
      try {
        fn(JSON.parse(ev.data) as T);
      } catch {
        /* ignore malformed */
      }
    });
  };
  bind<AutoModeDetail>("snapshot", handlers.onSnapshot);
  bind<AutoModeDetail>("automode_start", handlers.onAutoModeStart);
  bind<{
    autoModeId: string;
    iteration: AutoModeIterationSummary;
    sweep: SweepDetail;
  }>("iteration_start", handlers.onIterationStart);
  bind<{
    autoModeId: string;
    iterationIndex: number;
    sweepId: string;
    combo: SweepCombo;
    bestIndex: number;
  }>("combo_complete", handlers.onComboComplete);
  bind<{
    autoModeId: string;
    iteration: AutoModeIterationSummary;
    bestSweepId: string | null;
    bestParams: Record<string, number | boolean | string> | null;
    bestGateStreak: number;
  }>("iteration_complete", handlers.onIterationComplete);
  // Same terminal-event treatment as sweep streams: `automode_cancelled`
  // is emitted instantly on DELETE so the UI flips to "cancelled" right
  // away even while the orchestrator is still finishing the simTick that
  // was in flight when the user clicked Cancel.
  const onTerminal = (ev: MessageEvent) => {
    try {
      handlers.onAutoModeComplete?.(JSON.parse(ev.data) as AutoModeDetail);
    } catch {
      /* ignore */
    }
    sse.close();
  };
  sse.addEventListener("automode_complete", onTerminal);
  sse.addEventListener("automode_cancelled", onTerminal);
  return () => sse.close();
}
