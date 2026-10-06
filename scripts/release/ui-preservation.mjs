// Read-only protected-filesystem observation. Never reads database rows or
// writes, repairs, removes, copies or prunes the executable/source store.
import {lstatSync,realpathSync,readdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {evidenceHash} from './validate-manifest.mjs';
const hash=/^sha256:[a-f0-9]{64}$/;
function regularDirectory(root) {
  const absolute=path.resolve(root);
  if (realpathSync(absolute)!==absolute || !lstatSync(absolute).isDirectory() || lstatSync(absolute).isSymbolicLink()) throw Error('Redirected or non-directory immutable root');
  return absolute;
}
export function collectImmutableClosure(roots,{now=Date.now()}={}) {
  if (!roots || Object.keys(roots).length<1 || Object.keys(roots).some(key=>!/^[a-z][a-z0-9-]*$/.test(key))) throw Error('Explicit protected immutable roots required');
  const files=[],resolved={};
  for (const [name,root] of Object.entries(roots).sort()) {
    resolved[name]=regularDirectory(root);
    const walk=directory=>{
      for (const entry of readdirSync(directory).sort()) {
        const file=path.join(directory,entry),stat=lstatSync(file);
        if (stat.isSymbolicLink() || realpathSync(file)!==file) throw Error('Symlink/redirect in immutable store');
        if(stat.isDirectory())walk(file);
        else if(stat.isFile()){
          const bytes=readFileSync(file),after=lstatSync(file);
          if(stat.size!==after.size||stat.mtimeMs!==after.mtimeMs||stat.ino!==after.ino||stat.dev!==after.dev||bytes.length!==stat.size)throw Error('Immutable file changed during observation');
          files.push({root:name,path:path.relative(resolved[name],file).split(path.sep).join('/'),bytes:bytes.length,sha256:`sha256:${createHash('sha256').update(bytes).digest('hex')}`});
        }else throw Error('Non-regular immutable file');
      }
    };walk(resolved[name]);
  }
  return {schemaVersion:1,kind:'immutable-filesystem-closure',observedAt:new Date(now).toISOString(),rootsHash:evidenceHash(resolved),files,
    databaseReferenceInventory:'not_executed',currentDatabaseReferenceCoverage:'not_asserted'};
}
function validateClosure(value) {
  if(value?.schemaVersion!==1||value.kind!=='immutable-filesystem-closure'||!hash.test(value.rootsHash)||!Number.isFinite(Date.parse(value.observedAt))
    ||value.databaseReferenceInventory!=='not_executed'||value.currentDatabaseReferenceCoverage!=='not_asserted'||!Array.isArray(value.files)
    ||new Set(value.files.map(file=>`${file.root}/${file.path}`)).size!==value.files.length)throw Error('Invalid immutable closure');
  for(const file of value.files)if(!/^[a-z][a-z0-9-]*$/.test(file.root)||typeof file.path!=='string'||!file.path||/[\\:\0]/.test(file.path)
    ||file.path.split('/').some(part=>!part||['.','..'].includes(part))||!Number.isSafeInteger(file.bytes)||file.bytes<0||!hash.test(file.sha256))throw Error('Invalid immutable file record');
}
export function assertImmutablePreservation(before,after) {
  validateClosure(before);validateClosure(after);
  if(before.rootsHash!==after.rootsHash||Date.parse(after.observedAt)<Date.parse(before.observedAt))throw Error('Immutable root or observation order changed');
  const next=new Map(after.files.map(file=>[`${file.root}/${file.path}`,file]));
  for(const file of before.files)if(evidenceHash(file)!==evidenceHash(next.get(`${file.root}/${file.path}`)??null))throw Error('Existing immutable file changed or disappeared');
  return {status:'passed',beforeHash:evidenceHash(before),afterHash:evidenceHash(after),preserved:before.files.length,
    concurrentAdditions:after.files.length-before.files.length,databaseReferenceInventory:'not_executed',currentDatabaseReferenceCoverage:'not_asserted'};
}
export function assertUnchangedRunningRuntime(before,after) {
  for(const observation of [before,after]){
    if(!observation||Object.keys(observation).sort().join(',')!=='backend,rulesWorker')throw Error('Exact protected backend/worker observations required');
    for(const [component,row] of Object.entries(observation)){
      if(!/^[a-f0-9]{64}$/.test(row.containerId??'')||!row.identity||row.identity.component!==component
        ||['configurationHash','mountsHash','databaseBindingHash'].some(key=>!hash.test(row[key])))throw Error('Actual running identity/config/mount binding missing');
    }
  }
  if(evidenceHash(before)!==evidenceHash(after))throw Error('Protected backend/worker containers, identities, config or mounts changed');
  return {status:'passed',observationHash:evidenceHash(before)};
}
