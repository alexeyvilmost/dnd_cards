#!/usr/bin/env node
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {githubReader} from './ui-ci.mjs';
import {readConvergenceBaseline,preflightAutomaticDeployment,planReconciliation,dispatchReconciliation,verifyReconciledCI} from './automatic-convergence.mjs';
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const save=(file,value)=>{mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});};
export async function withExclusiveDispatchMarker(output,request,send){
  save(output,{status:'dispatch-attempt-started',key:request.key,source:request.source});
  return send();
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [command,...args]=process.argv.slice(2),env=process.env,repository=env.GITHUB_REPOSITORY,get=githubReader(repository,env.GITHUB_TOKEN);
  const emit=value=>process.stdout.write(value+'\n');
  if(command==='discover'){
    const [output]=args;if(args.length!==1)throw Error('Expected discovery output');
    const latest=await readConvergenceBaseline(get,repository);save(output,latest);
    emit(`run_id=${latest?.id??''}\nartifact_id=${latest?.artifactId??''}`);
  }else if(command==='preflight'){
    const [candidateDir,releaseRunFile,latestFile,baselineDir,output]=args;if(args.length!==5)throw Error('Expected candidate, run, latest, baseline and output');
    const latest=read(latestFile),result=await preflightAutomaticDeployment({eventName:env.GITHUB_EVENT_NAME,repository,get,
      candidate:read(path.join(candidateDir,'candidate.json')),releaseRun:read(releaseRunFile),latest,
      ...(latest?{manifest:read(path.join(baselineDir,'manifest.json')),receipt:read(path.join(baselineDir,'deployment.json'))}:{})});
    save(output,result);emit(`candidate_available=${result.candidateAvailable}\npreflight_status=${result.status}`);
  }else if(command==='plan'){
    const [policyFile,latestFile,baselineDir,output]=args;if(args.length!==4)throw Error('Expected policy, latest, baseline and output');
    const latest=read(latestFile),policy=read(policyFile),result=await planReconciliation({event:read(env.GITHUB_EVENT_PATH),eventName:env.GITHUB_EVENT_NAME,repository,
      controlCommit:env.GITHUB_SHA,runId:Number(env.GITHUB_RUN_ID),runAttempt:Number(env.GITHUB_RUN_ATTEMPT),variables:env,policy,latest,get,
      ...(latest?{manifest:read(path.join(baselineDir,'manifest.json')),receipt:read(path.join(baselineDir,'deployment.json'))}:{})});
    save(output,result);emit(`status=${result.status}\nclaim_name=${result.claimName??''}`);
  }else if(command==='dispatch'){
    const [policyFile,planFile,output]=args;if(args.length!==3)throw Error('Expected policy, immutable request and output');
    const plan=read(planFile);if(plan.status!=='planned')throw Error('Planned convergence request required');
    let attempted=false;
    const post=async(route,body)=>{
      if(route!=='actions/workflows/ci.yml/dispatches'||body.ref!=='main'||body.inputs?.suite!=='extended')throw Error('Only a fresh full main CI dispatch is allowed');
      // Exclusive local marker also prevents re-executing this CLI in the same
      // attempt workspace after a crash. The remote claim survives the runner.
      await withExclusiveDispatchMarker(output,plan.request,async()=>{
      attempted=true;
      const response=await fetch(`https://api.github.com/repos/${repository}/${route}`,{method:'POST',headers:{Authorization:`Bearer ${env.GITHUB_TOKEN}`,
        Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      if(response.status!==204)throw Error(`Dispatch not confirmed (${response.status}); inspect claim, never blindly retry`);
      });
    };
    const result=await dispatchReconciliation({request:plan.request,get,post,variables:env,policy:read(policyFile)});
    if(attempted)writeFileSync(output,JSON.stringify(result,null,2)+'\n');else save(output,result);emit(`status=${result.status}`);
  }else if(command==='ci-guard'){
    const [policyFile,output]=args;if(args.length!==2)throw Error('Expected policy and output');
    const event=read(env.GITHUB_EVENT_PATH),encoded=event.inputs?.reconcile_request;
    const result=encoded?await verifyReconciledCI({request:JSON.parse(encoded),eventName:env.GITHUB_EVENT_NAME,ref:env.GITHUB_REF,source:env.GITHUB_SHA,
      suite:event.inputs?.suite,get,variables:env,policy:read(policyFile)}):{status:'ordinary-ci'};
    save(output,result);emit(`status=${result.status}`);
  }else throw Error('Unknown convergence command');
}
