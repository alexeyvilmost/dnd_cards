import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCanonicalPendingScenario,createRehearsalAccount,authorizeNativeRehearsal,authorizeDockerRehearsal,rehearsalRequestFailure} from './rehearsal-scenarios.mjs';

test('rehearsal failures identify the operation without account IDs or private response fields',()=>{
  const failure=rehearsalRequestFailure(409,'/roguelike/runs/12345678-1234-1234-1234-123456789abc/commands','POST',
    {type:'combat_intent',payload:{intent:{type:'approach_action'},token:'private-token'}},
    {code:'combat_worker_rejected',error:'private detail',state:{entropy:'private seed'}});
  assert.equal(failure.message,'Owned canonical API returned HTTP 409: POST /roguelike/runs/:id/commands (combat_intent, approach_action, combat_worker_rejected)');
  assert.equal(rehearsalRequestFailure(422,'/auth/login','POST',{type:'private token'}, {code:'private response'}).message,
    'Owned canonical API returned HTTP 422: POST /auth/login');
});

test('arbitrary HTTP callbacks and serialized/lookalike capabilities cannot register users',async()=>{
  let calls=0;const request=async()=>{calls++;throw Error('Must not access network');};
  for(const capability of [request,{},Object.freeze({kind:'owned-rehearsal'}),{request,assertOwned:async()=>{}},null,undefined]){
    await assert.rejects(createCanonicalPendingScenario(capability,{label:'guard negative'}),/owned rehearsal capability/);
    await assert.rejects(createRehearsalAccount(capability,{label:'browser account negative'}),/owned rehearsal capability/);
  }
  assert.equal(calls,0);
});
test('native registry and generated Docker namespace are required before authorization',async()=>{
  await assert.rejects(authorizeNativeRehearsal({env:{}}),/runner|stack/);
  await assert.rejects(authorizeDockerRehearsal({owner:'production',names:{}}),/Generated Docker/);
  const owner=`rehearsal_${'a'.repeat(24)}`;
  await assert.rejects(authorizeDockerRehearsal({owner,names:{postgres:`${owner}_db`,backend:'production',rulesWorker:`${owner}_worker`,network:`${owner}_net`}}),/Generated Docker/);
});
