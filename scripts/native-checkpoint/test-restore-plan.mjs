import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {digest,planRestore,SOURCE_COMMIT,SOURCE_INPUTS} from './restore-plan.mjs';
const source=path.resolve(process.env.NFD_SOURCE_ROOT||fileURLToPath(new URL('../../',import.meta.url)));
// prepare strips real TS source, but never imports/executes the simulator or codec.
const {prepare}=await import(pathToFileURL(path.join(source,'scripts/native-checkpoint/prepare.mjs')));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nfd-restore-plan-'));
const checks=[];
try{
 const native=path.join(root,'source');fs.mkdirSync(native);
 for(const name of Object.keys(SOURCE_INPUTS)){fs.mkdirSync(path.dirname(path.join(native,name)),{recursive:true});fs.copyFileSync(path.join(source,name),path.join(native,name));}
 const artifacts=path.join(root,'artifacts');fs.mkdirSync(artifacts);
 prepare(path.join(artifacts,'prepared'));
 const files=Object.fromEntries(['checkpoint.mjs','nfd/math.js','nfd/params.js','nfd/sim.js','nfd/tasks.js','package.json','source-binding.json'].map(n=>[n,digest(fs.readFileSync(path.join(artifacts,'prepared',n)))]));
 const sourceSha256=Object.fromEntries(['math','params','sim','tasks'].map(n=>[n+'.js',files['nfd/'+n+'.js']]));sourceSha256['source-binding.json']=files['source-binding.json'];
 // Intentionally not a V8 state. A pass is only metadata planning, never a decode.
 const cp={schema:'nfd.native-checkpoint.v1',nodeVersion:process.version,sourceSha256,rngState:0,payload:Buffer.from('OPAQUE_NOT_A_V8_CHECKPOINT').toString('base64')};
 const put=(n,x)=>fs.writeFileSync(path.join(artifacts,n),JSON.stringify(x,null,2)+'\n');
 put('checkpoint.json',cp);
 put('recipe.json',{schema:'trainlab.experiment.v2',name:'CONSTRUCTED_METADATA_UNIT_FIXTURE_ONLY',command:['node','NOT_ADMITTED_OR_EXECUTED.mjs'],workload:{kind:'test',training_method:null,execution:'single_process'}});
 put('protocol.json',{schema:'CONSTRUCTED_METADATA_UNIT_FIXTURE_NOT_LAB_ADMISSION'});
 put('stop.json',{state:'stopped',scope:'CONSTRUCTED_METADATA_NO_REAL_PROCESS'});
 const pinned=n=>({path:n,sha256:digest(fs.readFileSync(path.join(artifacts,n)))});
 const original={schema:'nfd.restore-plan.v1',job_id:'METADATA_UNIT_FIXTURE',source_commit:SOURCE_COMMIT,node_version:process.version,
  recipe:pinned('recipe.json'),protocol:pinned('protocol.json'),prepared:{root:'prepared',files},checkpoint:pinned('checkpoint.json'),
  previous_attempt:{id:'CONSTRUCTED_NOT_A_REAL_JOB',state:'STOP_REPORTED_NOT_INDEPENDENTLY_VERIFIED',stop_receipt:pinned('stop.json')},
  resource:{allocation_state:'NO_ALLOCATION_REQUESTED'},trust:'TRUSTED_LOCAL_ONLY_NOT_AUTHENTICATED'};
 const pin=d=>digest(Buffer.from(JSON.stringify(d)));
 const run=d=>planRestore({sourceRoot:native,artifactRoot:artifacts,descriptor:d,expectedDescriptorSha256:pin(d)});
 const result=run(original);
 assert.equal(result.admitted,false);assert.equal(result.resume_allowed,false);assert.equal(result.checkpoint_deserialized,false);assert.equal(result.previous_attempt_stopped_proved,false);
 assert.deepEqual(run(original),result);checks.push('deterministic_metadata_only_positive_invalid_v8_not_decoded');
 function reject(name,change){const d=structuredClone(original);let cleanup=()=>{};try{cleanup=change(d)||cleanup;assert.throws(()=>run(d));checks.push(name);}finally{cleanup();}}
 reject('unknown_live_attempt',d=>{d.previous_attempt.state='UNKNOWN';});
 reject('running_attempt',d=>{d.previous_attempt.state='RUNNING';});
 reject('closed_allocation_reuse',d=>{d.resource.allocation_state='CLOSED_ALLOCATION_REUSE';});
 reject('untrusted_remote_checkpoint',d=>{d.trust='DOWNLOADED_UNTRUSTED';});
 reject('runtime_mismatch',d=>{d.node_version='v0.0.0';});
 reject('source_commit_mismatch',d=>{d.source_commit='0'.repeat(40);});
 reject('recipe_byte_drift',()=>{const p=path.join(artifacts,'recipe.json'),b=fs.readFileSync(p);fs.appendFileSync(p,' ');return()=>fs.writeFileSync(p,b);});
 reject('protocol_byte_drift',()=>{const p=path.join(artifacts,'protocol.json'),b=fs.readFileSync(p);fs.appendFileSync(p,' ');return()=>fs.writeFileSync(p,b);});
 reject('missing_stop_receipt',d=>{d.previous_attempt.stop_receipt.path='missing.json';});
 reject('checkpoint_byte_drift',()=>{const p=path.join(artifacts,'checkpoint.json'),b=fs.readFileSync(p);fs.appendFileSync(p,' ');return()=>fs.writeFileSync(p,b);});
 reject('traversal',d=>{d.checkpoint.path='../checkpoint.json';});
 reject('absolute_path',d=>{d.checkpoint.path='/tmp/checkpoint.json';});
 reject('unknown_authority_field',d=>{d.admitted=true;});
 reject('prepared_codec_drift_even_repinned',d=>{d.prepared.files['checkpoint.mjs']='0'.repeat(64);});
 reject('native_source_drift',()=>{const p=path.join(native,'lib/amisgc-core/src/sim.ts'),b=fs.readFileSync(p);fs.appendFileSync(p,'\n');return()=>fs.writeFileSync(p,b);});
 reject('symlink_checkpoint',d=>{fs.symlinkSync(path.join(artifacts,'checkpoint.json'),path.join(artifacts,'alias.json'));d.checkpoint=pinned('alias.json');return()=>fs.unlinkSync(path.join(artifacts,'alias.json'));});
 reject('checkpoint_source_header_drift',d=>{const p=path.join(artifacts,'checkpoint.json'),b=fs.readFileSync(p);put('checkpoint.json',{...cp,sourceSha256:{...cp.sourceSha256,'sim.js':'0'.repeat(64)}});d.checkpoint=pinned('checkpoint.json');return()=>fs.writeFileSync(p,b);});
 reject('duplicate_checkpoint_json_key',d=>{const p=path.join(artifacts,'checkpoint.json'),b=fs.readFileSync(p);fs.writeFileSync(p,b.toString().replace('{','{"schema":"nfd.native-checkpoint.v1",'));d.checkpoint=pinned('checkpoint.json');return()=>fs.writeFileSync(p,b);});
 assert.throws(()=>planRestore({sourceRoot:native,artifactRoot:artifacts,descriptor:original,expectedDescriptorSha256:'0'.repeat(64)}));checks.push('external_descriptor_pin_required');
 console.log(JSON.stringify({schema:'nfd.restore-plan-tests.v1',status:'PASS_METADATA_PLANNER_ONLY',source_commit:SOURCE_COMMIT,checks,model_imports:0,codec_imports:0,deserializations:0,simulation:false,fits:0,worker_started:false,fixture:'Opaque invalid V8 payload and constructed recipe/stop metadata; not a real checkpoint or experiment receipt'}));
}finally{fs.rmSync(root,{recursive:true,force:true});}
