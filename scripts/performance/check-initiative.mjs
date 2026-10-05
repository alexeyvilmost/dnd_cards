import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir, writeFile} from 'node:fs/promises';
import {startTestStack} from '../testing/stack.mjs';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {createScenarioAPI, createRunFixture, assertSame, digest, summarize} from './scenarios.mjs';

/** The API and worker execute real canonical options and initialization. The
 * PostgreSQL observer retains only hashes, never a seed or full private state. */
export async function checkInitiativeOptions(stack, {repetitions = 1} = {}) {
  const context = await localAcceptanceContext(stack.env), samples = [], outcomes = [];
  context.readRunInvariant = async runId => {
    assert.match(runId, /^[0-9a-f-]{36}$/i);
    return JSON.parse((await stack.database.query(`SELECT json_build_object('run',md5(row_to_json(r)::text),'character',md5(row_to_json(c)::text),'entropy',md5(combat_envelope#>>'{entropy,seed}'),'cursor',combat_envelope#>>'{entropy,cursor}','artifact',combat_envelope->>'artifactHash')::text FROM roguelike_runs r JOIN characters_v3 c ON c.id=r.character_id WHERE r.id='${runId}';`)).trim());
  };
  const api = await createScenarioAPI(context, {onSample: sample => samples.push(sample)});
  const peer = await createScenarioAPI(context, {role: 'peer'});
  for (const partySize of [1, 2, 6]) {
    const fixture = await createRunFixture(context, {partySize, api});
    await fixture.command('start_encounter');
    const before = await context.readRunInvariant(fixture.run.id);
    const resource = `/roguelike/runs/${fixture.run.id}/initiative-options?expected_revision=${fixture.run.revision}`;
    await peer.request('GET', resource, undefined, {status: 404});
    let first;
    for (let iteration = -1; iteration < repetitions; iteration++) {
      const result = await api.request('GET', resource, undefined,
        iteration >= 0 ? {scenario: `initiative_options_party_${partySize}`} : {});
      assert.equal(result.enabled, true, 'Enable the owned stack initiativeOptions feature for this gate');
      assert.equal(result.run_revision, fixture.run.revision);
      assert.equal(result.character_id, fixture.run.character_id);
      assert.ok(Array.isArray(result.options));
      assert.match(result.artifact_hash, /^sha256:[a-f0-9]{64}$/);
      if (first) assertSame(result, first, 'Read-only initiative offer drifted');
      first = result;
      assertSame(await context.readRunInvariant(fixture.run.id), before, 'Offer mutated run, character, entropy or artifact');
    }
    // The simple fighter fixture intentionally has no optional initiative cost.
    // Two independent paid declarations are exercised by initiativeOptions.test.ts.
    assert.equal(first.options.length, 0, 'Fixture acquired an unaccounted initiative option');
    const initialized = await fixture.command('initialize_combat', {}, {scenario: `initialize_after_options_party_${partySize}`});
    await api.request('GET', resource, undefined, {status: 409});
    outcomes.push({partySize, offerHash: digest(first), noOfferMutation: true,
      initializedHash: initialized.outcomeHash, privateInvariant: initialized.invariant, ...await fixture.verify()});
  }
  const report = {runId: stack.registry.runId, fixture: stack.registry.fixture, artifactHash: stack.registry.artifactHash,
    repetitions, samples, summary: summarize(samples), outcomes};
  const output = path.join(stack.registry.directory, 'initiative-options');
  await mkdir(output, {recursive: true}); await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  return {scenarios: outcomes.length, samples: samples.length, exactRetry: true, noOfferMutation: true};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stack = await startTestStack({profile: 'integration', reuseBuild: true, initiativeOptions: true, performance: true});
  try {console.log(JSON.stringify({runId: stack.registry.runId, result: await checkInitiativeOptions(stack,
    {repetitions: process.argv.includes('--measure') ? 30 : 1})}));}
  finally {await stack.cleanup();}
}
