// Trusted local checkpoint codec for an exact prepared 81-node native NFD source.
// It is not a portable/untrusted checkpoint loader or a learned model interface.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {serialize,deserialize} from 'node:v8';
import {mulberry32} from './nfd/math.js';
const SCHEMA='nfd.native-checkpoint.v1';
const CONTEXT_KEYS=['P','phiPairs','rng','scratchCB','scratchExpV','seed'];
const MAX_BYTES=16*1024*1024;
const sourceSha256=Object.fromEntries(['math.js','params.js','sim.js','tasks.js'].map(name=>[
  name,createHash('sha256').update(readFileSync(new URL('./nfd/'+name,import.meta.url))).digest('hex')
]));
sourceSha256['source-binding.json']=createHash('sha256').update(readFileSync(new URL('./source-binding.json',import.meta.url))).digest('hex');
function assertContext(ctx){
  if(JSON.stringify(Object.keys(ctx).sort())!==JSON.stringify(CONTEXT_KEYS))throw new TypeError('unexpected native context fields');
  if(ctx.P?.N!==81 || !Array.isArray(ctx.phiPairs) || !(ctx.scratchCB instanceof Float32Array) || !(ctx.scratchExpV instanceof Float32Array))throw new TypeError('unsupported native context');
  if(typeof ctx.rng?.getState!=='function'||typeof ctx.rng?.setState!=='function')throw new TypeError('serializable RNG required');
}
export function captureNative({sim,ctx}){
  assertContext(ctx);
  // Explicit closure retains all current ctx fields except its callable RNG.
  // V8 preserves typed arrays, shared references, undefined and nonfinite values.
  const payload=serialize({sim,ctx:{P:ctx.P,phiPairs:ctx.phiPairs,seed:ctx.seed,scratchExpV:ctx.scratchExpV,scratchCB:ctx.scratchCB}});
  if(payload.length>MAX_BYTES)throw new RangeError('checkpoint payload too large');
  return {schema:SCHEMA,nodeVersion:process.version,sourceSha256:{...sourceSha256},rngState:ctx.rng.getState(),payload:payload.toString('base64')};
}
export function restoreNative(checkpoint){
  if(!checkpoint||JSON.stringify(Object.keys(checkpoint).sort())!==JSON.stringify(['nodeVersion','payload','rngState','schema','sourceSha256']))throw new TypeError('invalid checkpoint envelope');
  if(checkpoint.schema!==SCHEMA||checkpoint.nodeVersion!==process.version||JSON.stringify(checkpoint.sourceSha256)!==JSON.stringify(sourceSha256))throw new TypeError('checkpoint source/runtime mismatch');
  if(typeof checkpoint.payload!=='string'||checkpoint.payload.length>Math.ceil(MAX_BYTES/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(checkpoint.payload))throw new TypeError('invalid checkpoint payload');
  const rng=mulberry32(0);rng.setState(checkpoint.rngState);
  const payload=deserialize(Buffer.from(checkpoint.payload,'base64'));
  if(!payload||!payload.sim||!payload.ctx||Object.keys(payload).sort().join(',')!=='ctx,sim'||Object.keys(payload.ctx).sort().join(',')!=='P,phiPairs,scratchCB,scratchExpV,seed')throw new TypeError('invalid native state');
  const result={sim:payload.sim,ctx:{...payload.ctx,rng}};
  assertContext(result.ctx);
  if(result.sim.ns?.length!==81||result.ctx.scratchExpV.length!==81||result.ctx.scratchCB.length!==result.ctx.P.B)throw new TypeError('state shape mismatch');
  return result;
}
