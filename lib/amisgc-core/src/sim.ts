import type { Neuron, SimState, Stats, BodyState } from "./types.js";
import { TASKS, TASK_ORDER, type TaskKey } from "./tasks.js";
import type { Params } from "./params.js";
import {
  clamp,
  tdist,
  th,
  mkNB,
  nbPush,
  pearson,
  computeMI,
  computeCR,
  computeCoh,
  computeClustering,
  computeFSI,
  computePhi,
  makePhiPairs,
  mulberry32,
  project8,
} from "./math.js";

export interface SimContext {
  P: Params;
  phiPairs: Array<[number, number]>;
  rng: () => number;
  seed: number;
}

export interface CreateSimOptions {
  seed?: number;
}

export function createSim(
  P: Params,
  opts: CreateSimOptions = {},
): { sim: SimState; ctx: SimContext } {
  const N = P.N;
  const G = P.G;
  const inSet = new Set(P.IN_IDS);
  const B = P.B;

  const seed =
    typeof opts.seed === "number" && Number.isFinite(opts.seed)
      ? Math.floor(opts.seed) >>> 0
      : (((Date.now() & 0x7fffffff) ^ Math.floor(Math.random() * 0x7fffffff)) || 1) >>> 0;
  const rng = mulberry32(seed);

  const ns: Neuron[] = [];
  for (let i = 0; i < N; i++) {
    ns.push({
      id: i,
      gx: i % G,
      gy: Math.floor(i / G),
      atp:
        P.ATP_START_MIN +
        rng() * (P.ATP_START_MAX - P.ATP_START_MIN),
      refractory: 0,
      h: P.H_INIT,
      atrophied_at: -1,
      state: "healthy",
      conns: [],
      sources: [],
      lastFire: -999,
      noFireCount: 0,
      L: 0,
      L_rolling: 0,
      mi_f1: 0,
      mi_f0: 0,
      mi_n1: 0,
      mi_n0: 0,
      mi: 0,
      conns_pruned: 0,
      conns_grown: 0,
      atp_spent: 0,
      branch_soma_w: Array.from(
        { length: B },
        () => (0.6 + rng() * 0.4) / Math.max(1, B)
      ),
      branch_out: new Array(B).fill(0),
      d_eff: 0,
      branch_spike_1k: new Array(B).fill(0),
      branch_task_spikes: TASK_ORDER.reduce(
        (acc, k) => ({ ...acc, [k]: new Array(B).fill(0) }),
        {} as Record<string, number[]>
      ),
      b: 0,
      a: 0.3,
      a_prev: 0.3,
      a_slow: 0.3,
      epsilon: 0,
      epsilon_dd: 0,
      v: 0.45 + rng() * 0.1,
      A: 1 / N,
      s_soma: 0,
      C: 0,
      C_prev: 0,
      M: 0.3,
      Q_reflex: 0,
      Q_planned: 0,
      ic_wins: 0,
      ic_total: 0,
      spike_total: 0,
      control_ap: 0,
      isInput: inSet.has(i),
    });
  }

  for (let i = 0; i < N; i++) {
    const ni = ns[i] as Neuron;
    const sorted: Array<[number, number]> = [];
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      const nj = ns[j] as Neuron;
      sorted.push([j, tdist(ni.gx, ni.gy, nj.gx, nj.gy, G)]);
    }
    sorted.sort((a, b) => a[1] - b[1]);
    for (let k = 0; k < P.K_LOCAL && k < sorted.length; k++) {
      const jO = (sorted[k] as [number, number])[0];
      const j = rng() < P.REWIRE ? Math.floor(rng() * N) : jO;
      if (j === i || ni.conns.find((c) => c.to === j)) continue;
      const w = P.W_INIT_LO + rng() * (P.W_INIT_HI - P.W_INIT_LO);
      ni.conns.push({ to: j, w, branch: k % B });
      (ns[j] as Neuron).sources.push(i);
    }
  }

  const body: BodyState = {
    energy: 0.7,
    health: 0.8,
    pred_energy: 0.5,
    pred_health: 0.5,
    eps_body: 0,
    R_body: 0,
  };

  const sim: SimState = {
    ns,
    t: 0,
    seqI: 0,
    taskKey: "COPY",
    task: TASKS.COPY,
    taskStartT: 0,
    taskHistory: [],
    recent: [],
    networkMI: 0,
    networkSE: 0,
    networkCR: 1,
    ats: null,
    networkCoh: 0,
    networkG: 0,
    networkSself: 0,
    networkAgency: 0,
    networkEE: 0,
    networkBPS: 0,
    networkAtpVar: 0,
    networkClustering: 0,
    networkDU: 0,
    C_chollet: 0,
    C_bach: 0,
    J_score: 0,
    dopamine: 0,
    V_td: 0.5,
    networkPhi: 0,
    networkSC: 0,
    networkAS: 0,
    networkPU: 0,
    networkH_C: 0,
    networkCAR: 0,
    existenceGate: 0,
    gateStreak: 0,
    failureReason: "warming up",
    pu_C_history: [],
    pu_env_history: [],
    networkR: 0,
    networkControl: 0,
    networkM: 0,
    J_star: 0,
    J_emb: 0,
    networkIC: 0,
    networkPD: 0,
    networkFSI: 0,
    networkSbody: 0,
    networkCtrl: 0,
    phaseRegion: "DISORDERED",
    nb: {
      se: mkNB(),
      cr: mkNB(),
      ats: mkNB(),
      coh: mkNB(),
      sself: mkNB(),
      agency: mkNB(),
      J: mkNB(),
      phi: mkNB(),
      sc: mkNB(),
      Jstar: mkNB(),
      jemb: mkNB(),
    },
    firingBuffer: [],
    C_history: [],
    a_history: [],
    pd_rate_history: [],
    energy_history: [],
    interferenceScore: 0,
    recoveryTime: null,
    inRecovery: false,
    recoveryThreshold: 0,
    recoveryStartT: 0,
    transferEfficiency: null,
    baselineSE: null,
    I_at_task_start: {},
    totalPruned: 0,
    totalGrown: 0,
    totalConns: 0,
    Jstar_history: [],
    converged: false,
    convergedAt: -1,
    phaseTimeCOG: -1,
    phaseTimePRED: -1,
    win_Jstar: [],
    win_Phi: [],
    win_SC: [],
    win_Coh: [],
    win_Ctrl: [],
    win_IC: [],
    exp_maxPhi: 0,
    exp_phiPhase: false,
    hPhiSeen: false,
    h16Confirmed: false,
    h17Confirmed: false,
    body,
    attractorLibrary: [],
  };

  const ctx: SimContext = {
    P,
    phiPairs: makePhiPairs(N, rng),
    rng,
    seed,
  };

  return { sim, ctx };
}

export function setTask(sim: SimState, key: TaskKey): void {
  if (TASKS[key]) {
    sim.taskKey = key;
    sim.task = TASKS[key];
    sim.taskStartT = sim.t;
    sim.seqI = 0;
    sim.I_at_task_start[key] = sim.networkMI;
  }
}

export function advanceTask(sim: SimState): void {
  const cIdx = TASK_ORDER.indexOf(sim.taskKey as TaskKey);
  const nKey = TASK_ORDER[(cIdx + 1) % TASK_ORDER.length] as TaskKey;
  const I_end = sim.networkMI;
  const ticks = sim.t - sim.taskStartT;
  sim.taskHistory.push({
    key: sim.taskKey,
    startT: sim.taskStartT,
    endT: sim.t,
    I_start: sim.I_at_task_start[sim.taskKey] || 0,
    I_end,
    ticks,
  });
  if (nKey === "NOVEL" && sim.t > 2000) {
    const cr = sim.taskHistory.find((r) => r.key === "COPY");
    if (cr) {
      const sp = I_end / ticks;
      const sb = cr.I_end / cr.ticks;
      sim.ats = sb > 0 ? sp / sb : null;
      if (!sim.baselineSE) sim.baselineSE = sb;
    }
  } else if (nKey === "NOVEL") {
    sim.ats = null;
  }
  sim.recoveryStartT = sim.t;
  sim.recoveryThreshold = I_end * 0.9;
  sim.inRecovery = I_end > 0.01;
  sim.recoveryTime = null;
  sim.taskKey = nKey;
  sim.task = TASKS[nKey];
  sim.taskStartT = sim.t;
  sim.seqI = 0;
  sim.I_at_task_start[nKey] = sim.networkMI;
  for (const n of sim.ns) n.atp_spent = 0;
}

export function simTick(sim: SimState, ctx: SimContext): number {
  const P = ctx.P;
  const N = P.N;
  const B = P.B;
  const rng = ctx.rng;
  const TOPK_CONSCIOUS = Math.max(1, Math.floor(N * P.TOPK_FRACTION));
  const { ns, body } = sim;
  sim.t++;
  const t = sim.t;

  if (t - sim.taskStartT >= P.TASK_TICKS) advanceTask(sim);
  const envBit = sim.task.seq[sim.seqI % sim.task.seq.length] as number;
  sim.seqI++;
  const firedNow = new Set<number>();

  // Body dynamics
  body.energy -= P.BODY_ENERGY_DRAIN;
  if (rng() < P.BODY_FEED_PROB)
    body.energy = Math.min(1, body.energy + P.BODY_FEED_AMT);
  if (body.energy < 0) body.energy = 0;
  let meanM = 0;
  for (let i = 0; i < N; i++) meanM += (ns[i] as Neuron).M;
  meanM /= N;
  body.pred_energy = clamp(0.5 + meanM * 0.4);
  body.pred_health = clamp(body.health * 0.9 + 0.1);
  const epsBE =
    (body.energy - body.pred_energy) * (body.energy - body.pred_energy);
  const epsBH =
    (body.health - body.pred_health) * (body.health - body.pred_health);
  body.eps_body = epsBE + epsBH;
  const dE = body.energy - P.BODY_ENERGY_TARGET;
  const dH = body.health - P.BODY_HEALTH_TARGET;
  body.R_body = 1.0 - 0.5 * (dE * dE + dH * dH) - P.LAMBDA_B * body.eps_body;

  // TD dopamine
  const taskReward = sim.networkMI;
  const R_t = taskReward + P.LAMBDA_B * body.R_body;
  const V_next = clamp(
    sim.V_td * (1 - P.ETA_V_TD) + R_t * P.ETA_V_TD,
    0,
    2
  );
  const delta_t = R_t + P.GAMMA_TD * V_next - sim.V_td;
  sim.V_td += P.ETA_V_TD * delta_t;
  sim.dopamine = sim.dopamine * P.BETA_D * 0.8 + delta_t * 0.2;
  sim.dopamine = clamp(sim.dopamine, -1, 1);

  // PASS 1: ATP + basal input
  for (let i = 0; i < N; i++) {
    const n = ns[i] as Neuron;
    const maintain = n.isInput ? P.MAINTAIN_INPUT : P.MAINTAIN;
    n.atp += P.REGEN - maintain;
    if (n.atp > P.ATP_MAX) n.atp = P.ATP_MAX;
    if (n.atp < 1) n.atp = 1;
    if (n.refractory > 0) {
      n.refractory--;
      n.state = "refractory";
      continue;
    }
    let basal = n.isInput ? envBit * P.ENV_AMP : 0;
    if (t <= P.DEV_TICKS) basal += rng() * P.DEV_AMP;
    if (B <= 1) {
      const srcs = n.sources;
      for (let si = 0; si < srcs.length; si++) {
        const src = ns[srcs[si] as number] as Neuron;
        if (src.lastFire !== t - 1) continue;
        const conns = src.conns;
        for (let ci = 0; ci < conns.length; ci++) {
          const c = conns[ci] as { to: number; w: number };
          if (c.to === n.id) {
            basal += c.w * src.h;
            break;
          }
        }
      }
    } else {
      const V_b = n.branch_out;
      for (let b = 0; b < B; b++) V_b[b] = 0;
      const C_b = new Array(B).fill(0);
      const srcs = n.sources;
      for (let si = 0; si < srcs.length; si++) {
        const src = ns[srcs[si] as number] as Neuron;
        const conns = src.conns;
        for (let ci = 0; ci < conns.length; ci++) {
          const c = conns[ci] as { to: number; w: number; branch?: number };
          if (c.to !== n.id) continue;
          const br = c.branch ?? 0;
          if (src.lastFire === t - 1)
            (V_b[br] as number) += c.w * src.h;
          if (src.lastFire >= t - P.COIN_WINDOW) (C_b[br] as number)++;
          break;
        }
      }
      for (let b = 0; b < B; b++) {
        const vb = V_b[b] as number;
        const cb = C_b[b] as number;
        const nmda = 1 / (1 + Math.exp(-P.DEND_K * (vb - P.DEND_THRESH)));
        const coin = cb / P.COIN_K > 1 ? 1 : cb / P.COIN_K;
        n.branch_out[b] = vb * nmda * (0.5 + 0.5 * coin);
        basal += (n.branch_soma_w[b] as number) * (n.branch_out[b] as number);
        n.branch_spike_1k[b] = (n.branch_spike_1k[b] as number) * 0.997;
      }
    }
    n.b = basal;
    if (envBit === 1) n.mi_n1++;
    else n.mi_n0++;
    if (t % P.MI_WINDOW === 0) {
      n.mi_f1 *= 0.7;
      n.mi_f0 *= 0.7;
      n.mi_n1 *= 0.7;
      n.mi_n0 *= 0.7;
    }
    if (t % 8 === 0 && i % 4 === t % 4) n.mi = computeMI(n);
  }

  // PASS 2: Attractor gradient
  // v12 revision — soft, globally coupled attractor field.
  // The legacy top-K path is preserved for ablation runs (ATTN_MODE === "topk").
  if (P.ATTN_MODE !== "topk") {
    // Soft, globally coupled attractor (Phase 0 default).
    for (let iter = 0; iter < P.ATT_ITERS; iter++) {
      // softmax(a/τ) — every neuron participates
      let maxA = -Infinity;
      for (let i = 0; i < N; i++) {
        const a = (ns[i] as Neuron).a;
        if (a > maxA) maxA = a;
      }
      const tau = Math.max(1e-3, P.TAU_ATT);
      const expV = new Float32Array(N);
      let sumE = 0;
      for (let i = 0; i < N; i++) {
        expV[i] = Math.exp(((ns[i] as Neuron).a - maxA) / tau);
        sumE += expV[i] as number;
      }
      sumE = sumE || 1e-10;
      // v12 revision (post-B3): coherence-amplifying global field
      //   G = Σ C_i · a_i^2  /  (Σ C_i · a_i + ε)
      // The linear weighted average tracked the field but did not force
      // consensus. The amplifying form weights confident, attended cells
      // quadratically; when the field is fragmented the denominator shrinks
      // (creating pressure to resolve disagreement), when it is coherent
      // strong neurons pull the field toward their consensus.
      let Gnum = 0;
      let Gden = 0;
      let HC = 0;
      for (let i = 0; i < N; i++) {
        const Ci = (expV[i] as number) / sumE;
        const n = ns[i] as Neuron;
        n.A = Ci;
        Gnum += Ci * n.a * n.a;
        Gden += Ci * n.a;
        if (Ci > 1e-12) HC -= Ci * Math.log(Ci + 1e-8);
      }
      // sign-preserving safe denominator + clamp on G to avoid numeric
      // explosions when Σ C_i·a_i passes through zero.
      const EPS_G = 1e-8;
      const denomMag = Math.max(Math.abs(Gden), EPS_G);
      const denomSafe = Gden >= 0 ? denomMag : -denomMag;
      let G = Gnum / denomSafe;
      if (G > 4) G = 4;
      else if (G < -4) G = -4;
      sim.networkG = G;
      sim.networkH_C = HC;

      // Apical update on the active subset (refractory neurons keep their state)
      for (let i = 0; i < N; i++) {
        const n = ns[i] as Neuron;
        if (n.refractory > 0) continue;
        const localGrad = n.a - n.b;                 // prediction error gradient
        const globalGrad = P.GAMMA_GLOBAL * (n.a - G); // pull toward shared field
        const slowGrad = P.DELTA_TEMPORAL * (n.a - n.a_slow); // temporal coherence
        const selfGap = n.a - n.M;
        // Free-energy entropy bonus pushes participation up; gradient w.r.t. a_i
        // is approximated via -BETA_ENTROPY * (Ci - 1/N) so dominant cells are
        // pulled down and underused cells are pulled up.
        const entropyGrad = -P.BETA_ENTROPY * (n.A - 1 / N);
        const dEda =
          2 * localGrad +
          2 * globalGrad +
          slowGrad +
          2 * P.LAMBDA_SELF * selfGap -
          P.ALPHA_D * th(n.v) +
          entropyGrad;
        // Gaussian noise via Box–Muller (one draw per neuron per iter)
        const u1 = Math.max(1e-9, rng());
        const u2 = rng();
        const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const noise = gauss * P.NOISE_SIGMA;
        n.a -= P.ETA_ATT * dEda;
        n.a += noise;
        if (n.a > 2) n.a = 2;
        if (n.a < -2) n.a = -2;
        // Slow apical EMA
        n.a_slow = (1 - P.ALPHA_SLOW) * n.a_slow + P.ALPHA_SLOW * n.a;
        const som = n.b + P.LAMBDA_AP * n.a - P.THRESH / Math.max(n.h, 0.15);
        n.s_soma = 1 / (1 + Math.exp(-som * 3));
      }
    }
  } else {
    // Legacy top-K attractor (kept for ablation experiments).
    for (let iter = 0; iter < P.ATT_ITERS; iter++) {
      let maxS = -Infinity;
      for (let i = 0; i < N; i++) {
        const ss = (ns[i] as Neuron).s_soma;
        if (ss > maxS) maxS = ss;
      }
      const expV = new Float32Array(N);
      let sumE = 0;
      for (let i = 0; i < N; i++) {
        expV[i] = Math.exp(P.BETA_A * ((ns[i] as Neuron).s_soma - maxS));
        sumE += expV[i] as number;
      }
      sumE = sumE || 1e-10;
      for (let i = 0; i < N; i++) {
        const n = ns[i] as Neuron;
        if (n.refractory > 0) continue;
        n.A = (expV[i] as number) / sumE;
        const err = n.b - n.a;
        const selfGap = n.a - n.M;
        const dEda =
          -2 * err +
          2 * P.LAMBDA_SELF * selfGap -
          P.ALPHA_D * th(n.v) -
          P.BETA_A * (n.A - 1 / N);
        n.a -= P.ETA_ATT * dEda;
        if (n.a > 2) n.a = 2;
        if (n.a < -2) n.a = -2;
        n.a_slow = (1 - P.ALPHA_SLOW) * n.a_slow + P.ALPHA_SLOW * n.a;
        const som = n.b + P.LAMBDA_AP * n.a - P.THRESH / Math.max(n.h, 0.15);
        n.s_soma = 1 / (1 + Math.exp(-som * 3));
      }
    }
  }

  // PASS 3: Bottleneck + collapse
  if (P.USE_BOTTLENECK || P.ATTN_MODE === "topk") {
    const attnIdx = Array.from({ length: N }, (_, i) => i).sort(
      (a, b) => (ns[b] as Neuron).A - (ns[a] as Neuron).A
    );
    const topK = new Set(attnIdx.slice(0, TOPK_CONSCIOUS));
    for (let i = 0; i < N; i++) {
      const n = ns[i] as Neuron;
      if (n.refractory > 0) continue;
      n.C_prev = n.C;
      n.C = topK.has(i) ? n.A * n.a : 0;
    }
  } else {
    // v12 revision: every neuron participates, weighted by the soft attention.
    for (let i = 0; i < N; i++) {
      const n = ns[i] as Neuron;
      if (n.refractory > 0) continue;
      n.C_prev = n.C;
      n.C = n.A * n.a;
    }
  }

  for (let i = 0; i < N; i++) {
    const n = ns[i] as Neuron;
    if (n.refractory > 0) continue;
    n.a_prev = n.a;
    n.epsilon = n.b > n.a ? n.b - n.a : n.a - n.b;
    n.epsilon_dd = n.epsilon * (1 + P.ALPHA_D * th(n.v));
    const selfErr = n.a - n.M;
    const dpGrad = sim.dopamine * Math.sign(selfErr);
    n.M += P.ETA_M * selfErr + P.ETA_P * dpGrad;
    n.M = clamp(n.M, -2, 2);
    const L =
      n.epsilon * n.epsilon +
      P.LAMBDA_COH * (n.a - n.a_prev) * (n.a - n.a_prev) +
      P.LAMBDA_ATP * (n.atp - P.ATP_TARGET) * (n.atp - P.ATP_TARGET);
    n.L = L;
    n.L_rolling = n.L_rolling * 0.92 + n.L * 0.08;
    const atrophy =
      P.ATROPHY_RATE * (n.L - P.L_CRIT > 0 ? n.L - P.L_CRIT : 0);
    n.h -= atrophy;
    n.h += P.H_FLOOR_RECOVERY;
    if (n.h > 1) n.h = 1;
    if (n.h < P.H_MIN) n.h = P.H_MIN;
    if (n.h < P.H_ATROPHIED && n.atrophied_at < 0) n.atrophied_at = t;
    if (n.h >= P.H_STRESSED && n.atrophied_at > 0) n.atrophied_at = -1;
    n.Q_reflex = n.b * Math.max(0, n.v - 0.3);
    n.Q_planned = n.s_soma * n.v;
  }

  let meanH = 0;
  for (let i = 0; i < N; i++) meanH += (ns[i] as Neuron).h;
  meanH /= N;
  body.health = body.health * 0.998 + meanH * 0.002;

  // PASS 4: Act
  for (let i = 0; i < N; i++) {
    const n = ns[i] as Neuron;
    if (n.refractory > 0) continue;
    if (n.s_soma > 0.5 && n.epsilon > P.EPS && n.atp > P.FIRE_COST) {
      const since = t - n.lastFire;
      const pen = since < 4 ? P.FIRE_COST * (2.5 / since) : 0;
      const cost = P.FIRE_COST + pen;
      if (n.atp >= cost) {
        n.atp -= cost;
        n.atp_spent += cost;
        n.lastFire = t;
        n.refractory = P.REFRACT;
        n.noFireCount = 0;
        firedNow.add(n.id);
        sim.recent.push({ id: n.id, t });
        if (envBit === 1) n.mi_f1++;
        else n.mi_f0++;
        if (n.a > n.b) n.control_ap++;
        n.spike_total++;
        n.ic_total++;
        if (n.Q_planned > n.Q_reflex) n.ic_wins++;
        if (B > 1) {
          const dom = n.branch_out.indexOf(Math.max(...n.branch_out));
          (n.branch_spike_1k[dom] as number)++;
          if (n.branch_task_spikes[sim.taskKey])
            (n.branch_task_spikes[sim.taskKey] as number[])[dom] =
              ((n.branch_task_spikes[sim.taskKey] as number[])[dom] as number) +
              1;
        }
        n.state = "alarming";
        continue;
      }
    }
    n.noFireCount =
      n.b > 0.1 ? n.noFireCount + 1 : Math.max(0, n.noFireCount - 1);
    if (n.h >= P.H_STRESSED)
      n.state = n.noFireCount > P.DRIFT_T ? "drifted" : "healthy";
    else if (n.h >= P.H_ATROPHIED) n.state = "stressed";
    else n.state = "atrophied";
  }

  // PASS 5: Coop
  const ws = t - P.COOP_W;
  const rset = new Set(sim.recent.filter((f) => f.t >= ws).map((f) => f.id));
  for (const id of firedNow) {
    for (const { to } of (ns[id] as Neuron).conns) {
      if (rset.has(to)) {
        (ns[id] as Neuron).atp = Math.min(
          P.ATP_MAX,
          (ns[id] as Neuron).atp + P.COOP_BONUS
        );
        (ns[id] as Neuron).h = Math.min(
          1,
          (ns[id] as Neuron).h + P.RECOVERY_RATE
        );
        break;
      }
    }
  }

  // PASS 6: Plasticity (TD-gated)
  let pruned = 0,
    totalW = 0;
  const eta_b = P.ETA_B ?? P.HEBB;
  const eta_a = P.ETA_A ?? P.HEBB * 0.5;
  for (let i = 0; i < N; i++) {
    const n = ns[i] as Neuron;
    const wCap = P.W_MAX * Math.max(n.h, 0.15);
    const inact =
      Math.min(1, n.noFireCount / P.DRIFT_T) *
      P.INACTIVITY_SCALE *
      (1 / Math.max(n.h, 0.2));
    const myF = firedNow.has(n.id);
    const localAct =
      n.conns.filter((c) => firedNow.has(c.to)).length /
      Math.max(n.conns.length, 1);
    const toRem: number[] = [];
    for (let ci = 0; ci < n.conns.length; ci++) {
      const c = n.conns[ci] as { to: number; w: number; branch?: number };
      if (myF && firedNow.has(c.to)) {
        c.w = Math.min(wCap, c.w + eta_b * Math.abs(n.epsilon_dd));
        if (firedNow.has(c.to))
          c.w = Math.min(wCap, c.w + eta_a * localAct);
      } else {
        c.w = Math.max(0, c.w - P.DECAY * (1 + inact));
      }
      if (c.w < P.W_PRUNE) {
        toRem.push(c.to);
        pruned++;
      }
      totalW++;
    }
    for (let r = 0; r < toRem.length; r++) {
      const tgt = toRem[r] as number;
      n.conns = n.conns.filter((c) => c.to !== tgt);
      (ns[tgt] as Neuron).sources = (ns[tgt] as Neuron).sources.filter(
        (s) => s !== n.id
      );
      n.conns_pruned++;
    }
    if (myF) {
      n.v = clamp(
        n.v + P.ETA_V * (sim.dopamine * (0.5 + th(n.v) * 0.5)),
        0,
        2
      );
    }
  }

  // PASS 7: Regrowth
  let grown = 0;
  if (t % 4 === 0) {
    const miS = ns
      .filter((n) => n.state !== "atrophied" && n.mi > 0.02)
      .sort((a, b) => b.mi - a.mi)
      .slice(0, 15);
    for (let i = 0; i < N; i++) {
      const n = ns[i] as Neuron;
      if (n.h >= P.H_ATROPHIED || rng() > P.P_REGROW) continue;
      const tgt =
        rng() < P.REGROW_BIAS_MI && miS.length > 0
          ? (miS[Math.floor(rng() * Math.min(5, miS.length))] as Neuron)
          : (ns[Math.floor(rng() * N)] as Neuron);
      if (
        !tgt ||
        tgt.id === n.id ||
        n.conns.find((c) => c.to === tgt.id) ||
        n.conns.length >= P.K_LOCAL * 3
      )
        continue;
      const bc = new Array(B).fill(0);
      for (const c of n.conns) (bc[c.branch ?? 0] as number)++;
      const branch = bc.indexOf(Math.min(...bc));
      n.conns.push({ to: tgt.id, w: P.W_INIT_LO * 0.6, branch });
      if (!tgt.sources.includes(n.id)) tgt.sources.push(n.id);
      n.conns_grown++;
      grown++;
    }
  }

  sim.recent = sim.recent.filter((f) => f.t >= t - P.COOP_W - 2);

  // Periodic metrics
  if (t % 16 === 0) {
    let miS = 0;
    for (let i = 0; i < N; i++) miS += (ns[i] as Neuron).mi;
    sim.networkMI = miS / N;
    sim.networkCR = computeCR(ns, N);
  }
  if (sim.inRecovery && sim.networkMI >= sim.recoveryThreshold) {
    sim.recoveryTime = t - sim.recoveryStartT;
    sim.inRecovery = false;
  }

  if (t % 50 === 0) {
    sim.networkCoh = computeCoh(ns, N);
    let gS = 0,
      atpS = 0,
      atpSq = 0;
    for (let i = 0; i < N; i++) {
      const n = ns[i] as Neuron;
      gS += n.epsilon;
      atpS += n.atp;
      atpSq += n.atp * n.atp;
    }
    sim.networkG = gS / N;
    const atpMu = atpS / N;
    sim.networkAtpVar = atpSq / N - atpMu * atpMu;
    sim.networkPhi = computePhi(ns, N, ctx.phiPairs);
    let HA = 0;
    for (let i = 0; i < N; i++) {
      const A = (ns[i] as Neuron).A;
      if (A > 1e-10) HA -= A * Math.log2(A);
    }
    sim.networkAS = clamp(1 - HA / Math.log2(N));
    let mS = 0,
      icW = 0,
      icT = 0,
      ctrlAp = 0,
      spikeT = 0;
    for (let i = 0; i < N; i++) {
      const n = ns[i] as Neuron;
      mS += n.M;
      icW += n.ic_wins;
      icT += n.ic_total;
      ctrlAp += n.control_ap;
      spikeT += n.spike_total;
    }
    sim.networkM = mS / N;
    sim.networkIC = icT > 0 ? icW / icT : 0;
    sim.networkControl = spikeT > 0 ? ctrlAp / spikeT : 0;
    const dEn = body.energy - P.BODY_ENERGY_TARGET;
    const dHe = body.health - P.BODY_HEALTH_TARGET;
    sim.networkCtrl = clamp(1 - (dEn * dEn + dHe * dHe) * 2, 0, 1);
    sim.energy_history.push(body.energy);
    if (sim.energy_history.length > 40) sim.energy_history.shift();
    if (sim.energy_history.length >= 20) {
      const half = Math.floor(sim.energy_history.length / 2);
      sim.networkSbody = Math.max(
        0,
        pearson(
          sim.energy_history.slice(0, half),
          sim.energy_history.slice(half)
        )
      );
    }
  }

  sim.firingBuffer.push({ count: firedNow.size, envBit });
  if (sim.firingBuffer.length > 400) sim.firingBuffer.shift();

  if (t % 300 === 0) {
    if (sim.firingBuffer.length >= 200) {
      const r = sim.firingBuffer.slice(-100).map((f) => f.count);
      const o = sim.firingBuffer.slice(-200, -100).map((f) => f.count);
      sim.networkSself = Math.max(0, pearson(r, o));
    }
    const d2 = 20;
    if (sim.firingBuffer.length >= d2 + 80) {
      const yr = sim.firingBuffer.slice(-d2 - 80, -d2).map((f) => f.count);
      const xe = sim.firingBuffer.slice(-80).map((f) => f.envBit);
      sim.networkAgency = Math.max(0, pearson(yr, xe));
    }
    const atpW = ns.reduce((s, n) => s + n.atp_spent, 0);
    const dI = Math.max(
      0,
      sim.networkMI - (sim.I_at_task_start[sim.taskKey] || 0)
    );
    sim.networkEE = atpW > 0 ? (dI / atpW) * 1000 : 0;
    const spW = sim.firingBuffer.slice(-30).reduce((s, f) => s + f.count, 0);
    sim.networkBPS = spW > 0 ? (sim.networkMI * N * 30) / spW : 0;
    if (B > 1) {
      let actB = 0,
        totB = 0;
      for (let i = 0; i < N; i++) {
        for (let b = 0; b < B; b++) {
          totB++;
          if ((((ns[i] as Neuron).branch_spike_1k[b] as number) || 0) > 0.5)
            actB++;
        }
      }
      sim.networkDU = totB ? actB / totB : 0;
    }
    const Cv = ns.map((n) => n.C);
    sim.C_history.push(Cv);
    if (sim.C_history.length > 5) sim.C_history.shift();
    if (sim.C_history.length >= 2)
      sim.networkSC = Math.max(
        0,
        pearson(
          sim.C_history[sim.C_history.length - 1] as number[],
          sim.C_history[0] as number[]
        )
      );
    const Av = ns.map((n) => n.a);
    sim.a_history.push(Av);
    if (sim.a_history.length > 5) sim.a_history.shift();
    if (sim.a_history.length >= 2)
      sim.networkR = Math.max(
        0,
        pearson(
          sim.a_history[sim.a_history.length - 1] as number[],
          sim.a_history[0] as number[]
        )
      );
    const rateVec = firedNow.size / N;
    sim.pd_rate_history.push(rateVec);
    if (sim.pd_rate_history.length > 25) sim.pd_rate_history.shift();
    if (sim.pd_rate_history.length >= 20) {
      const base = pearson(
        sim.pd_rate_history.slice(0, 10),
        sim.pd_rate_history.slice(1, 11)
      );
      const lag2 = pearson(
        sim.pd_rate_history.slice(0, 8),
        sim.pd_rate_history.slice(4, 12)
      );
      const lag3 = pearson(
        sim.pd_rate_history.slice(0, 6),
        sim.pd_rate_history.slice(7, 13)
      );
      const eps = 0.1 * Math.max(Math.abs(base), 0.01);
      sim.networkPD =
        Math.abs(lag3) > eps
          ? 3
          : Math.abs(lag2) > eps
            ? 2
            : Math.abs(base) > eps
              ? 1
              : 0;
    }
    if (t % 2000 === 0) sim.networkFSI = computeFSI(ns, N);
    if (sim.networkPhi > sim.exp_maxPhi) sim.exp_maxPhi = sim.networkPhi;
    if (sim.networkPhi > 0.2 && sim.networkSC > 0.35) {
      sim.exp_phiPhase = true;
      sim.hPhiSeen = true;
    }
  }

  // v12 revision — buffer the global field and the env bit every tick so
  // calcStats can compute PU = I(G_t ; envBit_{t+PU_LAG}). Sampling every
  // tick is essential: PU_LAG (default 4) is much smaller than the periodic
  // 50-tick block above, so buffering inside that block would never produce
  // matching (t, t+lag) pairs.
  {
    const puCh = sim.pu_C_history!;
    const puEnv = sim.pu_env_history!;
    puCh.push({ t, C_index: sim.networkG });
    puEnv.push({ t, envBit });
    const CAP = 600;
    if (puCh.length > CAP) puCh.shift();
    if (puEnv.length > CAP) puEnv.shift();
  }

  if (t % 1000 === 0) sim.networkClustering = computeClustering(ns, N);
  sim.totalPruned += pruned;
  sim.totalGrown += grown;
  sim.totalConns = totalW;
  return firedNow.size;
}

const BURNIN = 2000;
const CONV_THRESH = 0.002;
const WIN_SAMPLES = 10;

export function calcStats(sim: SimState, ctx: SimContext): Stats {
  const P = ctx.P;
  const N = P.N;
  const B = P.B;
  const ns = sim.ns;
  const counts = {
    healthy: 0,
    stressed: 0,
    atrophied: 0,
    alarming: 0,
    refractory: 0,
    drifted: 0,
  } as Record<string, number>;
  let atpS = 0,
    hS = 0,
    vS = 0,
    atpSp = 0,
    deffS = 0;
  for (let i = 0; i < N; i++) {
    const n = ns[i] as Neuron;
    counts[n.state] = (counts[n.state] || 0) + 1;
    atpS += n.atp;
    hS += n.h;
    vS += n.v;
    atpSp += n.atp_spent;
    deffS += n.d_eff || 0;
  }
  const tW = sim.t - sim.taskStartT;
  const dI = Math.max(
    0,
    sim.networkMI - (sim.I_at_task_start[sim.taskKey] || 0)
  );
  const SE = atpSp > 0 && tW > 0 ? dI / (tW * 0.01 + atpSp * 0.001) : 0;
  const FS = (counts["healthy"] as number) / N;
  const nb = sim.nb;
  const nSE = nbPush(nb["se"] as ReturnType<typeof mkNB>, SE);
  const nCR = nbPush(nb["cr"] as ReturnType<typeof mkNB>, sim.networkCR);
  const nATS =
    sim.ats != null ? nbPush(nb["ats"] as ReturnType<typeof mkNB>, sim.ats) : nSE;
  const C_chollet = Math.cbrt(nSE * nCR * nATS);
  const nCoh = nbPush(nb["coh"] as ReturnType<typeof mkNB>, sim.networkCoh);
  const nSself = nbPush(
    nb["sself"] as ReturnType<typeof mkNB>,
    sim.networkSself
  );
  const nAgency = nbPush(
    nb["agency"] as ReturnType<typeof mkNB>,
    sim.networkAgency
  );
  const C_bach = Math.cbrt(
    Math.max(nCoh, 0.01) *
      Math.max(nSself, 0.01) *
      Math.max(nAgency, 0.01)
  );
  const J_score = Math.sqrt(C_chollet * C_bach);
  nbPush(nb["J"] as ReturnType<typeof mkNB>, J_score);
  const nPhi = nbPush(nb["phi"] as ReturnType<typeof mkNB>, sim.networkPhi);
  const nSC = nbPush(nb["sc"] as ReturnType<typeof mkNB>, sim.networkSC);
  const D_score = clamp(vS / N - 0.4 + sim.networkIC * 0.3);
  const J_star = Math.pow(
    Math.max(nPhi, 0.01) *
      Math.max(nCoh, 0.01) *
      Math.max(sim.networkR, 0.01) *
      Math.max(nSC, 0.01) *
      Math.max(D_score, 0.01),
    0.2
  );
  nbPush(nb["Jstar"] as ReturnType<typeof mkNB>, J_star);
  sim.J_score = J_score;
  sim.J_star = J_star;
  sim.C_chollet = C_chollet;
  sim.C_bach = C_bach;
  const J_emb =
    J_star *
    (1 + sim.networkCtrl * P.LAMBDA_B) *
    (1 + sim.networkSbody * P.LAMBDA_B);
  nbPush(nb["jemb"] as ReturnType<typeof mkNB>, J_emb);
  sim.J_emb = J_emb;

  // v12 revision — compute predictive usefulness PU = I(G_t ; envBit_{t+PU_LAG})
  // by binning the buffered global field into 3 quantile bins and pairing each
  // sample with the env bit observed PU_LAG ticks later.
  const puCh = sim.pu_C_history ?? [];
  const puEnv = sim.pu_env_history ?? [];
  let PU = 0;
  if (puCh.length >= 40 && puEnv.length >= 40) {
    const lag = Math.max(1, P.PU_LAG);
    const envByT = new Map<number, number>();
    for (const e of puEnv) envByT.set(e.t, e.envBit);
    const pairs: Array<{ g: number; e: number }> = [];
    for (const c of puCh) {
      const e = envByT.get(c.t + lag);
      if (e !== undefined) pairs.push({ g: c.C_index, e });
    }
    if (pairs.length >= 30) {
      const sortedG = [...pairs].map((p) => p.g).sort((a, b) => a - b);
      const q1 = sortedG[Math.floor(sortedG.length / 3)] as number;
      const q2 = sortedG[Math.floor((sortedG.length * 2) / 3)] as number;
      const bin = (g: number) => (g <= q1 ? 0 : g <= q2 ? 1 : 2);
      const joint = new Map<string, number>();
      const pg = [0, 0, 0];
      const pe = [0, 0];
      for (const p of pairs) {
        const b = bin(p.g);
        const k = `${b}|${p.e}`;
        joint.set(k, (joint.get(k) ?? 0) + 1);
        pg[b] = (pg[b] as number) + 1;
        pe[p.e] = (pe[p.e] as number) + 1;
      }
      const total = pairs.length;
      let mi = 0;
      for (const [k, n] of joint) {
        const [bi, ei] = k.split("|").map(Number) as [number, number];
        const pj = n / total;
        const pgv = (pg[bi] as number) / total;
        const pev = (pe[ei] as number) / total;
        if (pj > 0 && pgv > 0 && pev > 0)
          mi += pj * Math.log2(pj / (pgv * pev));
      }
      PU = Math.max(0, mi);
    }
  }
  sim.networkPU = PU;
  // Coherence Amplification Ratio (post-B3 diagnostic)
  //   CAR = Φ / (1 - H_C/H_max + ε)
  // Guards Φ against narrow accidental peaks: when Φ rises because the field
  // genuinely integrates, participation entropy is high and CAR is large;
  // when Φ rises because a few neurons synchronise by accident, H_C is low
  // and CAR is small.
  {
    const Hmax = Math.log(Math.max(2, ctx.P.N));
    const norm = Hmax > 0 ? sim.networkH_C / Hmax : 0;
    const denom = 1 - norm + 1e-6;
    sim.networkCAR = denom > 0 ? sim.networkPhi / denom : 0;
  }
  // Existence Gate: Φ > 0.05 ∧ PU > 0.1 ∧ S_C > 0.1
  const gateOpen =
    sim.networkPhi > 0.05 && sim.networkPU > 0.1 && sim.networkSC > 0.1;
  if (gateOpen) {
    sim.existenceGate = 1;
    sim.gateStreak += 1;
    sim.failureReason = "";
  } else {
    sim.existenceGate = 0;
    sim.gateStreak = 0;
    // v13 spec §5.1 — six-category root-cause classifier. We compute a
    // "badness" score for each candidate cause and emit the worst.
    // Only run after a short burn-in so initial transients don't mis-classify.
    if (sim.t < 200) {
      sim.failureReason = "Warming up";
    } else {
      const N = ctx.P.N;
      const Hmax = Math.log(Math.max(2, N));
      const participationRatio = Hmax > 0 ? sim.networkH_C / Hmax : 0;
      // Dominance: max(C_i) approximated via the inverse of effective
      // participating fraction. effFrac = exp(H_C); maxC ≥ 1/effFrac.
      const effFrac = Math.exp(sim.networkH_C);
      const dominance = effFrac > 0 ? 1 / effFrac : 1;
      // Coupling strength: how much γ·G can move the attention term. When
      // γ·|G| is small the global field has no leverage on a-update.
      const couplingMag = Math.abs(ctx.P.GAMMA_GLOBAL * sim.networkG);
      // Temporal stability: 1 − coefficient-of-variation of recent Φ.
      let temporalStab = 1;
      if (sim.win_Phi.length >= 4) {
        const mu =
          sim.win_Phi.reduce((a, b) => a + b, 0) / sim.win_Phi.length;
        const v =
          sim.win_Phi.reduce((a, b) => a + (b - mu) * (b - mu), 0) /
          sim.win_Phi.length;
        const cv = Math.sqrt(v) / (Math.abs(mu) + 1e-6);
        temporalStab = Math.max(0, 1 - cv);
      }
      // Signal-to-noise: Φ relative to noise σ. <1 means noise dominates.
      const snr = sim.networkPhi / (ctx.P.NOISE_SIGMA + 1e-6);
      const candidates: Array<[number, string]> = [
        // Score = how badly the signal violates its healthy threshold.
        // Higher score → more severe.
        [Math.max(0, 0.4 - participationRatio) * 5, "Low Participation"],
        [Math.max(0, dominance - 0.5) * 4, "Dominance Collapse"],
        [Math.max(0, 0.05 - couplingMag) * 6, "Weak Coupling"],
        [Math.max(0, 0.3 - temporalStab) * 3, "Temporal Instability"],
        [Math.max(0, 0.05 - Math.abs(sim.networkG)) * 6, "Global Field Ineffective"],
        [Math.max(0, 1 - snr) * 2, "Noise Dominance"],
      ];
      let worstScore = 0;
      let worstReason = "Gate not met";
      for (const [s, label] of candidates) {
        if (s > worstScore) {
          worstScore = s;
          worstReason = label;
        }
      }
      sim.failureReason = worstReason;
    }
  }

  let phaseRegion = "DISORDERED";
  if (nPhi > 0.5 && nSC < 0.3) phaseRegion = "ATTENTIVE";
  if (J_score > 0.4) phaseRegion = "PREDICTIVE";
  if (nPhi > 0.5 && nSC > 0.5) phaseRegion = "CONSCIOUS";
  if (J_star > 0.3 && nPhi > 0.4 && nSC > 0.4) phaseRegion = "CONSCIOUS";
  if (J_emb > 0.5 && sim.networkCtrl > 0.5) phaseRegion = "EMBODIED";
  // v12 revision: if the existence gate is closed, no cognitive labels are
  // permitted regardless of any composite scores.
  if (sim.existenceGate === 0 && sim.t > 1000) phaseRegion = "NO-GO";
  sim.phaseRegion = phaseRegion;
  if (phaseRegion === "CONSCIOUS" && sim.phaseTimeCOG < 0)
    sim.phaseTimeCOG = sim.t;
  if (phaseRegion === "PREDICTIVE" && sim.phaseTimePRED < 0)
    sim.phaseTimePRED = sim.t;
  if (!sim.converged && sim.t > BURNIN) {
    sim.Jstar_history.push(J_star);
    if (sim.Jstar_history.length > 12) sim.Jstar_history.shift();
    if (sim.Jstar_history.length >= 8) {
      const arr = sim.Jstar_history;
      const hi = Math.max(...arr);
      const lo = Math.min(...arr);
      if (hi - lo < CONV_THRESH) {
        sim.converged = true;
        sim.convergedAt = sim.t;
      }
    }
  }
  const wa = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  sim.win_Jstar.push(J_star);
  sim.win_Phi.push(sim.networkPhi);
  sim.win_SC.push(sim.networkSC);
  sim.win_Coh.push(sim.networkCoh);
  sim.win_Ctrl.push(sim.networkCtrl);
  sim.win_IC.push(sim.networkIC);
  if (sim.win_Jstar.length > WIN_SAMPLES) {
    sim.win_Jstar.shift();
    sim.win_Phi.shift();
    sim.win_SC.shift();
    sim.win_Coh.shift();
    sim.win_Ctrl.shift();
  }
  if (sim.win_IC.length > WIN_SAMPLES) sim.win_IC.shift();
  const avgV = vS / N;
  if (avgV > 0.5 && sim.networkIC > 0.1 && sim.ats && sim.ats > 1.5 && B > 1)
    sim.h16Confirmed = true;
  if (counts["healthy"] === 0 && sim.networkMI > 0.05 && B > 1)
    sim.h17Confirmed = true;

  return {
    healthy: counts["healthy"] as number,
    stressed: counts["stressed"] as number,
    atrophied: counts["atrophied"] as number,
    alarming: counts["alarming"] as number,
    refractory: counts["refractory"] as number,
    drifted: counts["drifted"] as number,
    avgAtp: Math.round(atpS / N),
    avgH: Math.round((hS / N) * 100) / 100,
    avgV,
    networkMI: sim.networkMI,
    networkSE: SE,
    networkCR: sim.networkCR,
    ats: sim.ats,
    C_chollet,
    networkCoh: sim.networkCoh,
    networkSself: sim.networkSself,
    networkAgency: sim.networkAgency,
    C_bach,
    J_score,
    networkPhi: sim.networkPhi,
    networkSC: sim.networkSC,
    networkAS: sim.networkAS,
    networkR: sim.networkR,
    networkControl: sim.networkControl,
    networkM: sim.networkM,
    networkDopamine: sim.dopamine,
    V_td: sim.V_td,
    J_star,
    J_emb,
    networkIC: sim.networkIC,
    networkPD: sim.networkPD,
    networkFSI: sim.networkFSI,
    networkSbody: sim.networkSbody,
    networkCtrl: sim.networkCtrl,
    body_energy: sim.body.energy,
    body_health: sim.body.health,
    eps_body: sim.body.eps_body,
    networkAtpVar: sim.networkAtpVar,
    networkEE: sim.networkEE,
    networkBPS: sim.networkBPS,
    FS,
    networkClustering: sim.networkClustering,
    avgDeff: B > 1 ? deffS / N : 0,
    branchB: B,
    networkDU: sim.networkDU,
    h16Confirmed: sim.h16Confirmed,
    h17Confirmed: sim.h17Confirmed,
    hPhiSeen: sim.hPhiSeen,
    taskKey: sim.taskKey,
    taskProgress: Math.min(1, tW / P.TASK_TICKS),
    totalPruned: sim.totalPruned,
    totalGrown: sim.totalGrown,
    converged: sim.converged,
    convergedAt: sim.convergedAt,
    phaseTimeCOG: sim.phaseTimeCOG,
    phaseTimePRED: sim.phaseTimePRED,
    win_Jstar: wa(sim.win_Jstar),
    win_Phi: wa(sim.win_Phi),
    win_SC: wa(sim.win_SC),
    win_Coh: wa(sim.win_Coh),
    win_Ctrl: wa(sim.win_Ctrl),
    win_IC: wa(sim.win_IC),
    exp_maxPhi: sim.exp_maxPhi,
    exp_phiPhase: sim.exp_phiPhase,
    phaseRegion,
    attractorCount: sim.attractorLibrary.length,
    networkPU: sim.networkPU,
    networkH_C: sim.networkH_C,
    networkCAR: sim.networkCAR,
    existenceGate: sim.existenceGate,
    gateStreak: sim.gateStreak,
    failureReason: sim.failureReason,
  };
}

export function captureAttractor(sim: SimState, ctx: SimContext): void {
  const N = ctx.P.N;
  const apical = sim.ns.map((n) => n.a);
  const z = project8(apical, N);
  // J = a - a_prev (finite difference)
  const J: number[] = [];
  for (let i = 0; i < N; i++) {
    const n = sim.ns[i] as Neuron;
    J.push(n.a - n.a_prev);
  }
  sim.attractorLibrary.push({
    id: `att_${sim.taskKey}_${sim.t}`,
    taskKey: sim.taskKey,
    capturedAt: sim.t,
    z,
    J,
    apicalSnapshot: apical,
    C_snapshot: sim.ns.map((n) => n.C),
  });
}

// Re-seed apical state from a captured attractor (for transfer/reuse tests).
// Pass a deterministic `rng` (from a SimContext) for reproducible noise.
export function seedFromAttractor(
  sim: SimState,
  attractorId: string,
  noise = 0.05,
  rng: () => number = Math.random
): boolean {
  const att = sim.attractorLibrary.find((a) => a.id === attractorId);
  if (!att) return false;
  for (let i = 0; i < sim.ns.length; i++) {
    const n = sim.ns[i] as Neuron;
    const a0 = att.apicalSnapshot[i] ?? 0;
    n.a = a0 + (rng() - 0.5) * 2 * noise;
    n.a_prev = a0;
  }
  return true;
}
