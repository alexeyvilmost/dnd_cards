import assert from 'node:assert/strict';
import path from 'node:path';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {checkUpgradeBaselines as runMatrix} from '../testing/check-upgrade-baselines.mjs';

// Upgrade cases require distinct empty owned databases. They reuse the selected
// toolchain and never point migration DDL at the active application's database.
export async function checkUpgradeBaselines(stack,_options={},tools={}){
  const context=await localAcceptanceContext(stack.env);
  const output=path.join(context.registry.directory,'supported-upgrade-matrix');
  const report=await runMatrix({output,go:tools.go,pgBin:tools.pgBin,race:stack.env.TEST_GO_RACE==='1'});
  assert.equal(report.status,'passed');assert.equal(report.historicalChainVerified,false);
  assert.deepEqual(report.cases.map(row=>row.baseline),[297,298,299]);
  for(const row of report.cases){assert.equal(row.status,'passed');assert.equal(row.cleanup,'stopped');}
  return {status:'passed',cases:3,historicalChainVerified:false,race:report.race,report:path.join(output,'report.json'),
    baselines:report.cases.map(row=>({baseline:row.baseline,runId:row.runId,finalSchemaHash:row.finalSchemaHash,cleanup:row.cleanup}))};
}
