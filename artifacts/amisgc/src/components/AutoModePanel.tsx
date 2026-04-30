import { useEffect, useMemo, useState } from "react";
import { Panel } from "./Panel";
import {
  autoModeApi,
  subscribeAutoMode,
  type AutoModeDetail,
  type AutoModeIterationSummary,
  type CreateAutoModeRequest,
} from "../lib/api";

interface AutoModePanelProps {
  open: boolean;
  onClose: () => void;
}

const fmt = (v: number | null | undefined, p = 3): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 100) return v.toFixed(1);
  if (Math.abs(v) >= 10) return v.toFixed(2);
  return v.toFixed(p);
};

const ts = (n: number | null): string =>
  n ? new Date(n).toISOString().slice(11, 19) : "—";

// Default ranges shown to the user. Must mirror the server's
// PHASE0_DEFAULT_RANGES (v13 final spec — 720-combo grid). Auto-Mode iter 1
// sweeps these, then refines around the best combo each subsequent iteration.
const DEFAULT_RANGES: Record<string, number[]> = {
  TAU_ATT: [0.7, 1.0, 1.5, 2.0, 3.0],
  GAMMA_GLOBAL: [1.0, 1.5, 2.0, 3.0],
  BETA_ENTROPY: [0.1, 0.3, 0.5, 0.8],
  DELTA_TEMPORAL: [0.2, 0.4, 0.6],
  NOISE_SIGMA: [0.01, 0.02, 0.05],
};

const DEFAULT_TICKS = 30000;
const DEFAULT_MAX_ITER = 4;
const DEFAULT_GATE_STREAK = 1000;

function rangesToText(r: Record<string, number[]>): string {
  return Object.entries(r)
    .map(([k, vs]) => `${k}: ${vs.join(", ")}`)
    .join("\n");
}

function textToRanges(t: string): {
  ranges: Record<string, number[]>;
  error: string | null;
} {
  const out: Record<string, number[]> = {};
  for (const lineRaw of t.split("\n")) {
    const line = lineRaw.trim();
    if (!line) continue;
    const m = /^([A-Z_]+)\s*[:=]\s*(.+)$/.exec(line);
    if (!m)
      return { ranges: {}, error: `cannot parse line: "${line}"` };
    const key = m[1];
    const vs = m[2]
      .split(/[,\s]+/)
      .filter((s) => s.length > 0)
      .map((s) => Number(s));
    if (vs.some((v) => !Number.isFinite(v)))
      return { ranges: {}, error: `non-numeric value on ${key}` };
    if (vs.length === 0)
      return { ranges: {}, error: `${key} has no values` };
    out[key] = vs;
  }
  return { ranges: out, error: null };
}

function totalCombos(r: Record<string, number[]>): number {
  return Object.values(r).reduce((a, b) => a * b.length, 1);
}

export function AutoModePanel({ open, onClose }: AutoModePanelProps) {
  const [detail, setDetail] = useState<AutoModeDetail | null>(null);
  const [past, setPast] = useState<AutoModeDetail[]>([]);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Launch-form controls
  const [scale, setScale] = useState<81 | 810 | 81000>(81);
  const [neuronsStr, setNeuronsStr] = useState<string>("");
  const [topKStr, setTopKStr] = useState<string>("");
  const [ticks, setTicks] = useState<number>(DEFAULT_TICKS);
  const [maxIter, setMaxIter] = useState<number>(DEFAULT_MAX_ITER);
  const [gateStreak, setGateStreak] = useState<number>(DEFAULT_GATE_STREAK);
  const [rangesText, setRangesText] = useState<string>(rangesToText(DEFAULT_RANGES));

  const parsedRanges = useMemo(() => textToRanges(rangesText), [rangesText]);
  const comboCount = parsedRanges.error ? 0 : totalCombos(parsedRanges.ranges);

  // Refresh past automodes when panel opens or current run finishes.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const refresh = () =>
      autoModeApi
        .list()
        .then((r) => {
          if (alive) setPast(r.automodes);
        })
        .catch(() => undefined);
    refresh();
    const live = detail?.status === "running" || detail?.status === "pending";
    if (!live) return;
    const t = setInterval(refresh, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open, detail?.status]);

  // Stream live updates for the current automode.
  useEffect(() => {
    if (!open || !detail?.id) return;
    if (detail.status !== "running" && detail.status !== "pending") return;
    const unsub = subscribeAutoMode(detail.id, {
      onSnapshot: (a) => setDetail(a),
      onAutoModeStart: (a) => setDetail(a),
      onIterationStart: () => {
        autoModeApi.get(detail.id).then(setDetail).catch(() => undefined);
      },
      onComboComplete: () => {
        autoModeApi.get(detail.id).then(setDetail).catch(() => undefined);
      },
      onIterationComplete: () => {
        autoModeApi.get(detail.id).then(setDetail).catch(() => undefined);
      },
      onAutoModeComplete: (a) => setDetail(a),
      onError: (m) => setError(m),
    });
    return unsub;
  }, [open, detail?.id, detail?.status]);

  const start = async () => {
    if (parsedRanges.error) {
      setError(parsedRanges.error);
      return;
    }
    setLaunching(true);
    setError(null);
    try {
      const neuronsNum = neuronsStr.trim() === "" ? undefined : Number(neuronsStr);
      const topKNum = topKStr.trim() === "" ? undefined : Number(topKStr);
      const body: CreateAutoModeRequest = {
        scale,
        ticksPerCombo: ticks,
        maxIterations: maxIter,
        gateStreakTarget: gateStreak,
        baseRanges: parsedRanges.ranges,
      };
      if (typeof neuronsNum === "number" && Number.isFinite(neuronsNum))
        body.neurons = neuronsNum;
      if (typeof topKNum === "number" && Number.isFinite(topKNum))
        body.topK = topKNum;
      const { id } = await autoModeApi.create(body);
      const d = await autoModeApi.get(id);
      setDetail(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLaunching(false);
    }
  };

  const cancel = async () => {
    if (!detail) return;
    try {
      await autoModeApi.cancel(detail.id);
    } catch {
      /* ignore */
    }
  };

  const reset = () => {
    setDetail(null);
    setError(null);
  };

  const loadPast = async (id: string) => {
    setError(null);
    try {
      setDetail(await autoModeApi.get(id));
    } catch (e) {
      setError((e as Error).message);
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
          maxWidth: 1100,
          width: "100%",
          maxHeight: "92vh",
          overflow: "auto",
          padding: 16,
          borderRadius: 4,
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <span
            style={{
              fontSize: 12,
              color: "#aa88ff",
              letterSpacing: 3,
              fontWeight: 700,
            }}
          >
            ◈ AUTO MODE · self-driving Existence-Gate hunt
          </span>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid #4a3a6a",
              color: "#aa88ff",
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: 2,
            }}
          >
            ✕
          </button>
        </div>

        {!detail ? (
          <Panel title="LAUNCH AUTO MODE" accent="#aa88ff">
            <div
              style={{
                fontSize: 9,
                color: "#6a5a8a",
                marginBottom: 10,
                lineHeight: 1.6,
              }}
            >
              Auto Mode runs successive parameter sweeps that refine around the
              best combo each iteration. It stops when the Existence Gate is
              held for ≥ {DEFAULT_GATE_STREAK} ticks (v13 spec) or the iteration
              budget is exhausted. Each iteration is a normal sweep — its
              combos persist alongside hand-launched sweeps.
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr 1fr",
                gap: 10,
                marginBottom: 10,
                padding: 8,
                background: "rgba(0,0,0,0.3)",
                border: "1px solid #4a3a6a",
                borderRadius: 2,
              }}
            >
              <AField label="SCALE">
                <select
                  value={scale}
                  onChange={(e) =>
                    setScale(Number(e.target.value) as 81 | 810 | 81000)
                  }
                  style={selectStyle}
                >
                  <option value={81}>81 (G=9)</option>
                  <option value={810}>810 (G=29)</option>
                  <option value={81000}>81 000 (G=285)</option>
                </select>
              </AField>
              <AField label="NEURONS (override)">
                <input
                  type="number"
                  min={9}
                  max={102400}
                  step={1}
                  value={neuronsStr}
                  onChange={(e) => setNeuronsStr(e.target.value)}
                  placeholder="auto"
                  style={inputStyle}
                />
              </AField>
              <AField label="TOP_K (override)">
                <input
                  type="number"
                  min={1}
                  max={102400}
                  step={1}
                  value={topKStr}
                  onChange={(e) => setTopKStr(e.target.value)}
                  placeholder="auto"
                  style={inputStyle}
                />
              </AField>
              <AField label="TICKS PER COMBO">
                <input
                  type="number"
                  min={500}
                  max={50000}
                  step={500}
                  value={ticks}
                  onChange={(e) =>
                    setTicks(
                      Math.max(500, Math.min(50000, Number(e.target.value) || 0)),
                    )
                  }
                  style={inputStyle}
                />
              </AField>
              <AField label="MAX ITERATIONS">
                <input
                  type="number"
                  min={1}
                  max={10}
                  step={1}
                  value={maxIter}
                  onChange={(e) =>
                    setMaxIter(
                      Math.max(1, Math.min(10, Number(e.target.value) || 1)),
                    )
                  }
                  style={inputStyle}
                />
              </AField>
              <AField label="GATE-STREAK TARGET">
                <input
                  type="number"
                  min={1}
                  max={50000}
                  step={100}
                  value={gateStreak}
                  onChange={(e) =>
                    setGateStreak(
                      Math.max(1, Math.min(50000, Number(e.target.value) || 1)),
                    )
                  }
                  style={inputStyle}
                />
                <div style={{ fontSize: 8, color: "#4a3a6a", marginTop: 2 }}>
                  v13 default = 1000
                </div>
              </AField>
            </div>

            <AField label="ITERATION 1 BASE RANGES (KEY: v1, v2, …)">
              <textarea
                value={rangesText}
                onChange={(e) => setRangesText(e.target.value)}
                rows={6}
                style={{
                  ...inputStyle,
                  width: "100%",
                  fontFamily: "var(--font-mono)",
                  resize: "vertical",
                  minHeight: 110,
                }}
              />
              <div
                style={{
                  fontSize: 8,
                  color: parsedRanges.error ? "#ff4477" : "#4a3a6a",
                  marginTop: 2,
                }}
              >
                {parsedRanges.error
                  ? parsedRanges.error
                  : `${comboCount} combos × ${ticks} ticks per iteration`}
              </div>
            </AField>

            <button
              onClick={start}
              disabled={launching || !!parsedRanges.error}
              style={{
                background: "#aa88ff",
                color: "#020c16",
                border: "1px solid #aa88ff",
                padding: "6px 14px",
                fontSize: 10,
                letterSpacing: 2,
                borderRadius: 2,
                fontWeight: 700,
                opacity: launching || parsedRanges.error ? 0.5 : 1,
                cursor: launching ? "wait" : "pointer",
                marginTop: 10,
              }}
            >
              {launching
                ? "STARTING…"
                : `▶ START AUTO MODE (≤ ${maxIter} iter)`}
            </button>

            {error && (
              <div style={{ marginTop: 8, color: "#ff4477", fontSize: 9 }}>
                {error}
              </div>
            )}

            {past.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div
                  style={{
                    fontSize: 9,
                    color: "#aa88ff",
                    letterSpacing: 2,
                    marginBottom: 6,
                  }}
                >
                  PAST AUTO MODE RUNS
                </div>
                <div style={{ display: "grid", gap: 4 }}>
                  {past.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => loadPast(a.id)}
                      style={{
                        textAlign: "left",
                        background: "rgba(0,0,0,0.4)",
                        border: "1px solid #4a3a6a",
                        color: "#aa88ff",
                        padding: "4px 8px",
                        fontSize: 9,
                        borderRadius: 2,
                      }}
                    >
                      <span style={{ color: "#aa88ff" }}>{a.id}</span>{" "}
                      <span style={{ color: "#6a5a8a" }}>
                        · {ts(a.createdAt)} · {a.iterations.length}/
                        {a.maxIterations} iter ·{" "}
                      </span>
                      <span
                        style={{
                          color: a.passed ? "#00ffc4" : "#ff4477",
                          fontWeight: 700,
                        }}
                      >
                        {a.status.toUpperCase()}
                        {a.passed ? " · GATE HELD" : ""}
                      </span>
                      {a.bestParams && (
                        <span style={{ color: "#6a5a8a" }}>
                          {" · streak "}
                          <span style={{ color: "#ffd060" }}>
                            {a.bestGateStreak}
                          </span>
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        ) : (
          <ActiveAutoMode
            detail={detail}
            onCancel={cancel}
            onReset={reset}
            error={error}
          />
        )}
      </div>
    </div>
  );
}

function ActiveAutoMode({
  detail,
  onCancel,
  onReset,
  error,
}: {
  detail: AutoModeDetail;
  onCancel: () => void;
  onReset: () => void;
  error: string | null;
}) {
  const live = detail.status === "running" || detail.status === "pending";
  return (
    <div>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div style={{ fontSize: 9, color: "#6a5a8a", letterSpacing: 1 }}>
          <span style={{ color: "#aa88ff" }}>{detail.id}</span> · ITER{" "}
          {detail.currentIteration} / {detail.maxIterations} · SCALE{" "}
          {detail.scale}
          {detail.neurons ? (
            <>
              {" "}· NEURONS{" "}
              <span style={{ color: "#aa88ff" }}>{detail.neurons}</span>
            </>
          ) : null}
          {detail.topK ? (
            <>
              {" "}· TOP_K{" "}
              <span style={{ color: "#aa88ff" }}>{detail.topK}</span>
            </>
          ) : null}{" "}
          · TICKS{" "}
          <span style={{ color: "#aa88ff" }}>{detail.ticksPerCombo}</span> ·
          STREAK TARGET{" "}
          <span style={{ color: "#aa88ff" }}>{detail.gateStreakTarget}</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            style={{
              fontSize: 9,
              color: detail.passed ? "#00ffc4" : live ? "#ffb040" : "#ff4477",
              fontWeight: 700,
              letterSpacing: 2,
            }}
          >
            {detail.passed
              ? "GATE HELD ✓"
              : detail.status.toUpperCase()}
          </span>
          {live && (
            <button
              onClick={onCancel}
              style={{
                background: "transparent",
                border: "1px solid #ff4477",
                color: "#ff4477",
                fontSize: 9,
                padding: "3px 8px",
                borderRadius: 2,
                letterSpacing: 1,
              }}
            >
              ◈ CANCEL
            </button>
          )}
          <button
            onClick={onReset}
            style={{
              background: "transparent",
              border: "1px solid #4a3a6a",
              color: "#aa88ff",
              fontSize: 9,
              padding: "3px 8px",
              borderRadius: 2,
              letterSpacing: 1,
            }}
          >
            ◀ NEW
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: "#ff4477", fontSize: 9, marginBottom: 6 }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        {detail.iterations.map((it) => (
          <IterationCard key={it.index} iter={it} />
        ))}
        {detail.iterations.length === 0 && (
          <div style={{ fontSize: 9, color: "#6a5a8a" }}>
            waiting for first iteration…
          </div>
        )}
      </div>

      {detail.bestParams && (
        <div
          style={{
            marginTop: 12,
            padding: 8,
            background: "rgba(170, 136, 255, 0.08)",
            border: "1px solid #aa88ff",
            borderRadius: 2,
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: "#aa88ff",
              letterSpacing: 2,
              marginBottom: 4,
            }}
          >
            BEST COMBO SO FAR
          </div>
          <div
            style={{
              fontSize: 9,
              color: "#c5dfd4",
              fontFamily: "var(--font-mono)",
              lineHeight: 1.5,
            }}
          >
            {Object.entries(detail.bestParams)
              .map(([k, v]) =>
                typeof v === "number" ? `${k}=${fmt(v)}` : `${k}=${v}`,
              )
              .join("  ")}
          </div>
          <div style={{ fontSize: 9, color: "#6a5a8a", marginTop: 4 }}>
            gate streak{" "}
            <span style={{ color: "#ffd060" }}>{detail.bestGateStreak}</span>
            {detail.bestSweepId && (
              <>
                {" "}· sweep{" "}
                <span style={{ color: "#ffd060" }}>{detail.bestSweepId}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IterationCard({ iter }: { iter: AutoModeIterationSummary }) {
  const passed = iter.passedTarget;
  const accent = passed
    ? "#00ffc4"
    : iter.status === "running"
      ? "#ffb040"
      : iter.status === "completed"
        ? "#aa88ff"
        : "#4a3a6a";
  return (
    <div
      style={{
        padding: 8,
        background: "rgba(0,0,0,0.3)",
        border: `1px solid ${accent}`,
        borderRadius: 2,
      }}
    >
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <div style={{ fontSize: 10, color: accent, letterSpacing: 2 }}>
          ITER #{iter.index} · {iter.status.toUpperCase()}
          {passed ? " · GATE ✓" : ""}
        </div>
        <div style={{ fontSize: 8, color: "#6a5a8a" }}>
          sweep {iter.sweepId} · {ts(iter.startedAt)} →{" "}
          {ts(iter.completedAt)}
        </div>
      </div>
      <div
        style={{
          fontSize: 9,
          color: "#6a5a8a",
          fontFamily: "var(--font-mono)",
          lineHeight: 1.5,
        }}
      >
        {Object.entries(iter.ranges)
          .map(([k, vs]) => `${k}: [${vs.map((v) => fmt(v)).join(", ")}]`)
          .join("  ·  ")}
      </div>
      {iter.bestParams && (
        <div
          style={{
            marginTop: 4,
            fontSize: 9,
            color: "#c5dfd4",
            fontFamily: "var(--font-mono)",
          }}
        >
          BEST{" "}
          {Object.entries(iter.bestParams)
            .map(([k, v]) =>
              typeof v === "number" ? `${k}=${fmt(v)}` : `${k}=${v}`,
            )
            .join(" ")}{" "}
          · Φ={fmt(iter.bestPhi)} SC={fmt(iter.bestSC)} PU={fmt(iter.bestPU)}{" "}
          CAR={fmt(iter.bestCAR)} streak=
          <span
            style={{ color: passed ? "#00ffc4" : "#ffd060", fontWeight: 700 }}
          >
            {iter.bestGateStreak}
          </span>
        </div>
      )}
    </div>
  );
}

function AField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block" }}>
      <div
        style={{
          fontSize: 7,
          color: "#aa88ff",
          letterSpacing: 2,
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#020c16",
  color: "#c5dfd4",
  border: "1px solid #4a3a6a",
  fontSize: 10,
  padding: "3px 6px",
  width: "100%",
  fontFamily: "var(--font-mono)",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
};
