import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type PhaseStatus } from "../lib/api";

// §5.1 — Existence Gate (Gate I) banner. Enforces the hard progression rule:
//   • RED / NO-GO  ⇒ all experiments above PH0 are LOCKED. The platform is
//                    in NO-GO state — no cognitive claim can be accepted until
//                    the Existence Gate (Φ > 0.05 ∧ PU > 0.1 ∧ S_C > 0.1)
//                    holds for ≥ 1 000 consecutive ticks.
//   • GREEN / OPEN ⇒ Gate I confirmed open. Higher phases are unlocked.
// Polls every 8 s plus on every mutation so newly-opened gates surface
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
        {unlocked ? "GATE I OPEN" : "NO-GO · PHASE 0 LOCK"}
      </span>
      <span style={{ flex: 1, lineHeight: 1.5 }}>
        {unlocked
          ? data.manualOverride && !data.gateOpened
            ? `Manual override active (since ${fmtTs(data.manualOverrideAt)}) — higher phases runnable for debugging. Gate I not yet formally confirmed.`
            : `Existence Gate (Gate I) confirmed open by run ${data.openedByRunId ?? "?"} (${data.openedByExperimentId ?? "ad-hoc"}) at ${fmtTs(data.gateOpenedAt)} after a ${data.openingGateStreak}-tick streak. All phases unlocked. No cognitive claim is accepted without this gate.`
          : `NO-GO STATE — All experiments above PH0 are LOCKED. The network must demonstrate Φ > 0.05 ∧ PU > 0.1 ∧ S_C > 0.1 sustained for ≥ ${required} consecutive ticks (the Existence Gate) before any cognitive claim is accepted. No G-score or compound metrics are computed until Gate I opens.`}
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
        title="Bypass the lock for debugging only. Does NOT count as the gate opening. A formal Gate I opening requires an empirical Existence Gate streak."
      >
        {data.manualOverride ? "DISABLE OVERRIDE" : "MANUAL OVERRIDE"}
      </button>
      {(data.gateOpened || data.manualOverride) && (
        <button
          onClick={() => {
            if (confirm("Reset phase lock? All experiments above PH0 will be locked again until the Existence Gate is formally re-opened by a qualifying run.")) {
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
          title="Wipe the unlock back to initial NO-GO state. All higher phases become locked again."
        >
          RESET
        </button>
      )}
    </div>
  );
}
