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

// Phase-0 default grid (v13 final spec) — must match the server-side default
// in routes/runs.ts (PHASE0_DEFAULT_RANGES). Grid expanded to "force strong
// global coupling": τ extended to {2.0, 3.0}, β extended to 0.8, δ kept at
// the original [0.2, 0.4, 0.6]. 5 × 4 × 4 × 3 × 3 = 720 combinations.
const PHASE0_GRID = {
  TAU_ATT: [0.7, 1.0, 1.5, 2.0, 3.0],
  GAMMA_GLOBAL: [1.0, 1.5, 2.0, 3.0],
  BETA_ENTROPY: [0.1, 0.3, 0.5, 0.8],
  DELTA_TEMPORAL: [0.2, 0.4, 0.6],
  NOISE_SIGMA: [0.01, 0.02, 0.05],
};
const PHASE0_TOTAL = Object.values(PHASE0_GRID).reduce((a, b) => a * b.length, 1);
// v13 spec: default 30 000 ticks per combo; researcher can manually bump to
// 50 000 if a borderline combo shows a clear upward Φ trend in its final 5k.
const PHASE0_DEFAULT_TICKS = 30000;
const PHASE0_MAX_TICKS = 50000;

type SortMode = "CAR" | "STREAK" | "INDEX";

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
          <Panel title={`AUTO SWEEP · ${PHASE0_TOTAL}-COMBO PHASE 0 GRID`} accent="#00ffc4">
            <div style={{ fontSize: 9, color: "#0d7060", marginBottom: 10, lineHeight: 1.6 }}>
              One-click launch of the full Phase 0 hunt for the Existence Gate
              (Φ&gt;0.05 ∧ PU&gt;0.1 ∧ S_C&gt;0.1 sustained ≥1000 ticks).<br />
              τ_att ∈ {"{0.7, 1.0, 1.5, 2.0, 3.0}"} · γ_global ∈ {"{1.0, 1.5, 2.0, 3.0}"} ·
              β_entropy ∈ {"{0.1, 0.3, 0.5, 0.8}"} · δ_temporal ∈ {"{0.2, 0.4, 0.6}"} ·
              σ_noise ∈ {"{0.01, 0.02, 0.05}"} = <b>{PHASE0_TOTAL} combos</b>.
              <br />
              Combos are live-sorted by CAR (Φ / (1 − H_C/H_max)) so the
              coherence-amplifying leaders surface first.
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
                  500 – 50 000
                </div>
              </FieldLabel>
            </div>

            <button
              onClick={start}
              disabled={launching}
              style={{
                background: "#00ffc4",
                color: "#020c16",
                border: "1px solid #00ffc4",
                padding: "6px 14px",
                fontSize: 10,
                letterSpacing: 2,
                borderRadius: 2,
                fontWeight: 700,
                cursor: launching ? "wait" : "pointer",
              }}
            >
              {launching ? "STARTING…" : `▶ START AUTO SWEEP (${PHASE0_TOTAL} combos)`}
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
                      c.status === "completed"
                        ? c.gateOpened
                          ? "#00ffc4"
                          : "#ff4477"
                        : c.status === "running"
                          ? "#ffb040"
                          : "#0f4a3a"
                    }
                  >
                    {c.status}
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
