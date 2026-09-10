import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createRulesWorker, snapshotHash} from './server.mjs';
import {replayCombatRecords} from './replay.mjs';

test('replays actual HTTP worker transitions, RNG and projected revisions after JSON export', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'combat-replay-'));
  const token = 'private-local-replay-test-token-32-characters';
  const artifactFile = new URL('./dist/artifact.cjs', import.meta.url);
  const artifact = createRequire(import.meta.url)(fileURLToPath(artifactFile));
  const server = await createRulesWorker({artifactFile, artifactsDirectory: directory, token});
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const post = async (endpoint, body) => {
      const response = await fetch(url + endpoint, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      assert.equal(response.status, 200);
      return response.json();
    };
    const input = JSON.parse(await readFile(new URL('../src/roguelike/pinnedFighter.fixture.json', import.meta.url), 'utf8'));
    Object.assign(input, {seed: 'journal-real-combat', roster: [{monster_id: 'enemy', quantity: 1}],
      monsters: {version: 1, effects: [], actions: [{id: 'slam', name: 'Slam', mechanics: {
        activation: {mode: 'active', cost: [{resource: 'action', amount: 1}]},
        targeting: {domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy']},
        effects: [{resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee', attack_bonus_override: 4, vs: 'ac', on_hit: [{kind: 'damage', amount: 3, type: 'bludgeoning'}]}],
      }}], monsters: [{id: 'enemy', name: 'Enemy', slug: 'enemy', size: 'medium', creature_type: 'humanoid', armor_class: 10, max_hp: 20, speed: 30, initiative_bonus: 0, proficiency_bonus: 2,
        abilities: {str: 14, dex: 10, con: 10, int: 10, wis: 10, cha: 10}, action_ids: ['slam'], effect_ids: [], ai: {strategy: 'tactical'}}]}});
    let result = await post('/initialize', {input});
    assert.equal(result.status, 'ready');
    const records = [{schemaVersion: 1, type: 'initialize_combat', artifactHash: result.envelope.artifactHash,
      baseline: result.envelope, baselinePosition: 'after', ...result.trace}];
    for (let i = 0; i < 3; i++) {
      const before = result.envelope;
      const intent = {type: 'end_turn', actorId: input.character.id};
      result = await post('/transition', {artifactHash: before.artifactHash, envelope: before, intent,
        character: {...input.character, runtime_revision: result.patch.runtime_revision}});
      assert.equal(result.trace.beforeHash, snapshotHash(before));
      records.push({schemaVersion: 1, type: 'combat_intent', artifactHash: before.artifactHash, intent,
        randomValues: result.randomValues, ...result.trace});
    }
    const exported = JSON.parse(JSON.stringify(records));
    const replay = replayCombatRecords(exported, artifact);
    assert.equal(replay.commands, 3);
    assert.deepEqual(replay.envelope, result.envelope);
    const rollout = exported.slice(1);
    rollout[0] = {...rollout[0], baseline: exported[0].baseline, baselinePosition: 'before'};
    assert.deepEqual(replayCombatRecords(rollout, artifact).envelope, result.envelope);
    assert.ok(exported.some(record => record.randomValues?.length), 'Must exercise actual dice');
    assert.throws(() => replayCombatRecords([exported[0], ...exported.slice(2)], artifact), /Missing or reordered/);
    const corrupt = structuredClone(exported);
    corrupt[1].afterHash = `sha256:${'0'.repeat(64)}`;
    assert.throws(() => replayCombatRecords(corrupt, artifact), /diverged/);
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(directory), tmpdir());
    assert.ok(path.basename(directory).startsWith('combat-replay-'));
    await rm(directory, {recursive: true, force: true});
  }
});


test('rest HTTP uses saved inputs and ignores forged runtime output', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'camp-rest-'));
  const token = 'private-local-camp-rest-token-32-characters';
  const server = await createRulesWorker({artifactFile: new URL('./dist/artifact.cjs', import.meta.url), artifactsDirectory: directory, token});
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const input = JSON.parse(await readFile(new URL('../src/roguelike/pinnedFighter.fixture.json', import.meta.url), 'utf8'));
    input.character.current_hp = 4;
    input.long = false;
    input.hitDieRolls = [5];
    input.runtime = {current_hp: 9999, resources: {anything: 999}, turn_state: {forged: true}};
    const response = await fetch(`http://127.0.0.1:${server.address().port}/rest`, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({input})});
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, 'ready');
    assert.equal(result.patch.current_hp, 11);
    assert.equal(result.patch.resources.hit_dice_d10, 1);
    assert.equal(result.patch.resources['uses_ACT-second-wind'], 1);
    assert.equal(result.patch.resources.anything, undefined);
    assert.equal(result.patch.turn_state.forged, undefined);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, {recursive: true, force: true});
  }
});
