import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectHostWriterStage} from './writer-host-stage.mjs';
import {safeWriterFailure} from './writer-failure-diagnostics.mjs';

test('missing published fixture refuses before work and carries a fixed identity stage',async()=>{
 await assert.rejects(collectHostWriterStage({publishedCandidate:{}},{}),error=>{
  assert.equal(error.code,'WRITER_FIXTURE_UNAVAILABLE');
  assert.deepEqual(safeWriterFailure(error),{phase:'identity-fixture'});
  return true;
 });
});
