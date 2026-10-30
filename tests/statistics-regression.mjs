import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
const source=resolve(process.argv[2]||'lib/amisgc-core/src');
const dest=process.argv[3];
const compiled=mkdtempSync(join(tmpdir(),'nfd-fix-'));
const started=performance.now();
try{
 writeFileSync(join(compiled,'package.json'),'{"type":"module"}');
 for(const f of readdirSync(source).filter(f=>f.endsWith('.ts')))
  writeFileSync(join(compiled,f.replace(/\.ts$/,'.js')),stripTypeScriptTypes(readFileSync(join(source,f),'utf8'),{mode:'transform'}));
 const {createSim,simTick,calcStats}=await import(pathToFileURL(join(compiled,'sim.js')));
 const {defaultParams}=await import(pathToFileURL(join(compiled,'params.js')));
 const x=createSim(defaultParams(81),{seed:101});
 x.sim.t=1200;x.sim.networkPhi=.2;x.sim.networkSC=.2;
 x.sim.pu_C_history=[];x.sim.pu_env_history=[];
 for(let t=0;t<100;t++){x.sim.pu_C_history.push({t,C_index:t%2});x.sim.pu_env_history.push({t:t+x.ctx.P.PU_LAG,envBit:t%2});}
 const before=structuredClone(x.sim);
 const a=calcStats(x.sim,x.ctx);
 for(let i=0;i<100;i++)assert.deepEqual(calcStats(x.sim,x.ctx),a);
 assert.deepEqual(x.sim,before,'reading statistics must not mutate live state or manufacture a streak');
 simTick(x.sim,x.ctx);
 assert.equal(x.sim.gateStreak,1,'one dynamics tick contributes exactly one gate tick');
 for(let i=0;i<100;i++)calcStats(x.sim,x.ctx);
 assert.equal(x.sim.gateStreak,1);
 simTick(x.sim,x.ctx);assert.equal(x.sim.gateStreak,2);
 const rows=[];
 for(const seed of [101,202,303]){
  function run(every){const y=createSim(defaultParams(81),{seed});for(let t=0;t<2400;t++){simTick(y.sim,y.ctx);if(t%every===0)calcStats(y.sim,y.ctx);}return y;}
  const frequent=run(1), sparse=run(200);
  assert.deepEqual(frequent.sim,sparse.sim,'all persistent state must be independent of observation frequency');
  assert.deepEqual(calcStats(frequent.sim,frequent.ctx),calcStats(sparse.sim,sparse.ctx));
  rows.push({seed,ticks:2400,entireStateEqual:true,statsEqual:true,gateStreak:sparse.sim.gateStreak});
 }
 const result={study:'DEEP-FIX001',kind:'constructed_regression_not_capability',checks:3,rows,seconds:(performance.now()-started)/1000,node:process.version,optimizerSteps:0,gpuMinutes:0};
 if(dest){mkdirSync(dirname(resolve(dest)),{recursive:true});writeFileSync(dest,JSON.stringify(result,null,2)+'\n');}
 console.log(JSON.stringify(result));
}finally{rmSync(compiled,{recursive:true,force:true});}
