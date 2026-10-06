#!/usr/bin/env node
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {loadControlRecovery,assertRecoveredInitialHistory,recoveryFields} from './first-adoption-recovery.mjs';
import {prepareBuildPlan} from './ci-release.mjs';import {selectLatestDeployedRun} from './deployed-baseline.mjs';
import {githubReader,loadPublishedUIPlanning} from './ui-ci.mjs';import {dispatchVerifiedRelease} from './ui-release-dispatch.mjs';
import {catalogTests,selectGroups,hash} from '../testing/suites.mjs';import {suiteWorkload} from '../testing/workload.mjs';import {shardPlan} from '../testing/shards.mjs';
const read=file=>JSON.parse(readFileSync(file,'utf8'));
export function frontendWorkload(repo,planning,report){
  const bytes=readFileSync(path.join(repo,'tests/suites.json')),manifest=JSON.parse(bytes);
  if(hash(bytes)!==report.manifest_sha256)throw Error('CI suite manifest differs from candidate checkout');
  const selection=selectGroups(manifest,{...planning.input.selection,mode:'ci'},{suite:'core'}),catalog=catalogTests(manifest,repo);
  return shardPlan(suiteWorkload({selection,catalog,manifest,suite:'core',frontendPlanning:planning}));
}
export async function prepareDispatchedBuild(options,{get}){
  const {repo,repository,candidate,config,baselineDirectory,suiteReport}=options;
  // Explicit reviewed first-adoption recovery is always a full build, including
  // when selective planning is enabled. A failed attempt is never a baseline.
  if(options.firstAdoptionRecovery) {
    const ref=options.firstAdoptionRecovery;
    const {proof}=loadControlRecovery({id:ref.id,reference:ref,controlRoot:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),controlCommit:options.controlCommit,repository});
    if(candidate!==options.controlCommit||options.frontendVerification||options.baseline||options.baselineRun||options.baselineReceipt||options.baselineFile
      ||['manifest.json','deployment.json'].some(file=>existsSync(path.join(baselineDirectory,file)))
      ||existsSync(path.join(path.dirname(baselineDirectory),'verified-baseline-run.json')))throw Error('Recovery cannot use a baseline or selective verification');
    if((await get('commits/main')).sha!==candidate)throw Error('Recovery candidate has been superseded on main');
    await assertRecoveredInitialHistory(get,{proof});
    return prepareBuildPlan(options);
  }
  const run=await selectLatestDeployedRun(get,{repository}),baselineFile=path.join(baselineDirectory,'manifest.json');
  if(Boolean(run)!==existsSync(baselineFile))throw Error('Latest deployed baseline download missing or unexpected');
  const common={...options,...(run?{baselineFile,baseline:read(baselineFile),baselineReceipt:read(path.join(baselineDirectory,'deployment.json')),baselineRun:run}:{})};
  const freshPlanning=()=>loadPublishedUIPlanning({get,repository,run,baselineDirectory,repo,candidate,config});
  const current=await freshPlanning();
  if(current.eligibility.kind==='full')return prepareBuildPlan(common);
  const planning=suiteReport.frontend_planning,fullVerification=suiteReport.suite==='extended'&&planning?.eligibility?.kind==='full';
  const workloadPlan=current.eligibility.kind==='frontend-only'&&!fullVerification?frontendWorkload(repo,current,suiteReport):undefined;
  return dispatchVerifiedRelease({planning,ciReport:suiteReport,workloadPlan,freshPlanning,
    prepareFull:()=>prepareBuildPlan(common),prepareFrontend:({planning,ciReport,workloadPlan})=>prepareBuildPlan({...common,frontendVerification:{planning,ciReport,workloadPlan}})});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [repo,candidate,repository,configFile,verificationFile,reportFile,baselineDirectory,output,requestFile,...extra]=process.argv.slice(2);
  if(!output||extra.length)throw Error('Expected exact release planning arguments');
  const options={repo:path.resolve(repo),candidate,repository,config:read(configFile),verification:read(verificationFile),suiteReport:read(reportFile),baselineDirectory,
    controlCommit:process.env.GITHUB_SHA,releaseRunId:Number(process.env.GITHUB_RUN_ID),...recoveryFields(requestFile?read(requestFile).firstAdoptionRecovery:undefined)};
  // Default OFF preserves canonical full preparation and its old plan hashes.
  const plan=(options.firstAdoptionRecovery||process.env.FRONTEND_SELECTIVE_ENABLED==='true')?await prepareDispatchedBuild(options,{get:githubReader(repository,process.env.GITHUB_TOKEN)}):prepareBuildPlan({...options,
    ...(existsSync(path.join(baselineDirectory,'manifest.json'))?{baselineFile:path.join(baselineDirectory,'manifest.json'),baseline:read(path.join(baselineDirectory,'manifest.json')),baselineReceipt:read(path.join(baselineDirectory,'deployment.json')),baselineRun:read(path.join(path.dirname(baselineDirectory),'verified-baseline-run.json'))}:{})});
  mkdirSync(path.dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
  const noop=plan.kind==='no-deployment-needed';process.stdout.write(`no_deployment=${noop}\nmatrix=${JSON.stringify({include:noop?[]:plan.matrix.map(row=>({name:row.name}))})}\nbuildkit_image=${noop?'':plan.config.buildkitImage}\n`);
}
