import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startTestStack} from '../testing/stack.mjs';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {createScenarioAPI} from './scenarios.mjs';

// This acceptance reads seeded catalogs through the same authenticated HTTP
// endpoints as the library. Aggregates must describe the permission-filtered
// catalog and never merely count the currently loaded page.
export async function checkLibrary(stack) {
  const context=await localAcceptanceContext(stack.env), api=await createScenarioAPI(context);
  const statuses=['verified','verified_partial','not_verified','not_tested','narrative','partial_narrative_verified','partial_narrative_not_verified','partial_narrative_verified_partial'];
  const results=[];
  for(const catalog of ['cards','actions','effects','spells','feats','backgrounds','races','classes','resources','variables','concepts']) {
    const baseline=await api.request('GET',`/${catalog}?page=1&limit=1&fields=list`);
    const first=await api.request('GET',`/${catalog}?page=1&limit=1&fields=list&review_summary=true`);
    assert.ok(first.review_summary,`${catalog} omitted counts`);
    assert.equal(first.review_summary.total,baseline.total);
    assert.equal(statuses.reduce((total,status)=>total+first.review_summary.counts[status],0),baseline.total);
    assert.deepEqual(first[catalog],baseline[catalog],`${catalog} aggregate changed projection`);
    const selected=statuses.filter(status=>first.review_summary.counts[status]>0).slice(0,2);
    if(selected.length){
      const query=`fields=list&limit=1&review_summary=true&review_status=${selected.join(',')}`;
      const filtered=await api.request('GET',`/${catalog}?page=1&${query}`);
      assert.equal(filtered.total,selected.reduce((n,status)=>n+first.review_summary.counts[status],0));
      assert.deepEqual(filtered.review_summary,first.review_summary);
      if(filtered.total>1){const next=await api.request('GET',`/${catalog}?page=2&${query}`);assert.equal(next[catalog].length,1);assert.notEqual(next[catalog][0].id,filtered[catalog][0].id);}
    }
    results.push({catalog,total:baseline.total,page_size:first[catalog].length,statuses:8});
  }
  await writeFile(path.join(stack.registry.directory,'library-review.json'),JSON.stringify({run_id:stack.registry.runId,status:'passed',catalogs:results},null,2));
  return {catalogs:results.length,status:'passed'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const stack=await startTestStack({profile:'integration',reuseBuild:true});
  try{console.log(JSON.stringify({runId:stack.registry.runId,...await checkLibrary(stack)}));}
  finally{await stack.cleanup();}
}
