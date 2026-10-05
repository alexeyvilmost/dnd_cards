// Room/reward/checkpoint assertions run through checkUrvinAcceptance on a real
// owned API, worker and PostgreSQL. This guard is safe in the pre-stack Node tier.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkUrvinAcceptance} from '../testing/urvin-acceptance.mjs';

test('Urvin room acceptance refuses a caller-supplied HTTP-only adapter',async t=>{
  let contacted=false;
  t.mock.method(globalThis,'fetch',async()=>{contacted=true;throw Error('Unexpected network');});
  await assert.rejects(checkUrvinAcceptance({request:()=>{contacted=true;}},{part:'rooms'}),/runner-owned stack/);
  assert.equal(contacted,false);
});
