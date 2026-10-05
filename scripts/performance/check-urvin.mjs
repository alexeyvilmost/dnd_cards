import assert from 'node:assert/strict';
import {checkUrvinAcceptance as runAcceptance} from '../testing/urvin-acceptance.mjs';

export const requiredUrvinChecks=[
  'aura-phoenix','aura-restoration','aura-ferocity','aura-wealth','aura-solitude',
  'wealth-once','source-independent-copies','peer-ownership','route-and-room-gates','route-combat-reload-retry',
  'treasure-xp-loot-once','shop-buy-once-and-close','pass-canonical-rest-once','camp-canonical-rest-once',
  'elite-original-guardian-compiles','elite-actual-victory-reward-retry','boss-original-guardian-compiles','boss-actual-victory-reward-retry',
  'event-sleeping-goblins-quiet','event-sleeping-goblins-force','event-drowned-purse-recover','event-wayside-healer-help',
  'event-sealed-shrine-ritual','event-broken-bridge-balance','event-broken-bridge-repair','ambush-checkpoint-defeat-retry','source-sheets-unchanged',
];
export function verifyUrvinReport(report,runId){
  assert.equal(report?.schemaVersion,1);assert.equal(report.status,'passed');assert.equal(report.execution,'native-owned-api');assert.equal(report.part,'all');
  assert.equal(report.runId,runId);assert.match(report.artifactHash,/^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(report.checks.map(row=>row.id),requiredUrvinChecks);
  assert.ok(report.checks.every(row=>row.status==='passed'));assert.ok(report.createdRuns>0);
  assert.equal(report.fixture?.historicalChainVerified,false);assert.match(report.fixture.fixtureHash,/^sha256:[a-f0-9]{64}$/);
  assert.equal(report.fixtureCleanup?.status,'restored');assert.equal(report.fixtureCleanup.sharedCatalogUnchanged,true);assert.equal(report.fixtureCleanup.sharedSettingsUnchanged,true);
  return report;
}
export async function checkUrvinAcceptance(stack){return verifyUrvinReport(await runAcceptance(stack),stack.registry.runId);}
