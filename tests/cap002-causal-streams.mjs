// CAP002: actual NFD state plus an explicitly external trained linear readout.
// This is NOT end-to-end supervised training of the field, nor real-data utility.
// No model source changed. Future sequence values are never passed into the field.
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT=resolve('.');
const OUT=resolve(process.argv[2] || 'ci-artifacts/cap002');
mkdirSync(OUT,{recursive:true});
const SOURCE=join(ROOT,'lib/amisgc-core/src');
const COMPILED=mkdtempSync(join(tmpdir(),'nfd-cap002-'));
const SEEDS=[101,202,303], FIT=2048, EVAL=512, SHIFT=512, TOTAL=FIT+EVAL+SHIFT;
const TASKS=['next_markov','delayed_bit_8'];
const ARMS=['native_carry','reset_each_input'];
const sha=x=>createHash('sha256').update(x).digest('hex');
const json=x=>JSON.stringify(x,null,2)+'\n';
function rng(seed){let a=seed>>>0;return ()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
function bits(task,seed){
 const r=rng(seed+80000),x=new Array(TOTAL+1);x[0]=r()<.5?1:0;
 for(let t=1;t<x.length;t++){
  if(task==='next_markov'){const flip=t>=FIT+EVAL?.4:.2;x[t]=r()<flip?1-x[t-1]:x[t-1];}
  else x[t]=r()<(t>=FIT+EVAL?.75:.5)?1:0;
 }
 return x;
}
function newReadout(n){return {w:new Float64Array(n),updates:0};}
function probability(readout,f){let z=0;for(let i=0;i<f.length;i++)z+=readout.w[i]*f[i];z=Math.max(-30,Math.min(30,z));return 1/(1+Math.exp(-z));}
function update(readout,f,y,p){let norm=1;for(const v of f)norm+=v*v;const a=.2*(y-p)/norm;for(let i=0;i<f.length;i++)readout.w[i]+=a*f[i];readout.updates++;}
function feature(sim){
 const f=[1];
 // Deliberately exclude timestamps, phase labels, metrics, histories and task.seq.
 for(const n of sim.ns)for(const v of [n.a,n.v,n.C,n.M,n.b/4]){
  assert.ok(Number.isFinite(v),'nonfinite native state feature');f.push(Math.tanh(v));
 }
 return f;
}
function summarize(rows,key){
 let correct=0,logloss=0,n0=0,n1=0,c0=0,c1=0;
 for(const r of rows){const p=Math.max(1e-9,Math.min(1-1e-9,r[key]));const hit=Number((p>=.5?1:0)===r.y);correct+=hit;logloss-=r.y*Math.log(p)+(1-r.y)*Math.log(1-p);if(r.y){n1++;c1+=hit;}else{n0++;c0+=hit;}}
 return {n:rows.length,positives:n1,accuracy:correct/rows.length,balanced_accuracy:n0&&n1?(c0/n0+c1/n1)/2:null,log_loss:logloss/rows.length};
}

let report={study:'CAP002',kind:'SYNTHETIC_NATIVE_FIELD_WITH_EXTERNAL_LINEAR_READOUT',
 seeds:SEEDS,fit_ticks:FIT,eval_ticks:EVAL,shift_ticks:SHIFT,
 scope:'Native local plasticity executes; only external readout is supervised. No backbone SGD, no general intelligence or real-data claim.',
 prediction_contract:'Inject current bit only; emit all predictions before reading target; freeze readout and count-baseline fits after FIT. Native state may adapt to past/current inputs, never query labels.',
 shift:'Markov flip probability 0.2 to 0.4; delayed-memory input-one probability 0.5 to 0.75.',
 baseline_contract:'First-order count and global frequency frozen after FIT; persistence reads current input; delayed-bit history oracle explicitly has an eight-bit buffer and is not learned.',
 planned_runs:12,rows:[],node:process.version,gpu_minutes:0,
 source_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 source_sha256:sha(readFileSync(join(SOURCE,'sim.ts'))),
 full_state_resume:'NOT_RUN: native RNG is a closure; verify seeded replay instead of claiming full checkpoint continuation.'};
try{
 writeFileSync(join(COMPILED,'package.json'),'{"type":"module"}');
 for(const f of readdirSync(SOURCE).filter(f=>f.endsWith('.ts')))
  writeFileSync(join(COMPILED,f.replace(/\.ts$/,'.js')),stripTypeScriptTypes(readFileSync(join(SOURCE,f),'utf8'),{mode:'transform'}));
 const {createSim,simTick}=await import(pathToFileURL(join(COMPILED,'sim.js')));
 const {defaultParams}=await import(pathToFileURL(join(COMPILED,'params.js')));
 function make(seed){const p=defaultParams(81);p.TASK_TICKS=1000000000;return createSim(p,{seed});}
 function inject(s,bit){s.sim.task={...s.sim.task,seq:[bit]};s.sim.seqI=0;assert.equal(s.sim.task.seq.length,1);simTick(s.sim,s.ctx);}
 function run(task,arm,seed,preserve=true){
  const start=performance.now();const x=bits(task,seed);let s=make(seed);
  const ro=newReadout(406),raw=newReadout(2),counts=[[1,1],[1,1]],freq=[1,1];
  const trace=[],h=createHash('sha256');let trainLogLoss=0,trainN=0;
  for(let t=0;t<TOTAL;t++){
   if(arm==='reset_each_input')s=make(seed);
   inject(s,x[t]);
   const f=feature(s.sim);assert.equal(f.length,406);
   h.update(JSON.stringify(f));const rf=[1,x[t]];
   // Prediction happens before external target lookup.
   const p=probability(ro,f),praw=probability(raw,rf),pc=counts[x[t]][1]/(counts[x[t]][0]+counts[x[t]][1]);
   const pf=freq[1]/(freq[0]+freq[1]);const persistence=x[t];
   if(task==='delayed_bit_8' && t<8)continue;
   const y=task==='next_markov'?x[t+1]:x[t-8];
   if(t<FIT){
    trainLogLoss-=y*Math.log(Math.max(p,1e-9))+(1-y)*Math.log(Math.max(1-p,1e-9));trainN++;
    update(ro,f,y,p);update(raw,rf,y,praw);counts[x[t]][y]++;freq[y]++;
   }else{
    trace.push({t,split:t<FIT+EVAL?'eval':'shift',y,p,praw,pc,pf,persistence,
     // The oracle's extra explicit history is disclosed, not attributed to the field.
     oracle:task==='delayed_bit_8'?x[t-8]:x[t]});
   }
  }
  const result={task,arm,seed,status:'MEASURED',readout_parameters:ro.w.length,readout_updates:ro.updates,
   native_ticks:TOTAL,neuron_count:s.sim.ns.length,final_connections:s.sim.ns.reduce((a,n)=>a+n.conns.length,0),
   final_atrophied:s.sim.ns.filter(n=>n.state==='atrophied').length,
   mean_fit_prequential_log_loss:trainLogLoss/trainN,feature_sequence_sha256:h.digest('hex'),
   input_sha256:sha(JSON.stringify(x)),seconds:(performance.now()-start)/1000,metrics:{}};
  for(const split of ['eval','shift']){
   const rs=trace.filter(r=>r.split===split);result.metrics[split]={};
   for(const [name,key] of [['field_readout','p'],['current_input_readout','praw'],['first_order_counts','pc'],['frequency','pf'],['persistence','persistence'],['history_oracle','oracle']])result.metrics[split][name]=summarize(rs,key);
  }
  if(preserve){
   writeFileSync(join(OUT,`${task}_${arm}_${seed}_trace.json`),json(trace));
   writeFileSync(join(OUT,`${task}_${arm}_${seed}_readout.json`),json({weights:Array.from(ro.w),raw_weights:Array.from(raw.w),counts,freq,updates:ro.updates}));
   writeFileSync(join(OUT,`${task}_${arm}_${seed}_result.json`),json(result));
   console.log(JSON.stringify(result));
  }
  return result;
 }
 // Equal prefix, different unavailable suffix: only observed singleton inputs enter field.
 const a=make(101),b=make(101);const prefix=bits('next_markov',101).slice(0,64);
 for(const bit of prefix){inject(a,bit);inject(b,bit);assert.deepEqual(feature(a.sim),feature(b.sim));}
 report.integrity={current_input_only:true,prefix_features_equal:true,readout_frozen_in_eval:true,
  chronological_fit_eval_disjoint_target_indices:true,metric_reads_excluded_from_prediction:true};
 for(const task of TASKS)for(const seed of SEEDS)for(const arm of ARMS){
  try{report.rows.push(run(task,arm,seed));}catch(e){report.rows.push({task,arm,seed,status:'ERROR',error:String(e),stack:e.stack});}
  writeFileSync(join(OUT,'RESULTS.json'),json(report));
 }
 const original=report.rows.find(r=>r.task==='next_markov'&&r.arm==='native_carry'&&r.seed===101);
 if(original?.status==='MEASURED'){
  const replay=run('next_markov','native_carry',101,false);
  report.seeded_replay={feature_sequence_equal:original.feature_sequence_sha256===replay.feature_sequence_sha256,metrics_equal:JSON.stringify(original.metrics)===JSON.stringify(replay.metrics)};
 }
 report.measured_runs=report.rows.filter(r=>r.status==='MEASURED').length;
 report.error_runs=report.rows.filter(r=>r.status==='ERROR').length;
 writeFileSync(join(OUT,'RESULTS.json'),json(report));console.log(JSON.stringify({summary:report}));
 if(report.error_runs || !report.seeded_replay?.feature_sequence_equal || !report.seeded_replay?.metrics_equal)process.exitCode=1;
}finally{rmSync(COMPILED,{recursive:true,force:true});}
