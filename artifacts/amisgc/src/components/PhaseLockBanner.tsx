import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type PhaseStatus } from "../lib/api";

// v13 spec §3.2 — top-of-page banner that makes the phase-lock state explicit:
//   • RED  ⇒ all phases above PH0 are locked. Researchers MUST run a Phase-0
//             sweep first to open the Existence Gate.
//   • GREEN ⇒ gate opened (or manual override), higher phases are runnable.
// We poll every 8 s plus on every mutation so newly-opened gates surface
// immediately after a long sweep finishes.

function fmtTs(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function PhaseLockBanner() {
  const qc = useQueryClient();
  const { data } = useQuery<PhaseStatus>({
    queryKey: ["phase-status"],
    queryFn: () => api.phaseStatus(),
    refetchInterval: 8000,
  });

  const overrideMutation = useMutation({
    mutationFn: (enabled: boolean) => api.setPhaseOverride(enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["phase-status"] });
      qc.invalidateQueries({ queryKey: ["experiments"] });
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => api.resetPhaseStatus(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["phase-status"] });
      qc.invalidateQueries({ queryKey: ["experiments"] });
    },
  });

  if (!data) return null;
  const unlocked = data.gateOpened || data.manualOverride;
  const required = data.gateStreakRequired ?? 1000;

  const bg = unlocked ? "#04231a" : "#2a0a0a";
  const border = unlocked ? "#00ffc4" : "#ff5252";
  const accent = unlocked ? "#00ffc4" : "#ff8a8a";

  return (
    <div
      style={{
        background: bg,
        borderBottom: `1px solid ${border}`,
        padding: "6px 12px",
        fontSize: 9,
        color: accent,
        letterSpacing: 1.2,
        display: "flex",
        gap: 16,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontWeight: 700,
          padding: "2px 8px",
          background: border,
          color: bg,
          borderRadius: 2,
        }}
      >
        {unlocked ? "GATE OPEN" : "PHASE 0 LOCK"}
      </span>
      <span style={{ flex: 1, lineHeight: 1.5 }}>
        {unlocked
          ? data.manualOverride && !data.gateOpened
            ? `Manual override active (since ${fmtTs(data.manualOverrideAt)}) — higher phases runnable for debugging.`
            : `Existence Gate opened by run ${data.openedByRunId ?? "?"} (${data.openedByExperimentId ?? "ad-hoc"}) at ${fmtTs(data.gateOpenedAt)} after a ${data.openingGateStreak}-tick streak. All phases unlocked.`
          : `All experiments above PH0 are LOCKED. Run a Phase-0 sweep until the Existence Gate (Φ>0.05 ∧ PU>0.1 ∧ S_C>0.1) holds for ≥ ${required} consecutive ticks.`}
      </span>
      <button
        onClick={() => overrideMutation.mutate(!data.manualOverride)}
        disabled={overrideMutation.isPending}
        style={{
          background: "transparent",
          border: `1px solid ${accent}`,
          color: accent,
          padding: "2px 8px",
          fontSize: 8,
          letterSpacing: 1.5,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
        title="Bypass the lock for debugging. Does NOT count as the gate opening."
      >
        {data.manualOverride ? "DISABLE OVERRIDE" : "MANUAL OVERRIDE"}
      </button>
      {(data.gateOpened || data.manualOverride) && (
        <button
          onClick={() => {
            if (confirm("Reset phase lock? Higher phases will become locked again until the Existence Gate is re-opened.")) {
              resetMutation.mutate();
            }
          }}
          disabled={resetMutation.isPending}
          style={{
            background: "transparent",
            border: `1px solid ${accent}`,
            color: accent,
            padding: "2px 8px",
            fontSize: 8,
            letterSpacing: 1.5,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
          title="Reset the lock to its initial closed state. Useful when starting a fresh study."
        >
          RESET
        </button>
      )}
    </div>
  );
}
