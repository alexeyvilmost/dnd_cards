import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startTestStack} from '../testing/stack.mjs';
import {runRequiredGo} from '../testing/required-go.mjs';
import {repositoryRoot} from '../testing/runtime.mjs';
const startedAt=new Date().toISOString(),directory=path.join(repositoryRoot,'outputs/testing/retirement-execution-'+startedAt.replaceAll(':','-'));
await mkdir(directory,{recursive:true});
const sources=['backend/migrations/release_retirement_execute.go','backend/migrations/release_retirement_execute_test.go','backend/migrations/release_retirement_execution_integration_test.go','backend/migrations/release_retirement.go','backend/migrations/release_additive_test.go','backend/migrations/data/retire-legacy-characters-302.sql','backend/release_migration_command.go','backend/release_migration_command_test.go','backend/build_info.go','backend/build_info_test.go','scripts/database/retirement-execution-local.mjs'];
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const hashes=async()=>Object.fromEntries(await Promise.all(sources.map(async file=>[file,hash(await readFile(path.join(repositoryRoot,file)))])));
const sourceHashes=await hashes();
const receipt={schemaVersion:1,scope:'owned-native-postgres-explicit-retirement-execution',startedAt,status:'running',sourceHashes,productionChanges:0,syntheticExternalProofHashes:true,actualArchiveRestoreProven:false,productionReady:false,results:[],cleanup:{status:'pending'}};
let stack;
try{
 stack=await startTestStack({dbOnly:true});receipt.runId=stack.registry.runId;
 const enclosing=async()=>({marker:(await stack.database.query('SELECT current_database()||\':\'||run_id FROM test_run_ownership;')).trim(),tables:(await stack.database.query("SELECT coalesce(json_agg(table_name ORDER BY table_name),'[]'::json) FROM information_schema.tables WHERE table_schema='public';")).trim(),databases:(await stack.database.query("SELECT coalesce(json_agg(datname ORDER BY datname),'[]'::json) FROM pg_database WHERE datname LIKE 'test_%';")).trim()});
 const before=await enclosing();
 receipt.results.push(await runRequiredGo(stack,{packagePath:'./migrations',tests:['TestExplicitRetirementRejectsUnboundRequestsBeforeConnecting','TestExplicitRetirementAtomicExecutionRetryAndReconciliation','TestRetirementReadOnlyReconciliationRejectsPostCommitDrift','TestReleaseRetirementInspectionReadOnlyAndRejectsDrift','TestReleaseAdditiveAtomicRepeatAndHistory']}));
 receipt.results.push(await runRequiredGo(stack,{tests:['TestReleaseMigrationCLIRejectsUnboundAndMalformedRequestsBeforeStartup','TestReleaseMigrationCLIBoundsInputBeforeDatabaseConnection','TestMigrationInfoCommand']}));
 assert.deepEqual(await enclosing(),before);receipt.enclosingFixtureUnchanged=true;receipt.childDatabasesCleaned=true;
 assert.deepEqual(await hashes(),sourceHashes);receipt.sourceUnchanged=true;receipt.status='passed';
}catch(error){receipt.status='failed';receipt.errorCode='retirement-execution-test-failed';throw error;}
finally{
 if(stack){await stack.cleanup();const registry=JSON.parse(await readFile(path.join(stack.registry.directory,'registry.json'),'utf8'));receipt.cleanup={status:registry.status,errors:registry.cleanupErrors};assert.equal(registry.status,'stopped');assert.deepEqual(registry.cleanupErrors,[]);}
 receipt.completedAt=new Date().toISOString();await writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));process.stdout.write(JSON.stringify({status:receipt.status,directory,cleanup:receipt.cleanup})+'\n');
}
