import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { autoModeApi, api, type AutoModeDetail, type Preset } from "../lib/api";
import { Panel } from "./Panel";
import { StatusScoreboard } from "./StatusScoreboard";

interface LabHomeProps {
  onStarted?: (id: string) => void;
  onOpenAdvanced?: () => void;
  onOpenHypotheses?: () => void;
  watchedAutoMode: AutoModeDetail | null;
  onCancelWatched?: (id: string) => void;
}

const DIFFICULTY_BADGE: Record<
  Preset["difficulty"],
  { label: string; color: string }
> = {
  quick: { label: "QUICK", color: "#3aaf6a" },
  standard: { label: "STANDARD", color: "#c2a040" },
  deep: { label: "DEEP", color: "#bb4040" },
  debug: { label: "DEBUG", color: "#5a8aaa" },
};

export function LabHome({
  onStarted,
  onOpenAdvanced,
  onOpenHypotheses,
  watchedAutoMode,
  onCancelWatched,
}: LabHomeProps) {
  const queryClient = useQueryClient();

  const presetsQuery = useQuery({
    queryKey: ["presets"],
    queryFn: () => autoModeApi.presets(),
    staleTime: 60_000,
  });

  const phaseStatusQuery = useQuery({
    queryKey: ["phase-status"],
    queryFn: () => api.phaseStatus(),
    refetchInterval: 10_000,
  });

  const gateOpen =
    phaseStatusQuery.data?.gateOpened ||
    phaseStatusQuery.data?.manualOverride ||
    false;

  const startMutation = useMutation({
    mutationFn: (preset: Preset) => autoModeApi.create(preset.body),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["automodes"] });
      onStarted?.(data.id);
    },
  });

  const handleStart = useCallback(
    (preset: Preset) => {
      if (startMutation.isPending) return;
      startMutation.mutate(preset);
    },
    [startMutation],
  );

  const presets = presetsQuery.data?.presets ?? [];
  const isAnyRunning =
    !!watchedAutoMode &&
    (watchedAutoMode.status === "running" ||
      watchedAutoMode.status === "pending");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* §1.3 Platform Philosophy — self-operating laboratory intro */}
      <Panel accent="#0f4a3a">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 240 }}>
            <div
              style={{
                fontSize: 9,
                color: "#3aaf6a",
                letterSpacing: 3,
                marginBottom: 6,
              }}
            >
              AMISGC · EMERGENT INTELLIGENCE RESEARCH PLATFORM
            </div>
            {/* Core research question */}
            <div
              style={{
                fontSize: 8,
                color: "#3aaf6a",
                letterSpacing: 1.5,
                marginBottom: 4,
              }}
            >
              CORE QUESTION
            </div>
            <div
              style={{
                fontSize: 13,
                color: "#c5dfd4",
                lineHeight: 1.6,
                maxWidth: 720,
                marginBottom: 6,
              }}
            >
              How can a general-purpose system emergently specialise for complex
              tasks without pre-programmed modules?
            </div>
            <div
              style={{
                fontSize: 9,
                color: "#7a9a90",
                lineHeight: 1.5,
                maxWidth: 680,
                marginBottom: 10,
              }}
            >
              Each neuron follows only local rules — no task-specific code, no
              hand-designed modules. Specialisation emerges from attractors,
              predictive coding, and metabolic constraints, or it doesn&apos;t.
              Efficiency (sparse coupling, quantized weights, GPU code) is used
              only to scale experiments and validate biological plausibility.
            </div>
            {/* §1.3 — 4-step flow */}
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              {[
                { step: "1", label: "Choose a preset or hypothesis" },
                { step: "2", label: "Click Start" },
                { step: "3", label: "Watch the live dashboard" },
                { step: "4", label: "Read the plain-English report" },
              ].map(({ step, label }) => (
                <div
                  key={step}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid #0a2828",
                    borderRadius: 2,
                    padding: "4px 8px",
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: "#0f4a3a",
                      border: "1px solid #3aaf6a",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 8,
                      color: "#3aaf6a",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {step}
                  </span>
                  <span style={{ fontSize: 9, color: "#7a9a90" }}>{label}</span>
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 8,
                color: "#5a7a70",
                lineHeight: 1.5,
              }}
            >
              No manual coding, parameter entry, or metric computation required.
              The lab automates experiment scheduling, execution, evaluation,
              and reporting while enforcing scientific rigour through hard gates
              and ablation validations.
            </div>
            {onOpenHypotheses && (
              <button
                type="button"
                onClick={onOpenHypotheses}
                style={{
                  marginTop: 8,
                  padding: "5px 10px",
                  fontSize: 9,
                  letterSpacing: 1.5,
                  background: "rgba(20,80,40,0.35)",
                  border: "1px solid #3aaf6a",
                  color: "#9bf0c0",
                  borderRadius: 2,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                🧬 OPEN HYPOTHESIS TESTER →
              </button>
            )}
          </div>
          {onOpenAdvanced && (
            <button
              type="button"
              onClick={onOpenAdvanced}
              style={{
                padding: "5px 10px",
                fontSize: 9,
                letterSpacing: 1.5,
                background: "transparent",
                border: "1px solid #0f4a3a",
                color: "#3aaf6a",
                borderRadius: 2,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              ADVANCED DASHBOARD →
            </button>
          )}
        </div>
      </Panel>

      <StatusScoreboard
        automode={watchedAutoMode}
        onCancel={onCancelWatched}
      />

      {/* §7.11 — Preset system */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 10,
        }}
      >
        {presetsQuery.isLoading && (
          <Panel>
            <div style={{ fontSize: 10, color: "#5a7a70", padding: 8 }}>
              Loading presets…
            </div>
          </Panel>
        )}
        {presetsQuery.isError && (
          <Panel accent="#bb4040">
            <div style={{ fontSize: 10, color: "#f08a8a", padding: 8 }}>
              Could not load presets. Is the API server running?
            </div>
          </Panel>
        )}
        {presets.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            disabled={isAnyRunning || startMutation.isPending}
            gateOpen={gateOpen}
            onStart={handleStart}
            isStarting={
              startMutation.isPending &&
              startMutation.variables?.id === preset.id
            }
          />
        ))}
      </div>

      {startMutation.isError && (
        <Panel accent="#bb4040">
          <div style={{ fontSize: 10, color: "#f08a8a", padding: 4 }}>
            Failed to start experiment:{" "}
            {(startMutation.error as Error)?.message ?? "unknown error"}
          </div>
        </Panel>
      )}
    </div>
  );
}

interface PresetCardProps {
  preset: Preset;
  disabled: boolean;
  isStarting: boolean;
  gateOpen: boolean;
  onStart: (preset: Preset) => void;
}

function PresetCard({
  preset,
  disabled,
  isStarting,
  gateOpen,
  onStart,
}: PresetCardProps) {
  const badge = DIFFICULTY_BADGE[preset.difficulty];
  const requiresGateOpen = preset.requiresGateOpen;
  const gateBlocked = requiresGateOpen && !gateOpen;
  const accent = gateBlocked
    ? "#334455"
    : preset.recommended
      ? "#3aaf6a"
      : "#0f4a3a";
  const isDisabled = disabled || gateBlocked;

  return (
    <Panel accent={accent}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 6,
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: gateBlocked ? "#5a7a70" : "#c5dfd4",
              fontWeight: 600,
              letterSpacing: 0.5,
            }}
          >
            {preset.name}
          </div>
          <span
            style={{
              fontSize: 7,
              padding: "2px 6px",
              border: `1px solid ${gateBlocked ? "#334455" : badge.color}`,
              color: gateBlocked ? "#334455" : badge.color,
              letterSpacing: 1.5,
              borderRadius: 2,
            }}
          >
            {badge.label}
          </span>
        </div>

        {preset.recommended && !gateBlocked && (
          <div style={{ fontSize: 7, color: "#3aaf6a", letterSpacing: 1.5 }}>
            ★ RECOMMENDED FIRST RUN
          </div>
        )}
        {gateBlocked && (
          <div
            style={{
              fontSize: 7,
              color: "#556560",
              letterSpacing: 1.5,
              padding: "2px 5px",
              border: "1px solid #334455",
              background: "rgba(0,0,0,0.2)",
              borderRadius: 2,
            }}
          >
            🔒 REQUIRES EXISTENCE GATE (GATE I) TO BE OPEN
          </div>
        )}

        <div style={{ fontSize: 10, color: "#9aaaa6", fontStyle: "italic" }}>
          {preset.tagline}
        </div>
        <div
          style={{
            fontSize: 10,
            color: gateBlocked ? "#4a6a60" : "#7a9a90",
            lineHeight: 1.4,
            minHeight: 56,
          }}
        >
          {preset.description}
        </div>
        <div
          style={{
            fontSize: 9,
            color: "#5a7a70",
            lineHeight: 1.5,
            background: "rgba(0,0,0,0.25)",
            border: "1px solid #0a2828",
            borderRadius: 2,
            padding: "5px 7px",
          }}
        >
          <div>{preset.display.scaleLabel}</div>
          <div>{preset.display.ticksLabel}</div>
          <div>{preset.display.iterationsLabel}</div>
          <div style={{ color: gateBlocked ? "#5a7a70" : "#c2a040", marginTop: 2 }}>
            {preset.display.expectedRuntime}
          </div>
        </div>
        <button
          type="button"
          disabled={isDisabled}
          onClick={() => !isDisabled && onStart(preset)}
          style={{
            marginTop: 4,
            padding: "8px 12px",
            fontSize: 10,
            letterSpacing: 2,
            background: isDisabled
              ? "rgba(15,74,58,0.10)"
              : preset.recommended
                ? "rgba(20,80,40,0.45)"
                : "rgba(15,74,58,0.35)",
            border: `1px solid ${isDisabled ? "#1a3a30" : accent}`,
            color: isDisabled ? "#3a5a50" : "#9bf0c0",
            borderRadius: 2,
            cursor: isDisabled ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {isStarting
            ? "STARTING…"
            : gateBlocked
              ? "🔒 LOCKED"
              : disabled
                ? "BUSY"
                : "▶ START EXPERIMENT"}
        </button>
      </div>
    </Panel>
  );
}
