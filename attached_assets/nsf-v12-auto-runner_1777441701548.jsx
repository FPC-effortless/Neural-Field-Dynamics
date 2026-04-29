// ══════════════════════════════════════════════════════════════════════════════
// NEURAL SURVIVAL FIELD v12.0 -- AMISGC-AP-L-B-D-E-M-B v12.1 (Revised)
// Ideation Labs · Emergent Cognition Research
//
// REVISED v12.0 BLUEPRINT IMPLEMENTATION:
//
// ARCHITECTURE UPGRADES:
//   EMBODIMENT     -- body state (energy_b, health_b), interoceptive pred error
//   TD DOPAMINE    -- δ_t = R_t + γV_{t+1} − V_t  (drives plasticity only)
//   TANH DESIRE    -- ε_i^D = ε_i·(1 + α_D·tanh(v_i))  (bounded modulation)
//   COG BOTTLENECK -- replaced by soft globally coupled attractor field
//   SELF-MODEL ∇   -- M_i updated with δ_t-gated predictive gradient
//   IMPULSE CTRL   -- Q_reflex vs Q_planned competition → IC metric
//   ENERGY v12     -- E=‖ε‖² + λ_s‖a−M‖² − α_D·Ṽ(a) − β_A·H̃(A)
//
// NEW METRICS:
//   IC   -- Impulse Control: P(Q_planned > Q_reflex | spike)
//   PD   -- Prediction Depth: max lag k where MI(X_{t+k};Y_t) > ε
//   FSI  -- Functional Specialization Index: Var(task_MI)/Mean(task_MI)
//   S_body -- body autocorrelation (interoceptive continuity)
//   C_ctrl -- homeostatic control: −‖b_t − b*‖²
//   J_emb  -- J** · (1+C_ctrl) · (1+S_body)
//
// EXPERIMENT BATTERY (Phase 0 + CORE 1–12 + ARC mock):
//   Phase 0: integration emergence (soft globally coupled attractor)
//   Phase 1–6: revised core layers (reuse, replay, embodiment, credit)
//   Phase 7–12 and ARC mock follow only after the existence gate passes
//   Late phases: compositional reasoning, planning, language, lifelong learning, ARC mock
// ══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";

const G = 9, N = G*G;
const IN_IDS = new Set([0,12,24,36,48,60,72]);
const TOPK_CONSCIOUS = null; // legacy placeholder; use getTopKConscious()
const GAMMA_TD = 0.95;

const TASKS = {
  COPY:      {seq:[1,0,1,1,0,1,0,0], desc:"baseline sequence"},
  REVERSE:   {seq:[0,0,1,0,1,1,0,1], desc:"reversed bits"},
  ROTATE:    {seq:[1,0,1,0,0,1,1,0], desc:"cyclic shift +3"},
  ALTERNATE: {seq:[1,1,0,0,1,1,0,0], desc:"interleaved rhythm"},
  NOVEL:     {seq:[1,0,0,1,0,1,1,0], desc:"unseen -- ATS test"},
};
const TASK_ORDER = ["COPY","REVERSE","ROTATE","ALTERNATE","NOVEL"];
const DEFAULT_EXP_TICKS = 50000;
const DEFAULT_LOG_INTERVAL = 500;
const DEFAULT_BURNIN = 2000;


const DEFAULT_TOPK_FRACTION = 0.22; // legacy ablation support only
const DEFAULT_SOFT_TAU = 0.7;
function getTopKConscious(fraction = P.TOPK_FRACTION ?? DEFAULT_TOPK_FRACTION){
  return Math.max(1, Math.floor(N * fraction));
}
function softmaxStable(values, tau=DEFAULT_SOFT_TAU){
  const safeTau = Math.max(1e-6, tau);
  const maxV = Math.max(...values);
  const exps = values.map(v => Math.exp((v - maxV) / safeTau));
  const z = exps.reduce((s,v) => s + v, 1e-12);
  return exps.map(v => v / z);
}
function entropyOf(probs){
  return -probs.reduce((s,p)=>s + p * Math.log(p + 1e-8), 0);
}
function blendParams(base, extra){
  return {...(base||{}), ...(extra||{})};
}
function mergeParams(base, extra){
  return blendParams(base, extra);
}
function computeFailureReason(m){
  if(m.existenceGate===1) return "";
  if(!(m.networkPhi > 0.05)) return "Phi below gate";
  if(!(m.networkPU > 0.1)) return "PU below gate";
  if(!(m.networkSC > 0.1)) return "S_C below gate";
  return "Gate not met";
}
function computeGate(m){
  return Number(m.networkPhi > 0.05 && m.networkPU > 0.1 && m.networkSC > 0.1);
}
function expandBlueprints(groups){

  const out=[];
  for(const group of groups){
    const base = {...group};
    if(Array.isArray(base.cases) && base.cases.length){
      base.cases.forEach((variant, idx)=>{
        const spec = {
          ...base,
          ...variant,
          id: variant.id ? `${base.id}-${variant.id}` : `${base.id}-${String(idx+1).padStart(2,"0")}`,
          name: variant.name || `${base.name} ${variant.label || variant.id || idx+1}`,
          params: mergeParams(base.params, variant.params),
          taskSchedule: variant.taskSchedule || base.taskSchedule || TASK_ORDER,
          taskTicks: variant.taskTicks || base.taskTicks || P.TASK_TICKS,
          ticks: variant.ticks || base.ticks || 50000,
          logInterval: variant.logInterval || base.logInterval || 500,
          burnin: variant.burnin || base.burnin || 2000,
        };
        out.push(spec);
      });
      continue;
    }
    if(base.sweep){
      const combos = sampleCombos(cartesianProduct(base.sweep), base.maxRuns || null);
      combos.forEach((combo, idx)=>{
        const spec = {
          ...base,
          id: `${base.id}-${String(idx+1).padStart(2,"0")}`,
          name: `${base.name} [${sweepTag(combo)}]`,
          params: mergeParams(base.params, combo),
          sweepCombo: combo,
          taskSchedule: base.taskSchedule || TASK_ORDER,
          taskTicks: base.taskTicks || P.TASK_TICKS,
          ticks: base.ticks || 50000,
          logInterval: base.logInterval || 500,
          burnin: base.burnin || 2000,
        };
        out.push(spec);
      });
      continue;
    }
    out.push({
      ...base,
      params: mergeParams(base.params, {}),
      taskSchedule: base.taskSchedule || TASK_ORDER,
      taskTicks: base.taskTicks || P.TASK_TICKS,
      ticks: base.ticks || 50000,
      logInterval: base.logInterval || 500,
      burnin: base.burnin || 2000,
    });
  }
  return out;
}


function buildResearchExperiments(){
  const phase0Common = {
    params:{
      ATTN_MODE:"soft",
      TAU_ATT:0.7,
      GAMMA_GLOBAL:1.0,
      BETA_ENTROPY:0.2,
      DELTA_TEMPORAL:0.3,
      NOISE_SIGMA:0.02,
      ALPHA_SLOW:0.02,
      ETA_ATT:0.05,
      LAMBDA_AP:2.0,
      LAMBDA_SELF:0.1,
      B:1,
      MAINTAIN:1.0,
      LAMBDA_B:0.5,
      SELF_LP:0.02,
      BETA_D:1.0,
      ALPHA_D:0.8,
      ATT_ITERS:5,
      USE_BOTTLENECK:false,
      TOPK_FRACTION:0.22
    },
    taskSchedule:["COPY","REVERSE","ALTERNATE","NOVEL"],
    taskTicks:1000,
  };

  const coreBase = {
    params:{
      ATTN_MODE:"soft",
      TAU_ATT:0.7,
      GAMMA_GLOBAL:1.0,
      BETA_ENTROPY:0.2,
      DELTA_TEMPORAL:0.3,
      NOISE_SIGMA:0.02,
      ALPHA_SLOW:0.02,
      ETA_ATT:0.05,
      LAMBDA_AP:2.0,
      LAMBDA_SELF:0.1,
      B:1,
      MAINTAIN:1.0,
      LAMBDA_B:0.5,
      SELF_LP:0.02,
      BETA_D:1.0,
      ALPHA_D:0.8,
      ATT_ITERS:5,
      USE_BOTTLENECK:false,
      TOPK_FRACTION:0.22
    },
    taskSchedule:TASK_ORDER,
    taskTicks:1000,
  };

  return [
    {
      id:"PH0",
      name:"Phase 0 Integration Emergence Sweep",
      phase:"PH0",
      ticks:20000,
      logInterval:250,
      params:phase0Common.params,
      taskSchedule:phase0Common.taskSchedule,
      taskTicks:phase0Common.taskTicks,
      sweep:{
        TAU_ATT:[0.5,0.7,1.0],
        GAMMA_GLOBAL:[0.5,1.0,1.5],
        BETA_ENTROPY:[0.1,0.2,0.3],
        DELTA_TEMPORAL:[0.2,0.3,0.5],
        NOISE_SIGMA:[0.01,0.02,0.05]
      },
      maxRuns:243,
      metric:"existenceGate",
      check:(m)=>m.existenceGate===1 && (m.gateStreak||0)>=20,
      desc:"Soft attention / global coupling / entropy / temporal coherence sweep.",
    },
    {
      id:"PH0-A",
      name:"Phase 0 Ablations",
      phase:"PH0",
      ticks:12000,
      logInterval:250,
      params:phase0Common.params,
      taskSchedule:phase0Common.taskSchedule,
      taskTicks:phase0Common.taskTicks,
      cases:[
        {id:"noglobal", label:"no global coupling", params:{GAMMA_GLOBAL:0}},
        {id:"noentropy", label:"no entropy bonus", params:{BETA_ENTROPY:0}},
        {id:"nonoise", label:"no noise", params:{NOISE_SIGMA:0}},
        {id:"legacytopk", label:"legacy top-k", params:{ATTN_MODE:"topk", USE_BOTTLENECK:true}},
      ],
      metric:"existenceGate",
      check:(m)=>m.existenceGate===0,
      desc:"Ablations expected to break the existence gate.",
    },
    {
      id:"CORE-1A",
      name:"CORE-1A Attractor Formation Sweep",
      phase:"CORE1",
      ticks:10000,
      logInterval:250,
      params:coreBase.params,
      taskSchedule:TASK_ORDER,
      taskTicks:1000,
      sweep:{MAINTAIN:[0.6,1.0,1.4], THRESH:[0.2,0.4,0.6], LAMBDA_AP:[0.5,1.5,2.5]},
      maxRuns:27,
      metric:"networkPhi",
      check:(m)=>m.networkPhi>0.6 && m.networkSC>0.15 && m.networkMI>0.1,
      desc:"CORE-1 coarse sweep; find stable attractor regime.",
    },
    {
      id:"CORE-1B",
      name:"CORE-1B Attractor Formation Focus Sweep",
      phase:"CORE1",
      ticks:50000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:TASK_ORDER,
      taskTicks:1000,
      sweep:{MAINTAIN:frange(0.8,1.2,0.1), THRESH:frange(0.3,0.5,0.05), LAMBDA_AP:frange(1.0,2.0,0.25)},
      maxRuns:60,
      metric:"networkPhi",
      check:(m)=>m.networkPhi>0.6 && m.networkSC>0.15 && m.networkMI>0.1,
      desc:"CORE-1 focused search around the sweet spot.",
    },
    {
      id:"CORE-1C",
      name:"CORE-1C Bottleneck / Attention Sweep",
      phase:"CORE1",
      ticks:30000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:TASK_ORDER,
      taskTicks:1000,
      sweep:{TAU_ATT:[0.5,0.7,1.0,1.3], BETA_ENTROPY:[0.1,0.2,0.3], GAMMA_GLOBAL:[0.5,1.0,1.5]},
      maxRuns:48,
      metric:"networkPhi",
      check:(m)=>m.networkPhi>0.6 && m.networkSC>0.15,
      desc:"Sweep attention temperature and global coupling sweet spot.",
    },
    {
      id:"CORE-2",
      name:"CORE-2 Attractor Reuse",
      phase:"CORE2",
      ticks:30000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","REVERSE","ALTERNATE","NOVEL"],
      taskTicks:30000,
      cases:[
        {id:"close-rand", label:"close / random", params:{REUSE_PAIR:"close", INIT_MODE:"rand"}},
        {id:"close-seed", label:"close / seed", params:{REUSE_PAIR:"close", INIT_MODE:"seed"}},
        {id:"close-dist", label:"close / dist", params:{REUSE_PAIR:"close", INIT_MODE:"dist"}},
        {id:"close-wonly", label:"close / weights", params:{REUSE_PAIR:"close", INIT_MODE:"wonly"}},
        {id:"mid-seed", label:"mid / seed", params:{REUSE_PAIR:"mid", INIT_MODE:"seed"}},
        {id:"far-seed", label:"far / seed", params:{REUSE_PAIR:"far", INIT_MODE:"seed"}},
      ],
      metric:"ATS",
      check:(m)=>m.ATS!=null && m.ATS < 1,
      desc:"Reuse, distance-matched controls, and negative transfer.",
    },
    {
      id:"CORE-2.5",
      name:"CORE-2.5 Attractor Geometry",
      phase:"CORE25",
      ticks:30000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","REVERSE","ROTATE","ALTERNATE","NOVEL"],
      sweep:{SIMILARITY:["close","mid","far"], INTERP:[0.25,0.5,0.75]},
      maxRuns:6,
      metric:"ATS",
      check:(m)=>m.ATS!=null && m.ATS > 0,
      desc:"Task-distance curve and interpolation geometry.",
    },
    {
      id:"CORE-3.5",
      name:"CORE-3.5 Routing and Context Switching",
      phase:"CORE35",
      ticks:20000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","ALTERNATE","COPY","ALTERNATE"],
      taskTicks:1000,
      cases:[
        {id:"stable", label:"stable routing", params:{ROUTING_MODE:"stable"}},
        {id:"switch", label:"rapid switch", params:{ROUTING_MODE:"switch"}},
      ],
      metric:"networkSC",
      check:(m)=>m.networkSC>0.35,
      desc:"Routing stability and context switching.",
    },
    {
      id:"CORE-4",
      name:"CORE-4 Compressed Replay",
      phase:"CORE4",
      ticks:50000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:TASK_ORDER,
      taskTicks:1000,
      cases:[
        {id:"replay", label:"offline replay", params:{REPLAY_MODE:true}},
        {id:"sparse", label:"replay + sparsity", params:{REPLAY_MODE:true, L1_REPLAY:0.05}},
      ],
      metric:"ARF",
      check:(m)=>m.ARF!=null && m.ARF > 0,
      desc:"Replay with decay and sparsity.",
    },
    {
      id:"CORE-4.5",
      name:"CORE-4.5 Structured Memory",
      phase:"CORE45",
      ticks:30000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:TASK_ORDER,
      taskTicks:1000,
      cases:[
        {id:"partial", label:"partial cue", params:{MEM_MODE:"partial"}},
        {id:"interf", label:"A-B-C-A", params:{MEM_MODE:"interference"}},
      ],
      metric:"MRP",
      check:(m)=>m.MRP!=null ? m.MRP > 0.8 : false,
      desc:"Partial-cue retrieval and interference test.",
    },
    {
      id:"CORE-5",
      name:"CORE-5 Minimal Embodiment",
      phase:"CORE5",
      ticks:50000,
      logInterval:500,
      params:{...coreBase.params,LAMBDA_B:0.5},
      taskSchedule:["COPY","ALTERNATE","NOVEL"],
      taskTicks:1000,
      cases:[
        {id:"body", label:"body only", params:{LAMBDA_B:0.5, ALPHA_D:0.0}},
        {id:"bodyval", label:"body + value", params:{LAMBDA_B:0.5, ALPHA_D:0.8}},
        {id:"full", label:"full embodied", params:{LAMBDA_B:0.5, ALPHA_D:0.8, BETA_D:2.0}},
      ],
      metric:"J_emb",
      check:(m)=>m.J_emb>0.25,
      desc:"Interoceptive agency and body coupling.",
    },
    {
      id:"CORE-6",
      name:"CORE-6 Delayed Consequences",
      phase:"CORE6",
      ticks:50000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","NOVEL"],
      taskTicks:1000,
      cases:[
        {id:"delay50", label:"50 tick penalty", params:{DELAY_PENALTY:50}},
        {id:"delay100", label:"100 tick penalty", params:{DELAY_PENALTY:100}},
      ],
      metric:"IC",
      check:(m)=>m.networkIC>0.5,
      desc:"Impulse control under delayed consequences.",
    },
    {
      id:"CORE-6.5",
      name:"CORE-6.5 Temporal Credit Assignment",
      phase:"CORE65",
      ticks:50000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","NOVEL"],
      taskTicks:1000,
      cases:[
        {id:"d50", label:"delay 50", params:{CREDIT_DELAY:50}},
        {id:"d100", label:"delay 100", params:{CREDIT_DELAY:100}},
      ],
      metric:"TCAS",
      check:(m)=>m.TCAS>0.5,
      desc:"Temporal credit assignment with distractors.",
    },
    {
      id:"P7-7.1",
      name:"Phase 7.1 Rule Extraction",
      phase:"P7",
      ticks:30000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","REVERSE","ROTATE","ALTERNATE","NOVEL"],
      metric:"CGS",
      check:(m)=>m.CGS>0.6,
      desc:"Rule extraction on unseen inputs.",
    },
    {
      id:"P7-7.2",
      name:"Phase 7.2 Systematic Generalisation",
      phase:"P7",
      ticks:30000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","REVERSE","ROTATE","ALTERNATE","NOVEL"],
      metric:"CGS",
      check:(m)=>m.CGS>0.8,
      desc:"Short-to-long sequence generalisation.",
    },
    {
      id:"P7-7.3",
      name:"Phase 7.3 Multi-Step Reasoning",
      phase:"P7",
      ticks:30000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","ROTATE","ALTERNATE","NOVEL"],
      metric:"PD",
      check:(m)=>m.networkPD>=2,
      desc:"2-3 step chaining and depth scaling.",
    },
    {
      id:"P7-7.4",
      name:"Phase 7.4 Hidden Rule Extraction",
      phase:"P7",
      ticks:30000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","ROTATE","NOVEL"],
      metric:"CGS",
      check:(m)=>m.CGS>=0.7,
      desc:"Novel transformation generalisation.",
    },
    {
      id:"P7-7.5",
      name:"Phase 7.5 Algorithmic Depth Scaling",
      phase:"P7",
      ticks:30000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","REVERSE","ROTATE","ALTERNATE","NOVEL"],
      sweep:{DEPTH:[1,2,3]},
      metric:"CGS",
      check:(m)=>m.CGS>0.5,
      desc:"Accuracy vs depth with graceful degradation.",
    },
    {
      id:"P8-8.1",
      name:"Phase 8.1 Conscious Attractor",
      phase:"P8",
      ticks:50000,
      logInterval:500,
      params:coreBase.params,
      metric:"existenceGate",
      check:(m)=>m.existenceGate===1,
      desc:"Re-evaluate conscious attractor under cognitive load.",
    },
    {
      id:"P8-8.6",
      name:"Phase 8.6 Counterfactual Planning",
      phase:"P8",
      ticks:50000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","NOVEL"],
      metric:"CSR",
      check:(m)=>m.CSR>0.7,
      desc:"Long-safe vs short-trap planning.",
    },
    {
      id:"P9-9.0",
      name:"Phase 9 Attractor Inheritance",
      phase:"P9",
      ticks:30000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:TASK_ORDER,
      metric:"ATS",
      check:(m)=>m.ATS!=null && m.ATS>0,
      desc:"Formal library and reuse across tasks.",
    },
    {
      id:"P9-9.6",
      name:"Phase 9.6 Negative Transfer Detection",
      phase:"P9",
      ticks:30000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","NOVEL"],
      metric:"ATS",
      check:(m)=>m.ATS>1,
      desc:"COPY should slow down when misleading.",
    },
    {
      id:"P9-9.5",
      name:"Phase 9.5 Attractor Composition",
      phase:"P9",
      ticks:30000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","REVERSE","ALTERNATE"],
      metric:"J_score",
      check:(m)=>m.J_score>0.2,
      desc:"Sequential chaining and context selection.",
    },
    {
      id:"P10-10.4",
      name:"Phase 10.4 Variable Binding",
      phase:"P10",
      ticks:30000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","ROTATE","NOVEL"],
      metric:"VAR_BIND",
      check:(m)=>m.VAR_BIND!=null ? m.VAR_BIND > 0.7 : false,
      desc:"A:B::C:? on novel token sets.",
    },
    {
      id:"P10-10.1",
      name:"Phase 10 Symbol Emergence",
      phase:"P10",
      ticks:30000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:TASK_ORDER,
      metric:"AS",
      check:(m)=>m.networkAS>0.2,
      desc:"Attractor states as internal symbols.",
    },
    {
      id:"P11-11.0",
      name:"Phase 11 Spatial Navigation",
      phase:"P11",
      ticks:50000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","ALTERNATE","NOVEL"],
      metric:"GRID",
      check:(m)=>m.GRID!=null ? m.GRID > 0.2 : false,
      desc:"Grid-cell style navigation proxy.",
    },
    {
      id:"P11-11.5",
      name:"Phase 11.5 Map Reuse / Transfer",
      phase:"P11",
      ticks:30000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","ROTATE","NOVEL"],
      metric:"ATS",
      check:(m)=>m.ATS!=null && m.ATS > 0,
      desc:"Transfer to rotated or mirrored environments.",
    },
    {
      id:"P11L-11.6",
      name:"Phase 11.6 Compositional Language",
      phase:"P11L",
      ticks:30000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","ALTERNATE","NOVEL"],
      metric:"LGS",
      check:(m)=>m.LGS>0.5,
      desc:"Zero-shot compositional commands.",
    },
    {
      id:"P11L-11.7",
      name:"Phase 11.7 Instruction Multi-Step",
      phase:"P11L",
      ticks:30000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","REVERSE","ALTERNATE","NOVEL"],
      metric:"LGS",
      check:(m)=>m.LGS>0.6,
      desc:"Sequence commands over multiple steps.",
    },
    {
      id:"P11L-11.8",
      name:"Phase 11.8 Language <-> Attractor Alignment",
      phase:"P11L",
      ticks:30000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:TASK_ORDER,
      metric:"LANG_ALIGN",
      check:(m)=>m.LANG_ALIGN!=null ? m.LANG_ALIGN > 0.2 : false,
      desc:"Token-to-attractor MI alignment.",
    },
    {
      id:"P12-12.1",
      name:"Phase 12.1 Novel Task Injection",
      phase:"P12",
      ticks:50000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:TASK_ORDER,
      metric:"LLS",
      check:(m)=>m.LLS>0.8,
      desc:"Continuous new tasks without reset.",
    },
    {
      id:"P12-12.2",
      name:"Phase 12.2 Knowledge Compression",
      phase:"P12",
      ticks:50000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:TASK_ORDER,
      metric:"KCR",
      check:(m)=>m.KCR!=null ? m.KCR >= 1 : false,
      desc:"Tasks per attractor stored.",
    },
    {
      id:"P12-12.3",
      name:"Phase 12.3 Self-Improvement",
      phase:"P12",
      ticks:50000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:TASK_ORDER,
      metric:"LLS",
      check:(m)=>m.LLS>0.8,
      desc:"Meta-adjustment of learning rates.",
    },
    {
      id:"ARC-MOCK",
      name:"ARC Mock Benchmark",
      phase:"ARC",
      ticks:50000,
      logInterval:500,
      params:coreBase.params,
      taskSchedule:["COPY","REVERSE","ROTATE","ALTERNATE","NOVEL"],
      metric:"ARC",
      check:(m)=>m.ARC>=0.5,
      desc:"Final validation before any claim.",
    },
  ];
}

// ── Parameters (v12.0 defaults) ───────────────────────────────────────────────
 (v12.0 defaults) ───────────────────────────────────────────────
const P = {
  // Core metabolic (v12 canonical values)
  MAINTAIN:1.0, MAINTAIN_INPUT:0.04, REGEN:1.1,
  FIRE_COST:4.0, COOP_BONUS:6.0, COOP_W:8,
  ATP_MAX:100, ATP_TARGET:55, ATP_START_MIN:42, ATP_START_MAX:68,
  LAMBDA_ATP:0.0003, LAMBDA_FIRE:0.04, LAMBDA_COH:0.08,
  // Neuron
  THRESH:0.4, EPS:0.08,
  HEBB:0.01, DECAY:0.0008, W_MAX:2.0, W_PRUNE:0.004,
  W_INIT_LO:0.18, W_INIT_HI:0.55,
  H_INIT:1.0, L_CRIT:0.18, ATROPHY_RATE:0.0008, RECOVERY_RATE:0.025,
  H_FLOOR_RECOVERY:0.00015, H_MIN:0.05, H_ATROPHIED:0.35, H_STRESSED:0.65,
  INACTIVITY_SCALE:2.5, P_REGROW:0.004, REGROW_BIAS_MI:0.7,
  REFRACT:3, DRIFT_T:120, K_LOCAL:8, REWIRE:0.5,
  DEV_TICKS:50, DEV_AMP:0.22, ENV_AMP:0.85,
  TASK_TICKS:800, MI_WINDOW:300,
  // Dendritic
  B:1, DEND_THRESH:0.30, DEND_K:5.0, COIN_WINDOW:3, COIN_K:3,
  // Cognitive field v12
  ETA_ATT:0.05, BETA_A:2.0, ALPHA_D:0.8, ATT_ITERS:5,
  LAMBDA_AP:2.0, LAMBDA_SELF:0.1,
  // Revised soft attractor
  ATTN_MODE:"soft",
  TAU_ATT:0.7,
  GAMMA_GLOBAL:1.0,
  BETA_ENTROPY:0.2,
  DELTA_TEMPORAL:0.3,
  NOISE_SIGMA:0.02,
  ALPHA_SLOW:0.02,
  // Plasticity rates
  ETA_B:0.01, ETA_A:0.005, ETA_V:0.008, ETA_M:0.015, ETA_P:0.003,
  // TD / Dopamine
  BETA_D:1.0, ETA_V_TD:0.02, GAMMA_TD:0.95,
  // Body / Embodiment
  SELF_LP:0.02,
  LAMBDA_B:0.5,       // interoceptive coupling (0=disabled)
  BODY_ENERGY_DRAIN:0.0002,
  BODY_FEED_PROB:0.0005,
  BODY_FEED_AMT:0.35,
  BODY_HEALTH_TARGET:0.8,
  BODY_ENERGY_TARGET:0.7,
  // Consciousness bottleneck (legacy/top-k ablation only)
  TOPK_FRACTION:0.22,
  USE_BOTTLENECK:false,
};

// ══════════════════════════════════════════════════════════════════════════════
// EXPERIMENT DEFINITIONS
// ══════════════════════════════════════════════════════════════════════════════

const EXP_TICKS    = 50000;
const LOG_INTERVAL = 500;
const BURNIN       = 2000;
const CONV_THRESH  = 0.002;
const MAX_LOG      = 25000;
const WIN_SAMPLES  = 10;

const LOG_COLS = [
  't','expId','expName','phase',
  'existence_gate','failure_reason','gScore','participationEntropy',
  'J_emb','J_star','J_score','Phi','SC','PU','CGS','CSR','ARI','GIS','SOS','R','Coh','Control','AS',
  'IC','PD','FSI','S_body','C_ctrl',
  'MI','ATS','ATP','FS','BPS','dopamine','V_td',
  'body_energy','body_health','eps_body',
  'Sself','Agency','healthy','atrophied',
  'converged','phaseTimeCOG',
];

const EXPERIMENT_BLUEPRINTS = buildResearchExperiments();
const EXPERIMENTS = expandBlueprints(EXPERIMENT_BLUEPRINTS);
const NUM_EXP = EXPERIMENTS.length;

// ══════════════════════════════════════════════════════════════════════════════
// MATH
// ══════════════════════════════════════════════════════════════════════════════

function tdist(ax,ay,bx,by){
  const dx=Math.min(Math.abs(ax-bx),G-Math.abs(ax-bx));
  const dy=Math.min(Math.abs(ay-by),G-Math.abs(ay-by));
  return Math.sqrt(dx*dx+dy*dy);
}
function xlogx(p,q){if(p<1e-10||q<1e-10)return 0;return p*Math.log2(p/q);}
function clamp(v,lo=0,hi=1){return v<lo?lo:v>hi?hi:v;}
function th(x){return Math.tanh(x);}

function mkNB(max=200){return{arr:[],lo:Infinity,hi:-Infinity,max};}
function nbPush(nb,val){
  const v=isFinite(val)&&!isNaN(val)?val:0;
  nb.arr.push(v);if(v<nb.lo)nb.lo=v;if(v>nb.hi)nb.hi=v;
  if(nb.arr.length>nb.max){
    const rem=nb.arr.shift();
    if(rem<=nb.lo||rem>=nb.hi){
      nb.lo=Infinity;nb.hi=-Infinity;
      for(let i=0;i<nb.arr.length;i++){if(nb.arr[i]<nb.lo)nb.lo=nb.arr[i];if(nb.arr[i]>nb.hi)nb.hi=nb.arr[i];}
    }
  }
  return nb.hi>nb.lo?(v-nb.lo)/(nb.hi-nb.lo):0.5;
}

function pearson(a,b){
  const n=Math.min(a.length,b.length);if(n<4)return 0;
  let sa=0,sb=0,sab=0,sa2=0,sb2=0;
  for(let i=0;i<n;i++){sa+=a[i];sb+=b[i];sab+=a[i]*b[i];sa2+=a[i]*a[i];sb2+=b[i]*b[i];}
  const num=n*sab-sa*sb,den=Math.sqrt((n*sa2-sa*sa)*(n*sb2-sb*sb));
  return den<1e-10?0:clamp(num/den,-1,1);
}

function computeMI(n){
  const tot=n.mi_n1+n.mi_n0;if(tot<20)return 0;
  const p1=n.mi_n1/tot,p0=n.mi_n0/tot;
  const f1=n.mi_f1/Math.max(n.mi_n1,1),f0=n.mi_f0/Math.max(n.mi_n0,1);
  const f=f1*p1+f0*p0;
  return clamp(p1*(xlogx(f1,f)+xlogx(1-f1,1-f))+p0*(xlogx(f0,f)+xlogx(1-f0,1-f)));
}
function computeCR(ns){
  let wS=0,wSq=0,wC=0,fire=0;
  for(let i=0;i<N;i++){const n=ns[i];if(n.state==="alarming")fire++;for(let j=0;j<n.conns.length;j++){const w=n.conns[j].w;wS+=w;wSq+=w*w;wC++;}}
  const wM=wC?wS/wC:0,wV=wC?wSq/wC-wM*wM:0;
  const pf=clamp(fire/N,0.001,0.999);
  return Math.min(10,-(pf*Math.log2(pf)+(1-pf)*Math.log2(1-pf))/Math.max(0.001,Math.min(1,wV*5)));
}
function computeCoh(ns){
  let mu=0;for(let i=0;i<N;i++)mu+=ns[i].epsilon;mu/=N;
  let sig=0;for(let i=0;i<N;i++){const d=ns[i].epsilon-mu;sig+=d*d;}
  return clamp(1-Math.sqrt(sig/N)/(mu+0.01));
}
const PHI_PAIRS=[];
(function(){for(let i=0;i<28;i++)PHI_PAIRS.push([Math.floor(Math.random()*N),Math.floor(Math.random()*N)]);}());
function computePhi(ns){
  let mu=0;for(let i=0;i<N;i++)mu+=ns[i].C;mu/=N;
  let vari=0;for(let i=0;i<N;i++){const d=ns[i].C-mu;vari+=d*d;}vari/=N;
  let cs=0,pairs=0;
  for(let k=0;k<PHI_PAIRS.length;k++){
    const ai=PHI_PAIRS[k][0],bi=PHI_PAIRS[k][1];if(ai===bi)continue;
    cs+=Math.abs(ns[ai].C-mu)*Math.abs(ns[bi].C-mu);pairs++;
  }
  return clamp(Math.sqrt(vari)+(pairs?cs/pairs:0));
}
function computeClustering(ns){
  let tot=0;
  for(let i=0;i<N;i++){
    const n=ns[i],nb=new Set(n.conns.map(c=>c.to));if(nb.size<2)continue;
    const arr=[...nb];let tri=0,pairs=0;
    for(let a=0;a<arr.length;a++)for(let b=a+1;b<arr.length;b++){pairs++;if(ns[arr[a]].conns.some(c=>c.to===arr[b]))tri++;}
    tot+=pairs?tri/pairs:0;
  }
  return tot/N;
}

// FSI -- Functional Specialization Index
function computeFSI(ns){
  const miPerTask=TASK_ORDER.map(k=>ns.reduce((s,n)=>{
    if(!n.branch_task_spikes[k])return s;
    const spk=n.branch_task_spikes[k].reduce((a,b)=>a+b,0);
    return s+spk;
  },0)/N);
  const mean=miPerTask.reduce((a,b)=>a+b,0)/miPerTask.length;
  const vari=miPerTask.reduce((s,v)=>s+(v-mean)*(v-mean),0)/miPerTask.length;
  return mean>0.001?vari/mean:0;
}

// ══════════════════════════════════════════════════════════════════════════════
// SIM INIT
// ══════════════════════════════════════════════════════════════════════════════

function createSim(){
  const B=P.B;
  const ns=Array.from({length:N},(_,i)=>({
    id:i,gx:i%G,gy:Math.floor(i/G),
    atp:P.ATP_START_MIN+Math.random()*(P.ATP_START_MAX-P.ATP_START_MIN),
    refractory:0,h:P.H_INIT,atrophied_at:-1,
    state:"healthy",conns:[],sources:[],lastFire:-999,noFireCount:0,
    L:0,L_rolling:0,
    mi_f1:0,mi_f0:0,mi_n1:0,mi_n0:0,mi:0,
    conns_pruned:0,conns_grown:0,atp_spent:0,
    branch_soma_w:Array.from({length:B},()=>(0.6+Math.random()*0.4)/Math.max(1,B)),
    branch_out:new Array(B).fill(0),d_eff:0,
    branch_spike_1k:new Array(B).fill(0),
    branch_task_spikes:TASK_ORDER.reduce((acc,k)=>({...acc,[k]:new Array(B).fill(0)}),{}),
    // Cognitive field v12
    b:0, a:0.3, a_prev:0.3, epsilon:0,
    epsilon_dd:0, // tanh-bounded desire-modulated error
    v:0.45+Math.random()*0.1, A:1/N, s_soma:0,
    C:0.0, C_prev:0.0, a_slow:0.3, M:0.3, // M = slow apical self-model
    // IC computation
    Q_reflex:0, Q_planned:0,
    ic_wins:0, ic_total:0,
    spike_total:0, control_ap:0,
    isInput:IN_IDS.has(i),
  }));
  for(let i=0;i<N;i++){
    const ni=ns[i];const sorted=[];
    for(let j=0;j<N;j++){if(j===i)continue;sorted.push([j,tdist(ni.gx,ni.gy,ns[j].gx,ns[j].gy)]);}
    sorted.sort((a,b2)=>a[1]-b2[1]);
    for(let k=0;k<P.K_LOCAL;k++){
      const jO=sorted[k][0];
      const j=Math.random()<P.REWIRE?Math.floor(Math.random()*N):jO;
      if(j===i||ni.conns.find(c=>c.to===j))continue;
      const w=P.W_INIT_LO+Math.random()*(P.W_INIT_HI-P.W_INIT_LO);
      ni.conns.push({to:j,w,branch:k%B});ns[j].sources.push(i);
    }
  }
  return{
    ns,t:0,seqI:0,taskKey:"COPY",task:TASKS.COPY,taskStartT:0,
    taskHistory:[],recent:[],
    taskSchedule:[...TASK_ORDER],taskTicks:P.TASK_TICKS,currentSpec:null,
    networkMI:0,networkSE:0,networkCR:1,ats:null,
    networkCoh:0,networkG:0,networkSself:0,networkAgency:0,
    networkEE:0,networkBPS:0,networkAtpVar:0,networkClustering:0,
    networkDU:0,C_chollet:0,C_bach:0,J_score:0,
    // Cognitive field metrics
    dopamine:0,V_td:0.5,       // TD value estimate
    networkPhi:0,networkSC:0,networkAS:0,networkPU:0,
    networkR:0,networkControl:0,networkM:0,J_star:0,
    networkIC:0,networkPD:0,networkFSI:0,
    networkSbody:0,networkCtrl:0,J_emb:0,
    participationEntropy:0,globalField:0,existenceGate:0,gateStreak:0,failureReason:"",
    gScore:0,phaseRegion:"DISORDERED",
    // Incremental norm buffers
    nb:{se:mkNB(),cr:mkNB(),ats:mkNB(),coh:mkNB(),sself:mkNB(),agency:mkNB(),
        J:mkNB(),phi:mkNB(),sc:mkNB(),Jstar:mkNB(),jemb:mkNB()},
    firingBuffer:[],C_history:[],a_history:[],
    pd_rate_history:[],  // for prediction depth
    energy_history:[],   // for S_body
    interferenceScore:0,recoveryTime:null,
    inRecovery:false,recoveryThreshold:0,recoveryStartT:0,
    transferEfficiency:null,baselineSE:null,
    I_at_task_start:{},totalPruned:0,totalGrown:0,totalConns:0,
    Jstar_history:[],converged:false,convergedAt:-1,
    phaseTimeCOG:-1,phaseTimePRED:-1,
    win_Jstar:[],win_Phi:[],win_SC:[],win_Coh:[],win_Ctrl:[],win_IC:[],
    exp_maxPhi:0,exp_phiPhase:false,hPhiSeen:false,
    h16Confirmed:false,h17Confirmed:false,
    // Body / Embodiment
    body:{energy:0.7,health:0.8,pred_energy:0.5,pred_health:0.5,
          eps_body:0,R_body:0},
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// TICK -- v12.0 dynamics
// ══════════════════════════════════════════════════════════════════════════════

function simTick(sim){
  const{ns,body}=sim;sim.t++;const t=sim.t;const B=P.B;
  const taskTicks = sim.taskTicks || P.TASK_TICKS; if(t-sim.taskStartT>=taskTicks)advanceTask(sim);
  const envBit=sim.task.seq[sim.seqI%sim.task.seq.length];sim.seqI++;
  const firedNow=new Set();

  // ── Body dynamics (interoceptive state) ─────────────────────────────────────
  body.energy-=P.BODY_ENERGY_DRAIN;
  if(Math.random()<P.BODY_FEED_PROB)body.energy=Math.min(1,body.energy+P.BODY_FEED_AMT);
  if(body.energy<0)body.energy=0;
  // Interoceptive prediction from slow self-model mean
  const meanM=ns.reduce((s,n)=>s+n.M,0)/N;
  body.pred_energy=clamp(0.5+meanM*0.4);
  body.pred_health=clamp(body.health*0.9+0.1);
  const epsBE=(body.energy-body.pred_energy)*(body.energy-body.pred_energy);
  const epsBH=(body.health-body.pred_health)*(body.health-body.pred_health);
  body.eps_body=epsBE+epsBH;
  // Body reward
  const dE=body.energy-P.BODY_ENERGY_TARGET,dH=body.health-P.BODY_HEALTH_TARGET;
  body.R_body=1.0-0.5*(dE*dE+dH*dH)-P.LAMBDA_B*body.eps_body;

  // ── TD Dopamine update ───────────────────────────────────────────────────────
  const taskReward=sim.networkMI;
  const R_t=taskReward+P.LAMBDA_B*body.R_body;
  const V_next=clamp(sim.V_td*(1-P.ETA_V_TD)+R_t*P.ETA_V_TD,0,2);
  const delta_t=R_t+GAMMA_TD*V_next-sim.V_td;
  sim.V_td+=P.ETA_V_TD*delta_t;
  // Dopamine = bounded TD error (only for plasticity, not error modulation)
  sim.dopamine=sim.dopamine*P.BETA_D*0.8+delta_t*0.2;
  sim.dopamine=clamp(sim.dopamine,-1,1);

  // ── PASS 1: ATP + basal input ─────────────────────────────────────────────
  for(let i=0;i<N;i++){
    const n=ns[i];
    const maintain=n.isInput?P.MAINTAIN_INPUT:P.MAINTAIN;
    n.atp+=P.REGEN-maintain;
    if(n.atp>P.ATP_MAX)n.atp=P.ATP_MAX;
    if(n.atp<1)n.atp=1;
    if(n.refractory>0){n.refractory--;n.state="refractory";continue;}
    let basal=n.isInput?envBit*P.ENV_AMP:0;
    if(t<=P.DEV_TICKS)basal+=Math.random()*P.DEV_AMP;
    if(B<=1){
      const srcs=n.sources;
      for(let si=0;si<srcs.length;si++){
        const src=ns[srcs[si]];if(src.lastFire!==t-1)continue;
        const conns=src.conns;
        for(let ci=0;ci<conns.length;ci++){if(conns[ci].to===n.id){basal+=conns[ci].w*src.h;break;}}
      }
    } else {
      const V_b=n.branch_out;for(let b=0;b<B;b++)V_b[b]=0;
      const C_b=new Array(B).fill(0);
      const srcs=n.sources;
      for(let si=0;si<srcs.length;si++){
        const src=ns[srcs[si]];const conns=src.conns;
        for(let ci=0;ci<conns.length;ci++){
          if(conns[ci].to!==n.id)continue;
          const br=conns[ci].branch??0;
          if(src.lastFire===t-1)V_b[br]+=conns[ci].w*src.h;
          if(src.lastFire>=t-P.COIN_WINDOW)C_b[br]++;
          break;
        }
      }
      for(let b=0;b<B;b++){
        const nmda=1/(1+Math.exp(-P.DEND_K*(V_b[b]-P.DEND_THRESH)));
        const coin=C_b[b]/P.COIN_K>1?1:C_b[b]/P.COIN_K;
        n.branch_out[b]=V_b[b]*nmda*(0.5+0.5*coin);
        basal+=n.branch_soma_w[b]*n.branch_out[b];
        n.branch_spike_1k[b]*=0.997;
      }
    }
    n.b=basal;
    if(envBit===1)n.mi_n1++;else n.mi_n0++;
    if(t%P.MI_WINDOW===0){n.mi_f1*=0.7;n.mi_f0*=0.7;n.mi_n1*=0.7;n.mi_n0*=0.7;}
    if(t%8===0&&i%4===t%4)n.mi=computeMI(n);
  }


// ── PASS 2: Soft globally coupled attractor ─────────────────────────────────
for(let iter=0;iter<P.ATT_ITERS;iter++){
  const tau = Math.max(1e-6, P.TAU_ATT ?? 0.7);
  const logits = ns.map(n => n.a / tau);
  const C = softmaxStable(logits, 1.0);
  const G = ns.reduce((s,n,i)=>s + C[i] * n.a, 0);
  const H = entropyOf(C);
  sim.globalField = G;
  sim.participationEntropy = H;
  for(let i=0;i<N;i++){
    const n=ns[i];
    if(n.refractory>0) continue;
    n.C_prev = n.C;
    n.C = C[i];
    n.a_slow = (1 - (P.ALPHA_SLOW ?? 0.02)) * n.a_slow + (P.ALPHA_SLOW ?? 0.02) * n.a;
    const localErr = n.a - n.b;
    const globalAlign = (P.GAMMA_GLOBAL ?? 1.0) * (n.a - G);
    const temporalCoherence = (P.DELTA_TEMPORAL ?? 0.3) * (n.a - n.a_slow);
    const diversityPush = (P.BETA_ENTROPY ?? 0.2) * (Math.log(Math.max(n.C, 1e-8)) - Math.log(1 / N));
    const noise = (Math.random() * 2 - 1) * (P.NOISE_SIGMA ?? 0.02);
    const dEda = localErr + globalAlign + temporalCoherence - diversityPush;
    n.a -= P.ETA_ATT * dEda + noise * 0.25;
    if(n.a>2)n.a=2;if(n.a<-2)n.a=-2;
    const som=n.b+P.LAMBDA_AP*n.a-P.THRESH/Math.max(n.h,0.15);
    n.s_soma=1/(1+Math.exp(-som*3));
  }
}

// Legacy top-k ablation mode can still be requested explicitly via ATTN_MODE="topk".
if((P.ATTN_MODE || "soft") === "topk" || P.USE_BOTTLENECK){
  const attnIdx=Array.from({length:N},(_,i)=>i).sort((a,b2)=>ns[b2].A-ns[a].A);
  const topK=new Set(attnIdx.slice(0,getTopKConscious()));
  for(let i=0;i<N;i++){
    const n=ns[i];
    if(n.refractory>0)continue;
    n.C_prev=n.C;
    n.C=topK.has(i)?n.A*n.a:0;
  }
}

for(let i=0;i<N;i++){
  const n=ns[i];if(n.refractory>0)continue;
  n.a_prev=n.a;
  n.epsilon=n.b>n.a?n.b-n.a:n.a-n.b;
  // Tanh-bounded desire modulation (v12 correction)
  n.epsilon_dd=n.epsilon*(1+P.ALPHA_D*th(n.v));
  // Self-model update with TD-gated predictive gradient
  const selfErr=n.a-n.M;
  const dpGrad=sim.dopamine*Math.sign(selfErr);
  n.M+=P.ETA_M*selfErr+P.ETA_P*dpGrad;
  n.M=clamp(n.M,-2,2);
  // Health
  const L=n.epsilon*n.epsilon+P.LAMBDA_COH*(n.a-n.a_prev)*(n.a-n.a_prev)
          +P.LAMBDA_ATP*(n.atp-P.ATP_TARGET)*(n.atp-P.ATP_TARGET);
  n.L=L;n.L_rolling=n.L_rolling*0.92+n.L*0.08;
  const atrophy=P.ATROPHY_RATE*(n.L-P.L_CRIT>0?n.L-P.L_CRIT:0);
  n.h-=atrophy;n.h+=P.H_FLOOR_RECOVERY;
  if(n.h>1)n.h=1;if(n.h<P.H_MIN)n.h=P.H_MIN;
  if(n.h<P.H_ATROPHIED&&n.atrophied_at<0)n.atrophied_at=t;
  if(n.h>=P.H_STRESSED&&n.atrophied_at>0)n.atrophied_at=-1;
  // Impulse control: Q_reflex vs Q_planned
  n.Q_reflex=n.b*Math.max(0,n.v-0.3);
  n.Q_planned=n.s_soma*n.v;
}

// Body health tracks network health
const meanH=ns.reduce((s,n)=>s+n.h,0)/N;
body.health=body.health*0.998+meanH*0.002;

// ── PASS 4: Act ─────────────────────────────────────────────────────────────

  for(let i=0;i<N;i++){
    const n=ns[i];if(n.refractory>0)continue;
    if(n.s_soma>0.5&&n.epsilon>P.EPS&&n.atp>P.FIRE_COST){
      const since=t-n.lastFire,pen=since<4?P.FIRE_COST*(2.5/since):0,cost=P.FIRE_COST+pen;
      if(n.atp>=cost){
        n.atp-=cost;n.atp_spent+=cost;n.lastFire=t;n.refractory=P.REFRACT;
        n.noFireCount=0;firedNow.add(n.id);sim.recent.push({id:n.id,t});
        if(envBit===1)n.mi_f1++;else n.mi_f0++;
        if(n.a>n.b)n.control_ap++;
        n.spike_total++;
        // IC tracking
        n.ic_total++;
        if(n.Q_planned>n.Q_reflex)n.ic_wins++;
        if(B>1){const dom=n.branch_out.indexOf(Math.max(...n.branch_out));n.branch_spike_1k[dom]++;if(n.branch_task_spikes[sim.taskKey])n.branch_task_spikes[sim.taskKey][dom]++;}
        n.state="alarming";continue;
      }
    }
    n.noFireCount=n.b>0.1?n.noFireCount+1:Math.max(0,n.noFireCount-1);
    if(n.h>=P.H_STRESSED)n.state=n.noFireCount>P.DRIFT_T?"drifted":"healthy";
    else if(n.h>=P.H_ATROPHIED)n.state="stressed";
    else n.state="atrophied";
  }

  // ── PASS 5: Coop ─────────────────────────────────────────────────────────────
  const ws=t-P.COOP_W,rset=new Set(sim.recent.filter(f=>f.t>=ws).map(f=>f.id));
  for(const id of firedNow)for(const{to}of ns[id].conns)if(rset.has(to)){ns[id].atp=Math.min(P.ATP_MAX,ns[id].atp+P.COOP_BONUS);ns[id].h=Math.min(1,ns[id].h+P.RECOVERY_RATE);break;}

  // ── PASS 6: Plasticity (TD-gated, v12) ──────────────────────────────────────
  let pruned=0,totalW=0;
  const eta_b=P.ETA_B??P.HEBB;
  const eta_a=P.ETA_A??P.HEBB*0.5;
  for(let i=0;i<N;i++){
    const n=ns[i];
    const wCap=P.W_MAX*Math.max(n.h,0.15);
    const inact=Math.min(1,n.noFireCount/P.DRIFT_T)*P.INACTIVITY_SCALE*(1/Math.max(n.h,0.2));
    const myF=firedNow.has(n.id);
    // Local neighborhood activity for apical plasticity
    const localAct=n.conns.filter(c=>firedNow.has(c.to)).length/Math.max(n.conns.length,1);
    const toRem=[];
    for(let ci=0;ci<n.conns.length;ci++){
      const c=n.conns[ci];
      if(myF&&firedNow.has(c.to)){
        // Basal: Hebbian + epsilon_dd (desire-modulated)
        c.w=Math.min(wCap,c.w+eta_b*Math.abs(n.epsilon_dd));
        // Apical update (neighbourhood co-activity, no somatic requirement)
        if(firedNow.has(c.to))c.w=Math.min(wCap,c.w+eta_a*localAct);
      } else {
        c.w=Math.max(0,c.w-P.DECAY*(1+inact));
      }
      if(c.w<P.W_PRUNE){toRem.push(c.to);pruned++;}totalW++;
    }
    for(let r=0;r<toRem.length;r++){
      n.conns=n.conns.filter(c=>c.to!==toRem[r]);
      ns[toRem[r]].sources=ns[toRem[r]].sources.filter(s=>s!==n.id);
      n.conns_pruned++;
    }
    // Value learning: v12 uses TD delta
    if(myF){n.v=clamp(n.v+P.ETA_V*(sim.dopamine*(0.5+th(n.v)*0.5)),0,2);}
  }

  // ── PASS 7: Regrowth ─────────────────────────────────────────────────────────
  let grown=0;
  if(t%4===0){
    const miS=ns.filter(n=>n.state!=="atrophied"&&n.mi>0.02).sort((a,b2)=>b2.mi-a.mi).slice(0,15);
    for(let i=0;i<N;i++){
      const n=ns[i];
      if(n.h>=P.H_ATROPHIED||Math.random()>P.P_REGROW)continue;
      const tgt=Math.random()<P.REGROW_BIAS_MI&&miS.length>0?miS[Math.floor(Math.random()*Math.min(5,miS.length))]:ns[Math.floor(Math.random()*N)];
      if(!tgt||tgt.id===n.id||n.conns.find(c=>c.to===tgt.id)||n.conns.length>=P.K_LOCAL*3)continue;
      const bc=new Array(B).fill(0);for(const c of n.conns)bc[c.branch??0]++;
      const branch=bc.indexOf(Math.min(...bc));
      n.conns.push({to:tgt.id,w:P.W_INIT_LO*0.6,branch});
      if(!tgt.sources.includes(n.id))tgt.sources.push(n.id);
      n.conns_grown++;grown++;
    }
  }

  sim.recent=sim.recent.filter(f=>f.t>=t-P.COOP_W-2);

  // ── Periodic metrics ─────────────────────────────────────────────────────────
  if(t%16===0){
    let miS=0;for(let i=0;i<N;i++)miS+=ns[i].mi;
    sim.networkMI=miS/N;sim.networkCR=computeCR(ns);
  }
  if(sim.inRecovery&&sim.networkMI>=sim.recoveryThreshold){sim.recoveryTime=t-sim.recoveryStartT;sim.inRecovery=false;}

  if(t%50===0){
    sim.networkCoh=computeCoh(ns);
    let gS=0,atpS=0,atpSq=0;
    for(let i=0;i<N;i++){gS+=ns[i].epsilon;atpS+=ns[i].atp;atpSq+=ns[i].atp*ns[i].atp;}
    sim.networkG=gS/N;const atpMu=atpS/N;sim.networkAtpVar=atpSq/N-atpMu*atpMu;
    sim.networkPhi=computePhi(ns);
    let HA=0;for(let i=0;i<N;i++){if(ns[i].A>1e-10)HA-=ns[i].A*Math.log2(ns[i].A);}
    sim.networkAS=clamp(1-HA/Math.log2(N));
    // Predictive usefulness proxy: future-leaning utility of the current soft field.
    sim.networkPU=clamp(sim.networkMI*(0.5+sim.networkSC*0.5)*(0.5+sim.networkAS*0.5));
    let mS=0,icW=0,icT=0,ctrlAp=0,spikeT=0;
    for(let i=0;i<N;i++){
      mS+=ns[i].M;icW+=ns[i].ic_wins;icT+=ns[i].ic_total;
      ctrlAp+=ns[i].control_ap;spikeT+=ns[i].spike_total;
    }
    sim.networkM=mS/N;
    sim.networkIC=icT>0?icW/icT:0;
    sim.networkControl=spikeT>0?ctrlAp/spikeT:0;
    const gateNow = computeGate(sim);
    sim.existenceGate = gateNow;
    sim.gateStreak = gateNow ? (sim.gateStreak||0) + 1 : 0;
    sim.failureReason = computeFailureReason(sim);
    const structuralS = 0.4*sim.networkPhi + 0.3*sim.networkPU + 0.3*sim.networkSC;
    const functionalF = 0.5*Math.max(0, sim.networkR) + 0.5*Math.max(0, sim.ats ?? 0);
    const systemP = 0.4*Math.max(0, sim.networkAS) + 0.3*Math.max(0, sim.networkSself) + 0.3*Math.max(0, sim.networkAgency);
    const collapsePenalty = sim.phaseRegion === "DISORDERED" ? 0.2 : 0;
    sim.gScore = gateNow ? 1/(1+Math.exp(-(0.5*structuralS + 0.3*functionalF + 0.2*systemP - collapsePenalty))) : 0;
    // C_ctrl: homeostatic control (negative = good homeostasis)
    const dEn=body.energy-P.BODY_ENERGY_TARGET,dHe=body.health-P.BODY_HEALTH_TARGET;
    sim.networkCtrl=clamp(1-(dEn*dEn+dHe*dHe)*2,0,1);
    // Energy history for S_body
    sim.energy_history.push(body.energy);
    if(sim.energy_history.length>40)sim.energy_history.shift();
    if(sim.energy_history.length>=20){
      const half=Math.floor(sim.energy_history.length/2);
      sim.networkSbody=Math.max(0,pearson(sim.energy_history.slice(0,half),sim.energy_history.slice(half)));
    }
  }

  sim.firingBuffer.push({count:firedNow.size,envBit});if(sim.firingBuffer.length>400)sim.firingBuffer.shift();

  if(t%300===0){
    if(sim.firingBuffer.length>=200){const r=sim.firingBuffer.slice(-100).map(f=>f.count),o=sim.firingBuffer.slice(-200,-100).map(f=>f.count);sim.networkSself=Math.max(0,pearson(r,o));}
    const d2=20;if(sim.firingBuffer.length>=d2+80){const yr=sim.firingBuffer.slice(-d2-80,-d2).map(f=>f.count),xe=sim.firingBuffer.slice(-80).map(f=>f.envBit);sim.networkAgency=Math.max(0,pearson(yr,xe));}
    const atpW=ns.reduce((s,n)=>s+n.atp_spent,0),dI=Math.max(0,sim.networkMI-(sim.I_at_task_start[sim.taskKey]||0));
    sim.networkEE=atpW>0?dI/atpW*1000:0;
    const spW=sim.firingBuffer.slice(-30).reduce((s,f)=>s+f.count,0);sim.networkBPS=spW>0?sim.networkMI*N*30/spW:0;
    if(B>1){let actB=0,totB=0;for(let i=0;i<N;i++){for(let b=0;b<B;b++){totB++;if(ns[i].branch_spike_1k[b]>0.5)actB++;}}sim.networkDU=totB?actB/totB:0;}
    const Cv=ns.map(n=>n.C);sim.C_history.push(Cv);if(sim.C_history.length>5)sim.C_history.shift();
    if(sim.C_history.length>=2)sim.networkSC=Math.max(0,pearson(sim.C_history[sim.C_history.length-1],sim.C_history[0]));
    const Av=ns.map(n=>n.a);sim.a_history.push(Av);if(sim.a_history.length>5)sim.a_history.shift();
    if(sim.a_history.length>=2)sim.networkR=Math.max(0,pearson(sim.a_history[sim.a_history.length-1],sim.a_history[0]));
    // Firing rate vector for PD
    const rateVec=firedNow.size/N;
    sim.pd_rate_history.push(rateVec);if(sim.pd_rate_history.length>25)sim.pd_rate_history.shift();
    if(sim.pd_rate_history.length>=20){
      const base=pearson(sim.pd_rate_history.slice(0,10),sim.pd_rate_history.slice(1,11));
      const lag2=pearson(sim.pd_rate_history.slice(0,8),sim.pd_rate_history.slice(4,12));
      const lag3=pearson(sim.pd_rate_history.slice(0,6),sim.pd_rate_history.slice(7,13));
      const eps=0.1*Math.max(Math.abs(base),0.01);
      sim.networkPD=Math.abs(lag3)>eps?3:Math.abs(lag2)>eps?2:Math.abs(base)>eps?1:0;
    }
    if(t%2000===0)sim.networkFSI=computeFSI(ns);
    if(sim.networkPhi>sim.exp_maxPhi)sim.exp_maxPhi=sim.networkPhi;
    if(sim.networkPhi>0.2&&sim.networkSC>0.35){sim.exp_phiPhase=true;sim.hPhiSeen=true;}
  }

  if(t%1000===0)sim.networkClustering=computeClustering(ns);
  sim.totalPruned+=pruned;sim.totalGrown+=grown;sim.totalConns=totalW;
  return firedNow.size;
}

function advanceTask(sim){
  const schedule = Array.isArray(sim.taskSchedule) && sim.taskSchedule.length ? sim.taskSchedule : TASK_ORDER;
  const cIdx=schedule.indexOf(sim.taskKey);
  const nKey=schedule[(cIdx+1)%schedule.length];
  const I_end=sim.networkMI,ticks=sim.t-sim.taskStartT;
  sim.taskHistory.push({key:sim.taskKey,startT:sim.taskStartT,endT:sim.t,I_start:sim.I_at_task_start[sim.taskKey]||0,I_end,ticks});
  if(nKey==="NOVEL"&&sim.t>BURNIN){
    const cr=sim.taskHistory.find(r=>r.key==="COPY");
    if(cr){const sp=I_end/ticks,sb=cr.I_end/cr.ticks;sim.ats=sb>0?sp/sb:null;if(!sim.baselineSE)sim.baselineSE=sb;}
  } else if(nKey==="NOVEL"){sim.ats=null;}
  sim.recoveryStartT=sim.t;sim.recoveryThreshold=I_end*0.9;sim.inRecovery=I_end>0.01;sim.recoveryTime=null;
  sim.taskKey=nKey;sim.task=TASKS[nKey];sim.taskStartT=sim.t;sim.seqI=0;
  sim.I_at_task_start[nKey]=sim.networkMI;
  for(const n of sim.ns)n.atp_spent=0;
}

// ══════════════════════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════════════════════


function calcStats(sim){
  const ns=sim.ns;
  const counts={healthy:0,stressed:0,atrophied:0,alarming:0,refractory:0,drifted:0};
  let atpS=0,hS=0,vS=0,atpSp=0,deffS=0;
  for(let i=0;i<N;i++){
    const n=ns[i];counts[n.state]=(counts[n.state]||0)+1;
    atpS+=n.atp;hS+=n.h;vS+=n.v;atpSp+=n.atp_spent;deffS+=n.d_eff||0;
  }
  const tW=sim.t-sim.taskStartT;
  const taskTicks = sim.taskTicks || P.TASK_TICKS;
  const dI=Math.max(0,sim.networkMI-(sim.I_at_task_start[sim.taskKey]||0));
  const SE=atpSp>0&&tW>0?dI/(tW*0.01+atpSp*0.001):0;
  const FS=counts.healthy/N;
  const nb=sim.nb;
  const nSE=nbPush(nb.se,SE),nCR=nbPush(nb.cr,sim.networkCR);
  const nATS=sim.ats!=null?nbPush(nb.ats,sim.ats):nSE;
  const C_chollet=Math.cbrt(nSE*nCR*nATS);
  const nCoh=nbPush(nb.coh,sim.networkCoh),nSself=nbPush(nb.sself,sim.networkSself),nAgency=nbPush(nb.agency,sim.networkAgency);
  const C_bach=Math.cbrt(Math.max(nCoh,0.01)*Math.max(nSself,0.01)*Math.max(nAgency,0.01));
  const J_score=Math.sqrt(C_chollet*C_bach);nbPush(nb.J,J_score);
  const nPhi=nbPush(nb.phi,sim.networkPhi),nSC=nbPush(nb.sc,sim.networkSC);
  const D_score=clamp(vS/N-0.4+sim.networkIC*0.3);
  const J_star=Math.pow(Math.max(nPhi,0.01)*Math.max(nCoh,0.01)*Math.max(sim.networkR,0.01)*Math.max(nSC,0.01)*Math.max(D_score,0.01),0.2);
  nbPush(nb.Jstar,J_star);
  sim.J_score=J_score;sim.J_star=J_star;sim.C_chollet=C_chollet;sim.C_bach=C_bach;
  const J_emb=J_star*(1+sim.networkCtrl*P.LAMBDA_B)*(1+sim.networkSbody*P.LAMBDA_B);
  nbPush(nb.jemb,J_emb);sim.J_emb=J_emb;

  // Revised gate and tiered score.
  sim.networkPU = clamp(sim.networkPU || (sim.networkMI*(0.5+sim.networkSC*0.5)*(0.5+sim.networkAS*0.5)));
  sim.networkARI = sim.ats ?? 0;
  sim.networkGIS = sim.networkSC;
  sim.networkSOS = sim.networkAS;
  sim.networkCGS = clamp(sim.networkMI * (0.5 + sim.networkSC));
  sim.networkCSR = clamp(sim.networkIC * (0.5 + sim.networkPU));
  sim.existenceGate = computeGate(sim);
  sim.failureReason = computeFailureReason(sim);
  if(sim.existenceGate){
    sim.gateStreak = (sim.gateStreak || 0) + 1;
  } else {
    sim.gateStreak = 0;
  }
  const structuralS = 0.4*sim.networkPhi + 0.3*sim.networkPU + 0.3*sim.networkSC;
  const functionalF = 0.5*Math.max(0, sim.networkCGS) + 0.5*Math.max(0, sim.networkCSR);
  const systemP = 0.4*Math.max(0, sim.networkARI) + 0.3*Math.max(0, sim.networkGIS) + 0.3*Math.max(0, sim.networkSOS);
  const collapsePenalty = sim.phaseRegion === "DISORDERED" ? 0.2 : 0;
  sim.gScore = sim.existenceGate ? 1/(1+Math.exp(-(0.5*structuralS + 0.3*functionalF + 0.2*systemP - collapsePenalty))) : 0;

  // Phase
  let phaseRegion=sim.existenceGate ? "INTEGRATED" : "NO-GO";
  if(sim.existenceGate && nPhi>0.5&&nSC<0.3)phaseRegion="ATTENTIVE";
  if(sim.existenceGate && J_score>0.4)phaseRegion="PREDICTIVE";
  if(sim.existenceGate && nPhi>0.5&&nSC>0.5)phaseRegion="CONSCIOUS";
  if(sim.existenceGate && J_star>0.3&&nPhi>0.4&&nSC>0.4)phaseRegion="CONSCIOUS";
  if(sim.existenceGate && J_emb>0.5&&sim.networkCtrl>0.5)phaseRegion="EMBODIED";
  sim.phaseRegion=phaseRegion;
  if(phaseRegion==="CONSCIOUS"&&sim.phaseTimeCOG<0)sim.phaseTimeCOG=sim.t;
  if(phaseRegion==="PREDICTIVE"&&sim.phaseTimePRED<0)sim.phaseTimePRED=sim.t;
  // Convergence
  if(!sim.converged&&sim.t>BURNIN){
    sim.Jstar_history=sim.Jstar_history||[];
    sim.Jstar_history.push(J_star);
    if(sim.Jstar_history.length>12)sim.Jstar_history.shift();
    if(sim.Jstar_history.length>=8){
      const arr=sim.Jstar_history,hi=Math.max(...arr),lo=Math.min(...arr);
      if(hi-lo<CONV_THRESH){sim.converged=true;sim.convergedAt=sim.t;}
    }
  }
  // Windowed
  const wa=arr=>arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0;
  sim.win_Jstar.push(J_star);sim.win_Phi.push(sim.networkPhi);sim.win_SC.push(sim.networkSC);sim.win_Coh.push(sim.networkCoh);sim.win_Ctrl.push(sim.networkCtrl);sim.win_IC=sim.win_IC||[];sim.win_IC.push(sim.networkIC);
  if(sim.win_Jstar.length>WIN_SAMPLES){sim.win_Jstar.shift();sim.win_Phi.shift();sim.win_SC.shift();sim.win_Coh.shift();sim.win_Ctrl.shift();}
  if(sim.win_IC.length>WIN_SAMPLES)sim.win_IC.shift();
  const avgV=vS/N;
  if(avgV>0.5&&sim.networkIC>0.1&&sim.ats&&sim.ats>1.5&&P.B>1)sim.h16Confirmed=true;
  if(counts.healthy===0&&sim.networkMI>0.05&&P.B>1)sim.h17Confirmed=true;
  return{
    ...counts,
    avgAtp:Math.round(atpS/N),avgH:Math.round(hS/N*100)/100,avgV,
    networkMI:sim.networkMI,networkSE:SE,networkCR:sim.networkCR,ats:sim.ats,C_chollet,
    networkCoh:sim.networkCoh,networkSself:sim.networkSself,networkAgency:sim.networkAgency,C_bach,J_score,
    networkPhi:sim.networkPhi,networkSC:sim.networkSC,networkAS:sim.networkAS,networkPU:sim.networkPU,
    networkCGS:sim.networkCGS,networkCSR:sim.networkCSR,networkARI:sim.networkARI,networkGIS:sim.networkGIS,networkSOS:sim.networkSOS,
    networkR:sim.networkR,networkControl:sim.networkControl,networkM:sim.networkM,
    networkDopamine:sim.dopamine,V_td:sim.V_td,J_star,J_emb,phaseRegion,
    // Revised gate metrics
    existenceGate:sim.existenceGate,gateStreak:sim.gateStreak,failureReason:sim.failureReason,gScore:sim.gScore,
    participationEntropy:sim.participationEntropy,globalField:sim.globalField,
    // New v12 metrics
    networkIC:sim.networkIC,networkPD:sim.networkPD,networkFSI:sim.networkFSI,
    networkSbody:sim.networkSbody,networkCtrl:sim.networkCtrl,
    body_energy:sim.body.energy,body_health:sim.body.health,eps_body:sim.body.eps_body,
    networkAtpVar:sim.networkAtpVar,networkEE:sim.networkEE,networkBPS:sim.networkBPS,FS,
    networkClustering:sim.networkClustering,
    avgDeff:P.B>1?deffS/N:0,branchB:P.B,networkDU:sim.networkDU,
    h16Confirmed:sim.h16Confirmed,h17Confirmed:sim.h17Confirmed,hPhiSeen:sim.hPhiSeen,
    taskKey:sim.taskKey,taskProgress:Math.min(1,tW/taskTicks),taskTicks,
    totalPruned:sim.totalPruned,totalGrown:sim.totalGrown,
    converged:sim.converged,convergedAt:sim.convergedAt,
    phaseTimeCOG:sim.phaseTimeCOG,phaseTimePRED:sim.phaseTimePRED,
    win_Jstar:wa(sim.win_Jstar),win_Phi:wa(sim.win_Phi),win_SC:wa(sim.win_SC),
    win_Coh:wa(sim.win_Coh),win_Ctrl:wa(sim.win_Ctrl),win_IC:wa(sim.win_IC||[]),
    exp_maxPhi:sim.exp_maxPhi,exp_phiPhase:sim.exp_phiPhase,
  };
}

// ── Logger ────────────────────────────────────────────────────────────────────


function makeEntry(t,expId,expName,s){
  return{t,expId,expName,phase:s.phaseRegion,
    existence_gate:s.existenceGate,failure_reason:s.failureReason,gScore:s.gScore,participationEntropy:s.participationEntropy,
    J_emb:s.J_emb,J_star:s.J_star,J_score:s.J_score,
    Phi:s.networkPhi,SC:s.networkSC,PU:s.networkPU,CGS:s.networkCGS,CSR:s.networkCSR,ARI:s.networkARI,GIS:s.networkGIS,SOS:s.networkSOS,R:s.networkR,Coh:s.networkCoh,
    Control:s.networkControl,AS:s.networkAS,
    IC:s.networkIC,PD:s.networkPD,FSI:s.networkFSI,
    S_body:s.networkSbody,C_ctrl:s.networkCtrl,
    MI:s.networkMI,ATS:s.ats??null,ATP:s.avgAtp,FS:s.FS,
    BPS:s.networkBPS,dopamine:s.networkDopamine,V_td:s.V_td,
    body_energy:s.body_energy,body_health:s.body_health,eps_body:s.eps_body,
    Sself:s.networkSself,Agency:s.networkAgency,
    healthy:s.healthy,atrophied:s.atrophied,
    converged:s.converged?1:0,phaseTimeCOG:s.phaseTimeCOG};
function toCSV(log){
  if(!log.length)return"";
  const hdr=LOG_COLS.join(",");
  const rows=log.map(r=>LOG_COLS.map(k=>{const v=r[k];return v==null?"":typeof v==="number"?v.toFixed(5):v;}).join(","));
  return[hdr,...rows].join("\n");
}

// Clipboard copy (works inside Claude artifacts -- no file system access needed)
async function copyToClipboard(text){
  try{await navigator.clipboard.writeText(text);return true;}
  catch(e){
    // Fallback: textarea select
    const ta=document.createElement("textarea");
    ta.value=text;ta.style.position="fixed";ta.style.opacity="0";
    document.body.appendChild(ta);ta.focus();ta.select();
    try{document.execCommand("copy");document.body.removeChild(ta);return true;}
    catch(e){document.body.removeChild(ta);return false;}
  }
}

// window.storage helpers (Claude artifact persistent KV store)
const STORE_KEY_RESULTS="nsf11:results";
const STORE_KEY_LOG="nsf11:log_recent";
const STORE_KEY_META="nsf11:meta";
async function storageSave(key,value){
  try{await window.storage.set(key,JSON.stringify(value));}catch(e){console.warn("storage save failed",e);}
}
async function storageLoad(key){
  try{const r=await window.storage.get(key);return r?JSON.parse(r.value):null;}catch(e){return null;}
}
async function storageDelete(key){
  try{await window.storage.delete(key);}catch(e){}
}

// ══════════════════════════════════════════════════════════════════════════════
// DRAW
// ══════════════════════════════════════════════════════════════════════════════

const SCLR={healthy:"#0b3d3a",stressed:"#3d2800",atrophied:"#1a0a20",alarming:"#dfffff",refractory:"#28104a",drifted:"#7a3d00"};
const SGLOW={alarming:"rgba(0,255,200,0.95)",refractory:"rgba(140,50,255,0.6)",stressed:"rgba(180,80,0,0.4)",atrophied:"rgba(80,20,100,0.5)",drifted:"rgba(255,144,0,0.6)"};
function lerp3(t,c0,c1,c2){const u=t<0.5?t*2:(t-0.5)*2;const av=t<0.5?c0:c1,bv=t<0.5?c1:c2;return[av[0]+u*(bv[0]-av[0]),av[1]+u*(bv[1]-av[1]),av[2]+u*(bv[2]-av[2])];}
const VIEWS=["STATE","CONSCIOUS","ATTENTION","ENERGY","MI","HEALTH"];
const VL={STATE:"STATE",CONSCIOUS:"C_i ATTRACTOR",ATTENTION:"A_i ATTENTION",ENERGY:"FREE ENERGY",MI:"I(X;Y)",HEALTH:"HEALTH"};

function draw(canvas,sim,vm){
  if(!canvas||!sim)return;
  const ctx=canvas.getContext("2d");const CW=canvas.width,CH=canvas.height;
  const pad=22,cell=(CW-pad*2)/G,r=Math.max(4,Math.floor(cell*0.27));
  const px=(gx,gy)=>[pad+gx*cell+cell/2,pad+gy*cell+cell/2];
  const ns=sim.ns;const B=P.B;
  ctx.fillStyle="#020c16";ctx.fillRect(0,0,CW,CH);
  ctx.strokeStyle="rgba(10,50,45,0.12)";ctx.lineWidth=0.4;
  for(let i=0;i<=G;i++){ctx.beginPath();ctx.moveTo(pad+i*cell,pad);ctx.lineTo(pad+i*cell,CH-pad);ctx.stroke();ctx.beginPath();ctx.moveTo(pad,pad+i*cell);ctx.lineTo(CW-pad,pad+i*cell);ctx.stroke();}
  let maxL=0.01;if(vm==="ENERGY")for(let i=0;i<N;i++)if(ns[i].L_rolling>maxL)maxL=ns[i].L_rolling;
  const BT=["rgba(0,255,180","rgba(255,180,0","rgba(180,80,255","rgba(80,200,255"];
  for(let i=0;i<N;i++){
    const n=ns[i];if(n.h<0.08)continue;const[x1,y1]=px(n.gx,n.gy);const firing=n.state==="alarming";
    for(let ci=0;ci<n.conns.length;ci++){
      const c=n.conns[ci];const[x2,y2]=px(ns[c.to].gx,ns[c.to].gy);
      const eff=firing?Math.min(0.65,c.w*0.6):Math.min(0.1,c.w*0.08);
      const hl=n.h>0.5&&ns[c.to].h>0.5;
      ctx.strokeStyle=(B>1&&firing)?`${BT[(c.branch??0)%BT.length]},${eff})`:firing?`rgba(0,255,180,${eff})`:hl?`rgba(10,90,80,${eff})`:`rgba(80,30,100,${eff*0.4})`;
      ctx.lineWidth=firing?Math.min(1.8,c.w*1.3):0.4;
      ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
    }
  }
  for(let i=0;i<N;i++){
    const n=ns[i];const[x,y]=px(n.gx,n.gy);ctx.shadowBlur=0;
    let bc,gc="transparent",gb=0;
    if(vm==="STATE"){const g=SGLOW[n.state];if(g){gc=g;gb=n.state==="alarming"?20:8;}bc=SCLR[n.state]||"#0b3d3a";}
    else if(vm==="CONSCIOUS"){
      const cv=n.C,norm=clamp((cv+1)/2);const[rr,gg,bb]=lerp3(norm,[100,10,160],[15,15,35],[0,220,180]);
      bc=`rgb(${Math.floor(rr)},${Math.floor(gg)},${Math.floor(bb)})`;
      const inTopK=P.USE_BOTTLENECK?Math.abs(n.C)>0.01:true;
      if(inTopK){gc=n.C>0.02?`rgba(0,220,180,0.5)`:`rgba(100,10,160,0.4)`;gb=Math.abs(n.C)*14;}
    }
    else if(vm==="ATTENTION"){const av=Math.min(1,n.A*N*2.5);const[rr,gg,bb]=lerp3(av,[5,5,40],[180,100,0],[255,220,30]);bc=`rgb(${Math.floor(rr)},${Math.floor(gg)},${Math.floor(bb)})`;if(av>0.3){gc=`rgba(255,200,0,${av*0.5})`;gb=av*14;}}
    else if(vm==="ENERGY"){const heat=Math.min(1,n.L_rolling/maxL);const[rr,gg,bb]=lerp3(heat,[0,30,120],[200,120,0],[255,30,0]);bc=`rgb(${Math.floor(rr)},${Math.floor(gg)},${Math.floor(bb)})`;gc=`rgba(${Math.floor(rr)},${Math.floor(gg)},0,${heat*0.65})`;gb=heat*14;}
    else if(vm==="MI"){const v=Math.min(1,n.mi*6);bc=`rgb(${Math.floor(v*210)},${Math.floor(v*160)},${Math.floor(v*20)})`;gc=v>0.2?`rgba(220,170,0,${v*0.6})`:"transparent";gb=v*13;}
    else{const[rr,gg,bb]=lerp3(1-n.h,[0,200,160],[220,110,0],[100,20,140]);bc=`rgb(${Math.floor(rr)},${Math.floor(gg)},${Math.floor(bb)})`;gc=n.h>0.7?`rgba(0,200,160,0.5)`:n.h>0.35?`rgba(220,110,0,0.4)`:`rgba(100,20,140,0.5)`;gb=(1-n.h)*15;}
    ctx.shadowColor=gc;ctx.shadowBlur=gb;
    const rE=r*(0.45+0.55*n.h);ctx.fillStyle=bc;ctx.beginPath();ctx.arc(x,y,rE,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    // ATP ring
    const f=Math.max(0,n.atp)/P.ATP_MAX;let ar,ag,ab;
    if(f>0.55){ar=0;ag=Math.floor(80+f*160);ab=Math.floor(ag*0.4);}else if(f>0.28){const u=(f-0.28)/0.27;ar=Math.floor(230-u*130);ag=Math.floor(70+u*90);ab=0;}else{ar=Math.floor(140+f*220);ag=Math.floor(f*55);ab=0;}
    ctx.strokeStyle=`rgba(${ar},${ag},${ab},0.75)`;ctx.lineWidth=f<0.25?2.2:1.3;
    ctx.beginPath();ctx.arc(x,y,rE+3,-Math.PI/2,-Math.PI/2+Math.PI*2*f);ctx.stroke();
    // Health ring
    const hc=`rgba(${Math.floor((1-n.h)*160)},${Math.floor(n.h*170)},${Math.floor(n.h*90)},0.5)`;
    ctx.strokeStyle=hc;ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,rE+7,-Math.PI/2,-Math.PI/2+Math.PI*2*n.h);ctx.stroke();
    // Desire/value ring (gold)
    if(n.v>0.5){const vr=Math.min(1,(n.v-0.4)*1.5);ctx.strokeStyle=`rgba(255,200,50,${vr*0.4})`;ctx.lineWidth=0.8;ctx.beginPath();ctx.arc(x,y,rE+(B>1?15:11),-Math.PI/2,-Math.PI/2+Math.PI*2*vr);ctx.stroke();}
    // IC indicator: teal dot if ic_wins/ic_total > 0.4
    if(n.ic_total>20&&n.ic_wins/n.ic_total>0.4){ctx.fillStyle=`rgba(0,255,200,0.5)`;ctx.beginPath();ctx.arc(x+rE*0.7,y-rE*0.7,1.5,0,Math.PI*2);ctx.fill();}
    // Dendritic ring (purple)
    if(B>1&&n.d_eff>0.1){const dR=Math.min(1,n.d_eff/B);ctx.strokeStyle=`rgba(180,80,255,${dR*0.55})`;ctx.lineWidth=1.1;ctx.beginPath();ctx.arc(x,y,rE+11,-Math.PI/2,-Math.PI/2+Math.PI*2*dR);ctx.stroke();}
    if(n.isInput){ctx.strokeStyle="rgba(0,255,180,0.18)";ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,rE+19,0,Math.PI*2);ctx.stroke();}
  }
  ctx.shadowBlur=0;
}

// ══════════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function Spark({data,color,h=15,w=168}){
  if(!data||data.length<2)return <div style={{height:h}}/>;
  const max=Math.max(...data,0.001);
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-(v/max)*(h-2)}`).join(" ");
  const uid=`s${color.replace(/[^a-z0-9]/gi,"")}${h}${w}`;
  return(
    <svg width={w} height={h} style={{display:"block",overflow:"visible"}}>
      <defs><linearGradient id={uid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.15"/><stop offset="100%" stopColor={color} stopOpacity="0.01"/></linearGradient></defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#${uid})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.3" opacity="0.85"/>
    </svg>
  );
}
function MR({label,value,color,sub,w=56}){
  return(
    <div style={{display:"flex",alignItems:"baseline",gap:4,marginBottom:2}}>
      <span style={{fontSize:6,color:"#1a3a30",width:w,flexShrink:0,letterSpacing:1}}>{label}</span>
      <span style={{fontSize:11,color:color||"#2a5a40",lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{value}</span>
      {sub&&<span style={{fontSize:5,color:"#1a3a30",marginLeft:2}}>{sub}</span>}
    </div>
  );
}
function Pnl({title,accent,children,tight}){
  return(
    <div style={{background:"#030f1a",border:`1px solid ${accent||"#0a2828"}`,borderRadius:3,padding:tight?6:8}}>
      {title&&<div style={{fontSize:7,color:accent||"#0f4a3a",letterSpacing:3,marginBottom:4}}>{title}</div>}
      {children}
    </div>
  );
}

const PCOL={DISORDERED:"#334455",PREDICTIVE:"#ff9900",ATTENTIVE:"#aa88ff",CONSCIOUS:"#00ffc4",OBSESSIVE:"#ff4488",EMBODIED:"#44ffcc"};
const TKCOL={COPY:"#00ffc4",REVERSE:"#ff9900",ROTATE:"#aa88ff",ALTERNATE:"#4499ff",NOVEL:"#ff4488"};
const PHCOL={P8:"#aa88ff",PE:"#ffb040",PX:"#ff4488",PH:"#4499ff"};

function verdict(res){
  const m=res.metrics,spec=res.spec;
  let met=false;
  if(typeof spec.check === "function"){
    try{ met = !!spec.check(m,res); }catch(e){ met = false; }
  } else if(spec.targetVal !== undefined && spec.metric){
    const val=m[spec.metric]!==undefined?m[spec.metric]:0;
    met = spec.targetDir===1 ? val>=spec.targetVal : val<=spec.targetVal;
  } else {
    met = false;
  }
  return{met,label:met?"CONFIRMED":"REJECTED",color:met?"#00ffc4":"#ff4488"};
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

export default function NSFv12AutoRunner(){
  const canvasRef=useRef(null);const simRef=useRef(null);const animRef=useRef(null);
  const runRef=useRef(false);const speedRef=useRef(8);const drawRef=useRef(null);const viewRef=useRef("STATE");
  const logRef=useRef([]);const autoRef=useRef(false);
  const expQRef=useRef([]);const curExpRef=useRef(null);const expResRef=useRef([]);
  // Dedicated per-experiment tick counter -- completely decoupled from sim.t
  // Fixes: (1) stale `t` variable post-transition, (2) speed-skip at boundary
  const expTickRef=useRef(0);

  const[isRunning,setIsRunning]=useState(false);
  const[tick,setTick]=useState(0);const[viewMode,setViewMode]=useState("STATE");
  const[autoRunning,setAutoRunning]=useState(false);const[autoDone,setAutoDone]=useState(false);
  const[expName,setExpName]=useState("");const[expProg,setExpProg]=useState(0);
  const[expResults,setExpResults]=useState([]);
  const[logCount,setLogCount]=useState(0);const[logRows,setLogRows]=useState([]);const[showLog,setShowLog]=useState(false);
  const showLogRef=useRef(false);
  const[showSliders,setShowSliders]=useState(false);
  const[sv,setSv]=useState({ETA_ATT:P.ETA_ATT,BETA_A:P.BETA_A,ALPHA_D:P.ALPHA_D,LAMBDA_AP:P.LAMBDA_AP,LAMBDA_B:P.LAMBDA_B,SELF_LP:P.SELF_LP});
  // Persistent storage / clipboard state
  const[clipMsg,setClipMsg]=useState("");        // "Copied!" flash
  const[vaultRuns,setVaultRuns]=useState([]);    // loaded from window.storage
  const[showVault,setShowVault]=useState(false);
  const[storageStatus,setStorageStatus]=useState("idle"); // idle | saving | saved | error
  const[stats,setStats]=useState({
    healthy:N,stressed:0,atrophied:0,alarming:0,refractory:0,drifted:0,
    avgAtp:55,avgH:1,avgV:0.5,networkMI:0,networkSE:0,networkCR:1,ats:null,
    C_chollet:0,networkCoh:0,networkSself:0,networkAgency:0,C_bach:0,J_score:0,
    networkPhi:0,networkSC:0,networkAS:0,networkR:0,networkControl:0,networkM:0,
    networkDopamine:0,V_td:0.5,J_star:0,J_emb:0,phaseRegion:"DISORDERED",
    networkIC:0,networkPD:0,networkFSI:0,networkSbody:0,networkCtrl:0,
    networkAtpVar:0,networkEE:0,networkBPS:0,FS:1,networkClustering:0,
    h16Confirmed:false,h17Confirmed:false,hPhiSeen:false,
    existenceGate:0,gateStreak:0,failureReason:"",gScore:0,participationEntropy:0,networkPU:0,
    networkCGS:0,networkCSR:0,networkARI:0,networkGIS:0,networkSOS:0,
    taskKey:"COPY",taskProgress:0,totalPruned:0,totalGrown:0,
    converged:false,convergedAt:-1,phaseTimeCOG:-1,
    win_Jstar:0,win_Phi:0,win_SC:0,win_IC:0,
    exp_maxPhi:0,exp_phiPhase:false,branchB:1,
    body_energy:0.7,body_health:0.8,eps_body:0,
  });
  const[hist,setHist]=useState({mi:[],J:[],phi:[],sc:[],R:[],Jstar:[],Jemb:[],ctrl:[],coh:[],ic:[],body:[]});

  drawRef.current=()=>draw(canvasRef.current,simRef.current,viewRef.current);
  showLogRef.current=showLog;

  function applyExp(spec){
    Object.assign(P,spec.params);
    setSv({ETA_ATT:P.ETA_ATT,BETA_A:P.BETA_A,ALPHA_D:P.ALPHA_D,LAMBDA_AP:P.LAMBDA_AP,LAMBDA_B:P.LAMBDA_B,SELF_LP:P.SELF_LP});
  }
  function primeSimForSpec(sim,spec){
    if(!sim || !spec) return;
    sim.currentSpec = spec;
    sim.taskSchedule = Array.isArray(spec.taskSchedule) && spec.taskSchedule.length ? spec.taskSchedule : TASK_ORDER;
    sim.taskTicks = spec.taskTicks || P.TASK_TICKS;
    sim.taskKey = spec.startTask || sim.taskSchedule[0] || "COPY";
    sim.task = TASKS[sim.taskKey] || TASKS.COPY;
    sim.taskStartT = sim.t;
    sim.seqI = 0;
    sim.I_at_task_start = {};
    sim.I_at_task_start[sim.taskKey] = sim.networkMI;
  }

  function loop(){
    if(!runRef.current)return;
    // Count each individual tick into the experiment counter -- not sim.t
    for(let i=0;i<speedRef.current;i++){
      simTick(simRef.current);
      if(autoRef.current)expTickRef.current++;
    }
    drawRef.current();
    // Always read sim.t fresh -- never reuse a stale local `t`
    const simT=simRef.current.t;
    const ce=curExpRef.current;

    if(autoRef.current&&ce){
      const lt=expTickRef.current;   // ← experiment-local tick, not sim.t
      const expTicks = ce.spec.ticks || EXP_TICKS;
      const expLogInterval = ce.spec.logInterval || LOG_INTERVAL;
      setExpProg(Math.min(1,lt/expTicks));setExpName(ce.spec.name);
      // Log every experiment-specific interval (threshold-based, not equality)
      if(lt>0&&Math.floor(lt/expLogInterval)>Math.floor((lt-speedRef.current)/expLogInterval)){
        const s=calcStats(simRef.current);
        logRef.current.push(makeEntry(simT,ce.spec.id,ce.spec.name,s));
        if(logRef.current.length>MAX_LOG)logRef.current.shift();
        if(logRef.current.length%10===0){setLogCount(logRef.current.length);if(showLogRef.current)setLogRows(logRef.current.slice(-10));}
      }
      if(lt>=(ce.spec.ticks || EXP_TICKS)){
        const s=calcStats(simRef.current);
        const result={spec:ce.spec,finalTick:simT,metrics:{
          J_emb:s.J_emb,J_star:s.J_star,J_score:s.J_score,networkPhi:s.networkPhi,networkSC:s.networkSC,
          networkR:s.networkR,networkCoh:s.networkCoh,networkControl:s.networkControl,networkMI:s.networkMI,
          avgAtp:s.avgAtp,FS:s.FS,phaseRegion:s.phaseRegion,
          networkIC:s.networkIC,networkPD:s.networkPD,networkFSI:s.networkFSI,
          networkSbody:s.networkSbody,networkCtrl:s.networkCtrl,
          body_energy:s.body_energy,body_health:s.body_health,
          converged:s.converged,convergedAt:s.convergedAt,phaseTimeCOG:s.phaseTimeCOG,
          win_Jstar:s.win_Jstar,win_Phi:s.win_Phi,win_IC:s.win_IC,exp_maxPhi:s.exp_maxPhi,
        }};
        expResRef.current=[...expResRef.current,result];setExpResults([...expResRef.current]);
        if(expQRef.current.length>0){
          const next=expQRef.current.shift();applyExp(next);simRef.current=createSim();
          primeSimForSpec(simRef.current,next);
          expTickRef.current=0;  // ← reset experiment clock for new run
          setHist({mi:[],J:[],phi:[],sc:[],R:[],Jstar:[],Jemb:[],ctrl:[],coh:[],ic:[],body:[]});
          curExpRef.current={spec:next};
          setTick(0);setExpProg(0);
        } else {
          autoRef.current=false;setAutoRunning(false);setAutoDone(true);
          runRef.current=false;setIsRunning(false);cancelAnimationFrame(animRef.current);
          // Auto-save completed battery to vault
          saveToVault(`Battery ${new Date().toLocaleTimeString()}`);
          return;
        }
      }
    } else if(!autoRef.current){
      // Manual mode: log by sim.t threshold (not equality -- same fix)
      const manualLogInterval = LOG_INTERVAL;
      if(simT>0&&Math.floor(simT/manualLogInterval)>Math.floor((simT-speedRef.current)/manualLogInterval)){
        const s=calcStats(simRef.current);
        logRef.current.push(makeEntry(simT,"manual","MANUAL",s));
        if(logRef.current.length>MAX_LOG)logRef.current.shift();
        if(Math.floor(simT/(LOG_INTERVAL*10))>Math.floor((simT-speedRef.current)/(LOG_INTERVAL*10))){
          setLogCount(logRef.current.length);if(showLogRef.current)setLogRows(logRef.current.slice(-10));
        }
      }
    }

    // Always use fresh sim.t -- never the stale local variable
    if(simT%6===0||simT<6){
      const s=calcStats(simRef.current);setTick(simRef.current.t);setStats(s);
      setHist(prev=>({
        mi:[...prev.mi.slice(-100),s.networkMI*100],
        J:[...prev.J.slice(-100),s.J_score*100],
        phi:[...prev.phi.slice(-100),s.networkPhi*100],
        sc:[...prev.sc.slice(-100),s.networkSC*100],
        R:[...prev.R.slice(-100),s.networkR*100],
        Jstar:[...prev.Jstar.slice(-100),s.J_star*100],
        Jemb:[...prev.Jemb.slice(-100),s.J_emb*100],
        ctrl:[...prev.ctrl.slice(-100),s.networkCtrl*100],
        coh:[...prev.coh.slice(-100),s.networkCoh*100],
        ic:[...prev.ic.slice(-100),s.networkIC*100],
        body:[...prev.body.slice(-100),s.body_energy*100],
      }));
    }
    animRef.current=requestAnimationFrame(loop);
  }

  useEffect(()=>{
    simRef.current=createSim();
    requestAnimationFrame(()=>drawRef.current());
    // Load persisted vault on mount
    storageLoad(STORE_KEY_RESULTS).then(saved=>{
      if(saved&&Array.isArray(saved))setVaultRuns(saved);
    });
    return()=>cancelAnimationFrame(animRef.current);
  },[]);

  const toggleRun=()=>{runRef.current=!runRef.current;setIsRunning(runRef.current);if(runRef.current)loop();else cancelAnimationFrame(animRef.current);};
  const reset=()=>{runRef.current=false;setIsRunning(false);cancelAnimationFrame(animRef.current);autoRef.current=false;setAutoRunning(false);curExpRef.current=null;expTickRef.current=0;simRef.current=createSim();primeSimForSpec(simRef.current,{taskSchedule:TASK_ORDER,taskTicks:P.TASK_TICKS,startTask:"COPY"});setTick(0);setHist({mi:[],J:[],phi:[],sc:[],R:[],Jstar:[],Jemb:[],ctrl:[],coh:[],ic:[],body:[]});requestAnimationFrame(()=>drawRef.current());};
  const cycleView=()=>{const nv=VIEWS[(VIEWS.indexOf(viewRef.current)+1)%VIEWS.length];viewRef.current=nv;setViewMode(nv);requestAnimationFrame(()=>drawRef.current());};
  const skipTask=()=>{if(simRef.current)advanceTask(simRef.current);};
  const upd=(k,v)=>{P[k]=v;setSv(prev=>({...prev,[k]:v}));};

  const startAll=()=>{
    runRef.current=false;cancelAnimationFrame(animRef.current);
    setAutoDone(false);logRef.current=[];expResRef.current=[];setExpResults([]);setLogCount(0);setLogRows([]);
    const q=[...EXPERIMENTS];
    expQRef.current=q.slice(1);
    applyExp(q[0]);
    simRef.current=createSim();
    primeSimForSpec(simRef.current,q[0]);
    expTickRef.current=0;   // ← always reset experiment clock at battery start
    setHist({mi:[],J:[],phi:[],sc:[],R:[],Jstar:[],Jemb:[],ctrl:[],coh:[],ic:[],body:[]});
    curExpRef.current={spec:q[0]};setExpName(q[0].name);setExpProg(0);setTick(0);
    autoRef.current=true;setAutoRunning(true);runRef.current=true;setIsRunning(true);loop();
  };
  const pauseResume=()=>{runRef.current=!runRef.current;setIsRunning(runRef.current);if(runRef.current)loop();else cancelAnimationFrame(animRef.current);};

  // ── Clipboard copy helpers ──────────────────────────────────────────────────
  const flashMsg=(msg)=>{setClipMsg(msg);setTimeout(()=>setClipMsg(""),2200);};

  const copyCSV=async()=>{
    const c=toCSV(logRef.current);
    if(!c){flashMsg("No data yet");return;}
    const ok=await copyToClipboard(c);
    flashMsg(ok?`✓ Copied ${logRef.current.length} rows CSV`:"✗ Copy failed -- try again");
  };

  const copyJSON=async()=>{
    const data={experiments:expResRef.current,config:{EXP_TICKS,LOG_INTERVAL,BURNIN,CONV_THRESH,ATTN_MODE:P.ATTN_MODE,TAU_ATT:P.TAU_ATT,GAMMA_GLOBAL:P.GAMMA_GLOBAL,BETA_ENTROPY:P.BETA_ENTROPY,DELTA_TEMPORAL:P.DELTA_TEMPORAL,NOISE_SIGMA:P.NOISE_SIGMA},total:logRef.current.length};
    const ok=await copyToClipboard(JSON.stringify(data,null,2));
    flashMsg(ok?`✓ Copied summary JSON (${expResRef.current.length} exp)`:"✗ Copy failed");
  };

  const copySummaryTable=async()=>{
    if(!expResRef.current.length){flashMsg("No results yet");return;}
    const header="ID\tNAME\tJ_emb\tJ_star\tPhi\tSC\tIC\tPD\tCtrl\tPhase\tVerdict";
    const rows=expResRef.current.map(r=>{
      const v=verdict(r);
      const m=r.metrics;
      return[r.spec.id,r.spec.name,m.J_emb.toFixed(3),m.J_star.toFixed(3),m.networkPhi.toFixed(3),m.networkSC.toFixed(3),(m.networkIC*100).toFixed(0)+"%",m.networkPD,m.networkCtrl.toFixed(2),m.phaseRegion,v.label].join("\t");
    });
    const ok=await copyToClipboard([header,...rows].join("\n"));
    flashMsg(ok?"✓ Copied summary table (paste into spreadsheet)":"✗ Copy failed");
  };

  const copyLogChunk=async(start,end)=>{
    const chunk=logRef.current.slice(start,end);
    const c=toCSV(chunk);
    const ok=await copyToClipboard(c);
    flashMsg(ok?`✓ Copied rows ${start}-${Math.min(end,logRef.current.length)}`:"✗ Copy failed");
  };

  // ── window.storage persistence ──────────────────────────────────────────────
  const saveToVault=async(label)=>{
    setStorageStatus("saving");
    const entry={
      id:Date.now(),label:label||`Run ${new Date().toLocaleTimeString()}`,
      ts:new Date().toISOString(),
      experiments:expResRef.current,
      config:{EXP_TICKS,LOG_INTERVAL,BURNIN,ATTN_MODE:P.ATTN_MODE,TAU_ATT:P.TAU_ATT,GAMMA_GLOBAL:P.GAMMA_GLOBAL,BETA_ENTROPY:P.BETA_ENTROPY,DELTA_TEMPORAL:P.DELTA_TEMPORAL,NOISE_SIGMA:P.NOISE_SIGMA},
      logCount:logRef.current.length,
      // Store last 200 log rows (storage limit)
      logTail:logRef.current.slice(-200),
    };
    const existing=await storageLoad(STORE_KEY_RESULTS)||[];
    const updated=[...existing,entry].slice(-10); // keep last 10 runs
    await storageSave(STORE_KEY_RESULTS,updated);
    setVaultRuns(updated);
    setStorageStatus("saved");
    setTimeout(()=>setStorageStatus("idle"),2000);
    flashMsg(`✓ Saved to vault as "${entry.label}"`);
  };

  const loadFromVault=(entry)=>{
    expResRef.current=entry.experiments||[];
    setExpResults([...expResRef.current]);
    if(entry.logTail){logRef.current=entry.logTail;setLogCount(entry.logCount||entry.logTail.length);setLogRows(entry.logTail.slice(-10));}
    setAutoDone(true);
    flashMsg(`✓ Loaded "${entry.label}" -- ${entry.experiments?.length||0} experiments`);
  };

  const deleteVaultEntry=async(id)=>{
    const updated=vaultRuns.filter(r=>r.id!==id);
    await storageSave(STORE_KEY_RESULTS,updated);
    setVaultRuns(updated);
  };

  const clearVault=async()=>{
    await storageDelete(STORE_KEY_RESULTS);setVaultRuns([]);
    flashMsg("Vault cleared");
  };

  const exportCSV=copyCSV;   // legacy aliases so old button refs still work
  const exportJSON=copyJSON;
  const exportFull=()=>copyLogChunk(0,logRef.current.length);

  const pc=PCOL[stats.phaseRegion]||"#334455";
  const jec=stats.J_emb>0.6?"#44ffcc":stats.J_emb>0.35?"#00ffc4":stats.J_emb>0.15?"#ffdd44":"#334455";
  const jsc=stats.J_star>0.5?"#ffdd44":stats.J_star>0.25?"#ff9900":stats.J_star>0.1?"#aa88ff":"#334455";
  const cohC=stats.networkCoh>0.5?"#00ffc4":stats.networkCoh>0.25?"#ff9900":"#334455";
  const miC=stats.networkMI>0.06?"#daa520":stats.networkMI>0.02?"#ff9900":"#2a5040";
  const tkC=TKCOL[stats.taskKey]||"#00ffc4";
  const currentExpTicks = curExpRef.current?.spec?.ticks || EXP_TICKS;
  const maxJemb=expResults.length?Math.max(...expResults.map(r=>r.metrics.J_emb),0.001):1;
  const sRows=[["HEALTHY",stats.healthy,"#0d7060"],["STRESSED",stats.stressed,"#cc6600"],["ATROPHIED",stats.atrophied,"#884488"],["ALARMING",stats.alarming,"#00ffc4"],["REFRACTORY",stats.refractory,"#8833ff"],["DRIFTED",stats.drifted,"#ff9900"]];
  // Pre-computed summary replaces inline IIFE (artifact transpiler doesn't support IIFE in JSX)
  const expSummaryBest   = expResults.length===NUM_EXP ? expResults.reduce((b,r)=>r.metrics.J_emb>b.metrics.J_emb?r:b,expResults[0]) : null;
  const expSummaryWorst  = expResults.length===NUM_EXP ? expResults.reduce((b,r)=>r.metrics.J_emb<b.metrics.J_emb?r:b,expResults[0]) : null;
  const expSummaryConf   = expResults.length===NUM_EXP ? expResults.filter(r=>verdict(r).met).length : 0;

  return(
    <div style={{background:"#020c16",minHeight:"100vh",color:"#4dffbb",fontFamily:"'Courier New',monospace",display:"flex",flexDirection:"column",padding:10,gap:7,boxSizing:"border-box",userSelect:"none"}}>

      {/* HEADER */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:4}}>
        <div>
          <div style={{fontSize:7,color:"#0f4a3a",letterSpacing:4,marginBottom:1}}>IDEATION LABS · AMISGC-AP-L-B-D-E-M-B v12.0 · NSF v12 revised</div>
          <div style={{fontSize:17,color:"#00ffc4",letterSpacing:3,lineHeight:1}}>NEURAL SURVIVAL FIELD</div>
          <div style={{fontSize:6,color:"#0f3028",marginTop:1}}>
{"Soft attractor · global coupling · existence gate · IC · PD · FSI · J_emb"}
          </div>
          <div style={{marginTop:3,display:"flex",gap:7,flexWrap:"wrap"}}>
            {[["H16",stats.h16Confirmed],["H17",stats.h17Confirmed],["H-meta",true],["H-Phi",stats.hPhiSeen]].map(([l,ok])=>(
              <span key={l} style={{fontSize:6,color:ok?"#00ffc4":"#1a3a2a",letterSpacing:1}}>{ok?"✓ ":""}{l}</span>
            ))}
            {stats.converged&&<span style={{fontSize:6,color:"#ffdd44",letterSpacing:1}}>⚑ CVG@{stats.convergedAt}</span>}
            {stats.phaseTimeCOG>0&&<span style={{fontSize:6,color:"#00ffc4",letterSpacing:1}}>t_COG={stats.phaseTimeCOG}</span>}
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:20,letterSpacing:2,lineHeight:1,fontVariantNumeric:"tabular-nums",color:"#00ffc4"}}>T+{String(tick).padStart(6,"0")}</div>
          <div style={{marginTop:2,padding:"2px 7px",background:`${pc}11`,border:`1px solid ${pc}44`,borderRadius:1,display:"inline-block"}}>
            <span style={{fontSize:8,color:pc,letterSpacing:2}}>{stats.phaseRegion}</span>
          </div>
          {autoRunning&&(
            <div style={{marginTop:2}}>
              <div style={{fontSize:6,color:"#ff9900",letterSpacing:1}}>AUTO: {expName}</div>
              <div style={{height:2,background:"#0a181f",borderRadius:1,marginTop:1,width:130,marginLeft:"auto"}}>
                <div style={{width:`${expProg*100}%`,height:"100%",background:"#ff9900",borderRadius:1}}/>
              </div>
              <div style={{fontSize:5,color:"#664400",marginTop:1}}>{expResults.length}/{NUM_EXP} · {Math.round(expProg*currentExpTicks/1000)}k/{currentExpTicks/1000}k t</div>
            </div>
          )}
          {autoDone&&<div style={{marginTop:2,fontSize:7,color:"#00ffc4",letterSpacing:2}}>ALL COMPLETE ✓</div>}
        </div>
      </div>

      {/* MAIN */}
      <div style={{display:"flex",gap:8,overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
        {/* CANVAS */}
        <div style={{flexShrink:0}}>
          <canvas ref={canvasRef} width={430} height={430} style={{border:"1px solid #0a2828",borderRadius:3,display:"block"}}/>
          <div style={{marginTop:2,fontSize:6,color:"#0f4a3a",textAlign:"center"}}>[{VL[viewMode]}] · teal dot=IC · gold ring=desire · purple=D_eff</div>
        </div>

        {/* PANELS */}
        <div style={{flex:1,display:"flex",flexDirection:"column",gap:5,minWidth:218,maxHeight:430,overflowY:"auto",paddingRight:2}}>

          {/* J_emb */}
          <Pnl title="J_emb -- EMBODIED EMERGENCE" accent="#0a2a1a" tight>
            <div style={{display:"flex",gap:8,marginBottom:3}}>
              <div>
                <div style={{fontSize:5,color:"#0a3a1a",marginBottom:1}}>{"J**·(1+C_ctrl)·(1+S_body)"}</div>
                <div style={{fontSize:28,color:jec,lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{stats.J_emb.toFixed(3)}</div>
                <div style={{fontSize:5,color:"#0a3a1a",marginTop:1}}>win: {stats.win_Jstar.toFixed(3)}</div>
              </div>
              <div style={{flex:1}}>
                <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:2}}>
                  {[["J**",stats.J_star,jsc],["Phi",stats.networkPhi,"#ff4488"],["SC",stats.networkSC,"#00ffc4"],["IC",stats.networkIC,"#44ffaa"],["PD",stats.networkPD,"#4499ff"]].map(([l,v,c])=>(
                    <div key={l}><div style={{fontSize:4,color:"#1a3a1a"}}>{l}</div><div style={{fontSize:9,color:c,fontVariantNumeric:"tabular-nums"}}>{typeof v==="number"&&v<10?v.toFixed(2):v}</div></div>
                  ))}
                </div>
                <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                  {[["R",stats.networkR,"#aa88ff"],["Ctrl",stats.networkCtrl,"#ffdd44"],["Sb",stats.networkSbody,"#44ffcc"],["FSI",stats.networkFSI,"#ff9900"]].map(([l,v,c])=>(
                    <div key={l}><div style={{fontSize:4,color:"#1a3a1a"}}>{l}</div><div style={{fontSize:9,color:c,fontVariantNumeric:"tabular-nums"}}>{v.toFixed(2)}</div></div>
                  ))}
                </div>
              </div>
            </div>
            <Spark data={hist.Jemb} color={jec} h={14} w={168}/>
            <div style={{marginTop:2}}><Spark data={hist.Jstar} color={jsc} h={10} w={168}/></div>
          </Pnl>

          {/* BODY STATE */}
          <Pnl title="BODY STATE (INTEROCEPTION)" accent="#2a1a0a" tight>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3,marginBottom:3}}>
              <MR label="energy_b" value={stats.body_energy.toFixed(3)} color={stats.body_energy>0.5?"#44aa66":stats.body_energy>0.25?"#ff9900":"#cc2244"} w={50}/>
              <MR label="health_b" value={stats.body_health.toFixed(3)} color={stats.body_health>0.6?"#00ffc4":stats.body_health>0.3?"#ff9900":"#cc2244"} w={50}/>
              <MR label="eps_body" value={stats.eps_body.toFixed(4)} color={stats.eps_body<0.05?"#00ffc4":"#ff4488"} w={50}/>
              <MR label="C_ctrl" value={stats.networkCtrl.toFixed(3)} color={stats.networkCtrl>0.5?"#ffdd44":"#667799"} w={50}/>
              <MR label="S_body" value={stats.networkSbody.toFixed(3)} color="#44ffcc" w={50}/>
              <MR label="V_td" value={stats.V_td.toFixed(3)} color="#ff9900" w={50} sub="TD value"/>
            </div>
            <Spark data={hist.body} color="#44aa66" h={11} w={168}/>
            <div style={{marginTop:1,fontSize:5,color:"#2a1a0a"}}>{"δ_t=R_t+γV_{t+1}−V_t · R=taskMI+λ_b·R_body · dopa drives plasticity only"}</div>
          </Pnl>

          {/* COGNITIVE FIELD */}
          <Pnl title="COGNITIVE FIELD v12" accent="#2a0a2a" tight>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3,marginBottom:3}}>
              <MR label="Phi" value={stats.networkPhi.toFixed(3)} color="#ff4488" w={50}/>
              <MR label="S_C" value={stats.networkSC.toFixed(3)} color="#00ffc4" w={50}/>
              <MR label="R (self)" value={stats.networkR.toFixed(3)} color="#aa88ff" w={50}/>
              <MR label="AS" value={stats.networkAS.toFixed(3)} color="#4499ff" w={50}/>
              <MR label="IC" value={`${(stats.networkIC*100).toFixed(0)}%`} color="#44ffaa" w={50} sub="plan>reflex"/>
              <MR label="PD" value={`${stats.networkPD} steps`} color="#4499ff" w={50}/>
              <MR label="FSI" value={stats.networkFSI.toFixed(3)} color="#ffb040" w={50}/>
              <MR label="dopa δ" value={stats.networkDopamine.toFixed(4)} color="#ff9900" w={50}/>
            </div>
            <div style={{marginBottom:2}}><Spark data={hist.phi} color="#ff4488" h={10} w={168}/></div>
            <div style={{marginBottom:2}}><Spark data={hist.sc} color="#00ffc4" h={9} w={168}/></div>
            <Spark data={hist.ic} color="#44ffaa" h={8} w={168}/>
            <div style={{marginTop:3,fontSize:5,color:"#2a1a2a",lineHeight:1.6}}>
{"Soft attractor: all neurons participate · legacy Top-K only in explicit ablation · E=||ε||²+λ_s||a-M||²-α_D·V̂-β_A·Ĥ"}
            </div>
          </Pnl>

          {/* EXPERIMENT BATTERY */}
          <Pnl title={`EXPERIMENTS -- FULL BATTERY ×  ${NUM_EXP} RUNS`} accent="#1a2a0a" tight>
            {EXPERIMENTS.map((exp)=>{
              const res=expResults.find(r=>r.spec.id===exp.id);
              const isCur=autoRunning&&expName===exp.name;
              const col=res?"#00ffc4":isCur?"#ff9900":"#1a3a1a";
              const v=res?verdict(res):null;
              const phC=PHCOL[exp.phase]||"#667799";
              return(
                <div key={exp.id} style={{marginBottom:4,padding:"2px 3px",background:isCur?"rgba(255,153,0,0.05)":"transparent",borderRadius:1,border:isCur?"1px solid #ff990022":"1px solid transparent"}}>
                  <div style={{display:"flex",gap:3,alignItems:"baseline"}}>
                    <span style={{fontSize:5,color:phC,width:8,flexShrink:0}}>{exp.phase.slice(1)}</span>
                    <span style={{fontSize:6,color:col,width:10,flexShrink:0}}>{res?"✓":isCur?"▶":"○"}</span>
                    <span style={{fontSize:5,color:col,width:20,flexShrink:0}}>{exp.id}</span>
                    <span style={{fontSize:5,color:col,flex:1}}>{exp.name}</span>
                    {v&&<span style={{fontSize:4,color:v.color,letterSpacing:0.5}}>{v.label}</span>}
                  </div>
                  {res&&(
                    <div style={{marginTop:2,marginLeft:38}}>
                      <div style={{display:"flex",alignItems:"center",gap:3}}>
                        <div style={{flex:1,height:3,background:"#0a181f",borderRadius:1}}>
                          <div style={{width:`${(res.metrics.J_emb/maxJemb)*100}%`,height:"100%",background:jec,borderRadius:1,opacity:0.75}}/>
                        </div>
                        <span style={{fontSize:5,color:jec,width:26,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{res.metrics.J_emb.toFixed(3)}</span>
                      </div>
                      <div style={{fontSize:4,color:"#0f4020",display:"flex",gap:4,marginTop:1,flexWrap:"wrap"}}>
                        <span>{"Phi="+res.metrics.networkPhi.toFixed(2)}</span>
                        <span>{"IC="+(res.metrics.networkIC*100).toFixed(0)+"%"}</span>
                        <span>{"PD="+res.metrics.networkPD}</span>
                        <span>{"Sb="+res.metrics.networkSbody.toFixed(2)}</span>
                        {res.metrics.converged&&<span style={{color:"#ffdd44"}}>{"cvg@"+res.metrics.convergedAt}</span>}
                        {res.metrics.phaseTimeCOG>0&&<span style={{color:"#00ffc4"}}>{"COG@"+res.metrics.phaseTimeCOG}</span>}
                        <span style={{color:PCOL[res.metrics.phaseRegion]||"#334455"}}>{res.metrics.phaseRegion.slice(0,5)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {expSummaryBest&&(
                <div style={{marginTop:4,padding:"4px 5px",background:"rgba(0,255,196,0.03)",border:"1px solid #00ffc422",borderRadius:1}}>
                  <div style={{fontSize:5,color:"#44ffcc"}}>BEST: {expSummaryBest.spec.id} {expSummaryBest.spec.name.slice(0,14)} -- J_emb={expSummaryBest.metrics.J_emb.toFixed(3)}</div>
                  <div style={{fontSize:5,color:"#664444",marginTop:1}}>WORST: {expSummaryWorst.spec.id} -- J_emb={expSummaryWorst.metrics.J_emb.toFixed(3)}</div>
                  <div style={{fontSize:5,color:"#aaaaff",marginTop:1}}>{expSummaryConf}/{NUM_EXP} hypotheses confirmed</div>
                </div>
              )}
          </Pnl>

          {/* LOG */}
          <Pnl title="METRIC LOG" accent="#0a1a2a" tight>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
              <span style={{fontSize:5,color:"#1a3a30"}}>{logCount} entries · Δt={LOG_INTERVAL}</span>
              <span onClick={()=>setShowLog(v=>!v)} style={{fontSize:5,color:"#4488ff",cursor:"pointer"}}>{showLog?"hide":"show"}</span>
            </div>
            {showLog&&logRows.length>0&&(
              <div>
                <div style={{display:"grid",gridTemplateColumns:"30px 20px 26px 22px 22px 22px 24px",gap:1,marginBottom:1,borderBottom:"1px solid #0a2828",paddingBottom:1}}>
                  {["t","ID","Jemb","Phi","SC","IC","PHASE"].map(h2=><div key={h2} style={{fontSize:4,color:"#0f4a3a"}}>{h2}</div>)}
                </div>
                {logRows.map((row,i)=>{
                  const jc2=row.J_emb>0.5?"#44ffcc":row.J_emb>0.25?"#ffdd44":"#667799";
                  return(
                    <div key={i} style={{display:"grid",gridTemplateColumns:"30px 20px 26px 22px 22px 22px 24px",gap:1,marginBottom:1}}>
                      <div style={{fontSize:4,color:"#2a4a30",fontVariantNumeric:"tabular-nums"}}>{row.t}</div>
                      <div style={{fontSize:4,color:"#4488ff"}}>{row.expId}</div>
                      <div style={{fontSize:5,color:jc2,fontVariantNumeric:"tabular-nums"}}>{row.J_emb!=null?row.J_emb.toFixed(3):"-"}</div>
                      <div style={{fontSize:4,color:"#ff4488",fontVariantNumeric:"tabular-nums"}}>{row.Phi!=null?row.Phi.toFixed(2):"-"}</div>
                      <div style={{fontSize:4,color:"#00ffc4",fontVariantNumeric:"tabular-nums"}}>{row.SC!=null?row.SC.toFixed(2):"-"}</div>
                      <div style={{fontSize:4,color:"#44ffaa",fontVariantNumeric:"tabular-nums"}}>{row.IC!=null?(row.IC*100).toFixed(0)+"%":"-"}</div>
                      <div style={{fontSize:4,color:PCOL[row.phase]||"#334455"}}>{row.phase?row.phase.slice(0,5):"-"}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </Pnl>

          {/* CHOLLET + BACH */}
          <Pnl title="CHOLLET / BACH AXES" accent="#0a2a1a" tight>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3,marginBottom:2}}>
              <MR label="I(X;Y)" value={`${(stats.networkMI*100).toFixed(1)}%`} color={miC} w={50}/>
              <MR label="SE x1k" value={(stats.networkSE*1000).toFixed(2)} color={stats.networkSE>0.002?"#00ffc4":"#2a5040"} w={50}/>
              <MR label="Coh" value={stats.networkCoh.toFixed(3)} color={cohC} w={50}/>
              <MR label="S_self" value={stats.networkSself.toFixed(3)} color="#aa88ff" w={50}/>
              {stats.ats!=null&&<MR label="ATS" value={`${stats.ats.toFixed(2)}x`} color="#ff4488" w={50}/>}
              <MR label="Agency" value={stats.networkAgency.toFixed(3)} color="#4488ff" w={50}/>
            </div>
            <Spark data={hist.mi} color={miC} h={9} w={168}/>
          </Pnl>

          {/* METABOLIC */}
          <Pnl title="METABOLIC" accent="#0a2a1a" tight>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3}}>
              <MR label="ATP" value={stats.avgAtp} color="#44aa66" w={50}/>
              <MR label="FS" value={`${(stats.FS*100).toFixed(0)}%`} color="#0d7060" w={50}/>
              <MR label="EE x1k" value={stats.networkEE.toFixed(3)} color="#00cc88" w={50}/>
              <MR label="BPS" value={stats.networkBPS.toFixed(3)} color="#44cc88" w={50}/>
            </div>
          </Pnl>

          {/* SLIDERS */}
          <Pnl title="FIELD PARAMS" accent="#0a2828" tight>
            <div onClick={()=>setShowSliders(v=>!v)} style={{fontSize:5,color:"#0f4a3a",cursor:"pointer",letterSpacing:2,marginBottom:showSliders?4:0}}>{showSliders?"▼":"▶"} SLIDERS</div>
            {showSliders&&(
              <div>
                {[{k:"ETA_ATT",l:"eta_att",mn:0.01,mx:0.2,st:0.005},{k:"BETA_A",l:"beta_A",mn:0.001,mx:5,st:0.1},{k:"ALPHA_D",l:"alpha_D",mn:0,mx:2,st:0.05},{k:"LAMBDA_AP",l:"lam_ap",mn:0.1,mx:4,st:0.1},{k:"LAMBDA_B",l:"lam_body",mn:0,mx:1.5,st:0.05},{k:"SELF_LP",l:"self_lp",mn:0,mx:0.1,st:0.005}].map(({k,l,mn,mx,st})=>(
                  <div key={k} style={{display:"flex",alignItems:"center",gap:5,marginBottom:3}}>
                    <span style={{fontSize:5,color:"#0f4a3a",width:40,flexShrink:0}}>{l}</span>
                    <input type="range" min={mn} max={mx} step={st} value={sv[k]??0} onChange={e=>upd(k,+e.target.value)} style={{flex:1,accentColor:"#ff9900",height:2}}/>
                    <span style={{fontSize:6,color:"#ff9900",width:32,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{(sv[k]??0).toFixed(3)}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{marginTop:2,fontSize:5,color:"#1a4030"}}>
              <span style={{color:"#ff4488"}}>aD={P.ALPHA_D} bA={P.BETA_A} lAP={P.LAMBDA_AP} </span>
              <span style={{color:"#ff9900"}}>lB={P.LAMBDA_B} LP={P.SELF_LP} eta={P.ETA_ATT}</span>
            </div>
          </Pnl>

          {/* DATA VAULT -- persistent storage + clipboard export */}
          <Pnl title="DATA VAULT" accent="#0a1a3a" tight>
            {/* Clipboard copy section */}
            <div style={{marginBottom:5}}>
              <div style={{fontSize:5,color:"#1a2a4a",letterSpacing:2,marginBottom:3}}>COPY TO CLIPBOARD</div>
              <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:3}}>
                {[
                  {label:"TABLE",action:copySummaryTable,color:"#00ffc4",tip:"Summary table -- paste into Notes/Sheets"},
                  {label:"CSV",action:copyCSV,color:"#4488ff",tip:"Full metric log as CSV"},
                  {label:"JSON",action:copyJSON,color:"#44aaff",tip:"Experiment summaries as JSON"},
                ].map(({label,action,color,tip})=>(
                  <div key={label} onClick={action} style={{cursor:"pointer",padding:"3px 7px",background:`${color}11`,border:`1px solid ${color}44`,borderRadius:2,fontSize:6,color,letterSpacing:1}}>{label}</div>
                ))}
              </div>
              {/* Chunked log copy for large datasets */}
              {logCount>0&&(
                <div style={{marginBottom:3}}>
                  <div style={{fontSize:5,color:"#1a2a4a",marginBottom:2}}>COPY LOG IN CHUNKS ({logCount} rows total)</div>
                  <div style={{display:"flex",gap:2,flexWrap:"wrap"}}>
                    {Array.from({length:Math.ceil(logCount/500)},(_,i)=>(
                      <div key={i} onClick={()=>copyLogChunk(i*500,(i+1)*500)} style={{cursor:"pointer",padding:"2px 5px",background:"rgba(68,136,255,0.1)",border:"1px solid #4488ff44",borderRadius:1,fontSize:5,color:"#4488ff"}}>
                        {i*500}-{Math.min((i+1)*500,logCount)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Clipboard status flash */}
              {clipMsg&&(
                <div style={{fontSize:6,color:clipMsg.startsWith("✓")?"#00ffc4":"#ff4488",letterSpacing:1,marginTop:2}}>{clipMsg}</div>
              )}
            </div>

            {/* Storage save/load section */}
            <div style={{borderTop:"1px solid #0a2040",paddingTop:5}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:3}}>
                <div style={{fontSize:5,color:"#1a2a4a",letterSpacing:2}}>SESSION VAULT ({vaultRuns.length}/10 runs)</div>
                <div style={{display:"flex",gap:3}}>
                  <div onClick={()=>saveToVault()} style={{cursor:"pointer",fontSize:5,color:"#ffb040",padding:"1px 4px",border:"1px solid #ffb04044",borderRadius:1}}>
                    {storageStatus==="saving"?"…SAVING":storageStatus==="saved"?"✓ SAVED":"SAVE NOW"}
                  </div>
                  {vaultRuns.length>0&&<div onClick={()=>setShowVault(v=>!v)} style={{cursor:"pointer",fontSize:5,color:"#4488ff",padding:"1px 4px",border:"1px solid #4488ff44",borderRadius:1}}>{showVault?"HIDE":"SHOW"}</div>}
                </div>
              </div>
              <div style={{fontSize:5,color:"#0a1a3a",marginBottom:3}}>{"Auto-saves when battery completes · survives page reload · up to 10 runs"}</div>
              {showVault&&vaultRuns.length>0&&(
                <div>
                  {vaultRuns.slice().reverse().map((entry,i)=>{
                    const best=entry.experiments?.length?entry.experiments.reduce((b,r)=>r.metrics.J_emb>b.metrics.J_emb?r:b,entry.experiments[0]):null;
                    const confirmed=entry.experiments?.filter(r=>verdict(r).met).length||0;
                    return(
                      <div key={entry.id} style={{marginBottom:4,padding:"3px 4px",background:"rgba(0,255,196,0.03)",border:"1px solid #0a2040",borderRadius:1}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                          <span style={{fontSize:5,color:"#00ffc4"}}>{entry.label}</span>
                          <div style={{display:"flex",gap:3}}>
                            <span onClick={()=>loadFromVault(entry)} style={{cursor:"pointer",fontSize:5,color:"#4488ff",padding:"1px 3px",border:"1px solid #4488ff44",borderRadius:1}}>LOAD</span>
                            <span onClick={async()=>{const ok=await copyToClipboard(JSON.stringify(entry.experiments,null,2));flashMsg(ok?"✓ Copied run JSON":"✗ Failed");}} style={{cursor:"pointer",fontSize:5,color:"#44aaff",padding:"1px 3px",border:"1px solid #44aaff44",borderRadius:1}}>COPY</span>
                            <span onClick={()=>deleteVaultEntry(entry.id)} style={{cursor:"pointer",fontSize:5,color:"#ff4488",padding:"1px 3px",border:"1px solid #ff448844",borderRadius:1}}>✕</span>
                          </div>
                        </div>
                        <div style={{fontSize:4,color:"#0a3040",marginTop:1,display:"flex",gap:5}}>
                          <span>{entry.experiments?.length||0} exps</span>
                          <span>{entry.logCount} log rows</span>
                          {best&&<span style={{color:"#ffdd44"}}>best: {best.spec.id} J={best.metrics.J_emb.toFixed(2)}</span>}
                          <span style={{color:"#00ffc4"}}>{confirmed}/{entry.experiments?.length} confirmed</span>
                        </div>
                        <div style={{fontSize:4,color:"#0a2030",marginTop:1}}>{new Date(entry.ts).toLocaleString()}</div>
                      </div>
                    );
                  })}
                  <div onClick={clearVault} style={{cursor:"pointer",fontSize:5,color:"#ff4488",letterSpacing:1,marginTop:2}}>CLEAR ALL VAULT</div>
                </div>
              )}
            </div>
          </Pnl>

          {/* POPULATION */}
          <Pnl title="POPULATION" accent="#0a2828" tight>
            {sRows.map(([label,count,color])=>(
              <div key={label} style={{display:"flex",alignItems:"center",gap:3,marginBottom:2}}>
                <div style={{width:3,height:3,borderRadius:"50%",background:color,flexShrink:0}}/>
                <div style={{fontSize:5,color:"#1a6050",width:58,flexShrink:0}}>{label}</div>
                <div style={{flex:1,height:2,background:"#0a181f",borderRadius:1}}><div style={{width:`${(count/N)*100}%`,height:"100%",background:color,opacity:0.85}}/></div>
                <div style={{fontSize:5,color,width:18,textAlign:"right"}}>{count||0}</div>
              </div>
            ))}
          </Pnl>

          {/* TASK */}
          <Pnl accent={`${tkC}33`} tight>
            <div style={{fontSize:6,color:"#0f4a3a",letterSpacing:3,marginBottom:2}}>TASK</div>
            <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:2}}>
              {TASK_ORDER.map(k=><div key={k} style={{fontSize:5,padding:"1px 4px",borderRadius:1,background:stats.taskKey===k?`${TKCOL[k]}22`:"transparent",border:`1px solid ${stats.taskKey===k?TKCOL[k]:"#0a2828"}`,color:stats.taskKey===k?TKCOL[k]:"#1a5040"}}>{k}</div>)}
            </div>
            <div style={{height:2,background:"#0a181f",borderRadius:1}}><div style={{width:`${stats.taskProgress*100}%`,height:"100%",background:tkC}}/></div>
            <div style={{fontSize:5,color:"#1a5040",marginTop:1}}>{Math.round(stats.taskProgress*(stats.taskTicks||P.TASK_TICKS))}/{stats.taskTicks||P.TASK_TICKS}t</div>
          </Pnl>

        </div>
      </div>

      {/* CONTROLS */}
      <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
        {autoRunning?(
          <button onClick={pauseResume} style={{background:"rgba(0,0,0,0.4)",border:`1px solid ${isRunning?"#00aa88":"#ff9900"}`,color:isRunning?"#00aa88":"#ff9900",padding:"5px 9px",borderRadius:2,cursor:"pointer",fontFamily:"'Courier New',monospace",fontSize:8,letterSpacing:2}}>{isRunning?"⏸ PAUSE":"▶ RESUME"}</button>
        ):(
          <button onClick={toggleRun} style={{background:"rgba(0,0,0,0.4)",border:`1px solid ${isRunning?"#00aa88":"#00ffc4"}`,color:isRunning?"#00aa88":"#00ffc4",padding:"5px 9px",borderRadius:2,cursor:"pointer",fontFamily:"'Courier New',monospace",fontSize:8,letterSpacing:2}}>{isRunning?"■ PAUSE":"▶ RUN"}</button>
        )}
        <button onClick={startAll} disabled={autoRunning} style={{background:"rgba(0,0,0,0.4)",border:`1px solid ${autoRunning?"#333":"#ff9900"}`,color:autoRunning?"#333":"#ff9900",padding:"5px 9px",borderRadius:2,cursor:autoRunning?"default":"pointer",fontFamily:"'Courier New',monospace",fontSize:8,letterSpacing:2}}>{"⚡ START ALL ("+NUM_EXP+" RUNS)"}</button>
        <button onClick={cycleView} style={{background:"rgba(0,0,0,0.4)",border:"1px solid #667799",color:"#667799",padding:"5px 9px",borderRadius:2,cursor:"pointer",fontFamily:"'Courier New',monospace",fontSize:8,letterSpacing:2}}>{"⊞ "+VL[viewMode].split(" ")[0]}</button>
        <button onClick={skipTask} style={{background:"rgba(0,0,0,0.4)",border:`1px solid ${tkC}`,color:tkC,padding:"5px 9px",borderRadius:2,cursor:"pointer",fontFamily:"'Courier New',monospace",fontSize:8,letterSpacing:2}}>{"→ TASK"}</button>
        <button onClick={reset} style={{background:"rgba(0,0,0,0.4)",border:"1px solid #664466",color:"#664466",padding:"5px 9px",borderRadius:2,cursor:"pointer",fontFamily:"'Courier New',monospace",fontSize:8,letterSpacing:2}}>{"◈ RESET"}</button>
        <button onClick={copyCSV} style={{background:"rgba(0,0,0,0.4)",border:"1px solid #4488ff",color:"#4488ff",padding:"3px 6px",borderRadius:2,cursor:"pointer",fontFamily:"'Courier New',monospace",fontSize:6,letterSpacing:1}}>{"⎘CSV"}</button>
        <button onClick={copyJSON} style={{background:"rgba(0,0,0,0.4)",border:"1px solid #44aaff",color:"#44aaff",padding:"3px 6px",borderRadius:2,cursor:"pointer",fontFamily:"'Courier New',monospace",fontSize:6,letterSpacing:1}}>{"⎘JSON"}</button>
        <button onClick={copySummaryTable} style={{background:"rgba(0,0,0,0.4)",border:"1px solid #00ffc4",color:"#00ffc4",padding:"3px 6px",borderRadius:2,cursor:"pointer",fontFamily:"'Courier New',monospace",fontSize:6,letterSpacing:1}}>{"⎘TABLE"}</button>
        <div style={{display:"flex",alignItems:"center",gap:4,marginLeft:3}}>
          <span style={{fontSize:6,color:"#0f4a3a",letterSpacing:2}}>SPD</span>
          <input type="range" min={1} max={28} defaultValue={8} onChange={e=>{speedRef.current=+e.target.value;}} style={{width:52,accentColor:"#00ffc4"}}/>
        </div>
        {logCount>0&&<span style={{fontSize:5,color:"#1a3a20",marginLeft:3}}>{logCount} entries</span>}
      </div>

      {/* LEGEND */}
      <div style={{display:"flex",gap:8,fontSize:5,color:"#0f4a3a",flexWrap:"wrap"}}>
        <span style={{color:"#44ffcc"}}>{"J_emb=J**·(1+C_ctrl)·(1+S_body) · phases: P8=consciousness P=embodiment PX=ablation"}</span>
        <span style={{color:"#ffb040"}}>{"Body: energy depletes 0.0002/t, random feeds · health tracks mean-h · pred from M"}</span>
        <span style={{color:"#4488ff"}}>{"⎘CSV/JSON/TABLE = copy to clipboard · paste into Notes/Sheets · vault auto-saves on battery complete · survives reload"}</span>
        <span style={{color:"#ff4488"}}>{"Soft attractor: all neurons participate via soft attention · legacy Top-K only as explicit ablation · existence gate blocks false positives"}</span>
      </div>

    </div>
  );
}
