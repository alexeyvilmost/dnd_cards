import path from 'node:path';
import assert from 'node:assert/strict';
import {collectWriterCompatibility} from './writer-compatibility.mjs';
import {writerPolicy,evidenceHash} from './validate-manifest.mjs';
import {compactCommandIO} from './compact-command-fixtures.mjs';
import {imageJobCommandIO} from './image-job-command-fixtures.mjs';
import {probeCompactReceipts} from './compact-writer-probe.mjs';
import {probeImageJobs} from './image-job-writer-probe.mjs';
import {probeExpandedWriterRestore} from './expanded-writer-restore.mjs';
import {probeWriterPolicySequence} from './writer-policy-sequence.mjs';
import {markWriterFailure} from './writer-failure-diagnostics.mjs';

// Public format fixtures and the restored captured user DB are intentionally
// separate capabilities. No writer driver receives the full-history SQL handle.
export async function collectHostWriterStage(input,{directory,postgresImage,runId,retainedHistory}){
 if(!input.publishedCandidate?.writerFixture)throw markWriterFailure(Object.assign(Error('Hosted public writer fixture is missing'),{code:'WRITER_FIXTURE_UNAVAILABLE'}),{phase:'identity-fixture'});
 let createHostedWriterFixture;
 try{({createHostedWriterFixture}=await import('./writer-fixture-package.mjs'));}
 catch(error){if(error.code==='ERR_MODULE_NOT_FOUND')throw markWriterFailure(Object.assign(Error('Hosted writer fixture producer is not implemented'),{code:'WRITER_FIXTURE_UNAVAILABLE',cause:error}),{phase:'identity-fixture'});throw markWriterFailure(error,{phase:'identity-fixture'});}
 const cleanups=[];let preview,result,failure;
 async function fixture(label){return createHostedWriterFixture({candidate:input.publishedCandidate,active:input.active,verifiedReleaseRun:input.verifiedReleaseRun,directory:path.join(directory,'writer-'+label),postgresImage});}
 async function cleanup(value){const actual=await value.cleanup();cleanups.push(actual);if(actual.status!=='stopped'||actual.errors?.length)throw Error('Owned public writer fixture cleanup incomplete');}
 async function one(label,binding,probe){
  let value,failed,answer,phase='probe-fixture';
  try{value=await fixture(label);phase='probe-preflight';assert.equal(value.adapter.execution,'docker');assert.ok(Array.isArray(value.rollInfluences)&&value.rollInfluences.length>0,'Exact candidate rule data required');const compactIO=await compactCommandIO(value.adapter,value.accounts,binding,{rollInfluences:value.rollInfluences}),jobsIO=await imageJobCommandIO(value.adapter,value.accounts,binding);phase='probe-execution';answer=await probe({adapter:value.adapter,compactIO,jobsIO});}
  catch(error){failed=markWriterFailure(error,{phase});}finally{if(value)try{await cleanup(value);}catch(error){if(failed)markWriterFailure(failed,{cleanupFailed:true});else failed=markWriterFailure(error,{phase:'probe-cleanup'});}}
  if(failed)throw failed;return answer;
 }
 async function start(role,policy){await preview.adapter.start({role,...policy,releaseId:(role==='candidate'?input.manifest:input.previousManifest).releaseId});return preview.adapter.observe();}
 let phase='identity-fixture';
 try{
  preview=await fixture('identity');
  phase='candidate-start';const candidate=await start('candidate',writerPolicy(input.manifest));await preview.adapter.stopApplications();
  phase='previous-start';const previous=await start('previous',writerPolicy(input.previousManifest));await preview.adapter.stopApplications();
  phase='collector';
  result=await collectWriterCompatibility(input,{
   observeCandidate:async()=>candidate,observePrevious:async()=>previous,
   assertOwnedImages:()=>preview.adapter.assertOwned(),retainedHistory,
   restoreCandidateAndObserve:async()=>{await preview.adapter.stopApplications();const observed=await start('candidate',writerPolicy(input.manifest));assert.equal(evidenceHash(observed.images),evidenceHash(candidate.images));return observed;},
   drivers:{
    'compact-receipt-cross-image-retry':binding=>one('compact',binding,({compactIO})=>probeCompactReceipts(binding,compactIO)),
    'image-job-cross-image-retry':binding=>one('jobs',binding,({jobsIO})=>probeImageJobs(binding,jobsIO)),
    'frontend-pending-job-reload':binding=>preview.browserTrace(binding),
    'expanded-data-dump-restore':binding=>one('expanded',binding,async io=>(await probeExpandedWriterRestore({binding,...io})).trace),
    'enabled-off-enabled-rollback':binding=>one('policy',binding,io=>probeWriterPolicySequence({binding,...io})),
   },
  },{runId});
 }catch(error){failure=markWriterFailure(error,{phase});}finally{if(preview)try{await cleanup(preview);}catch(error){if(failure)markWriterFailure(failure,{cleanupFailed:true});else failure=markWriterFailure(error,{phase:'identity-cleanup'});}}
 if(failure)throw failure;
 return {...result,formatFixtureCleanup:{status:'stopped',executions:cleanups.length},formatScope:'separate-public-owned-fixture'};
}
