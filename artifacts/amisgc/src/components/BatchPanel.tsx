import { useEffect, useMemo, useState } from "react";
import { Panel, Pill } from "./Panel";
import {
  batchApi,
  subscribeBatch,
  type BatchDetail,
  type BatchItem,
  type CreateBatchRequest,
  type PhaseGroup,
} from "../lib/api";

interface BatchPanelProps {
  open: boolean;
  onClose: () => void;
  groups?: PhaseGroup[];
}

const fmt = (v: number | null | undefined, p = 3): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 100) return v.toFixed(1);
  if (Math.abs(v) >= 10) return v.toFixed(2);
  return v.toFixed(p);
};

const fmtDur = (ms: number): string => {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${Math.round(s - m * 60)}s`;
};

function statusColor(status: BatchItem["status"], passed: boolean): string {
  if (status === "running") return "#ffb040";
  if (status === "error") return "#ff4477";
  if (status === "skipped") return "#0f4a3a";
  if (status === "completed") return passed ? "#00ffc4" : "#ff4477";
  return "#0d7060";
}

function presetBody(
  kind: "all" | "phase" | "core" | "phase0",
  phase?: string,
  groups?: PhaseGroup[],
): CreateBatchRequest {
  if (kind === "all") return { all: true, scale: 81, repeats: 1 };
  if (kind === "phase0") return { phase: "PH0", scale: 81, repeats: 2 };
  if (kind === "phase" && phase) return { phase, scale: 81, repeats: 1 };
  if (kind === "core" && groups) {
    const ids = groups
      .filter((g) => g.phase.startsWith("C") || g.phase === "PH0")
      .flatMap((g) => g.experimentIds);
    return { experimentIds: ids, scale: 81, repeats: 1 };
  }
  return { all: true, scale: 81, repeats: 1 };
}

export function BatchPanel({ open, onClose, groups }: BatchPanelProps) {
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phaseFilter, setPhaseFilter] = useState<string>("");

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

            <div className="flex flex-wrap gap-2 mb-3">
              <PresetButton
                label="▶ RUN PHASE 0 SWEEP (×2)"
                desc="4 PH0 experiments × 2 repeats"
                onClick={() => start(presetBody("phase0"))}
                disabled={launching}
                accent="#00ffc4"
              />
              <PresetButton
                label="▶ RUN ALL CORE (PH0–C5)"
                desc="Phase 0 + CORE-1…6 attractor stack"
                onClick={() => start(presetBody("core", undefined, groups))}
                disabled={launching || !groups}
                accent="#aa88ff"
              />
              <PresetButton
                label="▶ RUN EVERYTHING"
                desc="All registered experiments × 1"
                onClick={() => start(presetBody("all"))}
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
                  onClick={() => phaseFilter && start({ phase: phaseFilter, scale: 81, repeats: 1 })}
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
                        style={{
                          background: "transparent",
                          border: "1px solid #0d7060",
                          color: "#0d7060",
                          padding: "3px 10px",
                          fontSize: 8,
                          letterSpacing: 2,
                          borderRadius: 2,
                        }}
                      >
                        ⎘ CSV
                      </button>
                      <button
                        onClick={reset}
                        style={{
                          background: "transparent",
                          border: "1px solid #ffd060",
                          color: "#ffd060",
                          padding: "3px 10px",
                          fontSize: 8,
                          letterSpacing: 2,
                          borderRadius: 2,
                        }}
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

            <Panel title="ITEMS" accent="#5a4a1a">
              <BatchTable items={batch.items} />
            </Panel>
          </>
        )}
      </div>
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
