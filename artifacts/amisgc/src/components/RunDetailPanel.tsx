import { memo } from "react";
import { Panel, MR, Pill } from "./Panel";
import { Sparkline } from "./Sparkline";
import { PHCOL } from "../lib/colors";
import type { RunDetail } from "../lib/api";

interface RunDetailPanelProps {
  run: RunDetail | null;
  series: Record<string, number[]>;
}

export const RunDetailPanel = memo(function RunDetailPanel({ run, series }: RunDetailPanelProps) {
  if (!run) {
    return (
      <Panel title="RUN DETAIL" accent="#0f4a3a">
        <div style={{ fontSize: 9, color: "#1a3a30", textAlign: "center", padding: 8 }}>
          select a run from the list
        </div>
      </Panel>
    );
  }
  const phaseColor = run.latestStats ? PHCOL[run.latestStats.phaseRegion] ?? "#334455" : "#334455";
  const passed = run.passed;
  return (
    <Panel title={`RUN ${run.id.slice(-6)}`} accent={phaseColor}>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <Pill color={phaseColor}>{run.experimentId ?? "ARC"}</Pill>
        <Pill color="#aa88ff">N={run.scale}</Pill>
        <Pill color="#0d7060">{run.status}</Pill>
        {run.status === "completed" && (
          <Pill color={passed ? "#00ffc4" : "#ff4488"}>
            {passed ? "CONFIRMED" : "REJECTED"}
          </Pill>
        )}
      </div>
      {run.hypothesis && (
        <div
          style={{
            fontSize: 8,
            color: "#0d7060",
            fontStyle: "italic",
            marginBottom: 6,
            lineHeight: 1.4,
          }}
        >
          "{run.hypothesis}"
        </div>
      )}
      <MR label="TICKS" value={`${run.ticksDone}/${run.ticks}`} color="#00ffc4" />
      {run.metric && (
        <MR
          label={run.metric}
          value={(run.measured ?? 0).toFixed(3)}
          color={passed ? "#00ffc4" : "#ff4488"}
          sub={`target ${run.target}`}
        />
      )}
      {run.latestStats && (
        <>
          <div style={{ marginTop: 4 }}>
            <Sparkline
              data={series.J_star ?? []}
              color="#00ffc4"
              h={20}
              w={220}
            />
            <div style={{ fontSize: 6, color: "#1a3a30", marginTop: 1 }}>J* trajectory</div>
          </div>
          <div style={{ marginTop: 4 }}>
            <Sparkline
              data={series.networkPhi ?? []}
              color="#aa88ff"
              h={20}
              w={220}
            />
            <div style={{ fontSize: 6, color: "#1a3a30", marginTop: 1 }}>Φ trajectory</div>
          </div>
        </>
      )}
      {run.arcResult && (
        <div
          style={{
            marginTop: 8,
            padding: 6,
            background: "rgba(255,204,68,0.05)",
            border: "1px solid #ffcc44",
            borderRadius: 2,
          }}
        >
          <div style={{ fontSize: 9, color: "#ffcc44", letterSpacing: 2, marginBottom: 4 }}>
            ARC RESULT
          </div>
          <MR
            label="SOLVE RATE"
            value={`${(run.arcResult.solveRate * 100).toFixed(1)}%`}
            color="#ffcc44"
          />
          <MR
            label="CORRECT"
            value={`${run.arcResult.correct}/${run.arcResult.total}`}
            color="#00ffc4"
          />
          <div style={{ marginTop: 4 }}>
            {run.arcResult.samples.slice(0, 6).map((s) => (
              <div
                key={s.id}
                style={{
                  fontSize: 7,
                  color: s.correct ? "#00ffc4" : "#ff4488",
                  letterSpacing: 1,
                  fontFamily: "var(--font-mono)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {s.correct ? "✓" : "✗"} {s.transformName}: [{s.input.join("")}] → [
                {s.predicted.join("")}] · sim {s.similarity.toFixed(2)}
              </div>
            ))}
          </div>
        </div>
      )}
      {run.error && (
        <div style={{ fontSize: 8, color: "#ff4488", marginTop: 4 }}>
          ERROR: {run.error}
        </div>
      )}
    </Panel>
  );
});
