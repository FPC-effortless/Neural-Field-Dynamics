// Node-only, dependency-free preparation. Browser exports remain pure TS/no I/O.
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export function prepare(output) {
  const root=fileURLToPath(new URL('../../',import.meta.url));
  mkdirSync(path.join(output,'nfd'),{recursive:true});
  const sources={};
  for(const name of ['math','params','sim','tasks']) {
    const relative=`lib/amisgc-core/src/${name}.ts`;
    const text=readFileSync(path.join(root,relative),'utf8');
    sources[relative]=createHash('sha256').update(text).digest('hex');
    writeFileSync(path.join(output,'nfd',`${name}.js`),stripTypeScriptTypes(text,{mode:'strip'}));
  }
  writeFileSync(path.join(output,'package.json'),'{"type":"module"}\n');
  writeFileSync(path.join(output,'source-binding.json'),JSON.stringify({schema:'nfd.source-binding.v1',node:process.version,sources},null,2)+'\n');
  writeFileSync(path.join(output,'checkpoint.mjs'),readFileSync(new URL('./checkpoint.mjs',import.meta.url)));
  return output;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  if(!process.argv[2]) throw Error('Usage: node scripts/native-checkpoint/prepare.mjs OUTPUT_DIRECTORY');
  prepare(path.resolve(process.argv[2]));
}
