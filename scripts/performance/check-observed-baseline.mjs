import assert from 'node:assert/strict';
import path from 'node:path';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {checkObservedBaseline as runObserved} from '../testing/check-observed-baseline.mjs';

// This case requires its own imported297 database and observed legacy ledger;
// ordinary migration batches must route here, never skip or quarantine it.
export async function checkObservedBaseline(stack,_options={},tools={}) {
  const context=await localAcceptanceContext(stack.env);
  const output=path.join(context.registry.directory,'observed-legacy-baseline');
  const report=await runObserved({output,go:tools.go,pgBin:tools.pgBin,race:stack.env.TEST_GO_RACE==='1'});
  assert.equal(report.status,'passed');
  assert.equal(report.scope,'observed-full-schema297-additive-adoption');
  assert.equal(report.historicalChainVerified,false);
  assert.equal(report.cleanup?.status,'stopped');
  assert.deepEqual(report.cleanup.errors,[]);
  assert.match(report.runId,/^test_[a-f0-9]+$/);
  assert.match(report.artifactHash,/^sha256:[a-f0-9]{64}$/);
  assert.ok(Object.keys(report.fixtureSources??{}).length>0);
  return {status:'passed',tests:1,scope:report.scope,historicalChainVerified:false,
    runId:report.runId,race:report.race,cleanup:report.cleanup,report:path.join(output,'report.json')};
}
