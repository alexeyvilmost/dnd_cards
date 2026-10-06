// The preview observes each exact image at its manifest policy. Format probes
// may change only the three writer flags; all other runtime settings stay bound.
import assert from 'node:assert/strict';
import {evidenceHash,requiredWriterOutcomes,writerPolicy} from './validate-manifest.mjs';
import {validateExecutionProfile} from './ui-execution-profile.mjs';
const same=(a,b)=>assert.equal(evidenceHash(a),evidenceHash(b),'Writer runtime profile differs');
const flags=policy=>({DB_COMPACT_RECEIPTS:policy.compactReceipts?'1':'0',DB_FROZEN_CATALOGS:'0',IMAGE_JOBS_ENABLED:policy.imageJobs?'1':'0'});
export function validateWriterPreviewProfiles(binding){
 const profiles=binding.executionProfile;
 assert.ok(profiles&&typeof profiles==='object'&&!Array.isArray(profiles));
 assert.deepEqual(Object.keys(profiles).sort(),['candidate','previous']);
 for(const role of ['candidate','previous']){
  if(role==='previous'&&!binding.previous){assert.equal(profiles.previous,null);continue;}
  const profile=validateExecutionProfile(profiles[role]),identity=binding[role]?.identities;
  for(const component of ['backend','rulesWorker'])same(profile[component].instance,{releaseId:identity[component].releaseId,releaseCommit:identity[component].releaseCommit});
  const expected=flags(role==='candidate'?binding.writerPolicy:writerPolicy(binding.previous.state.manifest));
  for(const [key,value]of Object.entries(expected))assert.equal(profile.backend.environment[key],value,'Preview must reflect actual manifest policy');
 }
 return profiles;
}
export function expectedWriterBrowserProfiles(binding){
 const profiles=structuredClone(validateWriterPreviewProfiles(binding));
 assert.ok(profiles.previous,'Exact previous image profile required for browser compatibility');
 const required=requiredWriterOutcomes({writerPolicy:binding.writerPolicy},binding.previous.state.manifest,binding.previous.identities);
 Object.assign(profiles.candidate.backend.environment,flags({compactReceipts:required.includes('compact-receipt-cross-image-retry'),imageJobs:required.includes('image-job-cross-image-retry')}));
 Object.assign(profiles.previous.backend.environment,flags({compactReceipts:false,imageJobs:false}));
 return profiles;
}
