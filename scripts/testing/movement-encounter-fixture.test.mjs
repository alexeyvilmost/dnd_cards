import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertUninitializedMovementEncounter,updateTrainingEntity,restoreTrainingEntities} from './movement-encounter-fixture.mjs';
const owner='72000000-0000-4000-8000-000000000001';
const run={id:'72000000-0000-4000-8000-000000000002',revision:1,phase:'combat',encounter:{number:1}};
test('movement scenery fixture permits only a just-created uninitialized encounter',()=>{
  assert.doesNotThrow(()=>assertUninitializedMovementEncounter(run,owner));
  for(const patch of [{revision:0},{revision:2},{phase:'camp'},{combat_state:{}},{encounter:null},{id:"x'; SELECT 1;--"}]){
    assert.throws(()=>assertUninitializedMovementEncounter({...run,...patch},owner));
  }
  assert.throws(()=>assertUninitializedMovementEncounter(run,'foreign-invalid-owner'));
});
test('unknown response after a committed write still restores original mechanics and nonempty name_en',async()=>{
  const original={id:owner,source:'Local tests',name_en:'Training attack',mechanics:{value:7}};
  let stored=structuredClone(original),lost=true;
  const api={async request(method,_resource,body){
    if(method==='PUT'){stored={...stored,...body};if(lost){lost=false;throw Error('simulated response loss after commit');}}
    return structuredClone(stored);
  }};
  const changes=[];
  await assert.rejects(updateTrainingEntity(api,changes,'actions',original,{mechanics:{value:0}}));
  assert.equal(changes.length,1);assert.equal(stored.name_en,original.name_en);
  await restoreTrainingEntities(api,changes);
  assert.deepEqual(stored,original);
});
test('one restore failure cannot abandon remaining declarations or temporary effect cleanup',async()=>{
  const first={resource:'/actions/a',restore:{mechanics:{value:1}},expected:{mechanics:{value:1}}};
  const second={resource:'/actions/b',restore:{mechanics:{value:2}},expected:{mechanics:{value:2}}};
  const calls=[];
  const api={async request(method,resource,body){
    calls.push(`${method} ${resource}`);
    if(resource===second.resource)throw Error('simulated unavailable entity');
    return method==='GET'?first.restore:body;
  }};
  await assert.rejects(restoreTrainingEntities(api,[first,second],owner),AggregateError);
  assert.deepEqual(calls,[`PUT ${second.resource}`,`GET ${second.resource}`,`PUT ${first.resource}`,`GET ${first.resource}`,`DELETE /effects/${owner}`,`GET /effects/${owner}`]);
});
test('successful PUT without restored values fails reread verification',async()=>{
  const change={resource:'/actions/a',restore:{name_en:'Original'},expected:{name_en:'Original'}};
  await assert.rejects(restoreTrainingEntities({async request(){return {name_en:null};}},[change]),AggregateError);
});
