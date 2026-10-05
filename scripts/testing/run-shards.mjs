#!/usr/bin/env node
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {runSuite,suiteOptions} from './run.mjs';
import {createPlan} from '../release/plan-components.mjs';
import {readSuites,selectGroups,catalogTests} from './suites.mjs';
import {suiteWorkload} from './workload.mjs';
import {shardPlan} from './shards.mjs';
import {repositoryRoot,execute} from './runtime.mjs';

const argv=process.argv.slice(2),args=suiteOptions(argv);
if(args.shard||args.select||args['plan-only']||args['reuse-ui-build']||args.suite==='legacy-manual')throw Error('run-shards requires a complete mandatory suite with fresh private builds');
const {manifest}=readSuites(),componentPlan=createPlan({repo:repositoryRoot,mode:args.mode,base:args.base,candidate:args.candidate,full:args.full});
const selection=selectGroups(manifest,componentPlan,{suite:args.suite});
const plan=shardPlan(suiteWorkload({selection,catalog:catalogTests(manifest),manifest,suite:args.suite}));
const directory=path.resolve(repositoryRoot,args.output??`outputs/testing/shards/${Date.now()}-${randomUUID()}`);
await mkdir(directory,{recursive:true});
const common=argv.filter((value,index)=>value!=='--output'&&argv[index-1]!=='--output'),queue=[...plan.names],reports=[];
const interrupted=()=>{queue.length=0;process.exitCode=130;};
process.once('SIGINT',interrupted);process.once('SIGTERM',interrupted);
// At most two full native stacks/builds. Every stack already owns its random
// cluster, ports, credentials, binaries, UI and interruption cleanup handler.
try{await Promise.all(Array.from({length:Math.min(2,queue.length)},async()=>{
  while(queue.length){
    const name=queue.shift(),output=path.join(directory,name);
    const report=await runSuite([...common,'--shard',name,'--output',output]);
    reports.push(path.join(output,'report.json'));
    if(report.status!=='passed')process.exitCode=1;
  }
}));}finally{process.removeListener('SIGINT',interrupted);process.removeListener('SIGTERM',interrupted);}
if(process.exitCode)throw Error(`One or more mandatory shards failed; partial reports retained at ${directory}`);
await execute(process.execPath,['scripts/testing/aggregate-shards.mjs',path.join(directory,'aggregate'),...reports],
  {log:path.join(directory,'aggregation.log')});
console.log(`PASS: ${path.join(directory,'aggregate/report.json')}`);
