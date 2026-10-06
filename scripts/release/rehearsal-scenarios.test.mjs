import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCanonicalPendingScenario,createRehearsalAccount,authorizeNativeRehearsal,authorizeDockerRehearsal} from './rehearsal-scenarios.mjs';

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
