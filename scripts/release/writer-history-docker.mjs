import assert from 'node:assert/strict';
import {chmod,lstat} from 'node:fs/promises';
import path from 'node:path';
import {checksum} from './backup-manifest.mjs';

// A narrow capability supplied only by createDockerRehearsal. It never accepts
// a live DSN, arbitrary database name, caller-produced dump or external report.
export function createWriterHistoryDocker({command,resource,names,owner,label,directory,image,execution}){
 if(execution!=='docker'||!/^rehearsal_[a-f0-9]{24}$/.test(owner)||names.postgres!==owner+'_db'||names.network!==owner+'_net'||label!=='bagofholding.rehearsal='+owner)throw Error('Actual owned Docker history capability required');
 let database='rehearsal',sequence=0;const snapshots=new Map(),restores=new Map();
 async function assertOwned(){
  const network=JSON.parse(await command(['network','inspect',names.network]))[0];
  assert.equal(network.Internal,true);assert.equal(network.Labels?.['bagofholding.rehearsal'],owner);
  const pg=JSON.parse(await command(['container','inspect',names.postgres]))[0];
  assert.equal(pg.Config.Labels?.['bagofholding.rehearsal'],owner);assert.equal(pg.State.Running,true);
  assert.deepEqual(Object.keys(pg.NetworkSettings.Networks),[names.network]);assert.ok(!Object.values(pg.NetworkSettings.Ports??{}).some(ports=>ports?.length));
  const current=await command(['exec',names.postgres,'psql','-X','-qAt','-U','rehearsal','-d',database,'-c','SELECT current_database();']);assert.equal(current.trim(),database);
 }
 async function assertApplicationsStopped(){
  const running=(await command(['container','ls','--filter','label='+label,'--format','{{.Names}}'])).split(/\r?\n/);
  assert.ok(![names.backend,names.rulesWorker,names.frontend].some(name=>running.includes(name)),'History applications must remain stopped');
 }
 async function query(sql){await assertOwned();return command(['exec','-i',names.postgres,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','rehearsal','-d',database],{input:sql,timeout:300000});}
 async function dumpDatabase(){
  await assertOwned();await assertApplicationsStopped();
  const name=owner+'_history_'+(++sequence),file=path.join(directory,name+'.dump'),temporary='/tmp/'+name+'.dump';
  await command(['exec',names.postgres,'pg_dump','--format=custom','--no-owner','--no-privileges','-U','rehearsal','-d',database,'--file',temporary],{timeout:300000});
  await command(['cp',names.postgres+':'+temporary,file]);await chmod(file,0o600);
  const stat=await lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0);
  const value={path:file,sha256:await checksum(file),bytes:stat.size,createdAt:new Date().toISOString(),sourceDatabase:database};snapshots.set(value,JSON.stringify(value));return value;
 }
 async function restoreDatabase(snapshot){
  assert.equal(snapshots.get(snapshot),JSON.stringify(snapshot));await assertOwned();await assertApplicationsStopped();assert.equal(await checksum(snapshot.path),snapshot.sha256);
  const next='writer_restore_'+(++sequence);assert.match(next,/^writer_restore_[1-9][0-9]*$/);
  await command(['exec',names.postgres,'createdb','--template=template0','-U','rehearsal',next]);
  await command(['exec','-i',names.postgres,'pg_restore','--exit-on-error','--no-owner','--no-privileges','-U','rehearsal','-d',next],{inputFile:snapshot.path,timeout:300000});
  const result={sourceDatabase:database,restoredDatabase:next,dumpHash:snapshot.sha256,sourceRetained:true,markerVerified:true};
  database=next;await assertOwned();restores.set(result,JSON.stringify(result));return result;
 }
 async function restoreSourceDatabase(result){
  assert.equal(restores.get(result),JSON.stringify(result));assert.equal(database,result.restoredDatabase);await assertApplicationsStopped();await assertOwned();
  database=result.sourceDatabase;await assertOwned();
  // Only this exact ephemeral target is removed; the captured source DB remains.
  await command(['exec',names.postgres,'dropdb','-U','rehearsal',result.restoredDatabase]);restores.delete(result);
 }
 async function artifactClosure(){
  await assertOwned();const volume=JSON.parse(await command(['volume','inspect',names.volume]))[0];assert.equal(volume.Labels?.['bagofholding.rehearsal'],owner);
  const name=owner+'_writer_artifacts_'+(++sequence),program=`import{readdir,lstat,readFile}from'node:fs/promises';import{createHash}from'node:crypto';const rows=[];for(const name of(await readdir('/artifacts')).sort()){if(!/^[a-f0-9]{64}\\.cjs$/.test(name))throw Error('Unexpected retained artifact');const p='/artifacts/'+name,s=await lstat(p);if(!s.isFile()||s.isSymbolicLink())throw Error('Unexpected retained artifact kind');const b=await readFile(p),hash=createHash('sha256').update(b).digest('hex');if(name!==hash+'.cjs')throw Error('Retained artifact checksum differs');rows.push({path:name,sha256:'sha256:'+hash,bytes:b.length})}console.log(JSON.stringify(rows));`;
  return JSON.parse(await resource('container',name,['run','--name',name,'--label',label,'--network','none','--read-only','--mount',`type=volume,source=${names.volume},target=/artifacts,readonly`,'--entrypoint','node',image,'--input-type=module','-e',program]));
 }
 return {execution,assertOwned,assertApplicationsStopped,query,dumpDatabase,restoreDatabase,restoreSourceDatabase,artifactClosure};
}
