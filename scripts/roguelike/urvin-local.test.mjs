// Real route assertions moved intact to the mandatory owned Urvin gate.
// This file verifies the entry boundary without reaching any default server.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkUrvinAcceptance} from '../testing/urvin-acceptance.mjs';

test('Urvin route acceptance refuses an absent owned stack before network',async t=>{
  let contacted=false;
  t.mock.method(globalThis,'fetch',async()=>{contacted=true;throw Error('Unexpected network');});
  await assert.rejects(checkUrvinAcceptance(undefined,{part:'route'}),/runner-owned stack/);
  assert.equal(contacted,false);
});
