import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { autoModeApi, type AutoModeDetail, type Preset } from "../lib/api";
import { Panel } from "./Panel";
import { StatusScoreboard } from "./StatusScoreboard";

interface LabHomeProps {
  // Called after a preset successfully starts an Auto-Mode run, so the
  // parent can switch into "watching" mode if it wants to.
  onStarted?: (id: string) => void;
  // Called when the user clicks "Open advanced dashboard". Lets the parent
  // toggle to the existing power-user UI.
  onOpenAdvanced?: () => void;
  // The currently-watched Auto-Mode run, if any. Drives the scoreboard.
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
  watchedAutoMode,
  onCancelWatched,
}: LabHomeProps) {
  const queryClient = useQueryClient();

  const presetsQuery = useQuery({
    queryKey: ["presets"],
    queryFn: () => autoModeApi.presets(),
    staleTime: 60_000,
  });

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
              AMISGC LAB · ONE-CLICK EXPERIMENTS
            </div>
            <div
              style={{
                fontSize: 13,
                color: "#c5dfd4",
                lineHeight: 1.5,
                maxWidth: 720,
              }}
            >
              Pick a preset below to run an experiment end-to-end. Each preset
              uses Auto-Mode to refine parameters automatically and report
              results in plain English. No knobs needed — the lab will tell
              you what happened and what to do next.
            </div>
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
  onStart: (preset: Preset) => void;
}

function PresetCard({
  preset,
  disabled,
  isStarting,
  onStart,
}: PresetCardProps) {
  const badge = DIFFICULTY_BADGE[preset.difficulty];
  const accent = preset.recommended ? "#3aaf6a" : "#0f4a3a";
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
              color: "#c5dfd4",
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
              border: `1px solid ${badge.color}`,
              color: badge.color,
              letterSpacing: 1.5,
              borderRadius: 2,
            }}
          >
            {badge.label}
          </span>
        </div>
        {preset.recommended && (
          <div
            style={{
              fontSize: 7,
              color: "#3aaf6a",
              letterSpacing: 1.5,
            }}
          >
            ★ RECOMMENDED FIRST RUN
          </div>
        )}
        <div
          style={{
            fontSize: 10,
            color: "#9aaaa6",
            fontStyle: "italic",
          }}
        >
          {preset.tagline}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "#7a9a90",
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
          <div style={{ color: "#c2a040", marginTop: 2 }}>
            {preset.display.expectedRuntime}
          </div>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onStart(preset)}
          style={{
            marginTop: 4,
            padding: "8px 12px",
            fontSize: 10,
            letterSpacing: 2,
            background: disabled
              ? "rgba(15,74,58,0.15)"
              : preset.recommended
                ? "rgba(20,80,40,0.45)"
                : "rgba(15,74,58,0.35)",
            border: `1px solid ${disabled ? "#1a3a30" : accent}`,
            color: disabled ? "#5a7a70" : "#9bf0c0",
            borderRadius: 2,
            cursor: disabled ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {isStarting ? "STARTING…" : disabled ? "BUSY" : "▶ START EXPERIMENT"}
        </button>
      </div>
    </Panel>
  );
}
