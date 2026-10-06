#!/usr/bin/env node
// Read-only latest-attempt publication discovery. A successful no-op workflow
// never supplies an older candidate artifact or creates a deployment attempt.
import {writeFileSync} from 'node:fs';
import path from 'node:path';import {fileURLToPath} from 'node:url';
import {verifyRun} from './ci-release.mjs';import {githubReader} from './ui-ci.mjs';
const positive=v=>Number.isSafeInteger(v)&&v>0;
const time=value=>{const match=typeof value==='string'&&/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);if(!match)return NaN;const canonical=`${match[1]}.${(match[2]??'').padEnd(3,'0')}Z`,parsed=Date.parse(canonical);return Number.isFinite(parsed)&&new Date(parsed).toISOString()===canonical?parsed:NaN;};
async function all(get,route,key){let total;const rows=[],ids=new Set();for(let page=1;page<=100;page++){
 const value=await get(`${route}${route.includes('?')?'&':'?'}per_page=100&page=${page}`),batch=value?.[key];
 if(!positive(value?.total_count)&&value?.total_count!==0||!Array.isArray(batch)||batch.length>100||total!==undefined&&total!==value.total_count)throw Error('Incomplete publication metadata');
 total=value.total_count;if(!batch.length&&rows.length!==total||rows.length+batch.length>total)throw Error('Incomplete publication pagination');
 for(const row of batch){if(!positive(row?.id)||ids.has(row.id))throw Error('Ambiguous publication metadata');ids.add(row.id);rows.push(row);}if(rows.length===total)return rows;
 }throw Error('Publication pagination bound reached');}
export async function discoverPublishedCandidate(get,{runId,repository,now=Date.now()}){
 if(!positive(Number(runId))||!Number.isFinite(now))throw Error('Exact release run required');
 const raw=await get(`actions/runs/${runId}`),run={...verifyRun(raw,{repository,kind:'release'}),runAttempt:raw.run_attempt};
 if(!positive(run.runAttempt))throw Error('Exact release attempt required');
 const jobs=await all(get,`actions/runs/${run.id}/jobs?filter=latest`,'jobs'),publish=jobs.filter(row=>row.name==='publish');
 if(publish.length!==1)throw Error('Publication job is missing or ambiguous');const job=publish[0];
 if(job.run_id!==run.id||job.run_attempt!==run.runAttempt||job.head_sha!==run.controlCommit||job.status!=='completed')throw Error('Publication job belongs to another attempt');
 let result;
 if(job.conclusion==='skipped')result={schemaVersion:1,kind:'release-publication',available:false,reason:'publication-skipped',run,artifactId:null,createCandidate:false,deploy:false,advanceBaseline:false};
 else{
  if(job.conclusion!=='success')throw Error('Publication did not succeed');
  const start=time(job.started_at),end=time(job.completed_at);if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end>now)throw Error('Invalid publication dates');
  const artifacts=(await all(get,`actions/runs/${run.id}/artifacts`,'artifacts')).filter(row=>row.name==='release-candidate');
  if(artifacts.length!==1)throw Error('Exact published candidate is missing or ambiguous');const artifact=artifacts[0],created=time(artifact.created_at),expires=time(artifact.expires_at);
  if(artifact.expired!==false||!positive(artifact.size_in_bytes)||artifact.workflow_run?.id!==run.id||artifact.workflow_run?.head_sha!==run.controlCommit||!Number.isFinite(created)||created<start||created>end||!Number.isFinite(expires)||expires<=now)throw Error('Candidate artifact is expired or from another attempt');
  result={schemaVersion:1,kind:'release-publication',available:true,run,artifactId:artifact.id};
 }
 const after=await get(`actions/runs/${run.id}`),fresh={...verifyRun(after,{repository,kind:'release'}),runAttempt:after.run_attempt};
 if(JSON.stringify(run)!==JSON.stringify(fresh))throw Error('Release attempt changed during publication discovery');return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [runId,repository,output,...extra]=process.argv.slice(2);if(!output||extra.length)throw Error('Expected release run, repository and verified-run output');
 const result=await discoverPublishedCandidate(githubReader(repository,process.env.GITHUB_TOKEN),{runId,repository});
 writeFileSync(output,JSON.stringify({...result.run,artifactId:result.artifactId},null,2)+'\n',{flag:'wx'});
 process.stdout.write(`candidate_available=${result.available}\nartifact_id=${result.artifactId??''}\n`);
}
