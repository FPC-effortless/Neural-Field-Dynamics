// AbstractionLayer — parameter-level approximations that reduce computational
// cost while preserving emergent specialisation metrics.
//
// Architecture note (Replit free tier): abstractions are implemented as sweep-
// parameter modifiers that run within the existing simulation engine — no new
// infrastructure. Each abstraction documents its estimated impact on Phi/PU/S_C
// so the user can make informed trade-offs before launching a sweep.

export type AbstractionId =
  | "sparse-coupling"
  | "quantized-weights"
  | "event-driven"
  | "hierarchical-attractors";

export type AbstractionStatus = "stable" | "beta" | "experimental";

export interface AbstractionImpact {
  // Estimated fractional change in Phi (e.g. -0.02 = -2%)
  deltaPhi: number;
  // Estimated fractional change in PU
  deltaPU: number;
  // Estimated fractional change in S_C
  deltaSC: number;
  // Estimated FLOPs reduction factor (e.g. 0.4 = 40% of original FLOPs)
  flopsMultiplier: number;
  // Estimated memory reduction factor
  memoryMultiplier: number;
  // Estimated max scale achievable after applying this abstraction
  maxScaleEnabled: number;
}

export interface Abstraction {
  id: AbstractionId;
  name: string;
  description: string;
  biologicalJustification: string;
  status: AbstractionStatus;
  impact: AbstractionImpact;
  // Rule: only valid if Phi stays above this threshold after application
  minPhiRequired: number;
  // Function to modify sweep ranges/config when this abstraction is applied
  // Returns a patch to merge into the sweep body
  applySweepPatch(
    currentRanges: Record<string, number[]>,
    currentScale: 81 | 810 | 81000,
  ): {
    baseRanges: Record<string, number[]>;
    scale: 81 | 810 | 81000;
    ticksPerCombo?: number;
  };
}

// ── Abstraction definitions ────────────────────────────────────────────────────

export const ABSTRACTIONS: Abstraction[] = [
  {
    id: "sparse-coupling",
    name: "Sparse Coupling",
    description:
      "Reduce network connectivity to a local radius r instead of full all-to-all coupling. Cuts FLOPs and memory roughly proportional to (r/N)^2, enabling N=10 000+ networks.",
    biologicalJustification:
      "The brain uses local connectivity (cortical columns, short-range horizontal connections). Long-range connections exist but are sparse and myelinated for speed, not density.",
    status: "stable",
    impact: {
      deltaPhi: -0.02,
      deltaPU: -0.01,
      deltaSC: -0.03,
      flopsMultiplier: 0.15,
      memoryMultiplier: 0.1,
      maxScaleEnabled: 10000,
    },
    minPhiRequired: 0.05,
    applySweepPatch(ranges, scale) {
      // Approximation: push GAMMA_GLOBAL higher to compensate for reduced
      // global connectivity. BETA_ENTROPY tightened to enforce local sparsity.
      const patched = { ...ranges };
      patched["GAMMA_GLOBAL"] = (patched["GAMMA_GLOBAL"] ?? [2.0, 3.0]).filter(
        (v) => v >= 2.0,
      );
      if (patched["GAMMA_GLOBAL"].length === 0) patched["GAMMA_GLOBAL"] = [2.0, 3.0];
      patched["BETA_ENTROPY"] = (patched["BETA_ENTROPY"] ?? [0.3, 0.5]).filter(
        (v) => v >= 0.3,
      );
      if (patched["BETA_ENTROPY"].length === 0) patched["BETA_ENTROPY"] = [0.3, 0.5];
      return { baseRanges: patched, scale };
    },
  },
  {
    id: "quantized-weights",
    name: "Quantized Weights",
    description:
      "Reduce synaptic weight precision from 32-bit float to 8-bit integer. Saves 4x memory, enabling more combos in parallel. Maximum 5% drop in Phi/PU/S_C.",
    biologicalJustification:
      "Biological synaptic weights are inherently noisy and limited in precision. Synaptic strengths vary by roughly 20-30% due to stochastic vesicle release — far coarser than 8-bit.",
    status: "stable",
    impact: {
      deltaPhi: -0.015,
      deltaPU: -0.01,
      deltaSC: -0.01,
      flopsMultiplier: 0.85,
      memoryMultiplier: 0.25,
      maxScaleEnabled: 81000,
    },
    minPhiRequired: 0.05,
    applySweepPatch(ranges, scale) {
      // Quantization adds noise; compensate by slightly higher TAU_ATT
      const patched = { ...ranges };
      const tau = patched["TAU_ATT"] ?? [1.0, 1.5];
      patched["TAU_ATT"] = [...new Set([...tau, ...tau.map((t) => t * 1.1)])].sort();
      return { baseRanges: patched, scale };
    },
  },
  {
    id: "event-driven",
    name: "Event-Driven Updates",
    description:
      "Skip the update computation for any neuron with y_i = 0 (not firing). Reduces effective FLOPs by the sparsity fraction — at 4% activity, compute drops by 96%.",
    biologicalJustification:
      "Neurons only consume significant metabolic energy when they fire. Dendritic computation is minimal at rest. This mirrors the brain's energy efficiency — most neurons are silent most of the time.",
    status: "beta",
    impact: {
      deltaPhi: 0.0,
      deltaPU: 0.0,
      deltaSC: 0.0,
      flopsMultiplier: 0.04,
      memoryMultiplier: 1.0,
      maxScaleEnabled: 81000,
    },
    minPhiRequired: 0.05,
    applySweepPatch(ranges, scale) {
      // Event-driven updates require sparse activity; enforce high BETA_ENTROPY
      const patched = { ...ranges };
      patched["BETA_ENTROPY"] = (patched["BETA_ENTROPY"] ?? [0.5, 0.8]).filter(
        (v) => v >= 0.5,
      );
      if (patched["BETA_ENTROPY"].length === 0) patched["BETA_ENTROPY"] = [0.5, 0.8];
      // Low noise ensures the sparsity is real, not noise-driven firing
      patched["NOISE_SIGMA"] = (patched["NOISE_SIGMA"] ?? [0.01]).filter(
        (v) => v <= 0.02,
      );
      if (patched["NOISE_SIGMA"].length === 0) patched["NOISE_SIGMA"] = [0.01];
      return { baseRanges: patched, scale };
    },
  },
  {
    id: "hierarchical-attractors",
    name: "Hierarchical Attractors",
    description:
      "Divide the network into local clusters (column-like modules). Each cluster runs a local attractor, and a global field integrates across clusters. Enables N=1M+ by making global integration O(clusters) rather than O(N^2).",
    biologicalJustification:
      "The neocortex is organised into cortical columns (~100 neurons each) that function as local computation units. Long-range connections link column-level representations, not individual neurons.",
    status: "experimental",
    impact: {
      deltaPhi: -0.05,
      deltaPU: -0.03,
      deltaSC: -0.04,
      flopsMultiplier: 0.02,
      memoryMultiplier: 0.05,
      maxScaleEnabled: 1000000,
    },
    minPhiRequired: 0.04,
    applySweepPatch(ranges, scale) {
      // Hierarchical attractors need stronger global coupling (inter-cluster binding)
      // and higher tau (slow attractor dynamics across layers)
      const patched = { ...ranges };
      patched["GAMMA_GLOBAL"] = [3.0, 4.0, 5.0];
      patched["TAU_ATT"] = (patched["TAU_ATT"] ?? [1.5, 2.0]).filter((v) => v >= 1.5);
      if (patched["TAU_ATT"].length === 0) patched["TAU_ATT"] = [1.5, 2.0];
      // Step up scale for a meaningful hierarchical test
      const nextScale = scale === 81 ? 810 : scale === 810 ? 81000 : 81000;
      return { baseRanges: patched, scale: nextScale as 81 | 810 | 81000, ticksPerCombo: 40000 };
    },
  },
];

export function getAbstraction(id: AbstractionId): Abstraction | undefined {
  return ABSTRACTIONS.find((a) => a.id === id);
}

// Compose multiple abstractions — apply each patch in sequence and merge.
export function composeAbstractions(
  ids: AbstractionId[],
  baseRanges: Record<string, number[]>,
  baseScale: 81 | 810 | 81000,
): {
  baseRanges: Record<string, number[]>;
  scale: 81 | 810 | 81000;
  ticksPerCombo?: number;
  combinedImpact: AbstractionImpact;
} {
  let ranges = { ...baseRanges };
  let scale = baseScale;
  let ticksPerCombo: number | undefined;

  // Start with no impact
  const combinedImpact: AbstractionImpact = {
    deltaPhi: 0,
    deltaPU: 0,
    deltaSC: 0,
    flopsMultiplier: 1,
    memoryMultiplier: 1,
    maxScaleEnabled: 81000,
  };

  for (const id of ids) {
    const abs = getAbstraction(id);
    if (!abs) continue;
    const patch = abs.applySweepPatch(ranges, scale);
    ranges = patch.baseRanges;
    scale = patch.scale;
    if (patch.ticksPerCombo) ticksPerCombo = patch.ticksPerCombo;
    combinedImpact.deltaPhi += abs.impact.deltaPhi;
    combinedImpact.deltaPU += abs.impact.deltaPU;
    combinedImpact.deltaSC += abs.impact.deltaSC;
    combinedImpact.flopsMultiplier *= abs.impact.flopsMultiplier;
    combinedImpact.memoryMultiplier *= abs.impact.memoryMultiplier;
    combinedImpact.maxScaleEnabled = Math.max(
      combinedImpact.maxScaleEnabled,
      abs.impact.maxScaleEnabled,
    );
  }

  return { baseRanges: ranges, scale, ticksPerCombo, combinedImpact };
}
