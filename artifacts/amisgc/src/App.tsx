import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";
import { NeuronGrid, VIEW_MODES, VIEW_LABEL, type ViewMode } from "./components/NeuronGrid";
import { ExperimentPicker } from "./components/ExperimentPicker";
import { MetricsPanel } from "./components/MetricsPanel";
import { RunsList } from "./components/RunsList";
import { RunDetailPanel } from "./components/RunDetailPanel";
import { Panel, Pill } from "./components/Panel";
import { SweepPanel } from "./components/SweepPanel";
import { BatchPanel } from "./components/BatchPanel";
import { AutoModePanel } from "./components/AutoModePanel";
import { LeaderboardPanel } from "./components/LeaderboardPanel";
import { PhaseLockBanner } from "./components/PhaseLockBanner";
import { LabHome } from "./components/LabHome";
import {
  api,
  autoModeApi,
  subscribeAutoMode,
  subscribeRun,
  type AutoModeDetail,
  type RunDetail,
  type RunSummary,
  type Stats,
  type CreateRunRequest,
} from "./lib/api";
import { exportRunCSV, exportRunJSON, exportRunsTable } from "./lib/exporters";
import { PHCOL } from "./lib/colors";

const SKIP_TASKS = ["COPY", "REVERSE", "ROTATE", "ALTERNATE", "NOVEL"] as const;

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

// Single-modal manager: only one full-screen panel can be active at a time.
// Previously each modal had its own boolean state and they could overlap
// (Sweep + Batch + Leaderboard all stacked, fighting for the backdrop and
// the Esc-key) — that "chimera" feel the researchers complained about.
// Centralising the state here also makes Esc-to-close trivial.
type ActiveModal = "sweep" | "batch" | "automode" | "leaderboard" | null;

type SurfaceMode = "LAB" | "ADVANCED";
const SURFACE_KEY = "amisgc.surfaceMode";

function readSurfaceMode(): SurfaceMode {
  if (typeof window === "undefined") return "LAB";
  const v = window.localStorage.getItem(SURFACE_KEY);
  return v === "ADVANCED" ? "ADVANCED" : "LAB";
}

function AppShell() {
  const [viewMode, setViewMode] = useState<ViewMode>("STATE");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const closeModal = useCallback(() => setActiveModal(null), []);
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>(readSurfaceMode);
  // Auto-Mode run currently surfaced on the Lab Home scoreboard.
  const [watchedAutoModeId, setWatchedAutoModeId] = useState<string | null>(
    null,
  );
  const [watchedAutoMode, setWatchedAutoMode] =
    useState<AutoModeDetail | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SURFACE_KEY, surfaceMode);
  }, [surfaceMode]);

  // On Lab-Home mount, if no run is being watched yet, latch onto the most
  // recent Auto-Mode run so the scoreboard isn't empty after a page refresh
  // mid-experiment.
  useEffect(() => {
    if (watchedAutoModeId) return;
    if (surfaceMode !== "LAB") return;
    let cancelled = false;
    void autoModeApi
      .list()
      .then((res) => {
        if (cancelled) return;
        const sorted = [...res.automodes].sort(
          (a, b) => b.createdAt - a.createdAt,
        );
        const latest = sorted[0];
        if (latest) setWatchedAutoModeId(latest.id);
      })
      .catch(() => {
        /* ignore — empty list is fine */
      });
    return () => {
      cancelled = true;
    };
  }, [surfaceMode, watchedAutoModeId]);

  // SSE subscription for the watched Auto-Mode run. Keeps scoreboard live.
  useEffect(() => {
    if (!watchedAutoModeId) {
      setWatchedAutoMode(null);
      return;
    }
    const refetch = () => {
      void autoModeApi.get(watchedAutoModeId).then((d) => setWatchedAutoMode(d));
    };
    refetch();
    const unsubscribe = subscribeAutoMode(watchedAutoModeId, {
      onSnapshot: (a) => setWatchedAutoMode(a),
      onAutoModeStart: (a) => setWatchedAutoMode(a),
      onIterationComplete: () => refetch(),
      onAutoModeComplete: (a) => setWatchedAutoMode(a),
    });
    return unsubscribe;
  }, [watchedAutoModeId]);

  const handleCancelAutoMode = useCallback((id: string) => {
    void autoModeApi.cancel(id).catch(() => {
      /* server-side error already surfaced via SSE */
    });
  }, []);

  // Esc closes whatever modal / drawer is open. One handler beats four
  // independent useEffects per modal.
  useEffect(() => {
    if (!activeModal && !drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveModal(null);
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeModal, drawerOpen]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [activeRun, setActiveRun] = useState<RunDetail | null>(null);
  const [series, setSeries] = useState<Record<string, number[]>>(emptySeries());
  // Do NOT auto-start the visualisation on load — wait for the user to press START.
  const [vizRunning, setVizRunning] = useState(false);
  const [vizSpeed, setVizSpeed] = useState(4);
  const [taskOverride, setTaskOverride] = useState<string | null>(null);
  const skipIndexRef = useRef(0);

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

  const handleStart = useCallback(() => {
    setVizRunning(true);
    if (!activeRunId) {
      // Default canonical experiment: PH0 existence-gate run.
      launchMutation.mutate({ experimentId: "PH0.gate", scale: 81 });
    }
  }, [activeRunId, launchMutation]);

  const handlePause = useCallback(() => {
    setVizRunning(false);
  }, []);

  const handleReset = useCallback(() => {
    if (activeRunId) cancelMutation.mutate(activeRunId);
    setActiveRunId(null);
    setSeries(emptySeries());
    setVizRunning(false);
    setTaskOverride(null);
    skipIndexRef.current = 0;
  }, [activeRunId, cancelMutation]);

  const handleSkipTask = useCallback(() => {
    skipIndexRef.current = (skipIndexRef.current + 1) % SKIP_TASKS.length;
    setTaskOverride(SKIP_TASKS[skipIndexRef.current] as string);
  }, []);

  const handleExportCSV = useCallback(() => {
    exportRunCSV(activeRun);
  }, [activeRun]);
  const handleExportJSON = useCallback(() => {
    exportRunJSON(activeRun);
  }, [activeRun]);
  const handleExportTable = useCallback(() => {
    exportRunsTable(runs);
  }, [runs]);

  const stats = activeRun?.latestStats ?? null;
  const phaseColor = stats ? PHCOL[stats.phaseRegion] ?? "#334455" : "#334455";
  const taskKey = taskOverride ?? stats?.taskKey ?? "COPY";

  // Stable key for ExperimentPicker
  const experiments = expQuery.data?.experiments;
  const groups = expQuery.data?.groups;

  return (
    <div style={{ minHeight: "100vh", background: "#020c16", color: "#c5dfd4" }}>
      <PhaseLockBanner />
      <Header
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onOpenDrawer={() => setDrawerOpen(true)}
        phaseLabel={stats?.phaseRegion ?? "—"}
        phaseColor={phaseColor}
        running={vizRunning}
        onStart={handleStart}
        onPause={handlePause}
        onReset={handleReset}
        onSkipTask={handleSkipTask}
        onExportCSV={handleExportCSV}
        onExportJSON={handleExportJSON}
        onExportTable={handleExportTable}
        onOpenSweep={() => setActiveModal("sweep")}
        onOpenBatch={() => setActiveModal("batch")}
        onOpenAutoMode={() => setActiveModal("automode")}
        onOpenLeaderboard={() => setActiveModal("leaderboard")}
        speed={vizSpeed}
        onSpeedChange={setVizSpeed}
        canExport={!!activeRun}
      />

      <main className="px-2 sm:px-3 lg:px-4 py-3 max-w-[1600px] mx-auto">
        {surfaceMode === "LAB" ? (
          <LabHome
            watchedAutoMode={watchedAutoMode}
            onStarted={(id) => setWatchedAutoModeId(id)}
            onCancelWatched={handleCancelAutoMode}
            onOpenAdvanced={() => setSurfaceMode("ADVANCED")}
          />
        ) : (
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
              <button
                type="button"
                onClick={() => setSurfaceMode("LAB")}
                style={{
                  width: "100%",
                  padding: "6px 10px",
                  fontSize: 9,
                  letterSpacing: 1.5,
                  background: "transparent",
                  border: "1px solid #0f4a3a",
                  color: "#3aaf6a",
                  borderRadius: 2,
                  cursor: "pointer",
                }}
              >
                ← BACK TO LAB HOME
              </button>
            </div>
          </div>
        </div>
        )}
      </main>

      <Footer />

      <SweepPanel open={activeModal === "sweep"} onClose={closeModal} />
      <BatchPanel
        open={activeModal === "batch"}
        onClose={closeModal}
        groups={groups}
      />
      <AutoModePanel open={activeModal === "automode"} onClose={closeModal} />
      <LeaderboardPanel
        open={activeModal === "leaderboard"}
        onClose={closeModal}
      />

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
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onSkipTask: () => void;
  onExportCSV: () => void;
  onExportJSON: () => void;
  onExportTable: () => void;
  onOpenSweep: () => void;
  onOpenBatch: () => void;
  onOpenAutoMode: () => void;
  onOpenLeaderboard: () => void;
  speed: number;
  onSpeedChange: (s: number) => void;
  canExport: boolean;
}

const btnBase = {
  padding: "3px 8px",
  fontSize: 8,
  letterSpacing: 2,
  borderRadius: 2,
  fontWeight: 700 as const,
  cursor: "pointer" as const,
};

function HeaderButton({
  onClick,
  color,
  active = false,
  disabled = false,
  children,
  title,
}: {
  onClick: () => void;
  color: string;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...btnBase,
        background: active ? color : "rgba(0,0,0,0.4)",
        color: active ? "#020c16" : color,
        border: `1px solid ${color}`,
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Header({
  viewMode,
  onViewModeChange,
  onOpenDrawer,
  phaseLabel,
  phaseColor,
  running,
  onStart,
  onPause,
  onReset,
  onSkipTask,
  onExportCSV,
  onExportJSON,
  onExportTable,
  onOpenSweep,
  onOpenBatch,
  onOpenAutoMode,
  onOpenLeaderboard,
  speed,
  onSpeedChange,
  canExport,
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
      <div className="max-w-[1600px] mx-auto px-2 sm:px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
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
            v12.0 · SOFT FIELD
          </span>
          <Pill color={phaseColor}>{phaseLabel}</Pill>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {/* Sim transport */}
          <HeaderButton onClick={onStart} color="#00ffc4" active={running} title="start simulation">
            ▶ START
          </HeaderButton>
          <HeaderButton onClick={onPause} color="#ffb040" title="pause visualisation">
            ❚❚ PAUSE
          </HeaderButton>
          <HeaderButton onClick={onReset} color="#ff4477" title="cancel run + clear">
            ◈ RESET
          </HeaderButton>
          <HeaderButton onClick={onSkipTask} color="#aa88ff" title="cycle to next task">
            → SKIP
          </HeaderButton>

          <span style={{ width: 1, height: 16, background: "#0a2828", margin: "0 2px" }} />

          {/* Exports */}
          <HeaderButton onClick={onExportCSV} color="#0d7060" disabled={!canExport} title="active run history → CSV">
            ⎘ CSV
          </HeaderButton>
          <HeaderButton onClick={onExportJSON} color="#0d7060" disabled={!canExport} title="active run → JSON">
            ⎘ JSON
          </HeaderButton>
          <HeaderButton onClick={onExportTable} color="#0d7060" title="all runs → table CSV">
            ⎘ TABLE
          </HeaderButton>

          <span style={{ width: 1, height: 16, background: "#0a2828", margin: "0 2px" }} />

          {/* Run all + auto sweep */}
          <HeaderButton
            onClick={onOpenBatch}
            color="#ffd060"
            title="run all experiments serially"
          >
            ▶ RUN ALL
          </HeaderButton>
          <HeaderButton onClick={onOpenSweep} color="#ffd060" title="parameter auto-sweep">
            ⚡ AUTO SWEEP
          </HeaderButton>
          <HeaderButton
            onClick={onOpenAutoMode}
            color="#aa88ff"
            title="self-driving Existence-Gate hunt that reruns failed sweeps with refined ranges"
          >
            ◈ AUTO MODE
          </HeaderButton>
          <HeaderButton
            onClick={onOpenLeaderboard}
            color="#aa88ff"
            title="aggregate stats across all batches"
          >
            🏆 STATS
          </HeaderButton>

          <span style={{ width: 1, height: 16, background: "#0a2828", margin: "0 2px" }} />

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
