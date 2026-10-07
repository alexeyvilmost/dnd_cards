import assert from 'node:assert/strict';
import path from 'node:path';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {checkHistoricalFresh as runHistoricalChain} from '../testing/check-historical-fresh.mjs';

// The shared application stack authenticates this gate's owner; migration DDL
// runs in a second disposable cluster and never reaches that application's DB.
export async function checkHistoricalFresh(stack, _options = {}, tools = {}) {
  const context = await localAcceptanceContext(stack.env);
  const output = path.join(context.registry.directory, 'historical-fresh');
  const report = await runHistoricalChain({output, go: tools.go, pgBin: tools.pgBin});
  assert.equal(report.status, 'passed');
  assert.equal(report.freshInstallAcceptance, true);
  assert.equal(report.historicalChainVerified, true);
  assert.equal(report.cleanup.status, 'stopped');
  assert.deepEqual(report.cleanup.errors, []);
  assert.equal(report.checks.allThreeArchivedPreimagesExact, true);
  assert.equal(report.checks.repeatAllPublicRowsExact, true);
  assert.equal(report.checks.sourceCodeUnchanged, true);
  return {status: 'passed', historicalChainVerified: true, freshInstallAcceptance: true,
    migrations: report.final.ledgerRows, revocations: report.final.revocations,
    sourceDumpHash: report.sourceDumpHash, archivedRevocationManifestHash: report.archivedRevocationManifestHash,
    repeat: report.final.allTablesAfterRepeat, cleanup: report.cleanup,
    unicodeLocale: report.unicodeLocale, report: path.join(output, 'report.json')};
}
