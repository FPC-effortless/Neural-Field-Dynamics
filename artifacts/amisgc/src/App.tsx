import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";
import { NeuronGrid, VIEW_MODES, VIEW_LABEL, type ViewMode } from "./components/NeuronGrid";
import { ExperimentPicker } from "./components/ExperimentPicker";
import { MetricsPanel } from "./components/MetricsPanel";
import { RunsList } from "./components/RunsList";
import { RunDetailPanel } from "./components/RunDetailPanel";
import { Panel, Pill } from "./components/Panel";
import {
  api,
  subscribeRun,
  type RunDetail,
  type RunSummary,
  type Stats,
  type CreateRunRequest,
} from "./lib/api";
import { PHCOL } from "./lib/colors";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

const SERIES_KEYS = [
  "J_star",
  "networkPhi",
  "networkMI",
  "avgAtp",
  "avgH",
  "body_energy",
  "body_health",
] as const;
const MAX_SERIES = 240;

function emptySeries(): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const k of SERIES_KEYS) out[k] = [];
  return out;
}

function pushSeries(prev: Record<string, number[]>, stats: Stats): Record<string, number[]> {
  const next: Record<string, number[]> = {};
  for (const k of SERIES_KEYS) {
    const arr = prev[k] ?? [];
    const v = (stats as unknown as Record<string, number>)[k] ?? 0;
    next[k] = arr.length >= MAX_SERIES ? [...arr.slice(arr.length - MAX_SERIES + 1), v] : [...arr, v];
  }
  return next;
}

function AppShell() {
  const [viewMode, setViewMode] = useState<ViewMode>("STATE");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRun, setActiveRun] = useState<RunDetail | null>(null);
  const [series, setSeries] = useState<Record<string, number[]>>(emptySeries());
  const [vizRunning, setVizRunning] = useState(true);
  const [vizSpeed, setVizSpeed] = useState(4);

  const expQuery = useQuery({
    queryKey: ["experiments"],
    queryFn: () => api.experiments(),
  });

  // Poll runs list (cheap)
  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const res = await api.listRuns();
        if (active) setRuns(res.runs);
      } catch {
        /* ignore */
      }
      if (active) timeout = setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  // SSE subscription for active run
  useEffect(() => {
    if (!activeRunId) {
      setActiveRun(null);
      setSeries(emptySeries());
      return;
    }
    setSeries(emptySeries());
    let detail: RunDetail | null = null;
    const unsubscribe = subscribeRun(activeRunId, {
      onSnapshot: (snap) => {
        detail = snap;
        setActiveRun(snap);
        // Backfill series from history
        const hist = snap.history ?? [];
        const next: Record<string, number[]> = emptySeries();
        for (const sample of hist.slice(-MAX_SERIES)) {
          for (const k of SERIES_KEYS) {
            const v = (sample.stats as unknown as Record<string, number>)[k] ?? 0;
            next[k] = [...(next[k] ?? []), v];
          }
        }
        setSeries(next);
      },
      onSample: (s) => {
        if (detail) {
          detail = {
            ...detail,
            ticksDone: s.t,
            latestStats: s.stats,
          };
          setActiveRun(detail);
        }
        setSeries((prev) => pushSeries(prev, s.stats));
      },
      onPhase: () => {
        // visual flash could be added later
      },
      onComplete: () => {
        // refresh detail with full results
        void api.getRun(activeRunId).then((d) => {
          setActiveRun(d);
        });
      },
      onArcSample: () => {
        void api.getRun(activeRunId).then((d) => setActiveRun(d));
      },
    });
    return unsubscribe;
  }, [activeRunId]);

  const launchMutation = useMutation({
    mutationFn: (req: CreateRunRequest) => api.createRun(req),
    onSuccess: (data) => {
      setActiveRunId(data.id);
      setDrawerOpen(false);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.cancelRun(id),
  });

  const handleLaunch = useCallback(
    (req: CreateRunRequest) => {
      launchMutation.mutate(req);
    },
    [launchMutation],
  );
  const handleCancel = useCallback(
    (id: string) => {
      cancelMutation.mutate(id);
    },
    [cancelMutation],
  );

  const stats = activeRun?.latestStats ?? null;
  const phaseColor = stats ? PHCOL[stats.phaseRegion] ?? "#334455" : "#334455";
  const taskKey = stats?.taskKey ?? "COPY";

  // Stable key for ExperimentPicker
  const experiments = expQuery.data?.experiments;
  const groups = expQuery.data?.groups;

  return (
    <div style={{ minHeight: "100vh", background: "#020c16", color: "#c5dfd4" }}>
      <Header
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onOpenDrawer={() => setDrawerOpen(true)}
        phaseLabel={stats?.phaseRegion ?? "—"}
        phaseColor={phaseColor}
        running={vizRunning}
        onToggleRun={() => setVizRunning((v) => !v)}
        speed={vizSpeed}
        onSpeedChange={setVizSpeed}
      />

      <main className="px-2 sm:px-3 lg:px-4 py-3 max-w-[1600px] mx-auto">
        <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
          <div className="grid gap-3 lg:grid-cols-12">
            {/* Left column: experiments + runs (hidden on mobile, drawer instead) */}
            <div className="hidden lg:block lg:col-span-3 space-y-3">
              <ExperimentPicker
                experiments={experiments}
                groups={groups}
                onLaunch={handleLaunch}
                launching={launchMutation.isPending}
              />
              <RunsList
                runs={runs}
                activeRunId={activeRunId}
                onSelect={setActiveRunId}
                onCancel={handleCancel}
              />
            </div>

            {/* Center: canvas */}
            <div className="lg:col-span-6 space-y-3">
              <Panel title={`NEURON FIELD · ${VIEW_LABEL[viewMode]}`} accent={phaseColor}>
                <NeuronGrid
                  viewMode={viewMode}
                  running={vizRunning}
                  taskKey={taskKey as never}
                  speed={vizSpeed}
                />
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 7,
                    color: "#0f4a3a",
                    textAlign: "center",
                    letterSpacing: 1.5,
                    lineHeight: 1.5,
                  }}
                >
                  [{VIEW_LABEL[viewMode]}] · teal dot=IC · gold ring=desire · purple=d_eff · cyan
                  ring=input
                </div>
              </Panel>
              {/* On mobile, run controls live here */}
              <div className="block lg:hidden space-y-3">
                <RunDetailPanel run={activeRun} series={series} />
                <RunsList
                  runs={runs}
                  activeRunId={activeRunId}
                  onSelect={setActiveRunId}
                  onCancel={handleCancel}
                />
              </div>
              {/* On desktop, run detail sits below canvas */}
              <div className="hidden lg:block">
                <RunDetailPanel run={activeRun} series={series} />
              </div>
            </div>

            {/* Right: live metrics */}
            <div className="lg:col-span-3 space-y-3">
              <MetricsPanel stats={stats} series={series} taskKey={taskKey} />
            </div>
          </div>
        </div>
      </main>

      <Footer />

      {drawerOpen && (
        <div className="mobile-drawer">
          <div className="flex items-center justify-between mb-3">
            <span style={{ fontSize: 11, letterSpacing: 3, color: "#00ffc4" }}>
              EXPERIMENT BATTERY
            </span>
            <button
              onClick={() => setDrawerOpen(false)}
              style={{
                background: "transparent",
                border: "1px solid #0f4a3a",
                color: "#00ffc4",
                fontSize: 12,
                padding: "4px 10px",
                borderRadius: 2,
              }}
            >
              ✕
            </button>
          </div>
          <ExperimentPicker
            experiments={experiments}
            groups={groups}
            onLaunch={handleLaunch}
            launching={launchMutation.isPending}
          />
        </div>
      )}
    </div>
  );
}

interface HeaderProps {
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  onOpenDrawer: () => void;
  phaseLabel: string;
  phaseColor: string;
  running: boolean;
  onToggleRun: () => void;
  speed: number;
  onSpeedChange: (s: number) => void;
}

function Header({
  viewMode,
  onViewModeChange,
  onOpenDrawer,
  phaseLabel,
  phaseColor,
  running,
  onToggleRun,
  speed,
  onSpeedChange,
}: HeaderProps) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        background: "rgba(2, 12, 22, 0.94)",
        borderBottom: "1px solid #0a2828",
        backdropFilter: "blur(6px)",
      }}
    >
      <div className="max-w-[1600px] mx-auto px-2 sm:px-3 py-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            style={{
              fontSize: 11,
              letterSpacing: 3,
              color: "#00ffc4",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            AMISGC
          </span>
          <span
            style={{
              fontSize: 7,
              color: "#0f4a3a",
              letterSpacing: 2,
              display: "none",
            }}
            className="sm:!inline"
          >
            v12.0 · NEURAL FIELD
          </span>
          <Pill color={phaseColor}>{phaseLabel}</Pill>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <button
            onClick={onToggleRun}
            style={{
              background: running ? "#00ffc4" : "rgba(0,0,0,0.4)",
              color: running ? "#020c16" : "#00ffc4",
              border: "1px solid #00ffc4",
              padding: "3px 8px",
              fontSize: 8,
              letterSpacing: 2,
              borderRadius: 2,
              fontWeight: 700,
            }}
          >
            {running ? "❚❚ PAUSE" : "▶ PLAY"}
          </button>
          <select
            value={speed}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
            style={{
              background: "#020c16",
              color: "#0d7060",
              border: "1px solid #0f4a3a",
              fontSize: 8,
              padding: "2px 4px",
            }}
            title="sim ticks per frame"
          >
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
            <option value={8}>8×</option>
            <option value={16}>16×</option>
          </select>
          <select
            value={viewMode}
            onChange={(e) => onViewModeChange(e.target.value as ViewMode)}
            style={{
              background: "rgba(0,0,0,0.4)",
              color: "#aa88ff",
              border: "1px solid #aa88ff",
              padding: "3px 6px",
              fontSize: 8,
              letterSpacing: 2,
              borderRadius: 2,
            }}
          >
            {VIEW_MODES.map((v) => (
              <option key={v} value={v}>
                ⊞ {VIEW_LABEL[v]}
              </option>
            ))}
          </select>
          <button
            className="lg:hidden"
            onClick={onOpenDrawer}
            style={{
              background: "rgba(0,0,0,0.4)",
              border: "1px solid #ffb040",
              color: "#ffb040",
              padding: "3px 8px",
              fontSize: 8,
              letterSpacing: 2,
              borderRadius: 2,
            }}
          >
            ☰ EXP
          </button>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer
      style={{
        marginTop: 24,
        padding: "10px 16px",
        borderTop: "1px solid #0a2828",
        textAlign: "center",
        fontSize: 7,
        color: "#0f4a3a",
        letterSpacing: 2,
      }}
    >
      AMISGC RESEARCH PROGRAMME · Emergent Intelligence from a Metabolically Constrained
      Predictive Neural Field · CORE-1 → PHASE 12 + ARC
    </footer>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  );
}
