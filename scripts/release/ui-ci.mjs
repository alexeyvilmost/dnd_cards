#!/usr/bin/env node
// Read-only CI transport. Only latest actual deployed artifact is an authority;
// source/PR files cannot supply a host domain or select an older baseline.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {selectLatestDeployedRun} from './deployed-baseline.mjs';import {verifyBaseline} from './ci-release.mjs';
import {prepareFrontendVerification} from './ui-release-planning.mjs';import {assertUIProofProjection} from './ui-proof-projection.mjs';
import {components,inventory,ignorePolicy} from './measure-local.mjs';import {evidenceHash} from './validate-manifest.mjs';
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const save=(file,value)=>{mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});};
export function githubReader(repository,token){
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository??'')||!token)throw Error('Read-only GitHub identity required');
  return async route=>{if(!/^[a-zA-Z0-9_./?=&-]+$/.test(route)||route.includes('..'))throw Error('Invalid metadata route');
    const response=await fetch(`https://api.github.com/repos/${repository}/${route}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error(`Read-only workflow metadata unavailable (${response.status})`);return response.json();};
}
export async function loadPublishedUIPlanning({get,repository,run,baselineDirectory,repo,candidate,config}){
  if(!run)return {eligibility:{kind:'full',requiredTier:'extended',reason:'no-deployed-baseline'}};
  const fresh=await selectLatestDeployedRun(get,{repository});if(evidenceHash(fresh)!==evidenceHash(run))throw Error('Latest deployed attempt changed while downloading planning evidence');
  const manifest=read(path.join(baselineDirectory,'manifest.json')),receipt=read(path.join(baselineDirectory,'deployment.json'));
  verifyBaseline(manifest,receipt,run);
  const projectionFile=path.join(baselineDirectory,'frontend-proof-anchor.json');
  // A missing projection on the first tooling follow-on requires full release.
  // Malformed/provided evidence is rejected instead of silently downgrading.
  if(!existsSync(projectionFile))return {eligibility:{kind:'full',requiredTier:'extended',reason:'no-published-full-anchor'}};
  const projection=assertUIProofProjection(read(projectionFile),{manifest,run});
  const baseline={manifest,receipt,binding:{repository,runId:run.id,runAttempt:run.runAttempt,artifactId:run.artifactId,
    controlCommit:run.controlCommit,sourceCommit:manifest.releaseCommit,manifestHash:evidenceHash(manifest),receiptHash:evidenceHash(receipt),completedAt:run.completedAt}};
  const worker=components.worker,rows=inventory(path.resolve(repo,worker.context),ignorePolicy(readFileSync(path.join(repo,worker.ignore),'utf8')));
  // Exact current Docker input inventory is a conservative superset of the
  // actual compiler graph. It may widen, never narrow, worker impact checks.
  const workerInputs={sourceCommit:candidate,artifactHash:manifest.rulesArtifactHash,paths:rows.map(row=>path.posix.join(worker.context==='.'?'':worker.context,row.path)).sort()};
  const testCatalog=execFileSync('git',['ls-files','frontend/src/*.test.tsx','frontend/src/**/*.test.tsx'],{cwd:repo,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
  const planning=prepareFrontendVerification({repo,candidate,repository,config,baseline,baselineFile:path.join(baselineDirectory,'manifest.json'),
    fullAnchor:projection.originalAnchor,previousDomain:projection.domain,candidateDomain:projection.domain,workerInputs,testCatalog});
  return {...planning,executionProfile:projection.executionProfile};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [command,...args]=process.argv.slice(2),repository=process.env.GITHUB_REPOSITORY;
  if(command==='discover'){
    const [output]=args;if(args.length!==1)throw Error('Expected discovery output');
    const allowed=process.env.FRONTEND_SELECTIVE_ENABLED==='true'&&process.env.GITHUB_EVENT_NAME==='push'&&process.env.GITHUB_REF==='refs/heads/main';
    const run=allowed?await selectLatestDeployedRun(githubReader(repository,process.env.GITHUB_TOKEN),{repository}):null;save(output,{schemaVersion:1,enabled:allowed,run});
    process.stdout.write(`artifact_id=${run?.artifactId??''}\nrun_id=${run?.id??''}\n`);
  }else if(command==='plan'){
    const [repo,configFile,discoveryFile,baselineDirectory,output]=args;if(args.length!==5)throw Error('Expected source, config, discovery, downloaded baseline and output');
    const discovery=read(discoveryFile),candidate=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
    const planning=discovery.enabled?await loadPublishedUIPlanning({get:githubReader(repository,process.env.GITHUB_TOKEN),repository,run:discovery.run,baselineDirectory,repo:path.resolve(repo),candidate,config:read(configFile)}):{eligibility:{kind:'full',requiredTier:'extended',reason:'selective-policy-disabled'}};
    save(output,planning);process.stdout.write(`verification_mode=${planning.eligibility.kind}\n`);
  }else throw Error('Unknown UI CI transport command');
}
