import type { AutoModeDetail } from "../lib/api";
import { Panel, Pill } from "./Panel";

interface StatusScoreboardProps {
  automode: AutoModeDetail | null;
  onCancel?: (id: string) => void;
  onOpenDetails?: (id: string) => void;
}

const GATE_COLORS: Record<string, { fg: string; bg: string; border: string }> = {
  green: { fg: "#9bf0c0", bg: "rgba(20,80,40,0.35)", border: "#3aaf6a" },
  yellow: { fg: "#f4dc80", bg: "rgba(80,60,10,0.35)", border: "#c2a040" },
  red: { fg: "#f08a8a", bg: "rgba(80,20,20,0.35)", border: "#bb4040" },
  grey: { fg: "#9aa8a4", bg: "rgba(40,40,40,0.35)", border: "#556560" },
};

function formatElapsed(start: number, end: number | null): string {
  const ms = (end ?? Date.now()) - start;
  if (ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function StatusScoreboard({
  automode,
  onCancel,
  onOpenDetails,
}: StatusScoreboardProps) {
  if (!automode) {
    return (
      <Panel title="LAB STATUS" accent="#0f4a3a">
        <div style={{ fontSize: 10, color: "#5a7a70", padding: "12px 4px" }}>
          No experiment running. Pick a preset above to start one.
        </div>
      </Panel>
    );
  }

  const gate = automode.gate ?? {
    color: "grey" as const,
    label: "—",
    headline: "Status unavailable.",
  };
  const colors = GATE_COLORS[gate.color] ?? GATE_COLORS.grey;
  const isRunning =
    automode.status === "running" || automode.status === "pending";

  return (
    <Panel
      title="LAB STATUS · CURRENT EXPERIMENT"
      accent={colors.border}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: colors.bg,
            border: `3px solid ${colors.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: colors.fg,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
            flexShrink: 0,
          }}
        >
          {gate.label}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              color: colors.fg,
              lineHeight: 1.3,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            {gate.headline}
          </div>
          <div
            style={{
              fontSize: 9,
              color: "#7a9a90",
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span>Status: {automode.status}</span>
            <span>·</span>
            <span>
              Elapsed {formatElapsed(automode.createdAt, automode.completedAt)}
            </span>
            <span>·</span>
            <span>
              Iteration {automode.currentIteration} / {automode.maxIterations}
            </span>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <Stat
          label="Best gate streak"
          value={`${automode.bestGateStreak} / ${automode.gateStreakTarget}`}
        />
        <Stat
          label="Best CAR"
          value={
            typeof automode.bestCAR === "number"
              ? automode.bestCAR.toFixed(3)
              : "—"
          }
        />
        <Stat
          label="Iterations done"
          value={String(
            automode.iterations.filter(
              (it) => it.status === "completed" || it.status === "cancelled",
            ).length,
          )}
        />
      </div>

      {automode.failureReason && automode.failureReason.code !== "OK" && (
        <div
          style={{
            background: "rgba(0,0,0,0.3)",
            border: "1px solid #1a3a30",
            borderRadius: 2,
            padding: 8,
            marginBottom: 8,
          }}
        >
          <div
            style={{
              fontSize: 7,
              color: "#1a3a30",
              letterSpacing: 1.5,
              marginBottom: 3,
            }}
          >
            WHY
          </div>
          <div style={{ fontSize: 10, color: "#9aaaa6", lineHeight: 1.4 }}>
            {automode.failureReason.plain}
          </div>
        </div>
      )}

      {automode.nextStep && (
        <div
          style={{
            background: "rgba(15,74,58,0.15)",
            border: "1px solid #0f4a3a",
            borderRadius: 2,
            padding: 8,
            marginBottom: 8,
          }}
        >
          <div
            style={{
              fontSize: 7,
              color: "#3aaf6a",
              letterSpacing: 1.5,
              marginBottom: 3,
            }}
          >
            NEXT STEP
          </div>
          <div style={{ fontSize: 10, color: "#c5dfd4", lineHeight: 1.4 }}>
            {automode.nextStep.plain}
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          marginTop: 8,
        }}
      >
        {isRunning && onCancel && (
          <button
            type="button"
            onClick={() => onCancel(automode.id)}
            style={{
              padding: "4px 10px",
              fontSize: 9,
              letterSpacing: 1.5,
              background: "rgba(80,20,20,0.35)",
              border: "1px solid #bb4040",
              color: "#f08a8a",
              borderRadius: 2,
              cursor: "pointer",
            }}
          >
            CANCEL
          </button>
        )}
        {onOpenDetails && (
          <button
            type="button"
            onClick={() => onOpenDetails(automode.id)}
            style={{
              padding: "4px 10px",
              fontSize: 9,
              letterSpacing: 1.5,
              background: "transparent",
              border: "1px solid #0f4a3a",
              color: "#3aaf6a",
              borderRadius: 2,
              cursor: "pointer",
            }}
          >
            OPEN DETAILS
          </button>
        )}
        <Pill color={colors.border}>{gate.label}</Pill>
      </div>
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "rgba(0,0,0,0.25)",
        border: "1px solid #0a2828",
        borderRadius: 2,
        padding: "5px 7px",
      }}
    >
      <div
        style={{
          fontSize: 6,
          color: "#1a3a30",
          letterSpacing: 1.5,
          marginBottom: 2,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "#c5dfd4",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}
