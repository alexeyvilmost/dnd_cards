#!/usr/bin/env node
// Full-schema supported upgrade matrix; historical installation is not implied.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startTestStack} from './stack.mjs';
import {repositoryRoot,resolveTool,execute,cleanEnvironment} from './runtime.mjs';
import {seedUpgradeBaseline,fixtureHash} from './upgrade-baseline-fixture.mjs';
import {databaseRecoveryInventory} from '../release/artifact-references.mjs';
import {evidenceHash} from '../release/validate-manifest.mjs';

async function migrationInputs(){
  const result={};
  async function walk(relative){for(const entry of await readdir(path.join(repositoryRoot,relative),{withFileTypes:true})){const file=relative+'/'+entry.name;if(entry.isDirectory())await walk(file);else if(/\.(go|json|sql)$/.test(file))result[file]=fixtureHash(await readFile(path.join(repositoryRoot,file)));}}
  await walk('backend/migrations');
  for(const file of ['backend/go.mod','backend/go.sum','scripts/testing/check-upgrade-baselines.mjs','scripts/testing/upgrade-baseline-fixture.mjs'])result[file]=fixtureHash(await readFile(path.join(repositoryRoot,file)));
  return result;
}
async function finalStructure(database,inventory){
  const value=JSON.parse((await database.query(`SELECT json_build_object(
    'triggers',(SELECT coalesce(json_agg(pg_get_triggerdef(t.oid) ORDER BY c.relname,t.tgname),'[]'::json) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace),
    'functions',(SELECT coalesce(json_agg(json_build_array(p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid)) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::json) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'),
    'tables',(SELECT coalesce(json_agg(json_build_array(relname,relkind,relpersistence,relrowsecurity,relforcerowsecurity) ORDER BY relname),'[]'::json) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p') AND relname<>'test_run_ownership'));`)).trim());
  return evidenceHash({schema:inventory.schemaFingerprint,...value});
}
function verifyGoRun(output,baseline){
  const events=output.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
  assert(!events.some(row=>['fail','skip'].includes(row.Action)),'Go baseline matrix failed/skipped');
  const name=`TestSupportedBaselineUpgradeMatrix/baseline_${baseline}_to_current`;
  assert.equal(events.filter(row=>row.Action==='pass'&&row.Test===name).length,1,'Exact matrix subcase must pass once');
  assert.equal(events.filter(row=>row.Action==='pass'&&row.Test==='TestSupportedBaselineUpgradeMatrix').length,1);
}
export async function checkUpgradeBaselines({output,go,pgBin,race=process.env.TEST_GO_RACE==='1'}={}){
  if(race&&process.platform!=='linux')throw Error('Supported race matrix requires Linux');
  const directory=path.resolve(output??path.join(repositoryRoot,`outputs/testing/upgrade-baselines-${Date.now()}`));
  await mkdir(path.dirname(directory),{recursive:true});
  await mkdir(directory); // A failed or prior receipt is never overwritten.
  const executable=resolveTool('go',go),report={schemaVersion:1,status:'running',scope:'checked-in-schema-supported-upgrade',historicalChainVerified:false,productionBootstrap:false,cases:[],sourceInputs:await migrationInputs(),startedAt:new Date().toISOString(),limitations:['Baseline001–297 was imported, not executed; full historical fresh install still requires trusted preimage.','Synthetic nonempty storage canaries; semantic historical replay has its separate mandatory gate.','No production snapshots, providers, container builds or deployments.']};
  report.goVersion=(await execute(executable,['version'])).trim();report.race=race;
  const save=()=>writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');await save();
  try{
    // Keep one exact executable as evidence. In addition to avoiding recompiling
    // the same package three times, this avoids Windows' post-run temp-executable
    // unlink race without ignoring a nonzero Go/test exit code.
    const binary=path.join(directory,'migrations.test'+(process.platform==='win32'?'.exe':''));
    await execute(executable,['test',...(race?['-race']:[]),'./migrations','-c','-o',binary],{
      cwd:path.join(repositoryRoot,'backend'),log:path.join(directory,'compile.log'),timeout:180000,
    });
    report.testBinary={path:binary,sha256:fixtureHash(await readFile(binary))};await save();
    for(const baseline of [297,298,299]){
      let stack;const row={baseline,status:'running'};report.cases.push(row);await save();
      try{
        stack=await startTestStack({dbOnly:true,go,pgBin});row.runId=stack.registry.runId;row.directory=stack.registry.directory;row.postgres=stack.registry.database.version;
        const fixture=await seedUpgradeBaseline(stack,baseline);row.fixtureSources=fixture.sources;row.artifactHash=fixture.input.artifactHash;
        const env=cleanEnvironment({...stack.env,MIGRATION_BASELINE_MATRIX:'1',MIGRATION_BASELINE_DATABASE_URL:stack.database.dsn});
        const log=path.join(stack.registry.directory,'baseline-upgrade-go.jsonl');
        const args=['tool','test2json','-t','-p','dnd-cards-backend/migrations',binary,'-test.run=^TestSupportedBaselineUpgradeMatrix$','-test.count=1','-test.v=test2json'];
        const result=await execute(executable,args,{cwd:path.join(repositoryRoot,'backend'),env,log,timeout:180000});verifyGoRun(result,baseline);
        assert.equal(fixtureHash(await readFile(binary)),report.testBinary.sha256,'Matrix executable changed during run');
        row.result=JSON.parse(await readFile(path.join(stack.registry.directory,'baseline-upgrade-case.json')));assert.equal(row.result.status,'passed');assert.equal(row.result.case,baseline);assert.deepEqual(row.result.applied,['298_compact_command_receipts','299_frozen_combat_catalogs','300_image_jobs','301_character_lifecycle','307_catalog_presentation'].slice(baseline-297));assert.equal(row.result.repeatApplied.length,0);
        const inventory=await databaseRecoveryInventory(stack.database);assert.deepEqual(inventory.artifactHashes,[fixture.input.artifactHash]);
        assert.equal(fixtureHash(await readFile(fixture.artifactFile)),fixture.input.artifactHash);
        row.artifactInventory=inventory.artifactHashes;row.finalSchemaHash=await finalStructure(stack.database,inventory);row.status='passed';
      }catch(error){row.status='failed';row.reason=error.message;throw error;}
      finally{if(stack){await stack.cleanup();row.cleanup=stack.registry.status;assert.equal(row.cleanup,'stopped');}await save();}
    }
    assert.equal(report.cases.length,3);assert(report.cases.every(row=>row.status==='passed'&&row.cleanup==='stopped'));
    assert.equal(new Set(report.cases.map(row=>row.finalSchemaHash)).size,1,'Different intermediate baselines produced different final schema');
    assert.deepEqual(await migrationInputs(),report.sourceInputs,'Migration inputs changed during matrix');
    for(const row of report.cases)for(const [file,hash]of Object.entries(row.fixtureSources))assert.equal(fixtureHash(await readFile(path.join(repositoryRoot,file))),hash,'Fixture source changed during matrix');
    report.status='passed';return report;
  }catch(error){report.status='failed';report.reason=error.message;throw error;}
  finally{report.finishedAt=new Date().toISOString();await save();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const report=await checkUpgradeBaselines({output:process.argv[2]});console.log(JSON.stringify({status:report.status,cases:report.cases.length,scope:report.scope,historicalChainVerified:false}));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
