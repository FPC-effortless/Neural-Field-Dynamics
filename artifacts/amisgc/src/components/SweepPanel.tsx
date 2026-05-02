import { useEffect, useMemo, useState } from "react";
import { Panel, Pill } from "./Panel";
import {
  sweepApi,
  subscribeSweep,
  type SweepDetail,
  type SweepCombo,
} from "../lib/api";
import { fmt, parseNumOr } from "../lib/format";

interface SweepPanelProps {
  open: boolean;
  onClose: () => void;
}

function paramSummary(p: Record<string, number | boolean | string>): string {
  return Object.entries(p)
    .filter(([k]) => k !== "ATTN_MODE" && k !== "USE_BOTTLENECK")
    .map(([k, v]) => `${k}=${typeof v === "number" ? fmt(v) : String(v)}`)
    .join(" ");
}

// Phase-0 default grid (spec §6.1 "forced-coupling regime").
// Current axes: τ × γ × β × δ × σ  = 5×4×4×3×3 = 720 combinations.
// Full spec grid also includes p_inhib (inhibitory fraction) and replay_speed
// (offline replay compression) for 6×5×4×3×3×2×3 = 6 480 combos — those two
// axes require the brain-realistic upgrade (hierarchical layers + replay) and
// will be added once the structural enhancements are active.
const PHASE0_GRID: Record<string, number[]> = {
  TAU_ATT: [0.7, 1.0, 1.5, 2.0, 3.0],
  GAMMA_GLOBAL: [1.0, 1.5, 2.0, 3.0],
  BETA_ENTROPY: [0.1, 0.3, 0.5, 0.8],
  DELTA_TEMPORAL: [0.2, 0.4, 0.6],
  NOISE_SIGMA: [0.01, 0.02, 0.05],
};
const PHASE0_DEFAULT_TICKS = 30000;
const PHASE0_MAX_TICKS = 50000;

// Researcher-accessible extra sweep axes: biologically motivated parameters
// beyond the Phase-0 defaults. Clicking a preset adds/replaces the axis in
// the custom panel. The values shown are literature-motivated ranges.
interface AxisPreset { key: string; label: string; values: number[]; note: string }
const EXTRA_AXIS_PRESETS: AxisPreset[] = [
  {
    key: "FIRE_COST",
    label: "FIRE_COST (metabolic cost per spike)",
    values: [1.0, 2.5, 4.0, 8.0, 16.0],
    note: "H2 axis. Low = broad firing, high = sparse. Peak Phi expected at 4-8.",
  },
  {
    key: "REGEN",
    label: "REGEN (ATP regeneration rate)",
    values: [0.7, 0.9, 1.1, 1.3],
    note: "Pairs with FIRE_COST. Lower regen = tighter energy budget.",
  },
  {
    key: "COOP_BONUS",
    label: "COOP_BONUS (cooperative ATP bonus)",
    values: [3.0, 6.0, 9.0, 12.0],
    note: "Reward for synchronised firing. Higher = more attractor cohesion.",
  },
  {
    key: "K_LOCAL",
    label: "K_LOCAL (local connectivity radius)",
    values: [4, 8, 12, 16],
    note: "Connection fan-out per neuron. Higher = denser local coupling.",
  },
  {
    key: "HEBB",
    label: "HEBB (Hebbian learning rate)",
    values: [0.002, 0.005, 0.01, 0.02],
    note: "Weight update speed. High = fast association but less stable.",
  },
];

type SortMode = "CAR" | "STREAK" | "INDEX";

interface CustomAxis { key: string; rawValues: string }

function parseCustomValues(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n));
}

export function SweepPanel({ open, onClose }: SweepPanelProps) {
  const [sweep, setSweep] = useState<SweepDetail | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Launch-form controls
  const [scale, setScale] = useState<81 | 810 | 81000>(81);
  const [neuronsStr, setNeuronsStr] = useState<string>("");
  const [topKStr, setTopKStr] = useState<string>("");
  const [ticks, setTicks] = useState<number>(PHASE0_DEFAULT_TICKS);
  // Live sort for the combos table
  const [sortMode, setSortMode] = useState<SortMode>("CAR");
  // Extra custom axes (merged with PHASE0_GRID on launch)
  const [customAxes, setCustomAxes] = useState<CustomAxis[]>([]);
  const [showCustom, setShowCustom] = useState(false);

  // Build the merged ranges object for preview / launch
  const mergedRanges = useMemo<Record<string, number[]> | undefined>(() => {
    if (customAxes.length === 0) return undefined; // use server default
    const extra: Record<string, number[]> = {};
    for (const ax of customAxes) {
      const vals = parseCustomValues(ax.rawValues);
      if (vals.length > 0) extra[ax.key] = vals;
    }
    return { ...PHASE0_GRID, ...extra };
  }, [customAxes]);

  const comboCount = useMemo(() => {
    const grid = mergedRanges ?? PHASE0_GRID;
    return Object.values(grid).reduce((a, b) => a * b.length, 1);
  }, [mergedRanges]);

  const addCustomAxis = (preset: AxisPreset) => {
    setCustomAxes((prev) => {
      const existing = prev.findIndex((a) => a.key === preset.key);
      const entry: CustomAxis = { key: preset.key, rawValues: preset.values.join(", ") };
      if (existing >= 0) {
        const next = prev.slice();
        next[existing] = entry;
        return next;
      }
      return [...prev, entry];
    });
    setShowCustom(true);
  };

  const removeCustomAxis = (key: string) =>
    setCustomAxes((prev) => prev.filter((a) => a.key !== key));

  const updateCustomAxis = (key: string, rawValues: string) =>
    setCustomAxes((prev) => prev.map((a) => (a.key === key ? { ...a, rawValues } : a)));

  useEffect(() => {
    if (!open || !sweep?.id) return;
    if (sweep.status !== "running" && sweep.status !== "pending") return;
    const unsub = subscribeSweep(sweep.id, {
      onSnapshot: (s) => setSweep(s),
      onSweepStart: (s) => setSweep(s),
      onComboStart: ({ combo }) => updateCombo(setSweep, combo),
      onComboProgress: ({ combo }) => updateCombo(setSweep, combo),
      onComboComplete: ({ combo, bestIndex }) =>
        updateCombo(setSweep, combo, bestIndex),
      onSweepComplete: (s) => setSweep(s),
      onError: (m) => setError(m),
    });
    return unsub;
  }, [open, sweep?.id, sweep?.status]);

  const start = async () => {
    setLaunching(true);
    setError(null);
    try {
      // Use the shared NaN-safe parser instead of bare Number(): an
      // accidentally-typed "abc" used to silently become NaN and propagate
      // all the way to the simulator. parseNumOr returns undefined on bad
      // input so the request body simply omits the field.
      const neuronsNum = parseNumOr(neuronsStr, undefined);
      const topKNum = parseNumOr(topKStr, undefined);
      const body: {
        ticksPerCombo: number;
        scale: 81 | 810 | 81000;
        neurons?: number;
        topK?: number;
        ranges?: Record<string, number[]>;
      } = {
        ticksPerCombo: ticks,
        scale,
      };
      if (typeof neuronsNum === "number" && Number.isFinite(neuronsNum)) {
        body.neurons = neuronsNum;
      }
      if (typeof topKNum === "number" && Number.isFinite(topKNum)) {
        body.topK = topKNum;
      }
      // Only send ranges if the researcher added custom axes — otherwise
      // the server uses its own PHASE0_DEFAULT_RANGES unchanged.
      if (mergedRanges) {
        body.ranges = mergedRanges;
      }
      const { id } = await sweepApi.create(body);
      const detail = await sweepApi.get(id);
      setSweep(detail);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLaunching(false);
    }
  };

  const cancel = async () => {
    if (!sweep) return;
    try {
      await sweepApi.cancel(sweep.id);
    } catch {
      /* ignore */
    }
  };

  const reset = () => {
    setSweep(null);
    setError(null);
  };

  const best = useMemo(() => {
    if (!sweep) return null;
    return sweep.combos[sweep.bestIndex] ?? null;
  }, [sweep]);

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
          border: "1px solid #00ffc4",
          maxWidth: 980,
          width: "100%",
          maxHeight: "90vh",
          overflow: "auto",
          padding: 16,
          borderRadius: 4,
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <span style={{ fontSize: 12, color: "#00ffc4", letterSpacing: 3, fontWeight: 700 }}>
            ⚡ AUTO-SWEEP · Phase 0 Existence-Gate hunt
          </span>
          <button
            onClick={onClose}
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

        {!sweep ? (
          <Panel title={`AUTO SWEEP · ${comboCount}-COMBO PHASE 0 GRID`} accent="#00ffc4">
            <div style={{ fontSize: 9, color: "#0d7060", marginBottom: 10, lineHeight: 1.6 }}>
              Phase 0 Existence-Gate hunt — spec §6.1 forced-coupling regime.
              Gate I requires Φ &gt; 0.05 ∧ PU &gt; 0.1 ∧ S_C &gt; 0.1 sustained ≥ 1 000 consecutive ticks.
              <br />
              Base axes: τ · γ · β · δ · σ = 720 combos. Add extra axes below to sweep FIRE_COST, REGEN, or others.
              <br />
              Dead combos (Φ &lt; 0.008 at 8k ticks, no streak) exit early — saves ~73% compute per inert region.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
              <FieldLabel label="SCALE">
                <select
                  value={scale}
                  onChange={(e) => setScale(Number(e.target.value) as 81 | 810 | 81000)}
                  style={selectStyle}
                >
                  <option value={81}>81 (G=9)</option>
                  <option value={810}>810 (G=29)</option>
                  <option value={81000}>81 000 (G=285)</option>
                </select>
              </FieldLabel>
              <FieldLabel label="NEURONS (override)">
                <input
                  type="number"
                  min={9}
                  max={102400}
                  step={1}
                  value={neuronsStr}
                  onChange={(e) => setNeuronsStr(e.target.value)}
                  placeholder="—"
                  style={inputStyle}
                />
                <div style={{ fontSize: 8, color: "#0d7060", marginTop: 2 }}>
                  Optional · 9 – 102 400 · overrides scale
                </div>
              </FieldLabel>
              <FieldLabel label="TOP_K (override)">
                <input
                  type="number"
                  min={1}
                  max={102400}
                  step={1}
                  value={topKStr}
                  onChange={(e) => setTopKStr(e.target.value)}
                  placeholder="—"
                  style={inputStyle}
                />
                <div style={{ fontSize: 8, color: "#0d7060", marginTop: 2 }}>
                  Optional · absolute count · overrides TOPK_FRACTION
                </div>
              </FieldLabel>
              <FieldLabel label="TICKS PER COMBO">
                <input
                  type="number"
                  min={500}
                  max={50000}
                  step={500}
                  value={ticks}
                  onChange={(e) => setTicks(Math.max(500, Math.min(50000, Number(e.target.value) || 0)))}
                  style={inputStyle}
                />
                <div style={{ fontSize: 8, color: "#0d7060", marginTop: 2 }}>
                  500 – 50 000 (dead combos exit at 8k)
                </div>
              </FieldLabel>
            </div>

            {/* ── Extra parameter axes ── */}
            <div style={{ marginBottom: 12 }}>
              <button
                onClick={() => setShowCustom((v) => !v)}
                style={{
                  background: "transparent",
                  border: "1px solid #0f4a3a",
                  color: showCustom ? "#00ffc4" : "#0d7060",
                  fontSize: 9,
                  padding: "3px 10px",
                  letterSpacing: 2,
                  borderRadius: 2,
                  cursor: "pointer",
                  marginBottom: 8,
                }}
              >
                {showCustom ? "▾" : "▸"} EXTRA PARAMETER AXES
                {customAxes.length > 0 ? ` (${customAxes.length} added)` : ""}
              </button>

              {showCustom && (
                <div style={{ border: "1px solid #0f4a3a", padding: 10, borderRadius: 2 }}>
                  <div style={{ fontSize: 8, color: "#0d7060", marginBottom: 8 }}>
                    Add axes to the sweep grid. Values are comma-separated numbers.
                    Extra axes multiply the combo count — keep the total under 1 000.
                  </div>
                  {/* Preset quick-add buttons */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                    {EXTRA_AXIS_PRESETS.map((p) => {
                      const active = customAxes.some((a) => a.key === p.key);
                      return (
                        <button
                          key={p.key}
                          onClick={() => (active ? removeCustomAxis(p.key) : addCustomAxis(p))}
                          title={p.note}
                          style={{
                            background: active ? "#00ffc4" : "transparent",
                            color: active ? "#020c16" : "#00ffc4",
                            border: "1px solid #0f4a3a",
                            fontSize: 8,
                            padding: "3px 8px",
                            borderRadius: 2,
                            cursor: "pointer",
                            letterSpacing: 1,
                          }}
                        >
                          {active ? "✓ " : "+ "}{p.key}
                        </button>
                      );
                    })}
                  </div>
                  {/* Active custom axes editor */}
                  {customAxes.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {customAxes.map((ax) => {
                        const preset = EXTRA_AXIS_PRESETS.find((p) => p.key === ax.key);
                        const vals = parseCustomValues(ax.rawValues);
                        return (
                          <div key={ax.key} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                            <div style={{ flex: "0 0 120px" }}>
                              <div style={{ fontSize: 8, color: "#00ffc4", letterSpacing: 1, marginBottom: 2 }}>
                                {ax.key}
                              </div>
                              {preset && (
                                <div style={{ fontSize: 7, color: "#0d7060" }}>
                                  {preset.note}
                                </div>
                              )}
                            </div>
                            <input
                              value={ax.rawValues}
                              onChange={(e) => updateCustomAxis(ax.key, e.target.value)}
                              placeholder="e.g. 1.0, 4.0, 16.0"
                              style={{ ...inputStyle, flex: 1 }}
                            />
                            <div style={{ fontSize: 8, color: "#0d7060", alignSelf: "center" }}>
                              {vals.length} vals
                            </div>
                            <button
                              onClick={() => removeCustomAxis(ax.key)}
                              style={{
                                background: "transparent",
                                border: "1px solid #0f4a3a",
                                color: "#ff4477",
                                fontSize: 8,
                                padding: "2px 6px",
                                borderRadius: 2,
                                cursor: "pointer",
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                      <div style={{ fontSize: 8, color: comboCount > 1000 ? "#ff4477" : "#0d7060" }}>
                        Total combos: <b style={{ color: comboCount > 1000 ? "#ff4477" : "#00ffc4" }}>{comboCount.toLocaleString()}</b>
                        {comboCount > 1000 ? " — exceeds 1 000 limit, reduce axes" : ""}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={start}
              disabled={launching || comboCount > 1000}
              style={{
                background: comboCount > 1000 ? "#0a2828" : "#00ffc4",
                color: comboCount > 1000 ? "#0d7060" : "#020c16",
                border: "1px solid #00ffc4",
                padding: "6px 14px",
                fontSize: 10,
                letterSpacing: 2,
                borderRadius: 2,
                fontWeight: 700,
                cursor: launching || comboCount > 1000 ? "not-allowed" : "pointer",
              }}
            >
              {launching ? "STARTING…" : `▶ START AUTO SWEEP (${comboCount.toLocaleString()} combos)`}
            </button>
            {error ? (
              <div style={{ marginTop: 8, color: "#ff4477", fontSize: 9 }}>{error}</div>
            ) : null}
          </Panel>
        ) : (
          <>
            <Panel
              title={`SWEEP ${sweep.id} · ${sweep.status.toUpperCase()}`}
              accent={sweep.status === "completed" ? "#00ffc4" : "#ffb040"}
            >
              <div className="flex items-center justify-between mb-2">
                <span style={{ fontSize: 9, color: "#0d7060" }}>
                  PROGRESS {Math.min(sweep.currentIndex + 1, sweep.total)} / {sweep.total} ·
                  {" "}scale {sweep.scale}
                  {sweep.neurons ? ` · neurons ${sweep.neurons}` : ""} ·
                  {" "}{sweep.ticksPerCombo} t/combo
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  {sweep.status === "running" || sweep.status === "pending" ? (
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
                    <button
                      onClick={reset}
                      style={{
                        background: "transparent",
                        border: "1px solid #0f4a3a",
                        color: "#00ffc4",
                        padding: "3px 10px",
                        fontSize: 8,
                        letterSpacing: 2,
                        borderRadius: 2,
                      }}
                    >
                      ↺ NEW SWEEP
                    </button>
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
                    background: "#00ffc4",
                    width: `${
                      sweep.total > 0 ? (sweep.currentIndex / sweep.total) * 100 : 0
                    }%`,
                    height: "100%",
                  }}
                />
              </div>
            </Panel>

            {best && best.gateStreak > 0 ? (
              <Panel title="★ BEST CONFIG SO FAR" accent="#00ffc4">
                <div style={{ fontSize: 9, color: "#00ffc4", marginBottom: 4 }}>
                  combo #{best.index} · {paramSummary(best.params)}
                </div>
                <div style={{ fontSize: 8, color: "#0d7060", letterSpacing: 1 }}>
                  Φ {fmt(best.finalPhi)} · S_C {fmt(best.finalSC)} · PU {fmt(best.finalPU)} ·
                  CAR {fmt(best.bestCAR)} · STREAK {best.gateStreak}
                </div>
              </Panel>
            ) : null}

            <Panel title="ALL COMBOS" accent="#0f4a3a">
              <SortControls value={sortMode} onChange={setSortMode} />
              <ComboTable
                combos={sweep.combos}
                bestIndex={sweep.bestIndex}
                sortMode={sortMode}
              />
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#0a1620",
  border: "1px solid #0f4a3a",
  color: "#00ffc4",
  fontSize: 10,
  padding: "4px 6px",
  borderRadius: 2,
  fontFamily: "monospace",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div
        style={{
          fontSize: 8,
          color: "#0d7060",
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

function SortControls({
  value,
  onChange,
}: {
  value: SortMode;
  onChange: (v: SortMode) => void;
}) {
  const opts: Array<{ k: SortMode; label: string }> = [
    { k: "CAR", label: "CAR ↓" },
    { k: "STREAK", label: "STREAK ↓" },
    { k: "INDEX", label: "INDEX ↑" },
  ];
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
      <span style={{ fontSize: 8, color: "#0d7060", letterSpacing: 2, alignSelf: "center" }}>
        SORT:
      </span>
      {opts.map((o) => {
        const active = value === o.k;
        return (
          <button
            key={o.k}
            onClick={() => onChange(o.k)}
            style={{
              background: active ? "#00ffc4" : "transparent",
              color: active ? "#020c16" : "#00ffc4",
              border: "1px solid #0f4a3a",
              padding: "2px 8px",
              fontSize: 8,
              letterSpacing: 1,
              borderRadius: 2,
              cursor: "pointer",
              fontWeight: active ? 700 : 400,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function updateCombo(
  setSweep: React.Dispatch<React.SetStateAction<SweepDetail | null>>,
  combo: SweepCombo,
  bestIndex?: number,
): void {
  setSweep((prev) => {
    if (!prev) return prev;
    const combos = prev.combos.slice();
    combos[combo.index] = combo;
    return {
      ...prev,
      combos,
      currentIndex:
        combo.status === "running"
          ? combo.index
          : Math.max(prev.currentIndex, combo.index),
      bestIndex: bestIndex ?? prev.bestIndex,
    };
  });
}

function ComboTable({
  combos,
  bestIndex,
  sortMode,
}: {
  combos: SweepCombo[];
  bestIndex: number;
  sortMode: SortMode;
}) {
  // Stable sort: copy then sort by the active key, with tie-breakers that
  // keep the table well-ordered when many combos haven't reported yet.
  const ordered = useMemo(() => {
    const arr = combos.slice();
    if (sortMode === "INDEX") {
      arr.sort((a, b) => a.index - b.index);
    } else if (sortMode === "STREAK") {
      arr.sort(
        (a, b) =>
          b.gateStreak - a.gateStreak ||
          b.bestCAR - a.bestCAR ||
          b.finalPhi - a.finalPhi ||
          a.index - b.index,
      );
    } else {
      arr.sort(
        (a, b) =>
          b.bestCAR - a.bestCAR ||
          b.gateStreak - a.gateStreak ||
          b.finalPhi - a.finalPhi ||
          a.index - b.index,
      );
    }
    return arr;
  }, [combos, sortMode]);

  return (
    <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
      <table style={{ width: "100%", fontSize: 8, color: "#0d7060", borderCollapse: "collapse" }}>
        <thead style={{ position: "sticky", top: 0, background: "#020c16" }}>
          <tr style={{ borderBottom: "1px solid #0a2828", color: "#00ffc4", letterSpacing: 1 }}>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>#</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>PARAMS</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>Φ</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>S_C</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>PU</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>CAR</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>STREAK</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((c) => {
            const isBest = c.index === bestIndex && c.gateStreak > 0;
            return (
              <tr
                key={c.index}
                style={{
                  borderBottom: "1px solid #0a2828",
                  color: isBest ? "#00ffc4" : "#0d7060",
                  background: isBest ? "rgba(0,255,196,0.05)" : undefined,
                }}
              >
                <td style={{ padding: "3px 6px" }}>
                  {isBest ? "★" : ""}
                  {c.index}
                </td>
                <td style={{ padding: "3px 6px", fontFamily: "monospace" }}>
                  {paramSummary(c.params)}
                </td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>{fmt(c.finalPhi)}</td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>{fmt(c.finalSC)}</td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>{fmt(c.finalPU)}</td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>{fmt(c.bestCAR)}</td>
                <td style={{ padding: "3px 6px", textAlign: "right" }}>{c.gateStreak}</td>
                <td style={{ padding: "3px 6px" }}>
                  <Pill
                    color={
                      (c as SweepCombo & { earlyExited?: boolean }).earlyExited
                        ? "#556560"
                        : c.status === "completed"
                          ? c.gateOpened
                            ? "#00ffc4"
                            : "#ff4477"
                          : c.status === "running"
                            ? "#ffb040"
                            : "#0f4a3a"
                    }
                  >
                    {(c as SweepCombo & { earlyExited?: boolean }).earlyExited
                      ? "early-exit"
                      : c.status}
                  </Pill>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
