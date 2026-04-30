import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel, Pill } from "./Panel";
import {
  baselinesApi,
  leaderboardApi,
  notesApi,
  type BaselineRecord,
  type LeaderboardRow,
} from "../lib/api";
import { fmt, fmtPct } from "../lib/format";

interface LeaderboardPanelProps {
  open: boolean;
  onClose: () => void;
}

type SortKey =
  | "passRate"
  | "totalRuns"
  | "phase"
  | "experimentId"
  | "lastSeen"
  | "bestMeasured"
  | "ciWidth"
  | "delta";

// Local formatter — leaderboard rows want full date + time (different
// from the time-only fmtTs in lib/format that the live panels use).
const fmtTs = (t: number | null | undefined): string => {
  if (!t || !Number.isFinite(t)) return "—";
  const d = new Date(t);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

function passColor(rate: number): string {
  if (rate >= 0.8) return "#00ffc4";
  if (rate >= 0.5) return "#ffd060";
  if (rate > 0) return "#ffb040";
  return "#ff4477";
}

function deltaColor(sign: "better" | "worse" | "tie" | null | undefined): string {
  if (sign === "better") return "#00ffc4";
  if (sign === "worse") return "#ff4477";
  return "#ffd060";
}

function pColor(p: number | null | undefined): string {
  if (p === null || p === undefined) return "#0d7060";
  if (p < 0.01) return "#00ffc4";
  if (p < 0.05) return "#9bff8a";
  if (p < 0.1) return "#ffd060";
  return "#5a4a8a";
}

export function LeaderboardPanel({ open, onClose }: LeaderboardPanelProps) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [totalBatches, setTotalBatches] = useState(0);
  const [includedBatches, setIncludedBatches] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("passRate");
  const [phaseFilter, setPhaseFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [minRuns, setMinRuns] = useState<number>(0);
  const [excludeInterrupted, setExcludeInterrupted] = useState<boolean>(true);
  const [baselines, setBaselines] = useState<BaselineRecord[]>([]);
  const [baselineId, setBaselineId] = useState<string>("");
  const [editing, setEditing] = useState<string | null>(null);

  // Debounce search input so the leaderboard isn't re-fetched on every keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(id);
  }, [search]);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    leaderboardApi
      .get({
        ...(phaseFilter ? { phase: phaseFilter } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(baselineId ? { baseline: baselineId } : {}),
        ...(minRuns > 0 ? { minRuns } : {}),
        excludeInterrupted,
      })
      .then((r) => {
        setRows(r.rows);
        setTotalBatches(r.totalBatches);
        setIncludedBatches(r.includedBatches);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [phaseFilter, debouncedSearch, baselineId, minRuns, excludeInterrupted]);

  useEffect(() => {
    if (!open) return;
    refresh();
    baselinesApi
      .list()
      .then((r) => setBaselines(r.baselines))
      .catch(() => undefined);
  }, [open, refresh]);

  const phases = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.phase);
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const sorted = [...rows];
    sorted.sort((a, b) => {
      // Pinned always wins regardless of chosen sort.
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
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
        case "ciWidth": {
          const aw =
            a.ci95Lo !== null && a.ci95Hi !== null ? a.ci95Hi - a.ci95Lo : Infinity;
          const bw =
            b.ci95Lo !== null && b.ci95Hi !== null ? b.ci95Hi - b.ci95Lo : Infinity;
          return aw - bw;
        }
        case "delta": {
          const ad = a.baselineDelta?.delta ?? 0;
          const bd = b.baselineDelta?.delta ?? 0;
          // Direction-aware: improvement first, then worsening.
          const aScore = a.baselineDelta?.sign === "better" ? Math.abs(ad) : -Math.abs(ad);
          const bScore = b.baselineDelta?.sign === "better" ? Math.abs(bd) : -Math.abs(bd);
          return bScore - aScore;
        }
      }
    });
    return sorted;
  }, [rows, sort]);

  const aggregate = useMemo(() => {
    if (rows.length === 0) return null;
    const totalRuns = rows.reduce((s, r) => s + r.totalRuns, 0);
    const totalPasses = rows.reduce((s, r) => s + r.totalPasses, 0);
    const passing = rows.filter((r) => r.passRate >= 0.5).length;
    const pinned = rows.filter((r) => r.pinned).length;
    return {
      experiments: rows.length,
      totalRuns,
      totalPasses,
      overallRate: totalRuns > 0 ? totalPasses / totalRuns : 0,
      reliablyPassing: passing,
      pinned,
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
      "ci95Lo",
      "ci95Hi",
      "batchCount",
      "lastSeen",
      "pinned",
      "baselineDelta",
      "baselinePValue",
      "noteText",
      "noteTags",
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
          r.ci95Lo ?? "",
          r.ci95Hi ?? "",
          r.batchCount,
          new Date(r.lastSeen).toISOString(),
          r.pinned ? "1" : "0",
          r.baselineDelta?.delta ?? "",
          r.baselineDelta?.pTwoSided ?? "",
          JSON.stringify(r.noteText ?? ""),
          JSON.stringify(r.noteTags.join("|")),
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

  const togglePin = async (row: LeaderboardRow) => {
    try {
      await notesApi.put(row.experimentId, { pinned: !row.pinned });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveNote = async (
    experimentId: string,
    text: string,
    tags: string[],
    pinned: boolean,
  ) => {
    try {
      await notesApi.put(experimentId, { text, tags, pinned });
      setEditing(null);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const deleteNote = async (experimentId: string) => {
    try {
      await notesApi.remove(experimentId);
      setEditing(null);
      refresh();
    } catch {
      /* ignore — already absent */
      setEditing(null);
      refresh();
    }
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
          maxWidth: 1280,
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

        {loading && rows.length === 0 ? (
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
              No batches match these filters. Open the <strong>▶ RUN ALL</strong> panel and
              launch a preset, or relax filters above.
            </div>
          </Panel>
        ) : (
          <>
            {aggregate ? (
              <Panel title="AGGREGATE" accent="#aa88ff">
                <div className="flex flex-wrap gap-4" style={{ fontSize: 9 }}>
                  <Stat label="EXPERIMENTS" value={String(aggregate.experiments)} />
                  <Stat label="TOTAL RUNS" value={String(aggregate.totalRuns)} />
                  <Stat
                    label="TOTAL PASSES"
                    value={String(aggregate.totalPasses)}
                    color="#00ffc4"
                  />
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
                  <Stat label="PINNED" value={String(aggregate.pinned)} color="#ffd060" />
                  <Stat
                    label="BATCHES INDEXED"
                    value={`${includedBatches}/${totalBatches}`}
                  />
                </div>
              </Panel>
            ) : null}

            <Panel title="FILTERS" accent="#5a4a8a">
              <div
                className="flex items-center gap-2 flex-wrap"
                style={{ fontSize: 9 }}
              >
                <span style={{ color: "#0d7060", letterSpacing: 2 }}>SORT</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  style={selectStyle}
                >
                  <option value="passRate">PASS RATE</option>
                  <option value="totalRuns">TOTAL RUNS</option>
                  <option value="phase">PHASE</option>
                  <option value="experimentId">EXPERIMENT ID</option>
                  <option value="lastSeen">MOST RECENT</option>
                  <option value="bestMeasured">BEST MEASURED</option>
                  <option value="ciWidth">CI WIDTH (tightest)</option>
                  <option value="delta">Δ vs BASELINE</option>
                </select>

                <span style={{ color: "#0d7060", letterSpacing: 2, marginLeft: 4 }}>
                  PHASE
                </span>
                <select
                  value={phaseFilter}
                  onChange={(e) => setPhaseFilter(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">— all —</option>
                  {phases.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>

                <span style={{ color: "#0d7060", letterSpacing: 2, marginLeft: 4 }}>
                  SEARCH
                </span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="id / name / hypothesis"
                  style={{
                    ...selectStyle,
                    width: 180,
                  }}
                />

                <span style={{ color: "#0d7060", letterSpacing: 2, marginLeft: 4 }}>
                  MIN RUNS
                </span>
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={minRuns}
                  onChange={(e) => setMinRuns(Math.max(0, Number(e.target.value) || 0))}
                  style={{ ...selectStyle, width: 60 }}
                />

                <span style={{ color: "#0d7060", letterSpacing: 2, marginLeft: 4 }}>
                  BASELINE
                </span>
                <select
                  value={baselineId}
                  onChange={(e) => setBaselineId(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">— none —</option>
                  {baselines.map((b) => (
                    <option key={b.id} value={b.batchId}>
                      {b.name} ({b.batchId})
                    </option>
                  ))}
                </select>

                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    color: "#0d7060",
                    letterSpacing: 1,
                    marginLeft: 4,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={excludeInterrupted}
                    onChange={(e) => setExcludeInterrupted(e.target.checked)}
                  />
                  EXCLUDE INTERRUPTED
                </label>

                <button
                  onClick={refresh}
                  style={{
                    ...buttonStyle,
                    color: "#aa88ff",
                    borderColor: "#5a4a8a",
                    marginLeft: 4,
                  }}
                  title="Refetch leaderboard"
                >
                  ↻ REFRESH
                </button>

                <button
                  onClick={exportCsv}
                  style={{
                    ...buttonStyle,
                    color: "#0d7060",
                    borderColor: "#0d7060",
                    marginLeft: "auto",
                  }}
                >
                  ⎘ EXPORT CSV
                </button>
              </div>
              {baselineId ? (
                <div
                  style={{
                    fontSize: 9,
                    color: "#5a4a8a",
                    marginTop: 6,
                    fontFamily: "monospace",
                  }}
                >
                  comparing every row's measured distribution against batch{" "}
                  <strong style={{ color: "#aa88ff" }}>{baselineId}</strong> using Welch's t
                </div>
              ) : null}
            </Panel>

            <Panel title={`RANKINGS · ${filtered.length} EXPERIMENTS`} accent="#5a4a8a">
              <LeaderboardTable
                rows={filtered}
                showBaseline={Boolean(baselineId)}
                editing={editing}
                onPinToggle={togglePin}
                onEdit={setEditing}
                onSaveNote={saveNote}
                onDeleteNote={deleteNote}
              />
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: "#020c16",
  color: "#aa88ff",
  border: "1px solid #5a4a8a",
  padding: "3px 6px",
  fontSize: 9,
};

const buttonStyle: React.CSSProperties = {
  background: "transparent",
  padding: "3px 10px",
  fontSize: 9,
  letterSpacing: 2,
  borderRadius: 2,
  border: "1px solid",
  cursor: "pointer",
};

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

interface TableProps {
  rows: LeaderboardRow[];
  showBaseline: boolean;
  editing: string | null;
  onPinToggle: (r: LeaderboardRow) => void;
  onEdit: (id: string | null) => void;
  onSaveNote: (id: string, text: string, tags: string[], pinned: boolean) => void;
  onDeleteNote: (id: string) => void;
}

function LeaderboardTable(props: TableProps) {
  const { rows, showBaseline, editing, onPinToggle, onEdit, onSaveNote, onDeleteNote } = props;
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{ width: "100%", fontSize: 8, color: "#0d7060", borderCollapse: "collapse" }}
      >
        <thead>
          <tr
            style={{ borderBottom: "1px solid #0a2828", color: "#aa88ff", letterSpacing: 1 }}
          >
            <th style={{ textAlign: "center", padding: "4px 6px", width: 22 }}>★</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>RANK</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>PHASE</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>EXPERIMENT</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>METRIC</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>TARGET</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>BEST</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>MEAN ±STD</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>95% CI</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>PASS k/N</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>RATE</th>
            {showBaseline ? (
              <th style={{ textAlign: "right", padding: "4px 6px" }}>Δ vs BASE (p)</th>
            ) : null}
            <th style={{ textAlign: "right", padding: "4px 6px" }}>BATCHES</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>LAST SEEN</th>
            <th style={{ textAlign: "center", padding: "4px 6px" }}>NOTE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const rateColor = passColor(r.passRate);
            const targetSym = r.targetDir === 1 ? "≥" : "≤";
            const isEditing = editing === r.experimentId;
            return (
              <>
                <tr
                  key={r.experimentId}
                  style={{
                    borderBottom: "1px solid #0a2828",
                    background: r.pinned ? "rgba(255,208,96,0.04)" : undefined,
                  }}
                >
                  <td style={{ padding: "3px 6px", textAlign: "center" }}>
                    <button
                      onClick={() => onPinToggle(r)}
                      title={r.pinned ? "Unpin" : "Pin to top"}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: r.pinned ? "#ffd060" : "#5a4a8a",
                        cursor: "pointer",
                        fontSize: 12,
                        padding: 0,
                        lineHeight: 1,
                      }}
                    >
                      {r.pinned ? "★" : "☆"}
                    </button>
                  </td>
                  <td style={{ padding: "3px 6px", color: "#5a4a8a" }}>{i + 1}</td>
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
                  <td
                    style={{
                      padding: "3px 6px",
                      textAlign: "right",
                      color: "#5a4a8a",
                      fontFamily: "monospace",
                    }}
                    title="Bootstrap (n=600) 95% CI of the mean"
                  >
                    {r.ci95Lo === null || r.ci95Hi === null
                      ? "—"
                      : `[${fmt(r.ci95Lo)}, ${fmt(r.ci95Hi)}]`}
                  </td>
                  <td style={{ padding: "3px 6px", textAlign: "right" }}>
                    {r.totalPasses}/{r.totalRuns}
                  </td>
                  <td style={{ padding: "3px 6px", textAlign: "right" }}>
                    <Pill color={rateColor}>{fmtPct(r.passRate)}</Pill>
                  </td>
                  {showBaseline ? (
                    <td
                      style={{
                        padding: "3px 6px",
                        textAlign: "right",
                        fontFamily: "monospace",
                      }}
                      title={
                        r.baselineDelta
                          ? `baseline n=${r.baselineDelta.baselineN}, μ=${fmt(r.baselineDelta.baselineMean)}`
                          : "no overlap with baseline batch"
                      }
                    >
                      {r.baselineDelta?.delta === null || !r.baselineDelta ? (
                        "—"
                      ) : (
                        <>
                          <span style={{ color: deltaColor(r.baselineDelta.sign) }}>
                            {r.baselineDelta.delta > 0 ? "+" : ""}
                            {fmt(r.baselineDelta.delta)}
                          </span>
                          <span style={{ color: pColor(r.baselineDelta.pTwoSided), marginLeft: 4 }}>
                            ({r.baselineDelta.pTwoSided === null
                              ? "—"
                              : r.baselineDelta.pTwoSided < 0.001
                                ? "p<.001"
                                : `p=${r.baselineDelta.pTwoSided.toFixed(3)}`})
                          </span>
                        </>
                      )}
                    </td>
                  ) : null}
                  <td style={{ padding: "3px 6px", textAlign: "right" }}>{r.batchCount}</td>
                  <td style={{ padding: "3px 6px" }}>{fmtTs(r.lastSeen)}</td>
                  <td style={{ padding: "3px 6px", textAlign: "center" }}>
                    <button
                      onClick={() => onEdit(isEditing ? null : r.experimentId)}
                      title={r.noteText ? r.noteText : "Add a note / tags"}
                      style={{
                        background: "transparent",
                        border: "1px solid #5a4a8a",
                        color: r.noteText ? "#9bff8a" : "#5a4a8a",
                        cursor: "pointer",
                        fontSize: 9,
                        padding: "1px 6px",
                        borderRadius: 2,
                      }}
                    >
                      {r.noteText ? "📝" : "+"}
                    </button>
                  </td>
                </tr>
                {isEditing ? (
                  <tr key={`${r.experimentId}-edit`}>
                    <td colSpan={showBaseline ? 15 : 14} style={{ padding: 8 }}>
                      <NoteEditor
                        row={r}
                        onSave={onSaveNote}
                        onDelete={() => onDeleteNote(r.experimentId)}
                        onCancel={() => onEdit(null)}
                      />
                    </td>
                  </tr>
                ) : null}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NoteEditor({
  row,
  onSave,
  onDelete,
  onCancel,
}: {
  row: LeaderboardRow;
  onSave: (id: string, text: string, tags: string[], pinned: boolean) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(row.noteText ?? "");
  const [tagsRaw, setTagsRaw] = useState(row.noteTags.join(", "));
  const [pinned, setPinned] = useState(row.pinned);
  return (
    <div
      style={{
        background: "#04111c",
        border: "1px solid #5a4a8a",
        padding: 8,
        borderRadius: 2,
      }}
    >
      <div style={{ fontSize: 8, color: "#aa88ff", letterSpacing: 2, marginBottom: 4 }}>
        EDIT NOTE · {row.experimentId}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What did you observe? (kept locally on the API server)"
        rows={3}
        style={{
          width: "100%",
          background: "#020c16",
          color: "#c5dfd4",
          border: "1px solid #0d7060",
          padding: 6,
          fontSize: 10,
          fontFamily: "monospace",
          resize: "vertical",
        }}
      />
      <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 6, fontSize: 9 }}>
        <span style={{ color: "#0d7060", letterSpacing: 2 }}>TAGS</span>
        <input
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          placeholder="comma, separated"
          style={{
            ...selectStyle,
            width: 240,
          }}
        />
        <label
          style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#ffd060" }}
        >
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
          />
          PIN
        </label>
        <button
          onClick={() =>
            onSave(
              row.experimentId,
              text.trim(),
              tagsRaw
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
              pinned,
            )
          }
          style={{ ...buttonStyle, color: "#00ffc4", borderColor: "#00ffc4", marginLeft: "auto" }}
        >
          ✓ SAVE
        </button>
        {row.noteText !== null ? (
          <button
            onClick={onDelete}
            style={{ ...buttonStyle, color: "#ff4477", borderColor: "#ff4477" }}
          >
            ✕ DELETE
          </button>
        ) : null}
        <button
          onClick={onCancel}
          style={{ ...buttonStyle, color: "#5a4a8a", borderColor: "#5a4a8a" }}
        >
          CANCEL
        </button>
      </div>
    </div>
  );
}
