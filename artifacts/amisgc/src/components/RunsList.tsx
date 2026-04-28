import { memo } from "react";
import { Panel, Pill } from "./Panel";
import { PHCOL } from "../lib/colors";
import type { RunSummary } from "../lib/api";

interface RunsListProps {
  runs: RunSummary[];
  activeRunId: string | null;
  onSelect: (id: string) => void;
  onCancel: (id: string) => void;
}

const STATUS_COLOR: Record<string, string> = {
  pending: "#cc6600",
  running: "#00ffc4",
  completed: "#0d7060",
  cancelled: "#884488",
  error: "#ff4488",
};

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m${sec}s`;
}

export const RunsList = memo(function RunsList({
  runs,
  activeRunId,
  onSelect,
  onCancel,
}: RunsListProps) {
  // Show newest first, capped at 30 so the list never grows unbounded
  const sorted = [...runs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
  return (
    <Panel title="LIVE RUNS" accent="#0f4a3a">
      <div
        style={{
          maxHeight: 240,
          overflowY: "auto",
          paddingRight: 4,
          contain: "layout paint",
        }}
      >
        {sorted.length === 0 && (
          <div style={{ fontSize: 9, color: "#1a3a30", textAlign: "center", padding: 8 }}>
            no runs yet
          </div>
        )}
        {sorted.map((r) => {
          const active = r.id === activeRunId;
          const color = STATUS_COLOR[r.status] ?? "#0f4a3a";
          const elapsed = r.startedAt
            ? fmtTime((r.completedAt ?? Date.now()) - r.startedAt)
            : "—";
          const pct =
            r.ticks > 0 ? Math.min(100, (r.ticksDone / r.ticks) * 100) : 0;
          const phaseColor = r.latestStats
            ? PHCOL[r.latestStats.phaseRegion] ?? "#334455"
            : "#334455";
          return (
            <div
              key={r.id}
              onClick={() => onSelect(r.id)}
              className="fade-in"
              style={{
                marginBottom: 4,
                padding: 5,
                background: active ? "rgba(0,255,196,0.06)" : "rgba(0,0,0,0.3)",
                border: `1px solid ${active ? "#00ffc4" : "#0a2828"}`,
                borderRadius: 2,
                cursor: "pointer",
              }}
            >
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Pill color={color}>{r.status.toUpperCase()}</Pill>
                  <span
                    style={{
                      fontSize: 8,
                      color: "#0d7060",
                      letterSpacing: 1,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: 110,
                    }}
                    title={r.experimentId ?? "ARC"}
                  >
                    {r.experimentId ?? "ARC"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span style={{ fontSize: 7, color: "#1a3a30" }}>N={r.scale}</span>
                  {r.status === "running" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCancel(r.id);
                      }}
                      style={{
                        background: "transparent",
                        border: "1px solid #ff4488",
                        color: "#ff4488",
                        fontSize: 7,
                        padding: "1px 4px",
                        borderRadius: 2,
                      }}
                    >
                      STOP
                    </button>
                  )}
                </div>
              </div>
              <div
                style={{
                  height: 2,
                  background: "#0a2828",
                  borderRadius: 1,
                  overflow: "hidden",
                  marginBottom: 2,
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    background: color,
                    transition: "width 250ms linear",
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span style={{ fontSize: 7, color: "#1a3a30" }}>
                  {r.ticksDone}/{r.ticks} · {elapsed}
                </span>
                {r.latestStats && (
                  <span style={{ fontSize: 7, color: phaseColor, letterSpacing: 1 }}>
                    {r.latestStats.phaseRegion}
                  </span>
                )}
              </div>
              {r.status === "completed" && r.metric && (
                <div style={{ fontSize: 7, color: r.passed ? "#00ffc4" : "#ff4488", marginTop: 1 }}>
                  {r.passed ? "✓" : "✗"} {r.metric} = {(r.measured ?? 0).toFixed(3)}{" "}
                  / {r.target}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
});
