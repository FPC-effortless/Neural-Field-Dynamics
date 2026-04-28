import type { Params } from "./params.js";

// Experiment specification: declarative parameter overrides + thresholds.
export interface ExperimentSpec {
  id: string;
  name: string;
  phase: string;
  desc: string;
  hypothesis: string;
  params: Partial<Params>;
  ticks: number;
  // Pass condition
  metric: string;
  targetVal: number;
  // 1 = >= targetVal passes, -1 = <= targetVal passes
  targetDir: 1 | -1;
}

const T_DEFAULT = 50000;
const T_FAST = 10000;
const T_LONG = 80000;

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8 — Conscious Attractor (canonical battery)
// ─────────────────────────────────────────────────────────────────────────────
const PHASE_8: ExperimentSpec[] = [
  {
    id: "8.1",
    name: "Conscious Attractor",
    phase: "P8",
    desc: "Canonical v12 — does Phi·SC attractor form with bottleneck?",
    params: {
      ALPHA_D: 0.8, BETA_A: 2.0, BETA_D: 1.0, LAMBDA_AP: 2.0,
      SELF_LP: 0.02, B: 1, MAINTAIN: 1.0, LAMBDA_B: 0.5,
      USE_BOTTLENECK: true,
    },
    hypothesis: "Phi>0.25 AND SC>0.4 within 50k ticks",
    metric: "networkPhi", targetVal: 0.25, targetDir: 1, ticks: T_DEFAULT,
  },
  {
    id: "8.2",
    name: "Self Collapse",
    phase: "P8",
    desc: "SELF_LP=0 — no slow apical. R must collapse.",
    params: {
      ALPHA_D: 0.8, BETA_A: 2.0, BETA_D: 1.0, LAMBDA_AP: 2.0,
      SELF_LP: 0, B: 1, MAINTAIN: 1.0, LAMBDA_B: 0,
      USE_BOTTLENECK: true,
    },
    hypothesis: "R→0 without slow self-model",
    metric: "networkR", targetVal: 0.08, targetDir: -1, ticks: T_DEFAULT,
  },
  {
    id: "8.3a",
    name: "Desire αD=0",
    phase: "P8",
    desc: "Passive predictor — no value modulation.",
    params: {
      ALPHA_D: 0, BETA_A: 2.0, BETA_D: 1.0, LAMBDA_AP: 2.0,
      SELF_LP: 0.02, B: 1, MAINTAIN: 1.0, LAMBDA_B: 0,
      USE_BOTTLENECK: true,
    },
    hypothesis: "IC<0.1, J_emb lower than 8.1",
    metric: "networkIC", targetVal: 0.1, targetDir: -1, ticks: T_DEFAULT,
  },
  {
    id: "8.3b",
    name: "Desire αD=0.8 (canonical)",
    phase: "P8",
    desc: "Canonical αD — expect peak J** and IC.",
    params: {
      ALPHA_D: 0.8, BETA_A: 2.0, BETA_D: 1.0, LAMBDA_AP: 2.0,
      SELF_LP: 0.02, B: 1, MAINTAIN: 1.0, LAMBDA_B: 0,
      USE_BOTTLENECK: true,
    },
    hypothesis: "Highest J** of desire sweep",
    metric: "J_star", targetVal: 0.35, targetDir: 1, ticks: T_DEFAULT,
  },
  {
    id: "8.4",
    name: "Dopamine βD=0",
    phase: "P8",
    desc: "No dopamine — does coordination still emerge?",
    params: {
      ALPHA_D: 0.8, BETA_A: 2.0, BETA_D: 0, LAMBDA_AP: 2.0,
      SELF_LP: 0.02, B: 1, MAINTAIN: 1.0, LAMBDA_B: 0,
      USE_BOTTLENECK: true,
    },
    hypothesis: "Phi lower without TD reward signal",
    metric: "networkPhi", targetVal: 0.15, targetDir: -1, ticks: T_DEFAULT,
  },
  {
    id: "8.5",
    name: "No Attention",
    phase: "P8",
    desc: "βA≈0 — uniform attention. Bottleneck ineffective.",
    params: {
      ALPHA_D: 0.8, BETA_A: 0.001, BETA_D: 1.0, LAMBDA_AP: 2.0,
      SELF_LP: 0.02, B: 1, MAINTAIN: 1.0, LAMBDA_B: 0,
      USE_BOTTLENECK: false,
    },
    hypothesis: "SC degrades without sharp attention",
    metric: "networkSC", targetVal: 0.2, targetDir: -1, ticks: T_DEFAULT,
  },
  {
    id: "8.6",
    name: "Free Will",
    phase: "P8",
    desc: "λ_ap=3.0 — maximal apical dominance.",
    params: {
      ALPHA_D: 0.8, BETA_A: 2.0, BETA_D: 1.0, LAMBDA_AP: 3.0,
      SELF_LP: 0.02, B: 1, MAINTAIN: 1.0, LAMBDA_B: 0,
      USE_BOTTLENECK: true,
    },
    hypothesis: "IC>0.5 — apical consistently overrides reflex",
    metric: "networkIC", targetVal: 0.5, targetDir: 1, ticks: T_DEFAULT,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Phase E — Embodiment
// ─────────────────────────────────────────────────────────────────────────────
const PHASE_E: ExperimentSpec[] = [
  {
    id: "E1", name: "No Body", phase: "PE",
    desc: "LAMBDA_B=0 — body decoupled. Baseline for embodiment.",
    params: { ALPHA_D: 0.8, BETA_A: 2.0, BETA_D: 1.0, LAMBDA_AP: 2.0, SELF_LP: 0.02, B: 1, MAINTAIN: 1.0, LAMBDA_B: 0, USE_BOTTLENECK: false },
    hypothesis: "J_emb lower without body coupling",
    metric: "J_emb", targetVal: 0.25, targetDir: -1, ticks: T_DEFAULT,
  },
  {
    id: "E2", name: "Body, No Value", phase: "PE",
    desc: "Body active but αD=0. Homeostasis without desire.",
    params: { ALPHA_D: 0, BETA_A: 2.0, BETA_D: 1.0, LAMBDA_AP: 2.0, SELF_LP: 0.02, B: 1, MAINTAIN: 1.0, LAMBDA_B: 0.5, USE_BOTTLENECK: false },
    hypothesis: "S_body>0 but IC≈0 — body without agency",
    metric: "networkSbody", targetVal: 0.2, targetDir: 1, ticks: T_DEFAULT,
  },
  {
    id: "E3", name: "Body + Value", phase: "PE",
    desc: "Canonical embodied — full interoceptive coupling.",
    params: { ALPHA_D: 0.8, BETA_A: 2.0, BETA_D: 1.0, LAMBDA_AP: 2.0, SELF_LP: 0.02, B: 1, MAINTAIN: 1.0, LAMBDA_B: 0.5, USE_BOTTLENECK: true },
    hypothesis: "J_emb > E1 and E2 — body+value synergy",
    metric: "J_emb", targetVal: 0.3, targetDir: 1, ticks: T_DEFAULT,
  },
  {
    id: "E6", name: "Impulse Control", phase: "PE",
    desc: "λ_ap=2.5, αD=1.2 — max IC test.",
    params: { ALPHA_D: 1.2, BETA_A: 2.0, BETA_D: 1.0, LAMBDA_AP: 2.5, SELF_LP: 0.02, B: 1, MAINTAIN: 1.0, LAMBDA_B: 0.5, USE_BOTTLENECK: true },
    hypothesis: "IC>0.4 sustained — predictive control over impulse",
    metric: "networkIC", targetVal: 0.4, targetDir: 1, ticks: T_DEFAULT,
  },
  {
    id: "E7", name: "Full Agent", phase: "PE",
    desc: "All features: B=2 dendritic branches, body, value, bottleneck, TD.",
    params: { ALPHA_D: 0.8, BETA_A: 2.0, BETA_D: 2.0, LAMBDA_AP: 2.0, SELF_LP: 0.02, B: 2, MAINTAIN: 1.0, LAMBDA_B: 0.5, USE_BOTTLENECK: true },
    hypothesis: "Highest J_emb — structural+field+body synergy",
    metric: "J_emb", targetVal: 0.4, targetDir: 1, ticks: T_DEFAULT,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Ablations
// ─────────────────────────────────────────────────────────────────────────────
const PHASE_X: ExperimentSpec[] = [
  {
    id: "X1", name: "No Plasticity", phase: "PX",
    desc: "Frozen weights — no learning. J** must stay near 0.",
    params: { ALPHA_D: 0.8, BETA_A: 2.0, BETA_D: 1.0, LAMBDA_AP: 2.0, SELF_LP: 0.02, B: 1, MAINTAIN: 1.0, LAMBDA_B: 0, USE_BOTTLENECK: true, ETA_B: 0, ETA_A: 0, ETA_V: 0, HEBB: 0 },
    hypothesis: "J**<0.1 with frozen weights",
    metric: "J_star", targetVal: 0.1, targetDir: -1, ticks: T_DEFAULT,
  },
  {
    id: "X2", name: "High Metabolic", phase: "PX",
    desc: "MAINTAIN=1.8 — near-collapse. Does consciousness persist?",
    params: { ALPHA_D: 0.8, BETA_A: 2.0, BETA_D: 1.0, LAMBDA_AP: 2.0, SELF_LP: 0.02, B: 1, MAINTAIN: 1.8, LAMBDA_B: 0, USE_BOTTLENECK: true },
    hypothesis: "Phi persists via coop even under ATP scarcity",
    metric: "networkPhi", targetVal: 0.15, targetDir: 1, ticks: T_DEFAULT,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CORE-1 — Attractor Formation parameter sweeps
// ─────────────────────────────────────────────────────────────────────────────
const CORE_1: ExperimentSpec[] = [];
for (const M of [0.6, 1.0, 1.4]) {
  for (const TH of [0.2, 0.4, 0.6]) {
    for (const LA of [0.5, 1.5, 2.5]) {
      CORE_1.push({
        id: `C1.coarse.M${M}.T${TH}.L${LA}`,
        name: `Coarse: MAINTAIN=${M} THRESH=${TH} λap=${LA}`,
        phase: "C1",
        desc: "Stage A coarse sweep over metabolic + threshold + apical influence.",
        params: { MAINTAIN: M, THRESH: TH, LAMBDA_AP: LA, ATT_ITERS: 5, BETA_A: 1, USE_BOTTLENECK: true, TOPK_FRACTION: 0.2 },
        hypothesis: "Phi>0.6 AND SC>0.15 AND PU>0.1 sustained",
        metric: "networkPhi", targetVal: 0.6, targetDir: 1, ticks: T_FAST,
      });
    }
  }
}
for (const TF of [0.1, 0.2, 0.3, 0.4]) {
  CORE_1.push({
    id: `C1.bottleneck.${TF}`,
    name: `Bottleneck width TOPK_FRACTION=${TF}`,
    phase: "C1",
    desc: "Sweep conscious bottleneck width to find optimal attention bandwidth.",
    params: { TOPK_FRACTION: TF, BETA_A: 2.0, LAMBDA_AP: 2.0, USE_BOTTLENECK: true },
    hypothesis: "Optimal TOPK_FRACTION maximises Phi*SC",
    metric: "networkPhi", targetVal: 0.4, targetDir: 1, ticks: T_FAST,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE-1 ablations
// ─────────────────────────────────────────────────────────────────────────────
const CORE_1_ABL: ExperimentSpec[] = [
  {
    id: "C1.abl.no_apical", name: "Ablation: no apical", phase: "C1",
    desc: "λ_ap=0 — disable apical input.",
    params: { LAMBDA_AP: 0, USE_BOTTLENECK: true },
    hypothesis: "Phi collapses without apical context",
    metric: "networkPhi", targetVal: 0.2, targetDir: -1, ticks: T_FAST,
  },
  {
    id: "C1.abl.no_iter", name: "Ablation: no attractor iters", phase: "C1",
    desc: "ATT_ITERS=0 — freeze attractor iteration.",
    params: { ATT_ITERS: 0, USE_BOTTLENECK: true },
    hypothesis: "SC collapses without attractor relaxation",
    metric: "networkSC", targetVal: 0.1, targetDir: -1, ticks: T_FAST,
  },
  {
    id: "C1.abl.no_inhibition", name: "Ablation: no lateral inhibition", phase: "C1",
    desc: "USE_BOTTLENECK=false — broadcast attention.",
    params: { USE_BOTTLENECK: false, BETA_A: 0.001 },
    hypothesis: "SC drops without competition",
    metric: "networkSC", targetVal: 0.15, targetDir: -1, ticks: T_FAST,
  },
  {
    id: "C1.abl.no_self", name: "Ablation: no self-model memory", phase: "C1",
    desc: "SELF_LP=1.0 — full overwrite, no self-model.",
    params: { SELF_LP: 1.0, USE_BOTTLENECK: true },
    hypothesis: "R drops without self-model continuity",
    metric: "networkR", targetVal: 0.1, targetDir: -1, ticks: T_FAST,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CORE-2 — Attractor Reuse (state initialisation tests)
// ─────────────────────────────────────────────────────────────────────────────
const CORE_2: ExperimentSpec[] = [
  {
    id: "C2.copy_train", name: "COPY train (capture attractor)", phase: "C2",
    desc: "Train on COPY 30k ticks; capture attractor into library.",
    params: { TASK_TICKS: 30000, USE_BOTTLENECK: true },
    hypothesis: "Stable attractor with Phi>0.4 by 30k",
    metric: "networkPhi", targetVal: 0.4, targetDir: 1, ticks: 30000,
  },
  {
    id: "C2.reverse_seed", name: "REVERSE seeded from COPY attractor", phase: "C2",
    desc: "Re-init apical from captured attractor with noise. Faster ACS expected.",
    params: { TASK_TICKS: 20000, USE_BOTTLENECK: true },
    hypothesis: "ACS<1 vs distance-matched control",
    metric: "networkPhi", targetVal: 0.4, targetDir: 1, ticks: 20000,
  },
  {
    id: "C2.alternate_seed", name: "ALTERNATE (moderate)", phase: "C2",
    desc: "Moderate-distance reuse test.",
    params: { TASK_TICKS: 20000, USE_BOTTLENECK: true },
    hypothesis: "ACS<1 still; smaller margin",
    metric: "networkPhi", targetVal: 0.35, targetDir: 1, ticks: 20000,
  },
  {
    id: "C2.novel_seed", name: "NOVEL (far)", phase: "C2",
    desc: "Far-distance reuse test (negative control).",
    params: { TASK_TICKS: 20000, USE_BOTTLENECK: true },
    hypothesis: "ACS≥1 — no transfer benefit on far task",
    metric: "networkPhi", targetVal: 0.2, targetDir: 1, ticks: 20000,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CORE-2.5 — Geometry; CORE-3.5 — Routing/context; CORE-4 — Replay; CORE-4.5 Memory
// ─────────────────────────────────────────────────────────────────────────────
const CORE_25: ExperimentSpec[] = [
  {
    id: "C2.5.geometry", name: "Attractor Geometry — task distance curve", phase: "C2.5",
    desc: "Plot ACS for graded task similarity (COPY → REVERSE → ROTATE → ALTERNATE → NOVEL).",
    params: { TASK_TICKS: 5000, USE_BOTTLENECK: true },
    hypothesis: "Smooth monotonic ACS vs task distance",
    metric: "networkPhi", targetVal: 0.3, targetDir: 1, ticks: 30000,
  },
];

const CORE_35: ExperimentSpec[] = [
  {
    id: "C3.5.routing", name: "Routing & Context Switching", phase: "C3.5",
    desc: "Alternate rules every 1000 ticks. Measure switch latency and dominant subnetworks.",
    params: { TASK_TICKS: 1000, USE_BOTTLENECK: true },
    hypothesis: "Routing stability >0.5; switch latency <200 ticks",
    metric: "networkSC", targetVal: 0.3, targetDir: 1, ticks: 30000,
  },
];

const CORE_4: ExperimentSpec[] = [
  {
    id: "C4.replay", name: "Compressed Offline Replay", phase: "C4",
    desc: "Offline replay with weight decay + L1 sparsity. Improves ARF, ACS without diversity collapse.",
    params: { TASK_TICKS: 1500, DECAY: 0.0014, USE_BOTTLENECK: true },
    hypothesis: "ARF improves; ACS<1; attractor diversity preserved",
    metric: "networkR", targetVal: 0.3, targetDir: 1, ticks: T_FAST,
  },
];

const CORE_45: ExperimentSpec[] = [
  {
    id: "C4.5.MRP", name: "Memory Retrieval Precision (MRP)", phase: "C4.5",
    desc: "Retrieval from partial cue. Pass MRP > 80%.",
    params: { TASK_TICKS: 2000, USE_BOTTLENECK: true },
    hypothesis: "MRP > 80%",
    metric: "networkR", targetVal: 0.5, targetDir: 1, ticks: T_FAST,
  },
  {
    id: "C4.5.interference", name: "Interference A→B→C→A", phase: "C4.5",
    desc: "Sequential task interference test for retention.",
    params: { TASK_TICKS: 2000, USE_BOTTLENECK: true },
    hypothesis: "Retention high after re-exposure to A",
    metric: "networkPhi", targetVal: 0.3, targetDir: 1, ticks: T_FAST,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CORE-5 → 6.5 — embodiment / consequences / TCAS
// ─────────────────────────────────────────────────────────────────────────────
const CORE_5_65: ExperimentSpec[] = [
  {
    id: "C5.embodiment", name: "Minimal Embodiment", phase: "C5",
    desc: "Body coupling alone (no desire). Re-run reuse tests in embodied context.",
    params: { ALPHA_D: 0, LAMBDA_B: 0.7, USE_BOTTLENECK: true },
    hypothesis: "S_body>0.2; PC>0.3; J_emb increases",
    metric: "networkSbody", targetVal: 0.2, targetDir: 1, ticks: T_DEFAULT,
  },
  {
    id: "C6.delayed", name: "Delayed Consequences", phase: "C6",
    desc: "Food gives immediate energy; health penalty after 50 ticks.",
    params: { ALPHA_D: 0.8, LAMBDA_B: 0.5, BODY_FEED_AMT: 0.45, USE_BOTTLENECK: true },
    hypothesis: "IC > 0.5",
    metric: "networkIC", targetVal: 0.5, targetDir: 1, ticks: T_DEFAULT,
  },
  {
    id: "C6.5.TCAS", name: "Temporal Credit Assignment (TCAS)", phase: "C6.5",
    desc: "Reward delayed 50–100 ticks after critical action with distractors.",
    params: { ALPHA_D: 0.8, LAMBDA_B: 0.5, ETA_V_TD: 0.04, USE_BOTTLENECK: true },
    hypothesis: "TCAS > 0.5",
    metric: "networkIC", targetVal: 0.5, targetDir: 1, ticks: T_DEFAULT,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 7 — Compositional reasoning (ARC-level gateway)
// ─────────────────────────────────────────────────────────────────────────────
const PHASE_7: ExperimentSpec[] = [
  {
    id: "P7.1.rules", name: "7.1 Rule Extraction", phase: "P7",
    desc: "Train on transformations (copy, reverse, rotate, alternate); test on unseen inputs.",
    params: { TASK_TICKS: 1500, USE_BOTTLENECK: true },
    hypothesis: "Generalisation accuracy high",
    metric: "networkPhi", targetVal: 0.35, targetDir: 1, ticks: T_FAST,
  },
  {
    id: "P7.2.systematic", name: "7.2 Systematic Generalisation", phase: "P7",
    desc: "Train short sequences; test longer ones. Requires genuine abstraction.",
    params: { TASK_TICKS: 1500, USE_BOTTLENECK: true },
    hypothesis: "Accuracy on longer sequences > 80%",
    metric: "networkPhi", targetVal: 0.35, targetDir: 1, ticks: T_FAST,
  },
  {
    id: "P7.3.multistep", name: "7.3 Multi-Step Reasoning", phase: "P7",
    desc: "Chain 2–3 operations (e.g. reverse then alternate).",
    params: { TASK_TICKS: 1200, USE_BOTTLENECK: true },
    hypothesis: "3-step chain success > 50%",
    metric: "networkSC", targetVal: 0.3, targetDir: 1, ticks: T_FAST,
  },
  {
    id: "P7.4.hidden_rule", name: "7.4 Hidden Rule Extraction", phase: "P7",
    desc: "Hidden rule (rotate+colour swap) with no repeated patterns; test on novel inputs.",
    params: { TASK_TICKS: 2000, USE_BOTTLENECK: true },
    hypothesis: "Generalisation accuracy ≥ 70%",
    metric: "networkPhi", targetVal: 0.35, targetDir: 1, ticks: T_FAST,
  },
  {
    id: "P7.5.depth", name: "7.5 Algorithmic Depth Scaling", phase: "P7",
    desc: "Tasks requiring 1, 2, 3 transformation steps.",
    params: { TASK_TICKS: 1200, USE_BOTTLENECK: true },
    hypothesis: "Graceful degradation, not collapse",
    metric: "networkPhi", targetVal: 0.3, targetDir: 1, ticks: T_FAST,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 8.5 — Hierarchical planning + counterfactual
// ─────────────────────────────────────────────────────────────────────────────
const PHASE_85: ExperimentSpec[] = [
  {
    id: "P8.5.1.plan_vs_reflex", name: "8.5.1 Plan vs Reflex", phase: "P8.5",
    desc: "Short risky path vs long safe path.",
    params: { ALPHA_D: 0.8, LAMBDA_B: 0.5, LAMBDA_AP: 2.5, USE_BOTTLENECK: true },
    hypothesis: "Plan preference > reflex",
    metric: "networkIC", targetVal: 0.5, targetDir: 1, ticks: T_DEFAULT,
  },
  {
    id: "P8.5.2.subgoal", name: "8.5.2 Subgoal Formation", phase: "P8.5",
    desc: "Multi-stage objectives (collect key → open door → goal).",
    params: { ALPHA_D: 0.8, LAMBDA_B: 0.5, LAMBDA_AP: 2.0, USE_BOTTLENECK: true },
    hypothesis: "Planning Depth ≥ 2",
    metric: "networkPD", targetVal: 2, targetDir: 1, ticks: T_DEFAULT,
  },
  {
    id: "P8.6.counterfactual", name: "8.6 Counterfactual Planning (CSR)", phase: "P8.5",
    desc: "Two paths: short→trap, long→safe reward. Choose without ever experiencing trap.",
    params: { ALPHA_D: 0.8, LAMBDA_B: 0.5, LAMBDA_AP: 2.5, USE_BOTTLENECK: true },
    hypothesis: "First-trial CSR > 0.7",
    metric: "networkIC", targetVal: 0.7, targetDir: 1, ticks: T_DEFAULT,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 9 — Attractor inheritance + negative transfer
// ─────────────────────────────────────────────────────────────────────────────
const PHASE_9: ExperimentSpec[] = [
  {
    id: "P9.library", name: "9 Attractor Inheritance Library", phase: "P9",
    desc: "Capture attractors across varied tasks; test reuse.",
    params: { TASK_TICKS: 1500, USE_BOTTLENECK: true },
    hypothesis: "Library reuse improves convergence on related tasks",
    metric: "networkR", targetVal: 0.4, targetDir: 1, ticks: T_DEFAULT,
  },
  {
    id: "P9.6.neg_transfer", name: "9.6 Negative Transfer Detection", phase: "P9",
    desc: "Train on COPY; test on conflicting task — should slow down (ACS>1).",
    params: { TASK_TICKS: 1500, USE_BOTTLENECK: true },
    hypothesis: "ACS > 1 — system avoids reusing wrong attractor",
    metric: "networkPhi", targetVal: 0.2, targetDir: -1, ticks: T_DEFAULT,
  },
  {
    id: "P9.5.composition", name: "9.5 Attractor Composition as Programmes", phase: "P9.5",
    desc: "Sequential chaining A→B→C; conditional selection.",
    params: { TASK_TICKS: 1500, USE_BOTTLENECK: true },
    hypothesis: "Chained execution preserves SC",
    metric: "networkSC", targetVal: 0.35, targetDir: 1, ticks: T_DEFAULT,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 10 — Symbol emergence (variable binding)
// ─────────────────────────────────────────────────────────────────────────────
const PHASE_10: ExperimentSpec[] = [
  {
    id: "P10.1.symbols", name: "10.1 Symbol Emergence", phase: "P10",
    desc: "Test attractors as internal symbols for analogy tasks.",
    params: { TASK_TICKS: 2000, USE_BOTTLENECK: true },
    hypothesis: "Symbol-attractor MI > 0.2 bits",
    metric: "networkPhi", targetVal: 0.35, targetDir: 1, ticks: T_DEFAULT,
  },
  {
    id: "P10.4.binding", name: "10.4 Variable Binding", phase: "P10",
    desc: "A:B :: C:? with abstract tokens. Infer relation, don't memorise.",
    params: { TASK_TICKS: 2000, USE_BOTTLENECK: true },
    hypothesis: "Accuracy on unseen symbols > 70%",
    metric: "networkSC", targetVal: 0.35, targetDir: 1, ticks: T_DEFAULT,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 11 — Spatial nav + grid cells
// ─────────────────────────────────────────────────────────────────────────────
const PHASE_11: ExperimentSpec[] = [
  {
    id: "P11.grid_cells", name: "11 Grid Cells (Moran's I)", phase: "P11",
    desc: "Large arena, egocentric input, predictive objective.",
    params: { TASK_TICKS: 3000, USE_BOTTLENECK: true },
    hypothesis: "Grid score (Moran's I) > 0.3 ; remapping observed",
    metric: "networkSC", targetVal: 0.35, targetDir: 1, ticks: T_DEFAULT,
  },
  {
    id: "P11.5.transfer", name: "11.5 Map Reuse / Transfer", phase: "P11",
    desc: "Learn env A; transfer to rotated/mirrored env B.",
    params: { TASK_TICKS: 3000, USE_BOTTLENECK: true },
    hypothesis: "Navigation efficiency > baseline",
    metric: "networkR", targetVal: 0.4, targetDir: 1, ticks: T_DEFAULT,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 11.5 — Language grounding
// ─────────────────────────────────────────────────────────────────────────────
const PHASE_115: ExperimentSpec[] = [
  {
    id: "P11.5.LGS", name: "11.5 Language Grounding (LGS)", phase: "P11.5",
    desc: "Symbol grounding, instruction following, compositional commands.",
    params: { TASK_TICKS: 2000, USE_BOTTLENECK: true },
    hypothesis: "LGS > 0.5",
    metric: "networkPhi", targetVal: 0.4, targetDir: 1, ticks: T_DEFAULT,
  },
  {
    id: "P11.6.composition", name: "11.6 Compositional Generalisation", phase: "P11.5",
    desc: "Train 'go to red object' & 'pick blue object'; test 'pick red object'.",
    params: { TASK_TICKS: 2000, USE_BOTTLENECK: true },
    hypothesis: "Zero-shot accuracy > 80%",
    metric: "networkSC", targetVal: 0.4, targetDir: 1, ticks: T_DEFAULT,
  },
  {
    id: "P11.7.instructions", name: "11.7 Multi-Step Execution", phase: "P11.5",
    desc: "Sequence: 'go to food, then avoid hazard, then rest'.",
    params: { TASK_TICKS: 2000, USE_BOTTLENECK: true },
    hypothesis: "Sequence success > 60%",
    metric: "networkPD", targetVal: 2, targetDir: 1, ticks: T_DEFAULT,
  },
  {
    id: "P11.8.alignment", name: "11.8 Language↔Attractor Alignment", phase: "P11.5",
    desc: "I(language token; attractor state).",
    params: { TASK_TICKS: 2000, USE_BOTTLENECK: true },
    hypothesis: "MI > 0.2 bits",
    metric: "networkPhi", targetVal: 0.35, targetDir: 1, ticks: T_DEFAULT,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 12 — Lifelong open-ended intelligence
// ─────────────────────────────────────────────────────────────────────────────
const PHASE_12: ExperimentSpec[] = [
  {
    id: "P12.1.novel_inject", name: "12.1 Novel Task Injection", phase: "P12",
    desc: "Continuous new tasks without reset.",
    params: { TASK_TICKS: 1500, USE_BOTTLENECK: true },
    hypothesis: "Adaptation speed and retention",
    metric: "networkR", targetVal: 0.4, targetDir: 1, ticks: T_LONG,
  },
  {
    id: "P12.2.KCR", name: "12.2 Knowledge Compression Ratio", phase: "P12",
    desc: "Tasks solved per attractor stored, over hundreds of tasks.",
    params: { TASK_TICKS: 1000, USE_BOTTLENECK: true },
    hypothesis: "KCR stable or growing",
    metric: "networkR", targetVal: 0.35, targetDir: 1, ticks: T_LONG,
  },
  {
    id: "P12.3.self_improve", name: "12.3 Self-Improvement (LLS)", phase: "P12",
    desc: "Meta-adjustment of learning rates and attractor parameters.",
    params: { TASK_TICKS: 1500, ETA_M: 0.025, USE_BOTTLENECK: true },
    hypothesis: "LLS > 0.8",
    metric: "networkR", targetVal: 0.5, targetDir: 1, ticks: T_LONG,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ARC mock benchmark (final validation)
// ─────────────────────────────────────────────────────────────────────────────
const ARC_MOCK: ExperimentSpec[] = [
  {
    id: "ARC.mock", name: "ARC Mock Benchmark", phase: "ARC",
    desc: "20–50 ARC-style tasks (unseen). Pass: ≥50% solve rate.",
    params: { TASK_TICKS: 800, USE_BOTTLENECK: true },
    hypothesis: "Solve rate ≥ 50%",
    metric: "networkPhi", targetVal: 0.4, targetDir: 1, ticks: T_DEFAULT,
  },
];

export const ALL_EXPERIMENTS: ExperimentSpec[] = [
  ...CORE_1,
  ...CORE_1_ABL,
  ...CORE_2,
  ...CORE_25,
  ...CORE_35,
  ...CORE_4,
  ...CORE_45,
  ...CORE_5_65,
  ...PHASE_7,
  ...PHASE_8,
  ...PHASE_85,
  ...PHASE_9,
  ...PHASE_10,
  ...PHASE_11,
  ...PHASE_115,
  ...PHASE_12,
  ...PHASE_E,
  ...PHASE_X,
  ...ARC_MOCK,
];

export const PHASE_GROUPS: Array<{ phase: string; label: string; experiments: ExperimentSpec[] }> = [
  { phase: "C1", label: "CORE-1 — Attractor Formation", experiments: [...CORE_1, ...CORE_1_ABL] },
  { phase: "C2", label: "CORE-2 — Attractor Reuse", experiments: CORE_2 },
  { phase: "C2.5", label: "CORE-2.5 — Geometry", experiments: CORE_25 },
  { phase: "C3.5", label: "CORE-3.5 — Routing", experiments: CORE_35 },
  { phase: "C4", label: "CORE-4 — Compressed Replay", experiments: CORE_4 },
  { phase: "C4.5", label: "CORE-4.5 — Structured Memory", experiments: CORE_45 },
  { phase: "C5/6/6.5", label: "CORE-5/6/6.5 — Embodiment, Delayed Consequences, TCAS", experiments: CORE_5_65 },
  { phase: "P7", label: "PHASE 7 — Compositional Reasoning (ARC-Level)", experiments: PHASE_7 },
  { phase: "P8", label: "PHASE 8 — Conscious Attractor", experiments: PHASE_8 },
  { phase: "P8.5", label: "PHASE 8.5 — Hierarchical & Counterfactual Planning", experiments: PHASE_85 },
  { phase: "P9", label: "PHASE 9 — Attractor Inheritance & Negative Transfer", experiments: PHASE_9 },
  { phase: "P10", label: "PHASE 10 — Symbol Emergence & Variable Binding", experiments: PHASE_10 },
  { phase: "P11", label: "PHASE 11 — Spatial Navigation & Grid Cells", experiments: PHASE_11 },
  { phase: "P11.5", label: "PHASE 11.5 — Language Grounding", experiments: PHASE_115 },
  { phase: "P12", label: "PHASE 12 — Lifelong Open-Ended Intelligence", experiments: PHASE_12 },
  { phase: "PE", label: "Embodiment battery", experiments: PHASE_E },
  { phase: "PX", label: "Ablations", experiments: PHASE_X },
  { phase: "ARC", label: "ARC mock benchmark", experiments: ARC_MOCK },
];

export function findExperiment(id: string): ExperimentSpec | undefined {
  return ALL_EXPERIMENTS.find((e) => e.id === id);
}
