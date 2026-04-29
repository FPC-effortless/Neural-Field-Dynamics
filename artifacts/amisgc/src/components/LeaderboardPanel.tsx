import { useEffect, useMemo, useState } from "react";
import { Panel, Pill } from "./Panel";
import { leaderboardApi, type LeaderboardRow } from "../lib/api";

interface LeaderboardPanelProps {
  open: boolean;
  onClose: () => void;
}

type SortKey = "passRate" | "totalRuns" | "phase" | "experimentId" | "lastSeen" | "bestMeasured";

const fmt = (v: number | null | undefined, p = 3): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 100) return v.toFixed(1);
  if (Math.abs(v) >= 10) return v.toFixed(2);
  return v.toFixed(p);
};

const fmtPct = (v: number): string => `${(v * 100).toFixed(0)}%`;

const fmtTs = (t: number): string => {
  if (!t) return "—";
  const d = new Date(t);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

function passColor(rate: number): string {
  if (rate >= 0.8) return "#00ffc4";
  if (rate >= 0.5) return "#ffd060";
  if (rate > 0) return "#ffb040";
  return "#ff4477";
}

export function LeaderboardPanel({ open, onClose }: LeaderboardPanelProps) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [totalBatches, setTotalBatches] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("passRate");
  const [phaseFilter, setPhaseFilter] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    leaderboardApi
      .get()
      .then((r) => {
        setRows(r.rows);
        setTotalBatches(r.totalBatches);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open]);

  const phases = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.phase);
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const list = phaseFilter ? rows.filter((r) => r.phase === phaseFilter) : rows;
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case "passRate":
          return b.passRate - a.passRate || b.totalRuns - a.totalRuns;
        case "totalRuns":
          return b.totalRuns - a.totalRuns;
        case "phase":
          return a.phase.localeCompare(b.phase) || a.experimentId.localeCompare(b.experimentId);
        case "experimentId":
          return a.experimentId.localeCompare(b.experimentId);
        case "lastSeen":
          return b.lastSeen - a.lastSeen;
        case "bestMeasured":
          return (b.bestMeasured ?? -Infinity) - (a.bestMeasured ?? -Infinity);
      }
    });
    return sorted;
  }, [rows, sort, phaseFilter]);

  const aggregate = useMemo(() => {
    if (rows.length === 0) return null;
    const totalRuns = rows.reduce((s, r) => s + r.totalRuns, 0);
    const totalPasses = rows.reduce((s, r) => s + r.totalPasses, 0);
    const passing = rows.filter((r) => r.passRate >= 0.5).length;
    return {
      experiments: rows.length,
      totalRuns,
      totalPasses,
      overallRate: totalRuns > 0 ? totalPasses / totalRuns : 0,
      reliablyPassing: passing,
    };
  }, [rows]);

  const exportCsv = () => {
    const header = [
      "experimentId",
      "phase",
      "name",
      "metric",
      "target",
      "targetDir",
      "totalRuns",
      "totalPasses",
      "passRate",
      "bestMeasured",
      "meanMeasured",
      "stdMeasured",
      "batchCount",
      "lastSeen",
      "hypothesis",
    ];
    const lines = [header.join(",")];
    for (const r of filtered) {
      lines.push(
        [
          r.experimentId,
          r.phase,
          JSON.stringify(r.experimentName),
          r.metric,
          r.target,
          r.targetDir,
          r.totalRuns,
          r.totalPasses,
          r.passRate.toFixed(4),
          r.bestMeasured ?? "",
          r.meanMeasured ?? "",
          r.stdMeasured ?? "",
          r.batchCount,
          new Date(r.lastSeen).toISOString(),
          JSON.stringify(r.hypothesis ?? ""),
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `amisgc-leaderboard-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
          border: "1px solid #aa88ff",
          maxWidth: 1200,
          width: "100%",
          maxHeight: "92vh",
          overflow: "auto",
          padding: 16,
          borderRadius: 4,
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <span style={{ fontSize: 12, color: "#aa88ff", letterSpacing: 3, fontWeight: 700 }}>
            🏆 LEADERBOARD · aggregate stats across all persisted batches
          </span>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid #5a4a8a",
              color: "#aa88ff",
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: 2,
            }}
          >
            ✕
          </button>
        </div>

        {loading ? (
          <Panel title="LOADING" accent="#aa88ff">
            <div style={{ fontSize: 9, color: "#0d7060" }}>aggregating batches…</div>
          </Panel>
        ) : error ? (
          <Panel title="ERROR" accent="#ff4477">
            <div style={{ fontSize: 9, color: "#ff4477" }}>{error}</div>
          </Panel>
        ) : rows.length === 0 ? (
          <Panel title="NO DATA YET" accent="#5a4a8a">
            <div style={{ fontSize: 9, color: "#0d7060", lineHeight: 1.6 }}>
              No batches have been run yet. Open the <strong>▶ RUN ALL</strong> panel and launch
              a preset — the leaderboard aggregates results across every persisted batch.
            </div>
          </Panel>
        ) : (
          <>
            {aggregate ? (
              <Panel title="AGGREGATE" accent="#aa88ff">
                <div className="flex flex-wrap gap-4" style={{ fontSize: 9 }}>
                  <Stat label="EXPERIMENTS" value={String(aggregate.experiments)} />
                  <Stat label="TOTAL RUNS" value={String(aggregate.totalRuns)} />
                  <Stat label="TOTAL PASSES" value={String(aggregate.totalPasses)} color="#00ffc4" />
                  <Stat
                    label="OVERALL PASS RATE"
                    value={fmtPct(aggregate.overallRate)}
                    color={passColor(aggregate.overallRate)}
                  />
                  <Stat
                    label="RELIABLY PASSING (≥50%)"
                    value={`${aggregate.reliablyPassing}/${aggregate.experiments}`}
                    color="#00ffc4"
                  />
                  <Stat label="BATCHES INDEXED" value={String(totalBatches)} />
                </div>
              </Panel>
            ) : null}

            <Panel title="FILTERS" accent="#5a4a8a">
              <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: 9 }}>
                <span style={{ color: "#0d7060", letterSpacing: 2 }}>SORT BY</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  style={{
                    background: "#020c16",
                    color: "#aa88ff",
                    border: "1px solid #5a4a8a",
                    padding: "3px 6px",
                    fontSize: 9,
                  }}
                >
                  <option value="passRate">PASS RATE</option>
                  <option value="totalRuns">TOTAL RUNS</option>
                  <option value="phase">PHASE</option>
                  <option value="experimentId">EXPERIMENT ID</option>
                  <option value="lastSeen">MOST RECENT</option>
                  <option value="bestMeasured">BEST MEASURED</option>
                </select>
                <span style={{ color: "#0d7060", letterSpacing: 2, marginLeft: 8 }}>
                  PHASE
                </span>
                <select
                  value={phaseFilter}
                  onChange={(e) => setPhaseFilter(e.target.value)}
                  style={{
                    background: "#020c16",
                    color: "#aa88ff",
                    border: "1px solid #5a4a8a",
                    padding: "3px 6px",
                    fontSize: 9,
                  }}
                >
                  <option value="">— all —</option>
                  {phases.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <button
                  onClick={exportCsv}
                  style={{
                    marginLeft: "auto",
                    background: "transparent",
                    border: "1px solid #0d7060",
                    color: "#0d7060",
                    padding: "3px 10px",
                    fontSize: 9,
                    letterSpacing: 2,
                    borderRadius: 2,
                  }}
                >
                  ⎘ EXPORT CSV
                </button>
              </div>
            </Panel>

            <Panel title={`RANKINGS · ${filtered.length} EXPERIMENTS`} accent="#5a4a8a">
              <LeaderboardTable rows={filtered} />
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color = "#aa88ff",
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 7, color: "#0d7060", letterSpacing: 2 }}>{label}</div>
      <div style={{ fontSize: 14, color, fontWeight: 700, fontFamily: "monospace" }}>
        {value}
      </div>
    </div>
  );
}

function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", fontSize: 8, color: "#0d7060", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #0a2828", color: "#aa88ff", letterSpacing: 1 }}>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>RANK</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>PHASE</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>EXPERIMENT</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>METRIC</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>TARGET</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>BEST</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>MEAN±STD</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>PASS k/N</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>RATE</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>BATCHES</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>LAST SEEN</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const rateColor = passColor(r.passRate);
            const targetSym = r.targetDir === 1 ? "≥" : "≤";
            return (
              <tr key={r.experimentId} style={{ borderBottom: "1px solid #0a2828" }}>
                <td style={{ padding: "3px 6px", color: "#5a4a8a" }}>{i + 1}</td>
                <td style={{ padding: "3px 6px", color: "#aa88ff" }}>{r.phase}</td>
                <td
                  style={{
                    padding: "3px 6px",
                    color: "#c5dfd4",
                    fontFamily: "monospace",
                    maxWidth: 280,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={`${r.experimentId} · ${r.hypothesis}`}
                >
                  {r.experimentName}
                </td>
                <td style={{ padding: "3px 6px", fontFamily: "monospace" }}>{r.metric}</td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>
                  {targetSym}
                  {fmt(r.target)}
                </td>
                <td
                  style={{
                    padding: "3px 6px",
                    textAlign: "right",
                    color: r.passRate > 0 ? "#00ffc4" : "#0d7060",
                  }}
                >
                  {fmt(r.bestMeasured)}
                </td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>
                  {fmt(r.meanMeasured)}
                  {r.stdMeasured !== null && r.totalRuns > 1
                    ? ` ±${fmt(r.stdMeasured)}`
                    : ""}
                </td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>
                  {r.totalPasses}/{r.totalRuns}
                </td>
                <td
                  style={{
                    padding: "3px 6px",
                    textAlign: "right",
                  }}
                >
                  <Pill color={rateColor}>{fmtPct(r.passRate)}</Pill>
                </td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>{r.batchCount}</td>
                <td style={{ padding: "3px 6px" }}>{fmtTs(r.lastSeen)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
