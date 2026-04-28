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
