// Research hypotheses for the AMISGC emergent-specialisation research programme.
//
// Each hypothesis maps to a section of the refocused spec. Status codes:
//   "testable"  — the current sim has all required parameters; run button enabled.
//   "partial"   — a proxy sweep is possible now; full test needs a structural upgrade.
//   "pending"   — requires a planned structural upgrade; no sweep possible yet.
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
      "Run a Phase-0 parameter sweep. Measure attractor count and Phi. Gate I opening (Phi > 0.05, PU > 0.1, S_C > 0.1 sustained 1000 ticks) confirms global integration arose from local rules alone — no task-specific code involved.",
    primaryMetric: "Phi (global integration) + attractorCount",
    successCriteria: "Phi > 0.05 sustained for 1000 ticks; attractors > 0",
    efficiencyTool: "None — this is the core AMISGC mechanism",
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
      "Sweep BETA_ENTROPY as a proxy for metabolic pressure — higher entropy weight penalises broad participation in a similar way to a metabolic cost. Measure participation rate (sparsity) and Phi across the sweep. A proxy confirmation: sparsity rises and Phi holds as beta increases.",
    primaryMetric: "Participation rate (sparsity) + Phi across beta values",
    successCriteria:
      "Sparsity increases toward 2-6% as BETA_ENTROPY rises; Phi remains > 0.05",
    efficiencyTool: "Automated parameter sweep over BETA_ENTROPY as metabolic proxy",
    status: "partial",
    pendingReason:
      "FIRE_COST is a compile-time constant in the current sim. Exposing it as a swept axis requires a parameter-binding structural upgrade. The current sweep uses BETA_ENTROPY as a metabolic-pressure proxy.",
    sweepConfig: {
      scale: 81,
      ticksPerCombo: 20000,
      maxIterations: 2,
      gateStreakTarget: 500,
      baseRanges: {
        TAU_ATT: [1.5, 2.0],
        GAMMA_GLOBAL: [2.0, 3.0],
        BETA_ENTROPY: [0.1, 0.3, 0.5, 0.8],
        DELTA_TEMPORAL: [0.4],
        NOISE_SIGMA: [0.01, 0.02],
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
      "Compare Phi before and after a SWR offline-replay phase. Phi should increase by >= 10% post-SWR, indicating the replay compressed and strengthened the attractor landscape.",
    primaryMetric: "Delta-Phi before vs. after SWR phase",
    successCriteria: "Phi increases by >= 10% post-SWR consolidation",
    efficiencyTool: "None required for this hypothesis",
    status: "pending",
    pendingReason:
      "Requires an offline consolidation loop in the sim engine: memory-trace replay, hippocampal sharp-wave-ripple emulation, and a Phi-snapshot mechanism before and after the phase. This is a planned structural upgrade.",
  },
  {
    id: "context-cues",
    index: 4,
    title: "Context Cues Enable Task Switching",
    question:
      "Do apical (top-down) context inputs allow the network to switch attractors for different tasks, enabling dynamic specialisation?",
    testMethod:
      "Train on interleaved tasks with and without apical context inputs. Measure task-switching accuracy and attractor separation. Expected: accuracy with context > 80%; without context < 60%.",
    primaryMetric: "Task accuracy with context vs. without; attractor separation",
    successCriteria:
      "Accuracy with context > 80%; without context < 60%; attractor overlap < 0.1",
    efficiencyTool: "None required for this hypothesis",
    status: "pending",
    pendingReason:
      "Requires apical dendritic input channels and a multi-task interleaving scheduler. These structural components are on the brain-realistic upgrade roadmap (hierarchical layers + context signal routing).",
  },
  {
    id: "hierarchical-attractors",
    index: 5,
    title: "Hierarchical Attractors Enable Composition",
    question:
      "Can the network first learn simple attractors (e.g., ROTATE), then compose them into complex task attractors (e.g., ROTATE + FLIP)?",
    testMethod:
      "Train on simple tasks first. Then train on composed tasks. Measure Phi and task accuracy on composed tasks vs. simple tasks. Success if composed accuracy > 80%.",
    primaryMetric: "Task accuracy on composed tasks vs. simple tasks",
    successCriteria:
      "Composed task accuracy > 80% after transfer from simple-task attractors",
    efficiencyTool:
      "Hierarchical abstraction to scale to N=1M with local cluster heads",
    status: "pending",
    pendingReason:
      "Requires hierarchical attractor fields with local cluster heads, inter-level binding mechanisms, and a curriculum learning scheduler. Planned for the hierarchical topology upgrade.",
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
