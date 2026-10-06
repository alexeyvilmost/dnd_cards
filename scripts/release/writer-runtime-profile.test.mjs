import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pair,off,refresh} from './writer-policy-unit-fixture.mjs';
import {writerTraceBinding} from './writer-traces.mjs';
import {evidenceHash,assertReleaseReady} from './validate-manifest.mjs';
import {validateWriterPreviewProfiles,expectedWriterBrowserProfiles} from './writer-runtime-profile.mjs';
const binding=f=>writerTraceBinding(f.candidate,f.check,f.bundle.rehearsalReceipt);
test('OFF reader lineage retains format probes while only writer flags change from observed preview',()=>{
 const f=pair(off,off),b=binding(f);b.executionProfile.candidate.backend.environment.RULES_PREPARATION_CACHE_ENABLED='1';b.executionProfile.previous.rulesWorker.environment.RULES_WORKER_MAX_CACHED_ARTIFACTS='7';
 validateWriterPreviewProfiles(b);const expected=expectedWriterBrowserProfiles(b);
 assert.equal(b.executionProfile.candidate.backend.environment.IMAGE_JOBS_ENABLED,'0');
 assert.equal(expected.candidate.backend.environment.IMAGE_JOBS_ENABLED,'1');assert.equal(expected.candidate.backend.environment.DB_COMPACT_RECEIPTS,'1');
 assert.equal(expected.previous.backend.environment.IMAGE_JOBS_ENABLED,'0');assert.equal(expected.candidate.backend.environment.RULES_PREPARATION_CACHE_ENABLED,'1');
 assert.equal(expected.previous.rulesWorker.environment.RULES_WORKER_MAX_CACHED_ARTIFACTS,'7');
 assert.deepEqual(expected.previous.backend.instance,b.executionProfile.previous.backend.instance);
 const c=pair({compactReceipts:true,imageJobs:false,frozenCatalogs:false},undefined,{compactReceipts:true,imageJobs:false,frozenCatalogs:false});
 assert.equal(expectedWriterBrowserProfiles(binding(c)).candidate.backend.environment.IMAGE_JOBS_ENABLED,'0');
});
test('missing previews, wrong manifest policy, changed launch or private settings are rejected',()=>{
 for(const mutate of [b=>delete b.executionProfile,b=>b.executionProfile.previous=null,b=>b.executionProfile.secret='PRIVATE_CANARY',b=>b.executionProfile.candidate.backend.environment.DB_COMPACT_RECEIPTS='0',b=>b.executionProfile.previous.rulesWorker.instance.releaseId='wrong',b=>b.executionProfile.candidate.backend.environment.DATABASE_URL='PRIVATE_CANARY']){
  const b=binding(pair());mutate(b);assert.throws(()=>validateWriterPreviewProfiles(b));
 }
});
test('coherently rehashed hosted profiles cannot alter nonwriter behavior, limits or selected writer format',()=>{
 for(const mutate of [p=>p.candidate.backend.environment.RULES_CATALOG_BATCH_ENABLED='1',p=>p.previous.backend.environment.RULES_WORKER_MAX_INFLIGHT='5',p=>p.candidate.rulesWorker.environment.RULES_WORKER_MAX_CACHED_ARTIFACTS='9',p=>p.candidate.backend.environment.DB_COMPACT_RECEIPTS='0']){
  const f=pair();assertReleaseReady(f.candidate,f.bundle);const trace=f.check.traces.find(t=>t.outcomeId==='frontend-pending-job-reload');mutate(trace.proof.executionProfile);
  trace.proofHash=evidenceHash(trace.proof);f.check.outcomes.find(o=>o.id===trace.outcomeId).traceHash=evidenceHash(trace);refresh(f.candidate,f.bundle);
  assert.throws(()=>assertReleaseReady(f.candidate,f.bundle),/profile|another input/);
 }
});
