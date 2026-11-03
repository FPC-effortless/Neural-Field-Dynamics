// Metadata-only handoff boundary. Never imports the simulator or V8 codec.
import {createHash} from 'node:crypto';
import {lstatSync, readFileSync} from 'node:fs';
import path from 'node:path';
export const SOURCE_COMMIT='f7cb469427faff336bdc5986006cd44ef291b837';
export const SOURCE_INPUTS=Object.freeze({
 'lib/amisgc-core/src/math.ts':'1f85bb3034feaf3150528e0287b6eca4d8ebf38a817968e2452aaa0d035bb4d0',
 'lib/amisgc-core/src/params.ts':'f9297e2bd9627a89ca70e17e6eddfb9a2dc2774a48bbdfb39dc5840b398624cc',
 'lib/amisgc-core/src/sim.ts':'0e3acf65ed1a460d90a378527b334475c806d10032ed05f42429f7a48874dafc',
 'lib/amisgc-core/src/tasks.ts':'dab66e05ba4dfc2a8b8ac9ebc4dfa9147c6432657b894e7abdc8a478c653bb0a',
 'scripts/native-checkpoint/checkpoint.mjs':'218cacf3a98920f63d781eb0e0943862cfc324660d8a43e74c1855fbb0ba2f5f',
 'scripts/native-checkpoint/prepare.mjs':'b9d406265746158757dbf9469d34b1e98c341ff0e0d049bc9ef9787d05361179',
 'scripts/native-checkpoint/source-binding.json':'77e5d7ea5ea58e713012789eaae6e13da90363ce6b8b7d99f55dfd9a599da456'
});
const PREPARED=['checkpoint.mjs','nfd/math.js','nfd/params.js','nfd/sim.js','nfd/tasks.js','package.json','source-binding.json'];
const MAX=24*1024*1024;
const SHA=/^[a-f0-9]{64}$/;
function requireThat(ok,message){if(!ok)throw new TypeError(message);}
export function digest(bytes){return createHash('sha256').update(bytes).digest('hex');}
function keys(value,expected){requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('\0')===[...expected].sort().join('\0'),'unexpected fields');}
function sha(s){requireThat(typeof s==='string'&&SHA.test(s),'invalid SHA256');return s;}
function relative(s){requireThat(typeof s==='string'&&s.length>0&&!s.includes('\\')&&!path.isAbsolute(s)&&s.split('/').every(x=>x&&x!=='.'&&x!=='..'),'invalid relative path');return s;}
function boundedFile(root,name,limit=MAX){
 relative(name);let current=path.resolve(root);
 requireThat(lstatSync(current).isDirectory()&&!lstatSync(current).isSymbolicLink(),'invalid root');
 const parts=name.split('/');
 for(let i=0;i<parts.length;i++){
  current=path.join(current,parts[i]);const stat=lstatSync(current);
  requireThat(!stat.isSymbolicLink()&&(i===parts.length-1?stat.isFile():stat.isDirectory()),'symlink/nonfile input');
 }
 requireThat(lstatSync(current).size<=limit,'input exceeds bound');
 const data=readFileSync(current);requireThat(data.length<=limit,'input exceeds bound');return data;
}
function strictJson(bytes){
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);const parsed=JSON.parse(text);
 // JSON.parse validates grammar first; this second lexical pass rejects duplicate keys.
 const stack=[];const tokens=text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)||[];
 for(const token of tokens){
  if(token==='{')stack.push({object:true,keys:new Set(),key:true});
  else if(token==='[')stack.push({object:false});
  else if(token==='}'||token===']')stack.pop();
  else if(token===','&&stack.at(-1)?.object)stack.at(-1).key=true;
  else if(token===':'&&stack.at(-1)?.object)stack.at(-1).key=false;
  else if(token.startsWith('"')&&stack.at(-1)?.object&&stack.at(-1).key){
   const key=JSON.parse(token);requireThat(!stack.at(-1).keys.has(key),'duplicate JSON key');stack.at(-1).keys.add(key);
  }
 }
 return parsed;
}
function same(a,b){return JSON.stringify(Object.entries(a).sort())===JSON.stringify(Object.entries(b).sort());}
function pinFile(root,entry,limit=MAX){keys(entry,['path','sha256']);const data=boundedFile(root,entry.path,limit);requireThat(digest(data)===sha(entry.sha256),'file digest drift');return data;}

/** Validate a frozen handoff, producing no command, process, admission or decode. */
export function planRestore({sourceRoot,artifactRoot,descriptor,expectedDescriptorSha256}){
 // The external descriptor pin is required; self-reported hashes are not authority.
 sha(expectedDescriptorSha256);
 const descriptorBytes=Buffer.from(JSON.stringify(descriptor));
 requireThat(descriptorBytes.length<=1024*1024,'descriptor exceeds bound');
 requireThat(digest(descriptorBytes)===expectedDescriptorSha256,'descriptor pin drift');
 descriptor=strictJson(descriptorBytes); // Validate the exact hashed snapshot, not caller getters/prototypes.
 keys(descriptor,['schema','job_id','source_commit','node_version','recipe','protocol','prepared','checkpoint','previous_attempt','resource','trust']);
 requireThat(descriptor.schema==='nfd.restore-plan.v1'&&descriptor.source_commit===SOURCE_COMMIT,'source/schema mismatch');
 requireThat(typeof descriptor.job_id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(descriptor.job_id),'invalid job identity');
 requireThat(descriptor.node_version===process.version,'Node runtime mismatch');
 requireThat(descriptor.trust==='TRUSTED_LOCAL_ONLY_NOT_AUTHENTICATED','unsupported checkpoint trust boundary');
 keys(descriptor.resource,['allocation_state']);
 requireThat(descriptor.resource.allocation_state==='NO_ALLOCATION_REQUESTED','allocation reuse or resource request requires separate admission');
 keys(descriptor.previous_attempt,['id','state','stop_receipt']);
 requireThat(typeof descriptor.previous_attempt.id==='string'&&descriptor.previous_attempt.id.length>0&&descriptor.previous_attempt.id.length<=120,'invalid prior attempt');
 requireThat(descriptor.previous_attempt.state==='STOP_REPORTED_NOT_INDEPENDENTLY_VERIFIED','unknown or possibly live prior attempt');
 // Stop receipt bytes are bound, but their truth/authorship is deliberately unverified.
 pinFile(artifactRoot,descriptor.previous_attempt.stop_receipt,1024*1024);
 for(const [name,hash] of Object.entries(SOURCE_INPUTS))requireThat(digest(boundedFile(sourceRoot,name))===hash,'native source drift');
 const recipe=pinFile(artifactRoot,descriptor.recipe,1024*1024);
 const protocol=pinFile(artifactRoot,descriptor.protocol,1024*1024);
 // Recipe/protocol are opaque pinned inputs: native TrainLab/Lab OS admission must validate them.
 keys(descriptor.prepared,['root','files']);relative(descriptor.prepared.root);keys(descriptor.prepared.files,PREPARED);
 const preparedBytes=new Map();
 for(const name of PREPARED){
  const bytes=boundedFile(artifactRoot,descriptor.prepared.root+'/'+name);
  requireThat(digest(bytes)===sha(descriptor.prepared.files[name]),'prepared source drift');preparedBytes.set(name,bytes);
 }
 requireThat(descriptor.prepared.files['checkpoint.mjs']===SOURCE_INPUTS['scripts/native-checkpoint/checkpoint.mjs'],'codec bytes drift');
 const binding=strictJson(preparedBytes.get('source-binding.json'));
 keys(binding,['schema','node','sources']);
 const ts=Object.fromEntries(Object.entries(SOURCE_INPUTS).filter(([name])=>name.endsWith('.ts')));
 requireThat(binding.schema==='nfd.source-binding.v1'&&binding.node===process.version&&same(binding.sources,ts),'prepared binding drift');
 const checkpointBytes=pinFile(artifactRoot,descriptor.checkpoint);
 const envelope=strictJson(checkpointBytes);
 keys(envelope,['schema','nodeVersion','sourceSha256','rngState','payload']);
 requireThat(envelope.schema==='nfd.native-checkpoint.v1'&&envelope.nodeVersion===process.version,'checkpoint runtime/schema mismatch');
 const expected=Object.fromEntries(['math','params','sim','tasks'].map(n=>[n+'.js',descriptor.prepared.files['nfd/'+n+'.js']]));
 expected['source-binding.json']=descriptor.prepared.files['source-binding.json'];
 requireThat(same(envelope.sourceSha256,expected),'checkpoint source mismatch');
 requireThat(Number.isInteger(envelope.rngState)&&envelope.rngState>=0&&envelope.rngState<=2**32-1,'invalid RNG header');
 requireThat(typeof envelope.payload==='string'&&envelope.payload.length<=Math.ceil(16*1024*1024/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(envelope.payload),'invalid opaque payload');
 return {schema:'nfd.restore-plan-result.v1',status:'PINNED_METADATA_ONLY',job_id:descriptor.job_id,source_commit:SOURCE_COMMIT,
  descriptor_sha256:expectedDescriptorSha256,recipe_sha256:digest(recipe),protocol_sha256:digest(protocol),checkpoint_sha256:digest(checkpointBytes),
  admitted:false,resume_allowed:false,checkpoint_deserialized:false,previous_attempt_stopped_proved:false,
  remaining_gates:['NATIVE_RECIPE_PROTOCOL_ADMISSION','SOURCE_RIGHTS','RESOURCE_RELEASE','STOP_RECEIPT_AUTHENTICATION','TRUSTED_CHECKPOINT_CUSTODY','PREPARED_TS_JS_CORRESPONDENCE','REVIEWED_RESTORE_RUNTIME'],
  scope:'No command/process/decode; raw checkpoint and source byte correspondence is not runtime or scientific verification'};
}
