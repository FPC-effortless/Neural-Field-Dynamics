import { useEffect, useMemo, useState } from "react";
import { Panel, Pill } from "./Panel";
import {
  baselinesApi,
  batchApi,
  subscribeBatch,
  type BatchDetail,
  type BatchItem,
  type CreateBatchRequest,
  type DiffResponse,
  type PhaseGroup,
} from "../lib/api";
import { fmt, fmtDur } from "../lib/format";

interface BatchPanelProps {
  open: boolean;
  onClose: () => void;
  groups?: PhaseGroup[];
}

function statusColor(status: BatchItem["status"], passed: boolean): string {
  if (status === "running") return "#ffb040";
  if (status === "error") return "#ff4477";
  if (status === "skipped") return "#0f4a3a";
  if (status === "completed") return passed ? "#00ffc4" : "#ff4477";
  return "#0d7060";
}

// Form-state-aware preset builder. The runtime knobs (scale/neurons/ticks)
// come from the panel's launch form so all presets use the same overrides.
interface BatchFormOverrides {
  scale: 81 | 810 | 81000;
  neurons?: number;
  topK?: number;
  ticksPerExperiment?: number;
}

function presetBody(
  kind: "all" | "phase" | "core" | "phase0",
  overrides: BatchFormOverrides,
  phase?: string,
  groups?: PhaseGroup[],
): CreateBatchRequest {
  const base: CreateBatchRequest = {
    scale: overrides.scale,
    ...(overrides.neurons !== undefined ? { neurons: overrides.neurons } : {}),
    ...(overrides.topK !== undefined ? { topK: overrides.topK } : {}),
    ...(overrides.ticksPerExperiment !== undefined
      ? { ticksPerExperiment: overrides.ticksPerExperiment }
      : {}),
  };
  if (kind === "all") return { ...base, all: true, repeats: 1 };
  if (kind === "phase0") return { ...base, phase: "PH0", repeats: 2 };
  if (kind === "phase" && phase) return { ...base, phase, repeats: 1 };
  if (kind === "core" && groups) {
    const ids = groups
      .filter((g) => g.phase.startsWith("C") || g.phase === "PH0")
      .flatMap((g) => g.experimentIds);
    return { ...base, experimentIds: ids, repeats: 1 };
  }
  return { ...base, all: true, repeats: 1 };
}

export function BatchPanel({ open, onClose, groups }: BatchPanelProps) {
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phaseFilter, setPhaseFilter] = useState<string>("");
  // Launch-form overrides shared by all presets (scale, neuron count, ticks).
  const [scale, setScale] = useState<81 | 810 | 81000>(81);
  const [neuronsStr, setNeuronsStr] = useState<string>("");
  const [topKStr, setTopKStr] = useState<string>("");
  const [ticksStr, setTicksStr] = useState<string>("");
  const [past, setPast] = useState<BatchDetail[]>([]);
  const [diffWith, setDiffWith] = useState<string>("");
  const [diffResult, setDiffResult] = useState<DiffResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [savingBaseline, setSavingBaseline] = useState(false);
  const [savedBaselineMsg, setSavedBaselineMsg] = useState<string | null>(null);

  // Refresh the list of past batches whenever the panel opens or a batch finishes
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const refresh = () => {
      batchApi
        .list()
        .then((r) => {
          if (alive) setPast(r.batches);
        })
        .catch(() => undefined);
    };
    refresh();
    const live = batch?.status === "running" || batch?.status === "pending";
    if (!live) return;
    const t = setInterval(refresh, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open, batch?.status]);

  const loadPast = async (id: string) => {
    setError(null);
    try {
      const detail = await batchApi.get(id);
      setBatch(detail);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    if (!open || !batch?.id) return;
    if (batch.status !== "running" && batch.status !== "pending") return;
    const unsub = subscribeBatch(batch.id, {
      onSnapshot: (s) => setBatch(s),
      onBatchStart: (s) => setBatch(s),
      onItemStart: ({ item }) => updateItem(setBatch, item),
      onItemProgress: ({ item }) => updateItem(setBatch, item),
      onItemComplete: ({ item, totalCompleted, totalPassed }) =>
        updateItem(setBatch, item, totalCompleted, totalPassed),
      onBatchComplete: (s) => setBatch(s),
      onError: (m) => setError(m),
    });
    return unsub;
  }, [open, batch?.id, batch?.status]);

  const start = async (body: CreateBatchRequest) => {
    setLaunching(true);
    setError(null);
    try {
      const { id } = await batchApi.create(body);
      const detail = await batchApi.get(id);
      setBatch(detail);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLaunching(false);
    }
  };

  const cancel = async () => {
    if (!batch) return;
    try {
      await batchApi.cancel(batch.id);
    } catch {
      /* ignore */
    }
  };

  const reset = () => {
    setBatch(null);
    setError(null);
    setDiffWith("");
    setDiffResult(null);
    setSavedBaselineMsg(null);
  };

  // Re-run launches a fresh batch reusing the same experiment list and (by
  // default) the same baseSeed, so the new run is byte-for-byte reproducible.
  const rerun = async (keepSeed: boolean) => {
    if (!batch) return;
    setLaunching(true);
    setError(null);
    try {
      const { id } = await batchApi.rerun(batch.id, { keepSeed });
      const detail = await batchApi.get(id);
      setBatch(detail);
      setDiffWith("");
      setDiffResult(null);
      setSavedBaselineMsg(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLaunching(false);
    }
  };

  const saveBaseline = async () => {
    if (!batch) return;
    setSavingBaseline(true);
    setSavedBaselineMsg(null);
    try {
      const name = window.prompt(
        "Name this baseline (used in the leaderboard delta picker):",
        `${batch.id} · ${new Date(batch.createdAt).toISOString().slice(0, 16)}`,
      );
      if (!name) return;
      const rec = await baselinesApi.create({ batchId: batch.id, name });
      setSavedBaselineMsg(`saved as ${rec.id} (${rec.name})`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingBaseline(false);
    }
  };

  const runDiff = async (otherId: string) => {
    if (!batch || !otherId) return;
    setDiffLoading(true);
    setDiffResult(null);
    try {
      const r = await batchApi.diff(batch.id, otherId);
      setDiffResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDiffLoading(false);
    }
  };

  const exportCsv = () => {
    if (!batch) return;
    const rows = [
      [
        "index",
        "experimentId",
        "phase",
        "name",
        "metric",
        "target",
        "targetDir",
        "totalRuns",
        "passes",
        "meanMeasured",
        "stdMeasured",
        "status",
        "durationMs",
        "hypothesis",
      ].join(","),
    ];
    for (const it of batch.items) {
      rows.push(
        [
          it.index,
          it.experimentId,
          it.phase,
          JSON.stringify(it.experimentName),
          it.metric,
          it.target,
          it.targetDir,
          it.totalRuns,
          it.passes,
          it.meanMeasured ?? "",
          it.stdMeasured ?? "",
          it.status,
          it.durationMs,
          JSON.stringify(it.hypothesis ?? ""),
        ].join(","),
      );
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `amisgc-batch-${batch.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const phaseOptions = useMemo(() => groups ?? [], [groups]);

  const overrides = useMemo<BatchFormOverrides>(() => {
    const neuronsNum = neuronsStr.trim() === "" ? undefined : Number(neuronsStr);
    const topKNum = topKStr.trim() === "" ? undefined : Number(topKStr);
    const ticksNum = ticksStr.trim() === "" ? undefined : Number(ticksStr);
    return {
      scale,
      ...(typeof neuronsNum === "number" && Number.isFinite(neuronsNum)
        ? { neurons: neuronsNum }
        : {}),
      ...(typeof topKNum === "number" && Number.isFinite(topKNum)
        ? { topK: topKNum }
        : {}),
      ...(typeof ticksNum === "number" && Number.isFinite(ticksNum)
        ? { ticksPerExperiment: ticksNum }
        : {}),
    };
  }, [scale, neuronsStr, topKStr, ticksStr]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#020c16",
          border: "1px solid #ffd060",
          maxWidth: 1100,
          width: "100%",
          maxHeight: "92vh",
          overflow: "auto",
          padding: 16,
          borderRadius: 4,
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <span style={{ fontSize: 12, color: "#ffd060", letterSpacing: 3, fontWeight: 700 }}>
            ▶ EXPERIMENT BATTERY · run all experiments serially
          </span>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid #5a4a1a",
              color: "#ffd060",
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: 2,
            }}
          >
            ✕
          </button>
        </div>

        {!batch ? (
          <Panel title="LAUNCH PRESETS" accent="#ffd060">
            <div style={{ fontSize: 9, color: "#0d7060", marginBottom: 10, lineHeight: 1.6 }}>
              Run a curated subset of experiments serially at the 81-neuron scale. Each
              experiment runs once (or with N repeats for variance). The pass rate, mean
              measured value, and ± std are reported per experiment.
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr 1fr",
                gap: 10,
                marginBottom: 10,
                padding: 8,
                background: "rgba(0,0,0,0.3)",
                border: "1px solid #5a4a1a",
                borderRadius: 2,
              }}
            >
              <BatchField label="SCALE">
                <select
                  value={scale}
                  onChange={(e) => setScale(Number(e.target.value) as 81 | 810 | 81000)}
                  style={batchInputStyle}
                >
                  <option value={81}>81 (G=9)</option>
                  <option value={810}>810 (G=29)</option>
                  <option value={81000}>81 000 (G=285)</option>
                </select>
              </BatchField>
              <BatchField label="NEURONS (override)">
                <input
                  type="number"
                  min={9}
                  max={102400}
                  step={1}
                  value={neuronsStr}
                  onChange={(e) => setNeuronsStr(e.target.value)}
                  placeholder="auto"
                  style={batchInputStyle}
                />
                <div style={{ fontSize: 8, color: "#5a4a1a", marginTop: 2 }}>
                  9 – 102 400 · overrides scale
                </div>
              </BatchField>
              <BatchField label="TOP_K (override)">
                <input
                  type="number"
                  min={1}
                  max={102400}
                  step={1}
                  value={topKStr}
                  onChange={(e) => setTopKStr(e.target.value)}
                  placeholder="auto"
                  style={batchInputStyle}
                />
                <div style={{ fontSize: 8, color: "#5a4a1a", marginTop: 2 }}>
                  absolute count · overrides TOPK_FRACTION
                </div>
              </BatchField>
              <BatchField label="TICKS / EXPERIMENT">
                <input
                  type="number"
                  min={100}
                  max={200000}
                  step={100}
                  value={ticksStr}
                  onChange={(e) => setTicksStr(e.target.value)}
                  placeholder="experiment default"
                  style={batchInputStyle}
                />
                <div style={{ fontSize: 8, color: "#5a4a1a", marginTop: 2 }}>
                  100 – 200 000 · blank = use each experiment's own
                </div>
              </BatchField>
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
              <PresetButton
                label="▶ RUN PHASE 0 SWEEP (×2)"
                desc="4 PH0 experiments × 2 repeats"
                onClick={() => start(presetBody("phase0", overrides))}
                disabled={launching}
                accent="#00ffc4"
              />
              <PresetButton
                label="▶ RUN ALL CORE (PH0–C5)"
                desc="Phase 0 + CORE-1…6 attractor stack"
                onClick={() => start(presetBody("core", overrides, undefined, groups))}
                disabled={launching || !groups}
                accent="#aa88ff"
              />
              <PresetButton
                label="▶ RUN EVERYTHING"
                desc="All registered experiments × 1"
                onClick={() => start(presetBody("all", overrides))}
                disabled={launching}
                accent="#ffd060"
              />
            </div>

            {phaseOptions.length > 0 ? (
              <div className="flex items-center gap-2 mb-2">
                <span style={{ fontSize: 9, color: "#0d7060", letterSpacing: 2 }}>
                  OR PICK PHASE
                </span>
                <select
                  value={phaseFilter}
                  onChange={(e) => setPhaseFilter(e.target.value)}
                  style={{
                    background: "#020c16",
                    color: "#ffd060",
                    border: "1px solid #5a4a1a",
                    padding: "3px 6px",
                    fontSize: 9,
                  }}
                >
                  <option value="">— select —</option>
                  {phaseOptions.map((g) => (
                    <option key={g.phase} value={g.phase}>
                      {g.label} ({g.experimentIds.length})
                    </option>
                  ))}
                </select>
                <button
                  onClick={() =>
                    phaseFilter &&
                    start(presetBody("phase", overrides, phaseFilter, groups))
                  }
                  disabled={launching || !phaseFilter}
                  style={{
                    background: "#ffd060",
                    color: "#020c16",
                    border: "1px solid #ffd060",
                    padding: "3px 10px",
                    fontSize: 9,
                    letterSpacing: 2,
                    fontWeight: 700,
                    borderRadius: 2,
                    opacity: !phaseFilter || launching ? 0.4 : 1,
                  }}
                >
                  ▶ RUN PHASE
                </button>
              </div>
            ) : null}

            {error ? (
              <div style={{ marginTop: 8, color: "#ff4477", fontSize: 9 }}>{error}</div>
            ) : null}

            {past.length > 0 ? (
              <div style={{ marginTop: 14 }}>
                <div
                  style={{
                    fontSize: 9,
                    color: "#5a4a1a",
                    letterSpacing: 2,
                    marginBottom: 6,
                    fontWeight: 700,
                  }}
                >
                  ↺ PAST BATCHES (persisted on disk)
                </div>
                <PastBatchTable past={past} onLoad={loadPast} />
              </div>
            ) : null}
          </Panel>
        ) : (
          <>
            <Panel
              title={`BATCH ${batch.id} · ${batch.status.toUpperCase()}`}
              accent={batch.status === "completed" ? "#00ffc4" : "#ffb040"}
            >
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div style={{ fontSize: 9, color: "#0d7060", letterSpacing: 1 }}>
                  PROGRESS {batch.totalCompleted} / {batch.total} · PASSED{" "}
                  <span style={{ color: "#00ffc4" }}>{batch.totalPassed}</span> · REPEATS{" "}
                  {batch.repeats} · SCALE {batch.scale}
                  {batch.neurons ? (
                    <>
                      {" "}· NEURONS{" "}
                      <span style={{ color: "#ffd060" }}>{batch.neurons}</span>
                    </>
                  ) : null}
                  {batch.topK ? (
                    <>
                      {" "}· TOP_K{" "}
                      <span style={{ color: "#ffd060" }}>{batch.topK}</span>
                    </>
                  ) : null}
                  {batch.ticksPerExperiment ? (
                    <>
                      {" "}· TICKS{" "}
                      <span style={{ color: "#ffd060" }}>{batch.ticksPerExperiment}</span>
                    </>
                  ) : null}
                  {typeof batch.baseSeed === "number" ? (
                    <>
                      {" "}
                      · SEED{" "}
                      <span
                        style={{ color: "#aa88ff", fontFamily: "monospace" }}
                        title="Base seed — every repeat's PRNG seed derives from this."
                      >
                        {batch.baseSeed.toString(16).padStart(8, "0")}
                      </span>
                    </>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  {batch.status === "running" || batch.status === "pending" ? (
                    <button
                      onClick={cancel}
                      style={{
                        background: "transparent",
                        border: "1px solid #ff4477",
                        color: "#ff4477",
                        padding: "3px 10px",
                        fontSize: 8,
                        letterSpacing: 2,
                        borderRadius: 2,
                      }}
                    >
                      ✕ CANCEL
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={exportCsv}
                        style={postRunBtn("#0d7060")}
                      >
                        ⎘ CSV
                      </button>
                      <button
                        onClick={() => rerun(true)}
                        disabled={launching}
                        title="Re-run with the SAME baseSeed (byte-identical replay)"
                        style={postRunBtn("#aa88ff")}
                      >
                        ↻ RE-RUN (same seed)
                      </button>
                      <button
                        onClick={() => rerun(false)}
                        disabled={launching}
                        title="Re-run with a fresh random seed (variance check)"
                        style={postRunBtn("#9bff8a")}
                      >
                        ↻ RE-RUN (new seed)
                      </button>
                      <button
                        onClick={saveBaseline}
                        disabled={savingBaseline}
                        title="Use this batch as the leaderboard's baseline reference"
                        style={postRunBtn("#ffd060")}
                      >
                        ☆ SAVE AS BASELINE
                      </button>
                      <button
                        onClick={reset}
                        style={postRunBtn("#ffd060")}
                      >
                        ◈ NEW BATCH
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div
                style={{
                  background: "#0a2828",
                  height: 4,
                  width: "100%",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    background: "#ffd060",
                    width: `${
                      batch.total > 0 ? (batch.totalCompleted / batch.total) * 100 : 0
                    }%`,
                    height: "100%",
                    transition: "width 0.3s",
                  }}
                />
              </div>
            </Panel>

            {savedBaselineMsg ? (
              <div
                style={{
                  fontSize: 9,
                  color: "#9bff8a",
                  margin: "4px 0 8px",
                  letterSpacing: 1,
                }}
              >
                ✓ {savedBaselineMsg} — pick it in the Leaderboard's BASELINE dropdown.
              </div>
            ) : null}

            {(batch.status === "completed" || batch.status === "cancelled" ||
              batch.status === "interrupted") && past.length > 1 ? (
              <Panel title="DIFF VS PRIOR BATCH" accent="#aa88ff">
                <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: 9 }}>
                  <span style={{ color: "#0d7060", letterSpacing: 2 }}>COMPARE TO</span>
                  <select
                    value={diffWith}
                    onChange={(e) => setDiffWith(e.target.value)}
                    style={{
                      background: "#020c16",
                      color: "#aa88ff",
                      border: "1px solid #5a4a8a",
                      padding: "3px 6px",
                      fontSize: 9,
                    }}
                  >
                    <option value="">— pick a batch —</option>
                    {past
                      .filter((b) => b.id !== batch.id)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.id} · {new Date(b.createdAt).toLocaleString()} · {b.total}×
                          {b.repeats}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => runDiff(diffWith)}
                    disabled={!diffWith || diffLoading}
                    style={{
                      background: "transparent",
                      border: "1px solid #aa88ff",
                      color: "#aa88ff",
                      padding: "3px 10px",
                      fontSize: 9,
                      letterSpacing: 2,
                      borderRadius: 2,
                      opacity: !diffWith || diffLoading ? 0.4 : 1,
                    }}
                  >
                    {diffLoading ? "…" : "▶ DIFF"}
                  </button>
                </div>
                {diffResult ? <DiffTable diff={diffResult} /> : null}
              </Panel>
            ) : null}

            <Panel title="ITEMS" accent="#5a4a1a">
              <BatchTable items={batch.items} />
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

const batchInputStyle: React.CSSProperties = {
  width: "100%",
  background: "#020c16",
  color: "#ffd060",
  border: "1px solid #5a4a1a",
  fontSize: 10,
  padding: "4px 6px",
  borderRadius: 2,
  fontFamily: "monospace",
};

function BatchField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div
        style={{
          fontSize: 8,
          color: "#5a4a1a",
          letterSpacing: 2,
          marginBottom: 3,
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      {children}
    </label>
  );
}

const postRunBtn = (color: string): React.CSSProperties => ({
  background: "transparent",
  border: `1px solid ${color}`,
  color,
  padding: "3px 10px",
  fontSize: 8,
  letterSpacing: 2,
  borderRadius: 2,
  cursor: "pointer",
});

function DiffTable({ diff }: { diff: DiffResponse }) {
  const fmtT = (ts: number) =>
    `${new Date(ts).toLocaleDateString()} ${new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return (
    <div style={{ marginTop: 8, overflowX: "auto" }}>
      <div
        style={{
          fontSize: 9,
          color: "#5a4a8a",
          marginBottom: 6,
          fontFamily: "monospace",
        }}
      >
        Δ = <strong style={{ color: "#aa88ff" }}>A({diff.aId}, {fmtT(diff.aCreatedAt)})</strong>{" "}
        − <strong style={{ color: "#aa88ff" }}>B({diff.bId}, {fmtT(diff.bCreatedAt)})</strong>{" "}
        · Welch's t two-sided p-value
      </div>
      <table
        style={{ width: "100%", fontSize: 8, color: "#0d7060", borderCollapse: "collapse" }}
      >
        <thead>
          <tr style={{ borderBottom: "1px solid #0a2828", color: "#aa88ff", letterSpacing: 1 }}>
            <th style={{ textAlign: "left", padding: "3px 6px" }}>PHASE</th>
            <th style={{ textAlign: "left", padding: "3px 6px" }}>EXPERIMENT</th>
            <th style={{ textAlign: "left", padding: "3px 6px" }}>METRIC</th>
            <th style={{ textAlign: "right", padding: "3px 6px" }}>A μ (n)</th>
            <th style={{ textAlign: "right", padding: "3px 6px" }}>B μ (n)</th>
            <th style={{ textAlign: "right", padding: "3px 6px" }}>Δ</th>
            <th style={{ textAlign: "right", padding: "3px 6px" }}>p</th>
            <th style={{ textAlign: "left", padding: "3px 6px" }}>SIGN</th>
          </tr>
        </thead>
        <tbody>
          {diff.rows.map((r) => {
            const signColor =
              r.sign === "better" ? "#00ffc4" : r.sign === "worse" ? "#ff4477" : "#ffd060";
            const pTxt =
              r.pTwoSided === null
                ? "—"
                : r.pTwoSided < 0.001
                  ? "p<.001"
                  : r.pTwoSided.toFixed(3);
            return (
              <tr key={r.experimentId} style={{ borderBottom: "1px solid #0a2828" }}>
                <td style={{ padding: "3px 6px", color: "#aa88ff" }}>{r.phase}</td>
                <td
                  style={{
                    padding: "3px 6px",
                    color: "#c5dfd4",
                    fontFamily: "monospace",
                    maxWidth: 240,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={r.experimentId}
                >
                  {r.experimentName}
                </td>
                <td style={{ padding: "3px 6px", fontFamily: "monospace" }}>{r.metric}</td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>
                  {r.aMean === null ? "—" : r.aMean.toFixed(3)} ({r.aN})
                </td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>
                  {r.bMean === null ? "—" : r.bMean.toFixed(3)} ({r.bN})
                </td>
                <td style={{ padding: "3px 6px", textAlign: "right", color: signColor }}>
                  {r.delta === null
                    ? "—"
                    : `${r.delta > 0 ? "+" : ""}${r.delta.toFixed(3)}`}
                </td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>{pTxt}</td>
                <td style={{ padding: "3px 6px", color: signColor, letterSpacing: 1 }}>
                  {r.sign ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PastBatchTable({
  past,
  onLoad,
}: {
  past: BatchDetail[];
  onLoad: (id: string) => void;
}) {
  const fmtTs = (t: number): string => {
    const d = new Date(t);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  };
  return (
    <div style={{ overflowX: "auto", maxHeight: 220, overflowY: "auto" }}>
      <table style={{ width: "100%", fontSize: 8, color: "#0d7060", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #0a2828", color: "#5a4a1a", letterSpacing: 1 }}>
            <th style={{ textAlign: "left", padding: "3px 6px" }}>ID</th>
            <th style={{ textAlign: "left", padding: "3px 6px" }}>WHEN</th>
            <th style={{ textAlign: "right", padding: "3px 6px" }}>ITEMS</th>
            <th style={{ textAlign: "right", padding: "3px 6px" }}>×REPS</th>
            <th style={{ textAlign: "right", padding: "3px 6px" }}>PASS/COMP</th>
            <th style={{ textAlign: "left", padding: "3px 6px" }}>STATUS</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {past.map((b) => {
            const color =
              b.status === "completed"
                ? "#00ffc4"
                : b.status === "running"
                  ? "#ffb040"
                  : b.status === "cancelled"
                    ? "#ff4477"
                    : b.status === "interrupted"
                      ? "#ff7766"
                      : "#0d7060";
            return (
              <tr key={b.id} style={{ borderBottom: "1px solid #0a2828" }}>
                <td style={{ padding: "3px 6px", color: "#ffd060", fontFamily: "monospace" }}>
                  {b.id}
                </td>
                <td style={{ padding: "3px 6px", color: "#0d7060" }}>{fmtTs(b.createdAt)}</td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>{b.total}</td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>×{b.repeats}</td>
                <td style={{ padding: "3px 6px", textAlign: "right", color: "#00ffc4" }}>
                  {b.totalPassed}/{b.totalCompleted}
                </td>
                <td style={{ padding: "3px 6px" }}>
                  <Pill color={color}>{b.status}</Pill>
                </td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>
                  <button
                    onClick={() => onLoad(b.id)}
                    style={{
                      background: "transparent",
                      border: `1px solid ${color}`,
                      color,
                      padding: "2px 8px",
                      fontSize: 8,
                      letterSpacing: 1,
                      borderRadius: 2,
                      cursor: "pointer",
                    }}
                  >
                    LOAD
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PresetButton({
  label,
  desc,
  onClick,
  disabled,
  accent,
}: {
  label: string;
  desc: string;
  onClick: () => void;
  disabled: boolean;
  accent: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "rgba(0,0,0,0.4)",
        border: `1px solid ${accent}`,
        color: accent,
        padding: "8px 12px",
        textAlign: "left",
        cursor: disabled ? "wait" : "pointer",
        opacity: disabled ? 0.4 : 1,
        borderRadius: 2,
        minWidth: 220,
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: 2, fontWeight: 700, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 8, color: "#0d7060", letterSpacing: 1 }}>{desc}</div>
    </button>
  );
}

function updateItem(
  setBatch: React.Dispatch<React.SetStateAction<BatchDetail | null>>,
  item: BatchItem,
  totalCompleted?: number,
  totalPassed?: number,
): void {
  setBatch((prev) => {
    if (!prev) return prev;
    const items = prev.items.slice();
    items[item.index] = item;
    return {
      ...prev,
      items,
      currentIndex:
        item.status === "running"
          ? item.index
          : Math.max(prev.currentIndex, item.index),
      totalCompleted: totalCompleted ?? prev.totalCompleted,
      totalPassed: totalPassed ?? prev.totalPassed,
    };
  });
}

function BatchTable({ items }: { items: BatchItem[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", fontSize: 8, color: "#0d7060", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #0a2828", color: "#ffd060", letterSpacing: 1 }}>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>#</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>PHASE</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>EXPERIMENT</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>METRIC</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>TARGET</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>MEAN±STD</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>PASS</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>TICKS</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>TIME</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const passed =
              it.status === "completed" && it.passes * 2 >= it.totalRuns;
            const color = statusColor(it.status, passed);
            const targetSym = it.targetDir === 1 ? "≥" : "≤";
            return (
              <tr
                key={it.index}
                style={{
                  borderBottom: "1px solid #0a2828",
                  color: it.status === "running" ? "#ffb040" : "#0d7060",
                  background:
                    it.status === "running" ? "rgba(255,176,64,0.05)" : undefined,
                }}
              >
                <td style={{ padding: "3px 6px" }}>{it.index}</td>
                <td style={{ padding: "3px 6px" }}>
                  <span style={{ color: "#aa88ff" }}>{it.phase}</span>
                </td>
                <td
                  style={{
                    padding: "3px 6px",
                    fontFamily: "monospace",
                    color: "#c5dfd4",
                    maxWidth: 280,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={`${it.experimentId} · ${it.hypothesis}`}
                >
                  {it.experimentName}
                </td>
                <td style={{ padding: "3px 6px", fontFamily: "monospace" }}>{it.metric}</td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>
                  {targetSym}
                  {fmt(it.target)}
                </td>
                <td
                  style={{
                    padding: "3px 6px",
                    textAlign: "right",
                    color: passed ? "#00ffc4" : "#0d7060",
                  }}
                >
                  {fmt(it.meanMeasured)}
                  {it.totalRuns > 1 && it.stdMeasured !== null
                    ? ` ±${fmt(it.stdMeasured)}`
                    : ""}
                </td>
                <td
                  style={{
                    padding: "3px 6px",
                    textAlign: "right",
                    color: passed ? "#00ffc4" : "#0d7060",
                  }}
                >
                  {it.passes}/{it.totalRuns}
                </td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>
                  {it.ticksDone}/{it.ticksTotal}
                </td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>
                  {fmtDur(it.durationMs)}
                </td>
                <td style={{ padding: "3px 6px" }}>
                  <Pill color={color}>{it.status}</Pill>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
