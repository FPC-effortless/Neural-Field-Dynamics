// AMISGC v12.0 default parameters
export interface Params {
  G: number;
  N: number;
  IN_IDS: number[];
  TOPK_FRACTION: number;
  GAMMA_TD: number;

  MAINTAIN: number;
  MAINTAIN_INPUT: number;
  REGEN: number;
  FIRE_COST: number;
  COOP_BONUS: number;
  COOP_W: number;
  ATP_MAX: number;
  ATP_TARGET: number;
  ATP_START_MIN: number;
  ATP_START_MAX: number;
  LAMBDA_ATP: number;
  LAMBDA_FIRE: number;
  LAMBDA_COH: number;

  THRESH: number;
  EPS: number;
  HEBB: number;
  DECAY: number;
  W_MAX: number;
  W_PRUNE: number;
  W_INIT_LO: number;
  W_INIT_HI: number;
  H_INIT: number;
  L_CRIT: number;
  ATROPHY_RATE: number;
  RECOVERY_RATE: number;
  H_FLOOR_RECOVERY: number;
  H_MIN: number;
  H_ATROPHIED: number;
  H_STRESSED: number;
  INACTIVITY_SCALE: number;
  P_REGROW: number;
  REGROW_BIAS_MI: number;
  REFRACT: number;
  DRIFT_T: number;
  K_LOCAL: number;
  REWIRE: number;
  DEV_TICKS: number;
  DEV_AMP: number;
  ENV_AMP: number;
  TASK_TICKS: number;
  MI_WINDOW: number;

  B: number;
  DEND_THRESH: number;
  DEND_K: number;
  COIN_WINDOW: number;
  COIN_K: number;

  ETA_ATT: number;
  BETA_A: number;
  ALPHA_D: number;
  ATT_ITERS: number;
  LAMBDA_AP: number;
  LAMBDA_SELF: number;

  ETA_B: number;
  ETA_A: number;
  ETA_V: number;
  ETA_M: number;
  ETA_P: number;

  BETA_D: number;
  ETA_V_TD: number;

  SELF_LP: number;
  LAMBDA_B: number;
  BODY_ENERGY_DRAIN: number;
  BODY_FEED_PROB: number;
  BODY_FEED_AMT: number;
  BODY_HEALTH_TARGET: number;
  BODY_ENERGY_TARGET: number;

  USE_BOTTLENECK: boolean;

  // v12 revision — soft globally coupled attractor field
  ATTN_MODE: "soft" | "topk";
  TAU_ATT: number;        // soft-attention temperature
  GAMMA_GLOBAL: number;   // global coupling strength
  BETA_ENTROPY: number;   // entropy regularisation weight on the attractor
  DELTA_TEMPORAL: number; // temporal coherence pull toward a_slow
  NOISE_SIGMA: number;    // gaussian noise on the apical update
  ALPHA_SLOW: number;     // EMA rate for the slow apical state
  PU_LAG: number;         // future-input lag (in ticks) used for PU estimate
}

export function defaultParams(scale: 81 | 810 | 81000 = 81): Params {
  let G: number;
  if (scale === 81) G = 9;
  else if (scale === 810) G = Math.round(Math.sqrt(810));
  else G = Math.round(Math.sqrt(81000));
  const N = G * G;
  const inputCount = Math.max(7, Math.floor(N / 12));
  const IN_IDS: number[] = [];
  const stride = Math.max(1, Math.floor(N / inputCount));
  for (let i = 0; i < inputCount; i++) IN_IDS.push((i * stride) % N);

  return {
    G,
    N,
    IN_IDS,
    TOPK_FRACTION: 0.22,
    GAMMA_TD: 0.95,

    MAINTAIN: 1.0,
    MAINTAIN_INPUT: 0.04,
    REGEN: 1.1,
    FIRE_COST: 4.0,
    COOP_BONUS: 6.0,
    COOP_W: 8,
    ATP_MAX: 100,
    ATP_TARGET: 55,
    ATP_START_MIN: 42,
    ATP_START_MAX: 68,
    LAMBDA_ATP: 0.0003,
    LAMBDA_FIRE: 0.04,
    LAMBDA_COH: 0.08,

    THRESH: 0.4,
    EPS: 0.08,
    HEBB: 0.01,
    DECAY: 0.0008,
    W_MAX: 2.0,
    W_PRUNE: 0.004,
    W_INIT_LO: 0.18,
    W_INIT_HI: 0.55,
    H_INIT: 1.0,
    L_CRIT: 0.18,
    ATROPHY_RATE: 0.0008,
    RECOVERY_RATE: 0.025,
    H_FLOOR_RECOVERY: 0.00015,
    H_MIN: 0.05,
    H_ATROPHIED: 0.35,
    H_STRESSED: 0.65,
    INACTIVITY_SCALE: 2.5,
    P_REGROW: 0.004,
    REGROW_BIAS_MI: 0.7,
    REFRACT: 3,
    DRIFT_T: 120,
    K_LOCAL: 8,
    REWIRE: 0.5,
    DEV_TICKS: 50,
    DEV_AMP: 0.22,
    ENV_AMP: 0.85,
    TASK_TICKS: 800,
    MI_WINDOW: 300,

    B: 1,
    DEND_THRESH: 0.30,
    DEND_K: 5.0,
    COIN_WINDOW: 3,
    COIN_K: 3,

    ETA_ATT: 0.05,
    BETA_A: 2.0,
    ALPHA_D: 0.8,
    ATT_ITERS: 5,
    LAMBDA_AP: 2.0,
    LAMBDA_SELF: 0.1,

    ETA_B: 0.01,
    ETA_A: 0.005,
    ETA_V: 0.008,
    ETA_M: 0.015,
    ETA_P: 0.003,

    BETA_D: 1.0,
    ETA_V_TD: 0.02,

    SELF_LP: 0.02,
    LAMBDA_B: 0.5,
    BODY_ENERGY_DRAIN: 0.0002,
    BODY_FEED_PROB: 0.0005,
    BODY_FEED_AMT: 0.35,
    BODY_HEALTH_TARGET: 0.8,
    BODY_ENERGY_TARGET: 0.7,

    // v12 revision: soft attention is the default; legacy top-k is opt-in
    USE_BOTTLENECK: false,

    ATTN_MODE: "soft",
    TAU_ATT: 0.7,
    GAMMA_GLOBAL: 1.0,
    BETA_ENTROPY: 0.2,
    DELTA_TEMPORAL: 0.3,
    NOISE_SIGMA: 0.02,
    ALPHA_SLOW: 0.02,
    PU_LAG: 4,
  };
}
