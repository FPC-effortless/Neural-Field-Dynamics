export type NeuronState =
  | "healthy"
  | "stressed"
  | "atrophied"
  | "alarming"
  | "refractory"
  | "drifted";

export interface Connection {
  to: number;
  w: number;
  branch: number;
}

export interface Neuron {
  id: number;
  gx: number;
  gy: number;
  atp: number;
  refractory: number;
  h: number;
  atrophied_at: number;
  state: NeuronState;
  conns: Connection[];
  sources: number[];
  lastFire: number;
  noFireCount: number;
  L: number;
  L_rolling: number;

  mi_f1: number;
  mi_f0: number;
  mi_n1: number;
  mi_n0: number;
  mi: number;

  conns_pruned: number;
  conns_grown: number;
  atp_spent: number;

  branch_soma_w: number[];
  branch_out: number[];
  d_eff: number;
  branch_spike_1k: number[];
  branch_task_spikes: Record<string, number[]>;

  b: number;
  a: number;
  a_prev: number;
  epsilon: number;
  epsilon_dd: number;

  v: number;
  A: number;
  s_soma: number;
  C: number;
  C_prev: number;
  M: number;

  Q_reflex: number;
  Q_planned: number;
  ic_wins: number;
  ic_total: number;

  spike_total: number;
  control_ap: number;

  isInput: boolean;
}

export interface BodyState {
  energy: number;
  health: number;
  pred_energy: number;
  pred_health: number;
  eps_body: number;
  R_body: number;
}

export interface NormBuffer {
  arr: number[];
  lo: number;
  hi: number;
  max: number;
}

export interface SimState {
  ns: Neuron[];
  t: number;
  seqI: number;
  taskKey: string;
  task: { seq: number[]; desc: string };
  taskStartT: number;
  taskHistory: Array<{
    key: string;
    startT: number;
    endT: number;
    I_start: number;
    I_end: number;
    ticks: number;
  }>;
  recent: Array<{ id: number; t: number }>;

  networkMI: number;
  networkSE: number;
  networkCR: number;
  ats: number | null;
  networkCoh: number;
  networkG: number;
  networkSself: number;
  networkAgency: number;
  networkEE: number;
  networkBPS: number;
  networkAtpVar: number;
  networkClustering: number;
  networkDU: number;
  C_chollet: number;
  C_bach: number;
  J_score: number;
  dopamine: number;
  V_td: number;
  networkPhi: number;
  networkSC: number;
  networkAS: number;
  networkR: number;
  networkControl: number;
  networkM: number;
  J_star: number;
  J_emb: number;
  networkIC: number;
  networkPD: number;
  networkFSI: number;
  networkSbody: number;
  networkCtrl: number;
  phaseRegion: string;

  nb: Record<string, NormBuffer>;
  firingBuffer: Array<{ count: number; envBit: number }>;
  C_history: number[][];
  a_history: number[][];
  pd_rate_history: number[];
  energy_history: number[];

  interferenceScore: number;
  recoveryTime: number | null;
  inRecovery: boolean;
  recoveryThreshold: number;
  recoveryStartT: number;
  transferEfficiency: number | null;
  baselineSE: number | null;

  I_at_task_start: Record<string, number>;
  totalPruned: number;
  totalGrown: number;
  totalConns: number;

  Jstar_history: number[];
  converged: boolean;
  convergedAt: number;
  phaseTimeCOG: number;
  phaseTimePRED: number;

  win_Jstar: number[];
  win_Phi: number[];
  win_SC: number[];
  win_Coh: number[];
  win_Ctrl: number[];
  win_IC: number[];

  exp_maxPhi: number;
  exp_phiPhase: boolean;
  hPhiSeen: boolean;
  h16Confirmed: boolean;
  h17Confirmed: boolean;

  body: BodyState;
  // Replay/memory for compressed attractors
  attractorLibrary: CompressedAttractor[];
}

export interface CompressedAttractor {
  id: string;
  taskKey: string;
  capturedAt: number;
  z: number[]; // 8-component PCA projection
  J: number[]; // dynamics signature
  apicalSnapshot: number[];
  C_snapshot: number[];
}

export interface Stats {
  healthy: number;
  stressed: number;
  atrophied: number;
  alarming: number;
  refractory: number;
  drifted: number;
  avgAtp: number;
  avgH: number;
  avgV: number;
  networkMI: number;
  networkSE: number;
  networkCR: number;
  ats: number | null;
  C_chollet: number;
  networkCoh: number;
  networkSself: number;
  networkAgency: number;
  C_bach: number;
  J_score: number;
  networkPhi: number;
  networkSC: number;
  networkAS: number;
  networkR: number;
  networkControl: number;
  networkM: number;
  networkDopamine: number;
  V_td: number;
  J_star: number;
  J_emb: number;
  networkIC: number;
  networkPD: number;
  networkFSI: number;
  networkSbody: number;
  networkCtrl: number;
  body_energy: number;
  body_health: number;
  eps_body: number;
  networkAtpVar: number;
  networkEE: number;
  networkBPS: number;
  FS: number;
  networkClustering: number;
  avgDeff: number;
  branchB: number;
  networkDU: number;
  h16Confirmed: boolean;
  h17Confirmed: boolean;
  hPhiSeen: boolean;
  taskKey: string;
  taskProgress: number;
  totalPruned: number;
  totalGrown: number;
  converged: boolean;
  convergedAt: number;
  phaseTimeCOG: number;
  phaseTimePRED: number;
  win_Jstar: number;
  win_Phi: number;
  win_SC: number;
  win_Coh: number;
  win_Ctrl: number;
  win_IC: number;
  exp_maxPhi: number;
  exp_phiPhase: boolean;
  phaseRegion: string;
  attractorCount: number;
}
