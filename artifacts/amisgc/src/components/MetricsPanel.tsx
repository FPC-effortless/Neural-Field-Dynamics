import { memo, useMemo } from "react";
import { Panel, MR, Pill } from "./Panel";
import { Sparkline } from "./Sparkline";
import { PCOL } from "../lib/colors";
import type { Stats } from "../lib/api";
import { fmt } from "../lib/format";

interface MetricsPanelProps {
  stats: Stats | null;
  series: Record<string, number[]>;
  taskKey: string;
}

// §7.9 — Rule-based Recommendation Engine.
// Maps the per-tick failure classifier string (from the sim's failureReason)
// to a plain-English action suggestion shown directly under the gate panel.
function getRecommendation(failureReason: string | undefined): {
  action: string;
  detail: string;
  color: string;
} | null {
  if (!failureReason || failureReason === "Warming up") return null;
  const r = failureReason.toLowerCase();
  if (r.includes("low participation") || r.includes("participation")) {
    return {
      action: "Raise τ or β",
      detail:
        "Too few neurons are participating. Try a higher attention temperature (τ ≥ 1.5) or increase the entropy weight (β ≥ 0.3) so the field spreads across more neurons.",
      color: "#ffb040",
    };
  }
  if (r.includes("dominance collapse") || r.includes("dominance")) {
    return {
      action: "Lower τ or add inhibition",
      detail:
        "One neuron is monopolising attention (C_max > 0.5). Reduce temperature (τ) to flatten the softmax, or enable local inhibitory interneurons to suppress runaway dominance.",
      color: "#ff9900",
    };
  }
  if (r.includes("weak coupling") || r.includes("weak global")) {
    return {
      action: "Raise γ or inject G into soma",
      detail:
        "The global field has insufficient leverage. Increase global coupling strength (γ ≥ 2.0, try up to 5.0 or 10.0). As a structural upgrade, injecting G directly into the somatic update can break this plateau.",
      color: "#ff4477",
    };
  }
  if (r.includes("temporal instability") || r.includes("temporal")) {
    return {
      action: "Raise δ or lower σ",
      detail:
        "Integration is appearing in flashes but the network cannot hold a stable state. Increase temporal coherence (δ ≥ 0.4) and/or reduce exploration noise (σ ≤ 0.01) to stabilise transient integration.",
      color: "#aa88ff",
    };
  }
  if (r.includes("global field ineffective") || r.includes("ineffective")) {
    return {
      action: "Increase γ aggressively",
      detail:
        "The consensus signal |G| is too small to act on. Try γ ≥ 3.0, and consider computing Φ over a rolling 200-tick window rather than instantaneously to catch weak sustained integration.",
      color: "#ff4477",
    };
  }
  if (r.includes("noise dominance") || r.includes("noise")) {
    return {
      action: "Lower σ",
      detail:
        "Signal-to-noise ratio SNR < 1 — exploration noise is overwhelming the coherence signal. Reduce σ to 0.01 or below. If the problem persists, consider a power-normalised attention distribution instead of softmax.",
      color: "#cc6600",
    };
  }
  if (r.includes("subcritical")) {
    return {
      action: "Try the Expanded Sweep preset",
      detail:
        "The network shows some signal but none of the six failure modes is dominant, suggesting a structural limitation rather than a tuning problem. Run the Expanded Sweep (720 combos) to confirm, then consider the brain-realistic upgrade (hierarchical layers, small-world hubs, local inhibition).",
      color: "#5a8aaa",
    };
  }
  return null;
}

export const MetricsPanel = memo(function MetricsPanel({
  stats,
  series,
  taskKey,
}: MetricsPanelProps) {
  const phaseColor = stats ? PCOL[stats.phaseRegion] ?? "#334455" : "#334455";

  const stateRows = useMemo(() => {
    if (!stats) return [] as Array<[string, number, string]>;
    return [
      ["HEALTHY", stats.healthy, "#0d7060"],
      ["STRESSED", stats.stressed, "#cc6600"],
      ["ATROPHIED", stats.atrophied, "#884488"],
      ["ALARMING", stats.alarming, "#00ffc4"],
      ["REFRACTORY", stats.refractory, "#8833ff"],
      ["DRIFTED", stats.drifted, "#ff9900"],
    ] as Array<[string, number, string]>;
  }, [stats]);

  const gate = stats?.existenceGate ?? 0;
  const gateOpen = gate === 1;
  const gateColor = gateOpen ? "#00ffc4" : "#ff4477";
  const gateLabel = gateOpen ? "GATE OPEN" : "NO-GO";
  const gateStreak = stats?.gateStreak ?? 0;
  const reason = stats?.failureReason ?? "";

  // §5.2 — Gate II: Structural Coherence (diagnostic only, never unlocks phases).
  // Condition: S_C > 0.4 AND R > 0.5 AND PU > 0.08
  const sc = stats?.networkSC ?? 0;
  const pu = (stats as unknown as Record<string, number>)?.networkPU ?? 0;
  const r = stats?.networkR ?? 0;
  const gate2Pillars = [sc > 0.4, r > 0.5, pu > 0.08];
  const gate2Open = gate2Pillars.every(Boolean);
  const gate2Partial = !gate2Open && gate2Pillars.some(Boolean);
  const gate2Color = gate2Open
    ? "#44ffcc"
    : gate2Partial
      ? "#c2a040"
      : "#334455";
  const gate2Label = gate2Open
    ? "GATE II OPEN"
    : gate2Partial
      ? "GATE II PARTIAL"
      : "GATE II CLOSED";

  // §7.9 — Recommendation Engine
  const rec = getRecommendation(reason);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
      {/* §5.1 — Existence Gate (Gate I) */}
      <Panel title="EXISTENCE GATE I · Φ·PU·S_C" accent={gateColor}>
        <div className="flex items-center justify-between mb-1">
          <span
            style={{
              fontSize: gateOpen ? 14 : 18,
              color: gateColor,
              letterSpacing: 2,
              fontWeight: 700,
              textShadow: gateOpen
                ? "none"
                : `0 0 6px ${gateColor}, 0 0 12px ${gateColor}`,
            }}
          >
            {gateLabel}
          </span>
          <Pill color={gateColor}>STREAK {gateStreak}</Pill>
        </div>
        <MR label="Φ > 0.05" value={fmt(stats?.networkPhi)} color={(stats?.networkPhi ?? 0) > 0.05 ? "#00ffc4" : "#ff4477"} />
        <MR label="PU > 0.10" value={fmt(pu)} color={pu > 0.10 ? "#00ffc4" : "#ff4477"} />
        <MR label="S_C > 0.10" value={fmt(stats?.networkSC)} color={(stats?.networkSC ?? 0) > 0.10 ? "#00ffc4" : "#ff4477"} />
        <MR label="H_C" value={fmt(stats?.networkH_C)} color="#aa88ff" />
        <MR label="CAR" value={fmt(stats?.networkCAR)} color="#44ffcc" />
        {reason ? (
          <div
            style={{
              fontSize: 8,
              color: "#ff4477",
              marginTop: 6,
              padding: "3px 5px",
              letterSpacing: 1,
              border: "1px solid #ff4477",
              background: "rgba(255,68,119,0.08)",
              fontWeight: 700,
            }}
          >
            ✗ {reason}
          </div>
        ) : null}

        {/* §7.9 — Inline Recommendation Engine */}
        {rec && !gateOpen && (
          <div
            style={{
              marginTop: 8,
              padding: "6px 8px",
              background: "rgba(0,0,0,0.25)",
              border: `1px solid ${rec.color}`,
              borderRadius: 2,
            }}
          >
            <div
              style={{
                fontSize: 7,
                color: rec.color,
                letterSpacing: 1.5,
                fontWeight: 700,
                marginBottom: 3,
              }}
            >
              ⟶ RECOMMENDATION · {rec.action}
            </div>
            <div style={{ fontSize: 9, color: "#9aaaa6", lineHeight: 1.45 }}>
              {rec.detail}
            </div>
          </div>
        )}
      </Panel>

      {/* §5.2 — Gate II: Structural Coherence (diagnostic only) */}
      <Panel title="GATE II · STRUCTURAL COHERENCE" accent={gate2Color}>
        <div className="flex items-center justify-between mb-1">
          <span
            style={{
              fontSize: 11,
              color: gate2Color,
              letterSpacing: 1.5,
              fontWeight: 700,
            }}
          >
            {gate2Label}
          </span>
          <span
            style={{
              fontSize: 7,
              color: "#5a7a70",
              letterSpacing: 1,
              fontStyle: "italic",
            }}
          >
            DIAGNOSTIC ONLY
          </span>
        </div>
        <MR
          label="S_C > 0.40"
          value={fmt(sc)}
          color={sc > 0.4 ? "#44ffcc" : "#556560"}
        />
        <MR
          label="R > 0.50"
          value={fmt(r)}
          color={r > 0.5 ? "#44ffcc" : "#556560"}
        />
        <MR
          label="PU > 0.08"
          value={fmt(pu)}
          color={pu > 0.08 ? "#44ffcc" : "#556560"}
        />
        {gate2Open && (
          <div
            style={{
              fontSize: 8,
              color: "#44ffcc",
              marginTop: 5,
              padding: "2px 5px",
              border: "1px solid #44ffcc",
              background: "rgba(68,255,204,0.06)",
            }}
          >
            Non-integrated distributed cognition confirmed. Gate I still required for phase unlock.
          </div>
        )}
      </Panel>

      {/* Phase Region */}
      <Panel title="PHASE REGION" accent={phaseColor}>
        <div style={{ fontSize: 14, color: phaseColor, letterSpacing: 2, marginBottom: 4 }}>
          {stats?.phaseRegion ?? "—"}
        </div>
        <Sparkline
          data={series.J_star ?? []}
          color={phaseColor}
          h={22}
          w={200}
        />
        <div style={{ fontSize: 6, color: "#1a3a30", marginTop: 2, letterSpacing: 1 }}>
          J* TRAJECTORY · {stats ? `t=${Math.round(stats.taskProgress)}` : "t=0"}
        </div>
      </Panel>

      {/* Task / Convergence */}
      <Panel title="TASK · CONVERGENCE" accent="#0f4a3a">
        <div className="flex items-center justify-between mb-1">
          <Pill color="#00ffc4">{taskKey}</Pill>
          <Pill color={stats?.converged ? "#00ffc4" : "#cc6600"}>
            {stats?.converged ? "CONVERGED" : "RUNNING"}
          </Pill>
        </div>
        <MR label="J*" value={fmt(stats?.J_star)} color="#00ffc4" />
        <MR label="J_emb" value={fmt(stats?.J_emb)} color="#44ffcc" />
        <MR label="J_score" value={fmt(stats?.J_score)} color="#0d7060" />
        <MR label="V_td" value={fmt(stats?.V_td)} color="#aa88ff" />
        <MR label="DOPAMINE" value={fmt(stats?.networkDopamine)} color="#ff66cc" />
      </Panel>

      {/* Consciousness Metrics */}
      <Panel title="CONSCIOUSNESS · Φ" accent="#aa88ff">
        <MR label="Φ (PHI)" value={fmt(stats?.networkPhi)} color="#aa88ff" />
        <Sparkline data={series.networkPhi ?? []} color="#aa88ff" h={16} w={200} />
        <MR label="C_chollet" value={fmt(stats?.C_chollet)} color="#aa88ff" />
        <MR label="C_bach" value={fmt(stats?.C_bach)} color="#aa88ff" />
        <MR label="SC" value={fmt(stats?.networkSC)} color="#a855f7" />
        <MR label="AS" value={fmt(stats?.networkAS)} color="#a855f7" />
        <MR label="COH" value={fmt(stats?.networkCoh)} color="#7c5fff" />
        <MR label="S_self" value={fmt(stats?.networkSself)} color="#aa88ff" />
        <MR label="AGENCY" value={fmt(stats?.networkAgency)} color="#aa88ff" />
        <MR label="CONTROL" value={fmt(stats?.networkControl)} color="#7c5fff" />
        <MR label="IC" value={fmt(stats?.networkIC)} color="#00ffc4" />
      </Panel>

      {/* Information / MI */}
      <Panel title="INFORMATION · MI" accent="#ffb040">
        <MR label="I(X;Y)" value={fmt(stats?.networkMI)} color="#ffb040" />
        <Sparkline data={series.networkMI ?? []} color="#ffb040" h={16} w={200} />
        <MR label="ENTROPY SE" value={fmt(stats?.networkSE)} color="#ffb040" />
        <MR label="CR" value={fmt(stats?.networkCR)} color="#ffb040" />
        <MR label="ATS" value={fmt(stats?.ats ?? undefined)} color="#ff9900" />
        <MR label="FSI" value={fmt(stats?.networkFSI)} color="#ffb040" />
        <MR label="FS" value={fmt(stats?.FS)} color="#ffb040" />
        <MR label="ATTRACTORS" value={stats?.attractorCount ?? 0} color="#00ffc4" />
      </Panel>

      {/* Energy / Free-Energy */}
      <Panel title="FREE ENERGY · ATP" accent="#ff9900">
        <MR label="AVG ATP" value={fmt(stats?.avgAtp)} color="#ff9900" />
        <Sparkline data={series.avgAtp ?? []} color="#ff9900" h={16} w={200} />
        <MR label="ATP VAR" value={fmt(stats?.networkAtpVar)} color="#ff9900" />
        <MR label="EFFICIENCY" value={fmt(stats?.networkEE)} color="#ff9900" />
        <MR label="BPS" value={fmt(stats?.networkBPS)} color="#ff9900" />
        <MR label="PD" value={fmt(stats?.networkPD)} color="#ff9900" />
      </Panel>

      {/* Health */}
      <Panel title="HEALTH · STATES" accent="#00ffc4">
        <MR label="AVG H" value={fmt(stats?.avgH)} color="#00ffc4" />
        <Sparkline data={series.avgH ?? []} color="#00ffc4" h={16} w={200} />
        <MR label="AVG V" value={fmt(stats?.avgV)} color="#00ffc4" />
        <MR label="PRUNED" value={stats?.totalPruned ?? 0} color="#cc6600" />
        <MR label="GROWN" value={stats?.totalGrown ?? 0} color="#00ffc4" />
        <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {stateRows.map(([label, count, color]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span style={{ fontSize: 14, color, fontVariantNumeric: "tabular-nums" }}>{count}</span>
              <span style={{ fontSize: 6, color: "#1a3a30", letterSpacing: 1 }}>{label}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Branches / Dendrites */}
      <Panel title="BRANCHES · CTRL" accent="#aa88ff">
        <MR label="B" value={stats?.branchB ?? 1} color="#aa88ff" />
        <MR label="AVG d_eff" value={fmt(stats?.avgDeff)} color="#aa88ff" />
        <MR label="DU" value={fmt(stats?.networkDU)} color="#aa88ff" />
        <MR label="CTRL" value={fmt(stats?.networkCtrl)} color="#aa88ff" />
        <MR label="CLUSTER" value={fmt(stats?.networkClustering)} color="#aa88ff" />
      </Panel>

      {/* Body */}
      <Panel title="BODY · EMBODIMENT" accent="#44ffcc">
        <MR label="ENERGY" value={fmt(stats?.body_energy)} color="#44ffcc" />
        <Sparkline data={series.body_energy ?? []} color="#44ffcc" h={16} w={200} />
        <MR label="HEALTH" value={fmt(stats?.body_health)} color="#44ffcc" />
        <Sparkline data={series.body_health ?? []} color="#0d7060" h={16} w={200} />
        <MR label="EPS_BODY" value={fmt(stats?.eps_body)} color="#44ffcc" />
        <MR label="S_body" value={fmt(stats?.networkSbody)} color="#44ffcc" />
        <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
          {stats?.h16Confirmed && <Pill color="#00ffc4">H16 ✓</Pill>}
          {stats?.h17Confirmed && <Pill color="#00ffc4">H17 ✓</Pill>}
          {stats?.hPhiSeen && <Pill color="#aa88ff">Φ-PHASE</Pill>}
          {stats?.exp_phiPhase && <Pill color="#ff66cc">EXP-Φ</Pill>}
        </div>
      </Panel>

      {/* Win counters */}
      <Panel title="WIN COUNTERS" accent="#0f4a3a">
        <MR label="J*" value={stats?.win_Jstar ?? 0} color="#00ffc4" />
        <MR label="Φ" value={stats?.win_Phi ?? 0} color="#aa88ff" />
        <MR label="SC" value={stats?.win_SC ?? 0} color="#a855f7" />
        <MR label="COH" value={stats?.win_Coh ?? 0} color="#7c5fff" />
        <MR label="CTRL" value={stats?.win_Ctrl ?? 0} color="#aa88ff" />
        <MR label="IC" value={stats?.win_IC ?? 0} color="#00ffc4" />
      </Panel>
    </div>
  );
});
