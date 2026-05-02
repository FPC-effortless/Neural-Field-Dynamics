import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { sweetSpotApi, type SweetSpotResult, type ParetoEntry } from "../lib/api";
import { Panel } from "./Panel";

interface SweetSpotPanelProps {
  open: boolean;
  onClose: () => void;
}

const OBJECTIVES = [
  { id: "phi", label: "Phi (global integration)", color: "#aa88ff" },
  { id: "pu", label: "PU (predictive utility)", color: "#00ffc4" },
  { id: "sc", label: "S_C (stability coherence)", color: "#3aaf6a" },
  { id: "car", label: "CAR (coherence amplification)", color: "#44ffcc" },
  { id: "gateStreak", label: "Gate Streak (ticks)", color: "#ffd060" },
] as const;

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(2,12,22,0.92)",
  zIndex: 200,
  overflowY: "auto",
  padding: "16px 8px",
};

const sheetStyle: React.CSSProperties = {
  maxWidth: 980,
  margin: "0 auto",
  background: "#020c16",
  border: "1px solid #0f4a3a",
  borderRadius: 4,
};

function ParetoBadge({ on }: { on: boolean }) {
  return (
    <span
      style={{
        fontSize: 7,
        padding: "1px 5px",
        border: `1px solid ${on ? "#00ffc4" : "#334455"}`,
        color: on ? "#00ffc4" : "#334455",
        borderRadius: 2,
        letterSpacing: 1,
      }}
    >
      {on ? "PARETO" : "SUB-OPTIMAL"}
    </span>
  );
}

function EntryRow({ entry, rank }: { entry: ParetoEntry; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr
        onClick={() => setExpanded((p) => !p)}
        style={{
          cursor: "pointer",
          background: entry.paretoFront ? "rgba(0,255,196,0.03)" : "transparent",
          borderBottom: "1px solid #0a1a14",
        }}
      >
        <td style={{ padding: "4px 6px", fontSize: 9, color: "#5a7a70" }}>#{rank}</td>
        <td style={{ padding: "4px 6px" }}>
          <ParetoBadge on={entry.paretoFront} />
        </td>
        <td style={{ padding: "4px 6px", fontSize: 9, color: "#aa88ff", fontVariantNumeric: "tabular-nums" }}>
          {fmt(entry.combo.finalPhi)}
        </td>
        <td style={{ padding: "4px 6px", fontSize: 9, color: "#00ffc4", fontVariantNumeric: "tabular-nums" }}>
          {fmt(entry.combo.finalPU)}
        </td>
        <td style={{ padding: "4px 6px", fontSize: 9, color: "#3aaf6a", fontVariantNumeric: "tabular-nums" }}>
          {fmt(entry.combo.finalSC)}
        </td>
        <td style={{ padding: "4px 6px", fontSize: 9, color: "#44ffcc", fontVariantNumeric: "tabular-nums" }}>
          {fmt(entry.combo.finalCAR)}
        </td>
        <td style={{ padding: "4px 6px", fontSize: 9, color: "#ffd060", fontVariantNumeric: "tabular-nums" }}>
          {entry.combo.gateStreak}
        </td>
        <td style={{ padding: "4px 6px", fontSize: 8, color: "#c2a040", fontVariantNumeric: "tabular-nums" }}>
          {(entry.score * 100).toFixed(1)}%
        </td>
        <td style={{ padding: "4px 6px", fontSize: 8, color: entry.combo.gateOpened ? "#00ffc4" : "#334455" }}>
          {entry.combo.gateOpened ? "GATE OPEN" : "no"}
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: "rgba(0,0,0,0.3)" }}>
          <td colSpan={9} style={{ padding: "6px 12px" }}>
            <div style={{ fontSize: 8, color: "#5a7a70", lineHeight: 1.6 }}>
              {Object.entries(entry.combo.params).map(([k, v]) => (
                <span key={k} style={{ marginRight: 10 }}>
                  <span style={{ color: "#3aaf6a" }}>{k}</span>
                  <span style={{ color: "#9aaaa6" }}>={String(v)}</span>
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function SweetSpotPanel({ open, onClose }: SweetSpotPanelProps) {
  const [selectedObjectives, setSelectedObjectives] = useState<string[]>(["phi", "pu", "sc"]);
  const [minPhi, setMinPhi] = useState(0);
  const [minGateStreak, setMinGateStreak] = useState(0);
  const [weights, setWeights] = useState<Record<string, number>>({ phi: 2, pu: 1, sc: 1, car: 1, gateStreak: 1 });
  const [result, setResult] = useState<SweetSpotResult | null>(null);

  const sweepsQuery = useQuery({
    queryKey: ["sweet-spot-sweeps"],
    queryFn: () => sweetSpotApi.listSweeps(),
    enabled: open,
    staleTime: 30_000,
  });

  const analyzeMutation = useMutation({
    mutationFn: (sweepId: string | undefined) =>
      sweetSpotApi.analyze({
        sweepId,
        objectives: selectedObjectives as never,
        constraints: { minPhi, minGateStreak },
        weights: Object.fromEntries(
          Object.entries(weights).filter(([k]) => selectedObjectives.includes(k))
        ),
      }),
    onSuccess: (data) => setResult(data),
  });

  const toggleObjective = (id: string) => {
    setSelectedObjectives((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  if (!open) return null;

  const sweepIds = sweepsQuery.data?.sweepIds ?? [];

  return (
    <div style={backdropStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={sheetStyle}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #0f4a3a" }}>
          <div>
            <div style={{ fontSize: 10, color: "#ffd060", letterSpacing: 3 }}>
              SWEET SPOT DISCOVERY · PARETO-OPTIMAL EMERGENCE
            </div>
            <div style={{ fontSize: 8, color: "#5a7a70", marginTop: 3 }}>
              Multi-objective analysis of sweep results. Finds configs where emergent specialisation is strongest — not most efficient.
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid #0f4a3a", color: "#00ffc4", fontSize: 12, padding: "4px 10px", borderRadius: 2, cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 0 }}>
          {/* Config panel */}
          <div style={{ padding: 14, borderRight: "1px solid #0a1a14" }}>
            <Panel title="OBJECTIVES TO MAXIMISE" accent="#ffd060">
              {OBJECTIVES.map(({ id, label, color }) => (
                <label key={id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={selectedObjectives.includes(id)}
                    onChange={() => toggleObjective(id)}
                    style={{ accentColor: color }}
                  />
                  <span style={{ fontSize: 8, color: selectedObjectives.includes(id) ? color : "#334455" }}>
                    {label}
                  </span>
                </label>
              ))}
            </Panel>

            <Panel title="WEIGHTS (relative importance)" accent="#c2a040">
              {OBJECTIVES.filter(({ id }) => selectedObjectives.includes(id)).map(({ id, label, color }) => (
                <div key={id} style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                    <span style={{ fontSize: 7, color }}>{label}</span>
                    <span style={{ fontSize: 7, color: "#5a7a70" }}>{weights[id] ?? 1}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={1}
                    value={weights[id] ?? 1}
                    onChange={(e) => setWeights((prev) => ({ ...prev, [id]: Number(e.target.value) }))}
                    style={{ width: "100%", accentColor: color }}
                  />
                </div>
              ))}
            </Panel>

            <Panel title="BIOLOGICAL CONSTRAINTS" accent="#3aaf6a">
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 7, color: "#3aaf6a", marginBottom: 2 }}>Min Phi (&gt; 0.05 for Gate I)</div>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={minPhi}
                  onChange={(e) => setMinPhi(Number(e.target.value))}
                  style={{ width: "100%", background: "#020c16", color: "#c5dfd4", border: "1px solid #0f4a3a", fontSize: 9, padding: "3px 6px" }}
                />
              </div>
              <div>
                <div style={{ fontSize: 7, color: "#3aaf6a", marginBottom: 2 }}>Min Gate Streak (ticks)</div>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step={100}
                  value={minGateStreak}
                  onChange={(e) => setMinGateStreak(Number(e.target.value))}
                  style={{ width: "100%", background: "#020c16", color: "#c5dfd4", border: "1px solid #0f4a3a", fontSize: 9, padding: "3px 6px" }}
                />
              </div>
            </Panel>

            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 7, color: "#5a7a70", marginBottom: 4 }}>
                {sweepIds.length > 0 ? `${sweepIds.length} sweep${sweepIds.length > 1 ? "s" : ""} available` : "No sweeps found — run a preset first"}
              </div>
              <button
                disabled={analyzeMutation.isPending || sweepIds.length === 0}
                onClick={() => analyzeMutation.mutate(sweepIds.at(-1))}
                style={{
                  width: "100%",
                  padding: "7px 12px",
                  fontSize: 9,
                  letterSpacing: 2,
                  background: sweepIds.length === 0 ? "rgba(0,0,0,0.2)" : "rgba(40,40,10,0.45)",
                  border: `1px solid ${sweepIds.length === 0 ? "#334455" : "#ffd060"}`,
                  color: sweepIds.length === 0 ? "#334455" : "#ffd060",
                  borderRadius: 2,
                  cursor: sweepIds.length === 0 ? "not-allowed" : "pointer",
                  fontWeight: 600,
                }}
              >
                {analyzeMutation.isPending ? "ANALYSING…" : "▶ FIND SWEET SPOTS"}
              </button>
              {analyzeMutation.isError && (
                <div style={{ fontSize: 8, color: "#ff4477", marginTop: 4 }}>
                  {(analyzeMutation.error as Error).message}
                </div>
              )}
            </div>
          </div>

          {/* Results */}
          <div style={{ padding: 14 }}>
            {!result && !analyzeMutation.isPending && (
              <div style={{ fontSize: 9, color: "#3a5a50", padding: 20, textAlign: "center", lineHeight: 1.8 }}>
                Run a sweep first (Phase 0 Integration Search is recommended), then click
                &ldquo;Find Sweet Spots&rdquo; to discover which parameter combinations achieve
                the strongest emergent specialisation across all selected objectives simultaneously.
                <br /><br />
                The Pareto front shows configs where improving one metric necessarily worsens another
                — these are the genuinely optimal trade-offs.
              </div>
            )}

            {analyzeMutation.isPending && (
              <div style={{ fontSize: 9, color: "#ffd060", padding: 20, textAlign: "center" }}>
                Analysing Pareto front…
              </div>
            )}

            {result && (
              <>
                {/* Verdict */}
                <div style={{ marginBottom: 12, padding: "8px 10px", background: "rgba(0,0,0,0.3)", border: "1px solid #0f4a3a", borderRadius: 2, fontSize: 9, color: "#9aaaa6", lineHeight: 1.6 }}>
                  <span style={{ color: "#ffd060", fontWeight: 700 }}>VERDICT: </span>
                  {result.verdict}
                </div>

                {/* Stats row */}
                <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
                  {[
                    { label: "TOTAL COMBOS", value: result.total, color: "#5a7a70" },
                    { label: "QUALIFIED", value: result.qualified, color: "#c2a040" },
                    { label: "PARETO FRONT", value: result.paretoFront.length, color: "#00ffc4" },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ textAlign: "center", padding: "6px 10px", background: "rgba(0,0,0,0.3)", border: "1px solid #0a1a14", borderRadius: 2 }}>
                      <div style={{ fontSize: 16, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
                      <div style={{ fontSize: 6, color: "#3a5a50", letterSpacing: 1 }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Pareto table */}
                {result.topByScore.length > 0 && (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #0f4a3a" }}>
                          {["#", "STATUS", "Phi", "PU", "S_C", "CAR", "STREAK", "SCORE", "GATE"].map((h) => (
                            <th key={h} style={{ padding: "4px 6px", textAlign: "left", fontSize: 7, color: "#3a5a50", letterSpacing: 1 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.topByScore.map((entry, i) => (
                          <EntryRow key={entry.combo.index} entry={entry} rank={i + 1} />
                        ))}
                      </tbody>
                    </table>
                    <div style={{ fontSize: 7, color: "#3a5a50", marginTop: 6 }}>
                      Click a row to see the full parameter configuration. Pareto-optimal configs (green) are not dominated by any other in all selected objectives simultaneously.
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
