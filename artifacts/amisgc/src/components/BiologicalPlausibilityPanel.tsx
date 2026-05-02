import { memo, useMemo } from "react";
import { Panel, MR } from "./Panel";
import type { Stats } from "../lib/api";
import { fmt } from "../lib/format";

interface BiologicalPlausibilityPanelProps {
  stats: Stats | null;
  scale?: 81 | 810 | 81000;
}

// Biological plausibility targets from the spec:
//   Sparsity      2 – 6 % active neurons       (matches brain recordings)
//   FLOPs/neuron  < 100 per tick                (brain ~0.23 FLOPs/neuron/tick)
//   Memory/neuron < 1 KB                        (brain ~1 KB synapses + state)
//   Power (sim)   < 1 W for N = 1 M             (brain uses ~20 W for 86 B neurons)
//   Clustering    > 0.3 for small-world regime   (wiring cost proxy)

const FLOPS_PER_NEURON_PER_TICK = 12; // attention(5) + integration(3) + plasticity(4)
const BYTES_PER_NEURON = 240;          // ~50 weights × 4B + 10 state vars × 4B

function badge(
  pass: boolean,
  passLabel: string,
  failLabel: string,
): { label: string; color: string } {
  return pass
    ? { label: passLabel, color: "#00ffc4" }
    : { label: failLabel, color: "#ff4477" };
}

export const BiologicalPlausibilityPanel = memo(
  function BiologicalPlausibilityPanel({
    stats,
    scale = 81,
  }: BiologicalPlausibilityPanelProps) {
    const metrics = useMemo(() => {
      if (!stats) return null;

      // Derive total N from the health-state census (always available).
      const totalN =
        stats.healthy +
        stats.stressed +
        stats.atrophied +
        stats.alarming +
        stats.refractory +
        stats.drifted;

      const activeN = stats.healthy + stats.stressed;
      const sparsity = totalN > 0 ? (activeN / totalN) * 100 : 0;

      // FLOPs and memory are deterministic from N and our architecture constants.
      const flopsPerNeuronPerTick = FLOPS_PER_NEURON_PER_TICK;
      const memoryPerNeuronBytes = BYTES_PER_NEURON;
      const memoryKB = memoryPerNeuronBytes / 1024;

      // Power: FLOPs × 10^-12 W/FLOP × 1 000 ticks/sec (assumed wall-clock rate).
      // This is the estimated power for the *current* N — useful for scaling extrapolation.
      const powerW = totalN * flopsPerNeuronPerTick * 1000 * 1e-12;
      const powerLabel =
        powerW < 1e-6
          ? `${(powerW * 1e9).toFixed(2)} nW`
          : powerW < 1e-3
            ? `${(powerW * 1e6).toFixed(2)} µW`
            : powerW < 1
              ? `${(powerW * 1e3).toFixed(2)} mW`
              : `${powerW.toFixed(2)} W`;

      // At-scale extrapolation: estimate power if N scaled to 1 million.
      const powerAt1M = 1_000_000 * flopsPerNeuronPerTick * 1000 * 1e-12;

      // Wiring cost proxy: networkClustering. Small-world requires > 0.3.
      const clustering = stats.networkClustering ?? 0;

      // Biological gate flags
      const sparsityOk = sparsity >= 2 && sparsity <= 6;
      const flopsOk = flopsPerNeuronPerTick < 100;
      const memOk = memoryKB < 1;
      const powerAt1MOk = powerAt1M < 1;
      const clusterOk = clustering > 0.3;
      const allOk = sparsityOk && flopsOk && memOk && powerAt1MOk && clusterOk;

      return {
        totalN,
        activeN,
        sparsity,
        flopsPerNeuronPerTick,
        memoryKB,
        powerLabel,
        powerAt1M,
        clustering,
        sparsityOk,
        flopsOk,
        memOk,
        powerAt1MOk,
        clusterOk,
        allOk,
        scale,
      };
    }, [stats, scale]);

    const panelColor = !metrics
      ? "#334455"
      : metrics.allOk
        ? "#00ffc4"
        : metrics.sparsityOk && metrics.flopsOk
          ? "#c2a040"
          : "#ff4477";

    return (
      <Panel title="BIOLOGICAL PLAUSIBILITY MONITOR" accent={panelColor}>
        {!metrics ? (
          <div style={{ fontSize: 9, color: "#5a7a70" }}>
            Waiting for run data…
          </div>
        ) : (
          <>
            <div
              style={{
                fontSize: 7,
                color: "#5a7a70",
                letterSpacing: 1,
                marginBottom: 8,
                lineHeight: 1.5,
              }}
            >
              Validates the model against brain-like constraints. Efficiency is
              a tool to scale experiments — not an end goal.
            </div>

            {/* Sparsity */}
            {(() => {
              const b = badge(
                metrics.sparsityOk,
                "IN RANGE",
                metrics.sparsity < 2 ? "TOO DENSE" : "TOO SPARSE",
              );
              return (
                <MR
                  label={`SPARSITY  ${fmt(metrics.sparsity)}% active  (target 2–6%)`}
                  value={b.label}
                  color={b.color}
                />
              );
            })()}

            {/* FLOPs */}
            {(() => {
              const b = badge(metrics.flopsOk, "PLAUSIBLE", "EXCEEDS TARGET");
              return (
                <MR
                  label={`FLOPs/neuron/tick  ${metrics.flopsPerNeuronPerTick}  (target < 100)`}
                  value={b.label}
                  color={b.color}
                />
              );
            })()}

            {/* Memory */}
            {(() => {
              const b = badge(metrics.memOk, "PLAUSIBLE", "EXCEEDS TARGET");
              return (
                <MR
                  label={`Memory/neuron  ${(metrics.memoryKB * 1024).toFixed(0)} B  (target < 1 KB)`}
                  value={b.label}
                  color={b.color}
                />
              );
            })()}

            {/* Current power */}
            <MR
              label={`Power (N=${metrics.totalN})  ${metrics.powerLabel}`}
              value="CURRENT SCALE"
              color="#5a8aaa"
            />

            {/* Power at 1M neurons */}
            {(() => {
              const b = badge(metrics.powerAt1MOk, "< 1 W AT N=1M", "> 1 W AT N=1M");
              return (
                <MR
                  label={`Power at N=1M  ${(metrics.powerAt1M * 1000).toFixed(2)} mW  (brain < 20 W)`}
                  value={b.label}
                  color={b.color}
                />
              );
            })()}

            {/* Wiring cost / clustering */}
            {(() => {
              const b = badge(
                metrics.clusterOk,
                "SMALL-WORLD",
                "LOW CLUSTERING",
              );
              return (
                <MR
                  label={`Clustering  ${fmt(metrics.clustering)}  (small-world > 0.3)`}
                  value={b.label}
                  color={b.color}
                />
              );
            })()}

            {/* Summary verdict */}
            <div
              style={{
                marginTop: 8,
                padding: "5px 7px",
                background: "rgba(0,0,0,0.25)",
                border: `1px solid ${panelColor}`,
                borderRadius: 2,
                fontSize: 8,
                color: panelColor,
                lineHeight: 1.5,
              }}
            >
              {metrics.allOk
                ? `All constraints satisfied at N=${metrics.totalN}. Model is biologically plausible at current scale.`
                : [
                    !metrics.sparsityOk &&
                      `Sparsity ${fmt(metrics.sparsity)}% is outside 2–6% target. Adjust BETA_ENTROPY to increase entropy pressure.`,
                    !metrics.clusterOk &&
                      `Clustering ${fmt(metrics.clustering)} is below 0.3. Small-world topology upgrade recommended.`,
                  ]
                    .filter(Boolean)
                    .join(" ")}
            </div>
          </>
        )}
      </Panel>
    );
  },
);
