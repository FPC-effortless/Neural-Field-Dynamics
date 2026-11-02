import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
import {deserialize,serialize} from 'node:v8';
import {stripTypeScriptTypes} from 'node:module';
import {prepare} from './prepare.mjs';
const self=fileURLToPath(import.meta.url);
const dir=process.argv[2]==='--child'?process.argv[3]:fs.mkdtempSync(path.join(os.tmpdir(),'nfd-checkpoint-'));
if(process.argv[2]!=='--child')prepare(dir);
const {createSim,simTick,calcStats}=await import(pathToFileURL(path.join(dir,'nfd/sim.js')));
const {defaultParams}=await import(pathToFileURL(path.join(dir,'nfd/params.js')));
const {captureNative,restoreNative}=await import(pathToFileURL(path.join(dir,'checkpoint.mjs')));
function init(seed){const p=defaultParams(81);p.TASK_TICKS=7;return createSim(p,{seed});}
function tick(x){simTick(x.sim,x.ctx);calcStats(x.sim,x.ctx);}
if(process.argv[2]==='--child'){
 const x=restoreNative(JSON.parse(fs.readFileSync(path.join(dir,'cp.json'),'utf8')));
 for(let i=0;i<45;i++)tick(x);
 fs.writeFileSync(path.join(dir,'child.json'),JSON.stringify(captureNative(x)));process.exit(0);
}
const baseRef=process.argv[2];let baseline;
if(baseRef){
 const base=path.join(dir,'base');fs.mkdirSync(base);fs.writeFileSync(path.join(base,'package.json'),'{"type":"module"}');
 const repo=fileURLToPath(new URL('../../',import.meta.url));
 for(const n of ['math','params','sim','tasks'])fs.writeFileSync(path.join(base,n+'.js'),stripTypeScriptTypes(execFileSync('git',['show',`${baseRef}:lib/amisgc-core/src/${n}.ts`],{cwd:repo,encoding:'utf8'}),{mode:'strip'}));
 baseline=await import(pathToFileURL(path.join(base,'sim.js')));
}
const rows=[];
for(const seed of [20111,20122,20133]){
 const a=init(seed),original=baseline?.createSim(structuredClone(a.ctx.P),{seed});
 for(let i=0;i<20;i++){tick(a);if(original){baseline.simTick(original.sim,original.ctx);baseline.calcStats(original.sim,original.ctx);assert.deepEqual(a.sim,original.sim);}}
 const cp=captureNative(a),b=restoreNative(JSON.parse(JSON.stringify(cp)));
 const negative=init(seed);negative.sim=structuredClone(a.sim);let diverged=false;
 fs.writeFileSync(path.join(dir,'cp.json'),JSON.stringify(cp));
 for(let i=0;i<45;i++){
  tick(a);tick(b);tick(negative);assert.deepEqual(a.sim,b.sim);assert.equal(a.ctx.rng.getState(),b.ctx.rng.getState());
  if(JSON.stringify(a.sim)!==JSON.stringify(negative.sim))diverged=true;
  if(original){baseline.simTick(original.sim,original.ctx);baseline.calcStats(original.sim,original.ctx);assert.deepEqual(a.sim,original.sim);}
 }
 assert(diverged);assert(a.sim.taskHistory.length>=5);
 const child=spawnSync(process.execPath,[self,'--child',dir],{encoding:'utf8',timeout:30000});assert.equal(child.status,0,child.stderr);
 const received=JSON.parse(fs.readFileSync(path.join(dir,'child.json'),'utf8')),expected=captureNative(a);
 assert.deepEqual({...received,payload:null},{...expected,payload:null});assert.deepEqual(deserialize(Buffer.from(received.payload,'base64')),deserialize(Buffer.from(expected.payload,'base64')));
 rows.push({seed,forward_ticks:65,immutable_base_parity:!!baseline,resume_ticks:45,native_task_switches:a.sim.taskHistory.length,child_process_exact:true,sim_only_negative_diverged:diverged});
}
const cp=captureNative(init(20111));let rejected=0;
const malformed=[null,{}, {...cp,rngState:-1},{...cp,rngState:2**32},{...cp,rngState:NaN},{...cp,nodeVersion:'wrong'},{...cp,schema:'wrong'},{...cp,sourceSha256:{}},{...cp,payload:'invalid'},{...cp,extra:true},{...cp,payload:serialize({sim:{},ctx:{}}).toString('base64')}];
for(const bad of malformed){assert.throws(()=>restoreNative(bad));rejected++;}
const mutated=captureNative(init(20111));mutated.sourceSha256['math.js']='0'.repeat(64);assert.throws(()=>restoreNative(mutated));rejected++;
// Caller mutation must not mutate the module's acceptance map.
assert.doesNotThrow(()=>restoreNative(cp));
// A fresh process must reject a checkpoint after actual emitted source changes.
fs.writeFileSync(path.join(dir,'cp.json'),JSON.stringify(cp));
const mathPath=path.join(dir,'nfd/math.js'),mathSource=fs.readFileSync(mathPath,'utf8');
fs.writeFileSync(mathPath,mathSource+'\n// source mutation negative control\n');
const mutationCode=`import assert from 'node:assert/strict';import fs from 'node:fs';import {restoreNative} from ${JSON.stringify(pathToFileURL(path.join(dir,'checkpoint.mjs')).href)};assert.throws(()=>restoreNative(JSON.parse(fs.readFileSync(${JSON.stringify(path.join(dir,'cp.json'))},'utf8'))),/mismatch/);`;
const mutation=spawnSync(process.execPath,['--input-type=module','-e',mutationCode],{encoding:'utf8',timeout:30000});
assert.equal(mutation.status,0,mutation.stderr);fs.writeFileSync(mathPath,mathSource);
const pristine=init(20111),zero=restoreNative(JSON.parse(JSON.stringify(captureNative(pristine))));assert.deepEqual(pristine.sim,zero.sim);
const result={schema:'nfd.native-checkpoint-test.v1',node:process.version,baseline_ref:baseRef??null,rows,rejected_invalid_envelopes:rejected,actual_source_mutation_child_rejected:true,zero_tick_nonfinite_preserved:true,model_fits:0,optimizer_steps:0,scope:'trusted-local engineering verification; not model capability or training'};
console.log(JSON.stringify(result,null,2));fs.rmSync(dir,{recursive:true,force:true});
