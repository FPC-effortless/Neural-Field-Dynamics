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
}

export interface PhaseGroup {
  phase: string;
  label: string;
  experimentIds: string[];
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
  ticks?: number;
  customParams?: Record<string, number | boolean>;
  type?: "experiment" | "arc";
  arc?: { numTasks?: number; trainTicksPerTask?: number; testInputs?: number };
}

export const api = {
  experiments: () =>
    jsonFetch<{ experiments: ExperimentSummary[]; groups: PhaseGroup[] }>(
      `${API_PREFIX}/experiments`,
    ),
  listRuns: () =>
    jsonFetch<{ runs: RunSummary[] }>(`${API_PREFIX}/runs`),
  getRun: (id: string) =>
    jsonFetch<RunDetail>(`${API_PREFIX}/runs/${id}`),
  createRun: (body: CreateRunRequest) =>
    jsonFetch<{ id: string; status: string; type?: string }>(`${API_PREFIX}/runs`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
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

export function subscribeRun(id: string, handlers: SseHandlers): () => void {
  const url = api.streamUrl(id);
  const es = new EventSource(url);
  if (handlers.onSnapshot) {
    es.addEventListener("snapshot", (ev: MessageEvent) => {
      try {
        handlers.onSnapshot?.(JSON.parse(ev.data) as RunDetail);
      } catch {
        /* ignore malformed */
      }
    });
  }
  if (handlers.onSample) {
    es.addEventListener("sample", (ev: MessageEvent) => {
      try {
        handlers.onSample?.(JSON.parse(ev.data) as { t: number; stats: Stats });
      } catch {
        /* ignore */
      }
    });
  }
  if (handlers.onPhase) {
    es.addEventListener("phase", (ev: MessageEvent) => {
      try {
        handlers.onPhase?.(JSON.parse(ev.data) as { t: number; phaseRegion: string });
      } catch {
        /* ignore */
      }
    });
  }
  if (handlers.onStart) {
    es.addEventListener("start", (ev: MessageEvent) => {
      try {
        handlers.onStart?.(JSON.parse(ev.data));
      } catch {
        /* ignore */
      }
    });
  }
  if (handlers.onComplete) {
    es.addEventListener("complete", (ev: MessageEvent) => {
      try {
        handlers.onComplete?.(JSON.parse(ev.data));
      } catch {
        /* ignore */
      }
      es.close();
    });
  }
  if (handlers.onArcSample) {
    es.addEventListener("arc_sample", (ev: MessageEvent) => {
      try {
        handlers.onArcSample?.(
          JSON.parse(ev.data) as { done: number; total: number; sample: ArcSample },
        );
      } catch {
        /* ignore */
      }
    });
  }
  es.addEventListener("error", () => {
    handlers.onError?.("stream error");
  });
  return () => es.close();
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
  currentIndex: number;
  bestIndex: number;
  total: number;
  combos: SweepCombo[];
}

export interface CreateSweepRequest {
  ranges?: Record<string, number[]>;
  ticksPerCombo?: number;
  scale?: 81 | 810 | 81000;
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
  passes: number;
  totalRuns: number;
  status: "pending" | "running" | "completed" | "skipped" | "error";
  meanMeasured: number | null;
  stdMeasured: number | null;
  ticksDone: number;
  ticksTotal: number;
  durationMs: number;
}

export interface BatchDetail {
  id: string;
  status: "pending" | "running" | "completed" | "cancelled";
  scale: 81 | 810 | 81000;
  ticksPerExperiment: number | null;
  repeats: number;
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
  ticksPerExperiment?: number;
  repeats?: number;
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
  lastSeen: number;
  batchCount: number;
  hypothesis: string;
}

export const leaderboardApi = {
  get: () =>
    jsonFetch<{ rows: LeaderboardRow[]; totalBatches: number }>(
      `${API_PREFIX}/leaderboard`,
    ),
};

export const batchApi = {
  list: () => jsonFetch<{ batches: BatchDetail[] }>(`${API_PREFIX}/batches`),
  get: (id: string) => jsonFetch<BatchDetail>(`${API_PREFIX}/batches/${id}`),
  create: (body: CreateBatchRequest) =>
    jsonFetch<{ id: string; total: number; repeats: number }>(`${API_PREFIX}/batches`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cancel: (id: string) =>
    jsonFetch<{ id: string; status: string }>(`${API_PREFIX}/batches/${id}`, {
      method: "DELETE",
    }),
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
  const es = new EventSource(batchApi.streamUrl(id));
  const bind = <T,>(name: string, fn?: (data: T) => void) => {
    if (!fn) return;
    es.addEventListener(name, (ev: MessageEvent) => {
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
  es.addEventListener("batch_complete", (ev: MessageEvent) => {
    try {
      handlers.onBatchComplete?.(JSON.parse(ev.data) as BatchDetail);
    } catch {
      /* ignore */
    }
    es.close();
  });
  es.addEventListener("error", () => handlers.onError?.("stream error"));
  return () => es.close();
}

export function subscribeSweep(id: string, handlers: SweepHandlers): () => void {
  const es = new EventSource(sweepApi.streamUrl(id));
  const bind = <T,>(name: string, fn?: (data: T) => void) => {
    if (!fn) return;
    es.addEventListener(name, (ev: MessageEvent) => {
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
  es.addEventListener("sweep_complete", (ev: MessageEvent) => {
    try {
      handlers.onSweepComplete?.(JSON.parse(ev.data) as SweepDetail);
    } catch {
      /* ignore */
    }
    es.close();
  });
  es.addEventListener("error", () => handlers.onError?.("stream error"));
  return () => es.close();
}
