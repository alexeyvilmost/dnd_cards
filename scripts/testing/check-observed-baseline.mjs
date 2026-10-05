#!/usr/bin/env node
// Explicit legacy adoption on an owned imported297 schema, not historical install.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startTestStack} from './stack.mjs';
import {seedUpgradeBaseline,fixtureHash} from './upgrade-baseline-fixture.mjs';
import {repositoryRoot,resolveTool,execute,cleanEnvironment} from './runtime.mjs';
export async function checkObservedBaseline({output,go,pgBin,race=process.env.TEST_GO_RACE==='1'}={}){
  if(race&&process.platform!=='linux')throw Error('Observed baseline race proof requires Linux');
  const directory=path.resolve(output??path.join(repositoryRoot,`outputs/testing/observed-baseline-${Date.now()}`));await mkdir(directory,{recursive:true});
  const report={schemaVersion:1,status:'running',scope:'observed-full-schema297-additive-adoption',historicalChainVerified:false,race},file=path.join(directory,'report.json');
  await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});let stack;
  try{
    stack=await startTestStack({dbOnly:true,go,pgBin});report.runId=stack.registry.runId;
    const fixture=await seedUpgradeBaseline(stack,297);report.fixtureSources=fixture.sources;report.artifactHash=fixture.input.artifactHash;
    const env=cleanEnvironment({...stack.env,MIGRATION_BASELINE_MATRIX:'1',MIGRATION_BASELINE_DATABASE_URL:stack.database.dsn});
    report.log=path.join(stack.registry.directory,'observed-baseline-go.jsonl');
    const result=await execute(resolveTool('go',go),['test',...(race?['-race']:[]),'-json','./migrations','-run','^TestSupportedObservedLegacyBaseline$','-count=1'],{cwd:path.join(repositoryRoot,'backend'),env,log:report.log,timeout:180000});
    const events=result.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));assert(!events.some(row=>['fail','skip'].includes(row.Action)));
    assert.equal(events.filter(row=>row.Action==='pass'&&row.Test==='TestSupportedObservedLegacyBaseline').length,1);
    for(const [source,hash]of Object.entries(fixture.sources))assert.equal(fixtureHash(await readFile(path.join(repositoryRoot,source))),hash);
    assert.equal(fixtureHash(await readFile(fixture.artifactFile)),fixture.input.artifactHash);report.status='passed';return report;
  }catch(error){report.status='failed';report.reason=error.message;throw error;}
  finally{if(stack){await stack.cleanup();report.cleanup={status:stack.registry.status,errors:stack.registry.cleanupErrors};if(report.cleanup.status!=='stopped')report.status='failed';}await writeFile(file,JSON.stringify(report,null,2)+'\n');}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const report=await checkObservedBaseline({output:process.argv[2]});console.log(JSON.stringify({status:report.status,runId:report.runId,cleanup:report.cleanup.status}));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
