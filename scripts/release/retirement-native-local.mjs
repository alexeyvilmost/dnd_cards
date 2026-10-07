// Execute an already verified plan only on a currently running native test DB.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {localRetirementProgram} from './retirement-artifacts.mjs';
import {databaseSchemaLedgerProof} from './database-schema-proof.mjs';
import {assertTestDsn,assertRealOwnedPath} from '../testing/guards.mjs';
import {execute,resolveTool,cleanEnvironment,runsRoot} from '../testing/runtime.mjs';
const literal=v=>"'"+v.replaceAll("'","''")+"'";
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
async function target(stack){
 const directory=await assertRealOwnedPath(runsRoot,stack.registry.directory);
 const registry=JSON.parse(await readFile(path.join(directory,'registry.json')));
 assert.equal(registry.directory,directory);assert.equal(registry.runId,stack.registry.runId);assert.equal(registry.status,'ready');assert.equal(registry.database.driver,'native');
 const dsn=new URL(assertTestDsn(stack.database.dsn,registry));assert(dsn.password);
 const data=await assertRealOwnedPath(directory,registry.database.data);
 const pid=(await readFile(path.join(data,'postmaster.pid'),'utf8')).split(/\r?\n/);
 assert.equal(path.resolve(pid[1]),path.resolve(data));assert.equal(Number(pid[3]),registry.ports.database);
 const executable=name=>resolveTool(name,process.env.TEST_PG_BIN?path.join(process.env.TEST_PG_BIN,name+(process.platform==='win32'?'.exe':'')):undefined);
 const psql=executable('psql'),pgctl=executable('pg_ctl');assert.equal(registry.database.psql,psql);assert.equal(registry.database.pgctl,pgctl);
 await execute(pgctl,['-D',data,'status'],{quiet:true});
 const env=cleanEnvironment({PGPASSWORD:dsn.password});
 const query=async program=>execute(psql,['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(registry.ports.database),'-U','test_runner','-d',registry.runId],{env,input:"SET log_min_error_statement='PANIC';SET TIME ZONE 'UTC';SET search_path=pg_catalog,public;SET statement_timeout='300s';"+program,timeout:360000});
 assert.equal((await query('SELECT current_database()||\':\'||run_id FROM public.test_run_ownership;')).trim(),registry.runId+':'+registry.runId);
 return {registry,query};
}
async function retained(query,expected){
 const tables=Object.keys(expected).filter(name=>name!=='test_run_ownership');assert(tables.length>0);assert(tables.every(n=>/^[a-z][a-z0-9_]*$/.test(n)));
 const parts=tables.map(name=>{
  const value=name==='inventories'?"(to_jsonb(t)-'character_id')":"to_jsonb(t)";
  const condition=name==='inventories'?"t.type IS DISTINCT FROM 'character'":name==='inventory_items'?"NOT EXISTS(SELECT 1 FROM public.inventories i WHERE i.id=t.inventory_id AND i.type='character')":'true';
  return `SELECT ${literal(name)} AS name,jsonb_build_object('rows',count(*),'sha256','sha256:'||encode(sha256(convert_to(coalesce(string_agg(digest,E'\\n' ORDER BY digest),''),'UTF8')),'hex')) AS fingerprint FROM (SELECT encode(sha256(convert_to(${value}::text,'UTF8')),'hex') AS digest FROM public.${name} t WHERE ${condition}) rows`;
 });
 const actual=JSON.parse((await query('SELECT jsonb_object_agg(name,fingerprint) FROM ('+parts.join(' UNION ALL ')+') records;')).trim());
 assert.deepEqual(actual,Object.fromEntries(tables.map(name=>[name,expected[name]])));return actual;
}
export async function applyNativeLocalRetirement(plan,stack){
 const program=await localRetirementProgram(plan),owned=await target(stack),query=owned.query;
 const ledgerSQL="SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY version),'[]'::jsonb) FROM public.schema_migrations m WHERE version <> '302_retire_legacy_characters';";
 const ledger=(await query(ledgerSQL)).trim(),rows=JSON.parse(ledger);assert.deepEqual(rows.map(r=>r.version).sort(),plan.expectedCurrentMigrations);
 const prior=(await query("SELECT description FROM public.schema_migrations WHERE version='302_retire_legacy_characters';")).trim();
 let fingerprints;
 if(prior){assert.deepEqual(JSON.parse(prior).request,plan.request);}else fingerprints=await retained(query,plan.retainedFingerprints);
 // Recheck the actual native target after potentially lengthy file/data hashes.
 await target(stack);await query(program);
 const receipt=(await query("SELECT description FROM public.schema_migrations WHERE version='302_retire_legacy_characters';")).trim();
 assert.deepEqual(JSON.parse(receipt).request,plan.request);if(prior)assert.equal(receipt,prior);
 assert.equal((await query(ledgerSQL)).trim(),ledger);
 assert.equal((await query("SELECT to_regclass('public.characters') IS NULL AND to_regclass('public.characters_v2') IS NULL AND NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventories' AND column_name='character_id');")).trim(),'t');
 if(!prior)assert.deepEqual(await retained(query,plan.retainedFingerprints),fingerprints);
 const schema=await databaseSchemaLedgerProof({query});
 assert.deepEqual(schema.migrations,[...plan.expectedCurrentMigrations,plan.migrationId].sort());
 return Object.freeze({schemaVersion:1,kind:'native-local-retirement-result',status:'passed',localOnly:true,productionReady:false,productionChanges:0,runId:owned.registry.runId,profileId:plan.profileId,bundleHash:plan.bundleHash,sqlSourceHash:plan.sqlSourceHash,request:plan.request,applied:!prior,receiptHash:hash(receipt),schemaFingerprint:schema.schemaFingerprint,priorMigrationRowsPreserved:rows.length,retainedTablesChecked:prior?0:Object.keys(fingerprints).length});
}
