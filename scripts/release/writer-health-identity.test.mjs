import {test} from 'node:test';import assert from 'node:assert/strict';
import {writerHealthIdentity,historyWriterPolicy} from './writer-health-identity.mjs';
test('health clock projection retains every source and launch field',()=>{
 const base={status:'ok',timestamp:1,sourceCommit:'one',releaseCommit:'two',releaseId:'three',readerCapabilities:['receipt-v2'],futureProof:'retained'};
 assert.deepEqual(writerHealthIdentity(base,'backend'),writerHealthIdentity({...base,timestamp:2},'backend'));
 assert.notDeepEqual(writerHealthIdentity(base,'backend'),writerHealthIdentity({...base,releaseId:'other'},'backend'));
 assert.equal(writerHealthIdentity(base,'backend').futureProof,'retained');assert.equal(writerHealthIdentity(base,'frontend'),base);
 for(const bad of [{...base,status:'failed'},{...base,timestamp:'2'},null,[]])assert.throws(()=>writerHealthIdentity(bad,'backend'));
 assert.deepEqual(historyWriterPolicy,{compactReceipts:false,imageJobs:false,frozenCatalogs:false});assert.ok(Object.isFrozen(historyWriterPolicy));
});
