import assert from 'node:assert/strict';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const exec=promisify(execFile);
const sourcePaths=[
 'scripts/testing/integration-baseline.mjs','scripts/testing/fixtures.mjs','scripts/testing/stack.mjs','scripts/testing/postgres.mjs','scripts/testing/runtime.mjs','scripts/testing/guards.mjs',
 'scripts/testing/fixtures/schema.sql','scripts/testing/fixtures/schema-manifest.json','backend/charactertemplates/presets.json',
 ...['classes','races','effects','actions','spells','feats','backgrounds','cards','resources','variables'].map(name=>'officials/canon/prod-snapshot/'+name+'.json'),
 'backend/migrations/data/catalog-audit-20260929/spells.json','frontend/src/roguelike/pinnedFighter.fixture.json','frontend/src/canon/data/micro-mvp-l1-content-patch.v1.json',
 'backend/migrations/generic_spell_freeuses_297_manifest.json','scripts/content/data/spell-grant-abilities-20261001.json','frontend/src/engine/data/rollInfluences.json'];
async function sourceInventory(root,commit){
 assert.match(commit,/^[a-f0-9]{40}$/);const rows=[];
 for(const relative of sourcePaths){
  const file=path.join(root,relative),stat=await lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(await realpath(file),file);
  const options={cwd:root,windowsHide:true,maxBuffer:1024*1024};
  const expected=(await exec('git',['rev-parse',commit+':'+relative],options)).stdout.trim();
  const observed=(await exec('git',['hash-object','--path='+relative,file],options)).stdout.trim();assert.equal(observed,expected,'Fixture input differs from exact application source');
  const bytes=await readFile(file);rows.push({path:relative,sha256:'sha256:'+createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
 }return rows.sort((a,b)=>a.path.localeCompare(b.path));
}
// No Go, frontend build, copied user data or historical-chain success claim.
// The candidate's exact OCI backend subsequently proves the 298–300 upgrade.
export async function producePublicWriterDump({repositoryRoot,sourceCommit}){
 const root=await realpath(repositoryRoot),sourceFiles=await sourceInventory(root,sourceCommit);
 const load=relative=>import(pathToFileURL(path.join(root,relative)));
 const [{startTestStack},{restoreIntegrationBaseline},{seedCanonicalTemplates,newAccounts,seedAccounts},{execute,resolveTool,writeRegistry}]=await Promise.all([
  load('scripts/testing/stack.mjs'),load('scripts/testing/integration-baseline.mjs'),load('scripts/testing/fixtures.mjs'),load('scripts/testing/runtime.mjs')]);
 let stack,answer,failure;
 try{
  stack=await startTestStack({dbOnly:true});const {database,registry}=stack;
  registry.fixture=await restoreIntegrationBaseline(database,registry);registry.fixture.templates=await seedCanonicalTemplates(database);
  const accounts=newAccounts();await seedAccounts(database,accounts);await writeRegistry(registry);
  const userIds=JSON.parse(await database.query('SELECT json_agg(id::text ORDER BY id) FROM users;'));assert.deepEqual(userIds,Object.values(accounts).map(row=>row.id).sort());
  for(const table of ['roguelike_runs','characters_v3','roguelike_command_receipts','character_runtime_commands'])assert.equal((await database.query('SELECT count(*) FROM '+table+';')).trim(),'0');
  assert.equal(registry.fixture.migrationBaseline,'297_retain_generic_spell_free_uses');assert.equal(registry.fixture.historicalChainVerified,false);
  for(const row of [...registry.fixture.catalog,registry.fixture.templates])assert.equal(sourceFiles.find(source=>source.path===row.source)?.sha256,'sha256:'+row.sha256,'Unbound public fixture input');
  await database.query('ANALYZE;');const dumpFile=path.join(registry.directory,'public-writer-fixture.dump'),url=new URL(database.dsn);
  await execute(resolveTool('pg_dump'),['--host',url.hostname,'--port',url.port,'--username','test_runner','--dbname',registry.runId,'--format=custom','--no-owner','--no-privileges','--file',dumpFile],{env:database.env,signal:stack.signal});
  const bytes=await readFile(dumpFile),sha256='sha256:'+createHash('sha256').update(bytes).digest('hex');assert.ok(bytes.length<=8*1024*1024);assert.equal(bytes.subarray(0,5).toString(),'PGDMP');
  assert.deepEqual(await sourceInventory(root,sourceCommit),sourceFiles);
  const rulePath='frontend/src/engine/data/rollInfluences.json',ruleBytes=await readFile(path.join(root,rulePath));
  const ruleData={...sourceFiles.find(row=>row.path===rulePath),base64:ruleBytes.toString('base64')};
  answer={ruleData,baseline:{migrationBaseline:registry.fixture.migrationBaseline,historicalChainVerified:false,schemaHash:'sha256:'+registry.fixture.schemaHash},sourceFiles,dump:{runId:registry.runId,base64:bytes.toString('base64'),sha256,bytes:bytes.length},accounts,
   local:{dumpFile,registryPath:path.join(registry.directory,'registry.json'),directory:registry.directory}};
 }catch(error){failure=error;}finally{if(stack)try{await stack.cleanup();}catch(error){failure??=error;}}
 if(failure)throw failure;return answer;
}
