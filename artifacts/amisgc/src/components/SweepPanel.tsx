import { useEffect, useMemo, useState } from "react";
import { Panel, Pill } from "./Panel";
import {
  sweepApi,
  subscribeSweep,
  type SweepDetail,
  type SweepCombo,
} from "../lib/api";

interface SweepPanelProps {
  open: boolean;
  onClose: () => void;
}

const fmt = (v: number, p = 3): string => {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 100) return v.toFixed(1);
  if (Math.abs(v) >= 10) return v.toFixed(2);
  return v.toFixed(p);
};

function paramSummary(p: Record<string, number | boolean | string>): string {
  return Object.entries(p)
    .filter(([k]) => k !== "ATTN_MODE" && k !== "USE_BOTTLENECK")
    .map(([k, v]) => `${k}=${typeof v === "number" ? fmt(v) : String(v)}`)
    .join(" ");
}

export function SweepPanel({ open, onClose }: SweepPanelProps) {
  const [sweep, setSweep] = useState<SweepDetail | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const { id } = await sweepApi.create({ ticksPerCombo: 2500, scale: 81 });
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
          maxWidth: 880,
          width: "100%",
          maxHeight: "90vh",
          overflow: "auto",
          padding: 16,
          borderRadius: 4,
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <span style={{ fontSize: 12, color: "#00ffc4", letterSpacing: 3, fontWeight: 700 }}>
            ⚡ AUTO-SWEEP · soft attractor parameter search
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
          <Panel title="DEFAULT GRID" accent="#00ffc4">
            <div style={{ fontSize: 9, color: "#0d7060", marginBottom: 8, lineHeight: 1.6 }}>
              Cartesian product over τ × γ × β with default δ/σ.<br />
              τ_att ∈ {"{0.4, 0.7, 1.0}"} · γ_global ∈ {"{0.5, 1.0, 1.5}"} · β_entropy ∈ {"{0.1, 0.3}"} = 18 combos × 2500 ticks each.
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
              {launching ? "STARTING…" : "▶ START SWEEP"}
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
                  PROGRESS {Math.min(sweep.currentIndex + 1, sweep.total)} / {sweep.total}
                </span>
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
                ) : null}
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
                  STREAK {best.gateStreak}
                </div>
              </Panel>
            ) : null}

            <Panel title="ALL COMBOS" accent="#0f4a3a">
              <ComboTable combos={sweep.combos} bestIndex={sweep.bestIndex} />
            </Panel>
          </>
        )}
      </div>
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
}: {
  combos: SweepCombo[];
  bestIndex: number;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", fontSize: 8, color: "#0d7060", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #0a2828", color: "#00ffc4", letterSpacing: 1 }}>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>#</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>PARAMS</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>Φ</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>S_C</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>PU</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>STREAK</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {combos.map((c) => {
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
