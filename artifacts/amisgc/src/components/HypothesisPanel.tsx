import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hypothesisApi, autoModeApi, type Hypothesis } from "../lib/api";
import { Panel } from "./Panel";

interface HypothesisPanelProps {
  open: boolean;
  onClose: () => void;
  onStarted?: (id: string) => void;
}

const STATUS_BADGE: Record<
  Hypothesis["status"],
  { label: string; color: string }
> = {
  testable: { label: "TESTABLE NOW", color: "#3aaf6a" },
  partial: { label: "PROXY SWEEP", color: "#c2a040" },
  pending: { label: "PENDING UPGRADE", color: "#556560" },
};

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(2,12,22,0.92)",
  zIndex: 200,
  overflowY: "auto",
  padding: "16px 8px",
};

const sheetStyle: React.CSSProperties = {
  maxWidth: 900,
  margin: "0 auto",
  background: "#020c16",
  border: "1px solid #0f4a3a",
  borderRadius: 4,
};

export function HypothesisPanel({ open, onClose, onStarted }: HypothesisPanelProps) {
  const queryClient = useQueryClient();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const hypothesesQuery = useQuery({
    queryKey: ["hypotheses"],
    queryFn: () => hypothesisApi.list(),
    staleTime: 300_000,
    enabled: open,
  });

  const startMutation = useMutation({
    mutationFn: ({
      config,
    }: {
      hypothesisId: string;
      config: Hypothesis["sweepConfig"];
    }) => autoModeApi.create(config!),
    onSuccess: (data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["automodes"] });
      setRunningId(vars.hypothesisId);
      onStarted?.(data.id);
    },
    onError: (err, vars) => {
      setErrors((prev) => ({
        ...prev,
        [vars.hypothesisId]: (err as Error).message ?? "Unknown error",
      }));
    },
  });

  if (!open) return null;

  const hypotheses = hypothesesQuery.data?.hypotheses ?? [];

  return (
    <div style={backdropStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={sheetStyle}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 16px",
            borderBottom: "1px solid #0f4a3a",
          }}
        >
          <div>
            <div style={{ fontSize: 10, color: "#00ffc4", letterSpacing: 3 }}>
              HYPOTHESIS TESTING · EMERGENT SPECIALISATION
            </div>
            <div style={{ fontSize: 8, color: "#5a7a70", marginTop: 3, lineHeight: 1.5 }}>
              Core question: How can a general-purpose system emergently specialise for complex tasks without pre-programmed modules?
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid #0f4a3a",
              color: "#00ffc4",
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: 2,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Legend */}
        <div
          style={{
            display: "flex",
            gap: 12,
            padding: "8px 16px",
            borderBottom: "1px solid #0a1a14",
            flexWrap: "wrap",
          }}
        >
          {Object.entries(STATUS_BADGE).map(([status, b]) => (
            <div key={status} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  fontSize: 7,
                  padding: "2px 6px",
                  border: `1px solid ${b.color}`,
                  color: b.color,
                  borderRadius: 2,
                  letterSpacing: 1,
                }}
              >
                {b.label}
              </span>
            </div>
          ))}
          <div style={{ fontSize: 8, color: "#5a7a70", marginLeft: "auto" }}>
            Efficiency tools are only used to scale or speed up experiments — not as an end goal.
          </div>
        </div>

        {/* Loading / error states */}
        {hypothesesQuery.isLoading && (
          <div style={{ padding: 20, fontSize: 10, color: "#5a7a70" }}>
            Loading hypotheses…
          </div>
        )}
        {hypothesesQuery.isError && (
          <div style={{ padding: 20, fontSize: 10, color: "#f08a8a" }}>
            Could not load hypotheses. Is the API server running?
          </div>
        )}

        {/* Hypothesis cards */}
        <div style={{ padding: "12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          {hypotheses.map((h) => {
            const badge = STATUS_BADGE[h.status];
            const canRun = (h.status === "testable" || h.status === "partial") && !!h.sweepConfig;
            const isRunning = startMutation.isPending && startMutation.variables?.hypothesisId === h.id;
            const justStarted = runningId === h.id && !isRunning;
            const err = errors[h.id];

            return (
              <div
                key={h.id}
                style={{
                  border: `1px solid ${h.status === "testable" ? "#0f4a3a" : h.status === "partial" ? "#2a3a20" : "#1a2a20"}`,
                  borderRadius: 3,
                  padding: "10px 12px",
                  background: h.status === "pending" ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.35)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 8, color: "#3aaf6a", letterSpacing: 1 }}>
                        H{h.index}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: h.status === "pending" ? "#5a7a70" : "#c5dfd4",
                          fontWeight: 600,
                        }}
                      >
                        {h.title}
                      </span>
                    </div>
                    <div style={{ fontSize: 9, color: "#7a9a90", fontStyle: "italic", lineHeight: 1.45 }}>
                      {h.question}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 7,
                      padding: "2px 7px",
                      border: `1px solid ${badge.color}`,
                      color: badge.color,
                      letterSpacing: 1,
                      borderRadius: 2,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {badge.label}
                  </span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 7, color: "#3aaf6a", letterSpacing: 1, marginBottom: 2 }}>
                      HOW TO TEST
                    </div>
                    <div style={{ fontSize: 8, color: "#7a9a90", lineHeight: 1.45 }}>
                      {h.testMethod}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 7, color: "#3aaf6a", letterSpacing: 1, marginBottom: 2 }}>
                      SUCCESS CRITERIA
                    </div>
                    <div style={{ fontSize: 8, color: "#7a9a90", lineHeight: 1.45 }}>
                      {h.successCriteria}
                    </div>
                    <div style={{ fontSize: 7, color: "#2a5a45", letterSpacing: 1, marginTop: 5 }}>
                      EFFICIENCY TOOL
                    </div>
                    <div style={{ fontSize: 8, color: "#4a7060", lineHeight: 1.4, fontStyle: "italic" }}>
                      {h.efficiencyTool}
                    </div>
                  </div>
                </div>

                {h.pendingReason && (
                  <div
                    style={{
                      fontSize: 8,
                      color: "#5a7a60",
                      lineHeight: 1.45,
                      padding: "4px 7px",
                      background: "rgba(0,0,0,0.25)",
                      border: "1px solid #1a3a25",
                      borderRadius: 2,
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ color: "#c2a040", fontWeight: 700 }}>NOTE: </span>
                    {h.pendingReason}
                  </div>
                )}

                {justStarted && (
                  <div
                    style={{
                      fontSize: 8,
                      color: "#3aaf6a",
                      padding: "4px 7px",
                      border: "1px solid #3aaf6a",
                      borderRadius: 2,
                      marginBottom: 6,
                    }}
                  >
                    Experiment started — switch to Lab Home to watch the scoreboard.
                  </div>
                )}

                {err && (
                  <div style={{ fontSize: 8, color: "#ff4477", marginBottom: 6 }}>
                    Error: {err}
                  </div>
                )}

                {canRun && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      disabled={startMutation.isPending}
                      onClick={() =>
                        startMutation.mutate({
                          hypothesisId: h.id,
                          config: h.sweepConfig,
                        })
                      }
                      style={{
                        padding: "5px 12px",
                        fontSize: 9,
                        letterSpacing: 1.5,
                        background:
                          h.status === "testable"
                            ? "rgba(20,80,40,0.45)"
                            : "rgba(40,40,10,0.45)",
                        border: `1px solid ${h.status === "testable" ? "#3aaf6a" : "#c2a040"}`,
                        color: h.status === "testable" ? "#9bf0c0" : "#d4b060",
                        borderRadius: 2,
                        cursor: startMutation.isPending ? "wait" : "pointer",
                        fontWeight: 600,
                      }}
                    >
                      {isRunning
                        ? "STARTING…"
                        : h.status === "testable"
                          ? `▶ RUN HYPOTHESIS ${h.index}`
                          : `▶ RUN PROXY SWEEP`}
                    </button>
                    {h.sweepConfig && (
                      <div style={{ fontSize: 7, color: "#3a5a50" }}>
                        {Object.values(h.sweepConfig.baseRanges).reduce(
                          (acc, v) => acc * v.length,
                          1,
                        )}{" "}
                        combos · {(h.sweepConfig.ticksPerCombo / 1000).toFixed(0)}K ticks ·
                        N={h.sweepConfig.scale}
                      </div>
                    )}
                  </div>
                )}

                {!canRun && h.status === "pending" && (
                  <div
                    style={{
                      fontSize: 8,
                      color: "#3a5a50",
                      padding: "4px 8px",
                      border: "1px solid #1a3a25",
                      borderRadius: 2,
                      display: "inline-block",
                    }}
                  >
                    Awaiting structural upgrade
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "8px 16px",
            borderTop: "1px solid #0a1a14",
            fontSize: 7,
            color: "#3a5a50",
            lineHeight: 1.5,
          }}
        >
          Efficiency features (sparse coupling, quantized weights, GPU code generation) are tools to enable larger experiments — not research goals. The science is emergent specialisation.
        </div>
      </div>
    </div>
  );
}
