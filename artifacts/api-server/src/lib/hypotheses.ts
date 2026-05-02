// Research hypotheses for the AMISGC emergent-specialisation research programme.
//
// Each hypothesis maps to a section of the refocused spec. Status codes:
//   "testable"  -- the current sim has all required parameters; run button enabled.
//   "partial"   -- a proxy sweep is possible now; full test needs a structural upgrade.
//   "pending"   -- requires a planned structural upgrade; no sweep possible yet.
//
// sweepConfig (when present) is posted directly to POST /api/automode.

export type HypothesisStatus = "testable" | "partial" | "pending";

export interface HypothesisSweepConfig {
  scale: 81 | 810 | 81000;
  ticksPerCombo: number;
  maxIterations: number;
  gateStreakTarget: number;
  baseRanges: Record<string, number[]>;
}

export interface Hypothesis {
  id: string;
  index: number;
  title: string;
  question: string;
  testMethod: string;
  primaryMetric: string;
  successCriteria: string;
  efficiencyTool: string;
  status: HypothesisStatus;
  pendingReason?: string;
  sweepConfig?: HypothesisSweepConfig;
}

export const HYPOTHESES: Hypothesis[] = [
  {
    id: "general-mechanisms",
    index: 1,
    title: "General Mechanisms Specialise Without Modules",
    question:
      "Can predictive coding and emergent attractors produce task specialisation without any pre-programmed task-specific modules?",
    testMethod:
      "Run a Phase-0 parameter sweep. Measure attractor count and Phi. Gate I opening (Phi > 0.05, PU > 0.1, S_C > 0.1 sustained 1000 ticks) confirms global integration arose from local rules alone -- no task-specific code involved.",
    primaryMetric: "Phi (global integration) + attractorCount",
    successCriteria: "Phi > 0.05 sustained for 1000 ticks; attractors > 0",
    efficiencyTool: "None -- this is the core AMISGC mechanism",
    status: "testable",
    sweepConfig: {
      scale: 81,
      ticksPerCombo: 30000,
      maxIterations: 4,
      gateStreakTarget: 1000,
      baseRanges: {
        TAU_ATT: [0.7, 1.5, 3.0],
        GAMMA_GLOBAL: [1.0, 2.0, 3.0],
        BETA_ENTROPY: [0.1, 0.5],
        DELTA_TEMPORAL: [0.2, 0.6],
      },
    },
  },
  {
    id: "energy-constraints",
    title: "Energy Constraints Force Specialisation",
    index: 2,
    question:
      "Does raising the metabolic cost of firing (FIRE_COST) reduce attractor overlap and sharpen neuron specialisation?",
    testMethod:
      "Sweep FIRE_COST directly across a 5x range (1.0 to 16.0). Measure avgAtp (mean ATP reserve), networkPhi (integration), and attractor count. Prediction: low FIRE_COST = broad firing = low Phi; high FIRE_COST = sparse firing = neurons forced to specialise = higher Phi if global coupling is sufficient. The H2 signature: Phi peaks at an intermediate FIRE_COST (4-8) where sparsity is 2-6% -- too low = overlap noise, too high = silence.",
    primaryMetric: "Phi + avgAtp across FIRE_COST values (sparsity proxy = 1 - alarming/N)",
    successCriteria:
      "Phi > 0.05 at intermediate FIRE_COST (4-8); alarming fraction drops toward 2-6% as FIRE_COST rises",
    efficiencyTool: "FIRE_COST is now a first-class swept parameter -- no proxy required",
    status: "testable",
    sweepConfig: {
      scale: 81,
      ticksPerCombo: 20000,
      maxIterations: 3,
      gateStreakTarget: 500,
      baseRanges: {
        FIRE_COST: [1.0, 2.5, 4.0, 8.0, 16.0],
        GAMMA_GLOBAL: [1.5, 2.0, 3.0],
        TAU_ATT: [1.0, 2.0],
      },
    },
  },
  {
    id: "offline-consolidation",
    index: 3,
    title: "Offline Consolidation (SWRs) Strengthens Attractors",
    question:
      "Does a simulated sharp-wave ripple (SWR) replay phase increase Phi and stabilise attractors after online learning?",
    testMethod:
      "Proxy test: run auto-mode with 4 iterations (each iteration is a separate sweep) and a long streak target (2000 ticks). The refinement loop approximates offline replay by running the best region of parameter space multiple times with increasing precision -- analogous to memory consolidation strengthening the most active attractor states. Phi improvement across iterations is the proxy metric.",
    primaryMetric: "Phi improvement across auto-mode iterations (proxy for SWR consolidation)",
    successCriteria:
      "Phi in iteration 3-4 >= 110% of iteration 1; gate streak improves across iterations",
    efficiencyTool: "None required for this hypothesis",
    status: "partial",
    pendingReason:
      "Full SWR test requires an offline consolidation loop in the sim engine: memory-trace replay, hippocampal sharp-wave-ripple emulation, and Phi-snapshot mechanism before and after the phase. The current proxy test uses auto-mode refinement iterations as a consolidation analog.",
    sweepConfig: {
      scale: 81,
      ticksPerCombo: 40000,
      maxIterations: 4,
      gateStreakTarget: 2000,
      baseRanges: {
        TAU_ATT: [1.0, 1.5, 2.0],
        GAMMA_GLOBAL: [1.5, 2.0, 3.0],
        BETA_ENTROPY: [0.3, 0.5],
        DELTA_TEMPORAL: [0.4, 0.6],
        NOISE_SIGMA: [0.01],
      },
    },
  },
  {
    id: "context-cues",
    index: 4,
    title: "Context Cues Enable Task Switching",
    question:
      "Do apical (top-down) context inputs allow the network to switch attractors for different tasks, enabling dynamic specialisation?",
    testMethod:
      "Proxy test: run sweep with high DELTA_TEMPORAL (strong temporal coherence acts as a context-binding signal) and compare attractor stability to low DELTA_TEMPORAL runs. High delta = stronger context binding = more stable attractor per-task. Also sweep across task-skip counts via different GAMMA_GLOBAL values: high coupling mimics top-down context routing. Success: high-delta configs show higher S_C (stability coherence) relative to Phi -- indicating task-contextual binding.",
    primaryMetric: "S_C / Phi ratio across DELTA_TEMPORAL values (proxy for context binding)",
    successCriteria:
      "S_C / Phi ratio > 1.5 in high-DELTA_TEMPORAL configs vs. < 1.0 in low-delta runs",
    efficiencyTool: "None required for this hypothesis",
    status: "partial",
    pendingReason:
      "Full test requires apical dendritic input channels and a multi-task interleaving scheduler. These structural components are on the brain-realistic upgrade roadmap. The current proxy uses DELTA_TEMPORAL as a context-binding analog.",
    sweepConfig: {
      scale: 81,
      ticksPerCombo: 25000,
      maxIterations: 2,
      gateStreakTarget: 800,
      baseRanges: {
        TAU_ATT: [1.0, 1.5, 2.0],
        GAMMA_GLOBAL: [2.0, 3.0],
        BETA_ENTROPY: [0.3, 0.5],
        DELTA_TEMPORAL: [0.2, 0.4, 0.6, 0.8],
        NOISE_SIGMA: [0.01, 0.02],
      },
    },
  },
  {
    id: "hierarchical-attractors",
    index: 5,
    title: "Hierarchical Attractors Enable Composition",
    question:
      "Can the network first learn simple attractors (e.g., ROTATE), then compose them into complex task attractors (e.g., ROTATE + FLIP)?",
    testMethod:
      "Proxy test: run multi-scale experiment at N=810 with strong global coupling. If Phi scales sub-linearly with N (Phi at N=810 > Phi at N=81 but not 10x higher), this indicates the network is forming hierarchical integration -- local clusters integrate first, then globally. Measure CAR (Coherence Amplification Ratio) as the proxy for hierarchical amplification.",
    primaryMetric: "Phi scaling with N + CAR at N=810 (proxy for hierarchical integration)",
    successCriteria:
      "CAR > 2.0 at N=810 with high GAMMA_GLOBAL; Phi > 0.08 sustained (40% above N=81 baseline)",
    efficiencyTool: "Hierarchical abstraction to scale to N=1M with local cluster heads",
    status: "partial",
    pendingReason:
      "Full test requires hierarchical attractor fields with local cluster heads, inter-level binding mechanisms, and a curriculum learning scheduler. The current proxy uses N=810 multi-scale sweep to observe emergent hierarchical structure in CAR.",
    sweepConfig: {
      scale: 810,
      ticksPerCombo: 40000,
      maxIterations: 3,
      gateStreakTarget: 1000,
      baseRanges: {
        TAU_ATT: [1.5, 2.0, 3.0],
        GAMMA_GLOBAL: [2.0, 3.0, 4.0],
        BETA_ENTROPY: [0.3, 0.5],
        DELTA_TEMPORAL: [0.4, 0.6],
        NOISE_SIGMA: [0.01],
      },
    },
  },
  {
    id: "sparse-coding",
    index: 6,
    title: "Sparse Coding Is Sufficient for Specialisation",
    question:
      "Is 2-6% neuron activity (biological sparsity) sufficient to produce stable attractors and Phi > 0.05?",
    testMethod:
      "Sweep BETA_ENTROPY to drive the network toward sparse activity. Use a larger network (810 neurons) to give enough cells for sparse coding. Measure participation rate and Phi. Confirm emergence holds at biologically realistic sparsity.",
    primaryMetric: "Participation rate (target 2-6%) + Phi > 0.05",
    successCriteria:
      "Phi > 0.05 sustained with 2-6% participation; attractor count > 0",
    efficiencyTool:
      "Sparse coupling abstraction to scale to N=10 000 without memory blowup",
    status: "testable",
    sweepConfig: {
      scale: 810,
      ticksPerCombo: 30000,
      maxIterations: 3,
      gateStreakTarget: 1000,
      baseRanges: {
        TAU_ATT: [1.0, 1.5, 2.0],
        GAMMA_GLOBAL: [2.0, 3.0],
        BETA_ENTROPY: [0.5, 0.8],
        DELTA_TEMPORAL: [0.4, 0.6],
        NOISE_SIGMA: [0.01],
      },
    },
  },
  {
    id: "small-world-topology",
    index: 7,
    title: "Small-World Topology Minimises Wiring Cost",
    question:
      "Does a small-world network topology (high clustering + short average path length) achieve high Phi with lower wiring cost than random or lattice topologies?",
    testMethod:
      "Run a standard sweep and observe networkClustering as a passive outcome. Hypothesis: configs with high Phi also show high clustering (small-world regime). Full test requires sweeping rewiring probability as an axis.",
    primaryMetric: "Phi + networkClustering (wiring cost proxy)",
    successCriteria:
      "Phi > 0.05 in runs where networkClustering > 0.4 (small-world regime)",
    efficiencyTool:
      "Topology configuration to minimise wiring cost while preserving emergence",
    status: "partial",
    pendingReason:
      "Network topology (rewiring probability, cluster radius, hub count) is not yet an exposed sweep parameter. The current test observes networkClustering as a passive outcome of parameter choices. Full topology sweeping requires a graph-construction upgrade.",
    sweepConfig: {
      scale: 810,
      ticksPerCombo: 25000,
      maxIterations: 2,
      gateStreakTarget: 800,
      baseRanges: {
        TAU_ATT: [1.0, 1.5, 2.0],
        GAMMA_GLOBAL: [1.5, 2.0, 3.0],
        BETA_ENTROPY: [0.3, 0.5],
        DELTA_TEMPORAL: [0.4],
        NOISE_SIGMA: [0.01, 0.02],
      },
    },
  },
];
