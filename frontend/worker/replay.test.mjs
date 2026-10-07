import {workerTestBuild} from '../../scripts/testing/worker-test-build.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createRulesWorker, snapshotHash} from './server.mjs';
import {replayCombatRecords} from './replay.mjs';
import {withContainerCatalog} from './fixtures/container-catalog.mjs';

const currentInput = async () => withContainerCatalog(
  JSON.parse(await readFile(new URL('../src/roguelike/pinnedFighter.fixture.json', import.meta.url), 'utf8')),
  JSON.parse(await readFile(new URL('../../officials/canon/prod-snapshot/cards.json', import.meta.url), 'utf8')),
);

test('explicit HTTP rules upgrade preserves the frame, retains both artifacts and starts a replayable segment', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'combat-upgrade-'));
  const token = 'private-local-upgrade-token-32-characters';
  const artifactFile = new URL('artifact.cjs', workerTestBuild()), artifact = createRequire(import.meta.url)(fileURLToPath(artifactFile));
  const legacy = 'exports.retainedVersion = 1;', oldHash = `sha256:${createHash('sha256').update(legacy).digest('hex')}`;
  await writeFile(path.join(directory, `${oldHash.slice(7)}.cjs`), legacy);
  let server;
  try {
    server = await createRulesWorker({artifactFile, artifactsDirectory: directory, token});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const post = async (route, body, expected = 200) => {
      const response = await fetch(url+route, {method:'POST',headers:{authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
      assert.equal(response.status, expected); return response.json();
    };
    const input = await currentInput();
    Object.assign(input, {seed:'explicit-upgrade', roster:[{monster_id:'enemy',quantity:1}], monsters:{version:1,effects:[],actions:[],monsters:[{
      id:'enemy',name:'Enemy',slug:'enemy',size:'medium',creature_type:'humanoid',armor_class:10,max_hp:20,speed:30,initiative_bonus:0,proficiency_bonus:2,
      abilities:{str:10,dex:10,con:10,int:10,wis:10,cha:10},action_ids:[],effect_ids:[],ai:{strategy:'tactical'},
    }]}});
    const initialized = await post('/initialize', {input}); assert.equal(initialized.status, 'ready');
    const before = {...initialized.envelope, artifactHash:oldHash}, serialized = JSON.stringify(before);
    const after = await post('/upgrade', {artifactHash:oldHash,envelope:before,targetHash:oldHash});
    assert.deepEqual(after.envelope, {...before,artifactHash:initialized.envelope.artifactHash});
    assert.deepEqual(after.randomValues, []); assert.equal(after.patch, undefined);
    assert.equal(after.trace.beforeHash,snapshotHash(before)); assert.equal(after.trace.afterHash,snapshotHash(after.envelope));
    const record = {schemaVersion:1,type:'upgrade_combat_rules',artifactHash:after.envelope.artifactHash,baseline:after.envelope,baselinePosition:'after',previousBaseline:before,...after.trace};
    assert.deepEqual(replayCombatRecords([record],artifact).envelope,after.envelope);
    const corrupt = structuredClone(record); corrupt.previousBaseline.entropy.cursor++;
    assert.throws(() => replayCombatRecords([corrupt],artifact), /Preceding frame hash mismatch/);
    assert.equal(JSON.stringify(before),serialized);
    await post('/upgrade',{artifactHash:after.envelope.artifactHash,envelope:after.envelope},409);
    const pending = structuredClone(before); pending.state.pendingTriggeredAction={event:'hit',sourceActorId:input.character.id,sourceActionId:'attack',targetIds:[],optionActionIds:[]};
    await post('/upgrade',{artifactHash:oldHash,envelope:pending},422);
    await post('/upgrade',{artifactHash:`sha256:${'f'.repeat(64)}`,envelope:before},409);
    assert.equal(await readFile(path.join(directory, `${oldHash.slice(7)}.cjs`),'utf8'),legacy);
  } finally {
    if (server?.listening) {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    assert.equal(path.dirname(directory),tmpdir());assert.ok(path.basename(directory).startsWith('combat-upgrade-'));await rm(directory,{recursive:true,force:true});
  }
});

test('journey HTTP preserves a held check across worker restart and uses the retained artifact for consequences', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'journey-worker-'));
  const token = 'private-local-journey-test-token-32-characters';
  const options = {artifactFile: new URL('artifact.cjs', workerTestBuild()), artifactsDirectory: directory, token};
  let server;
  const start = async () => {
    server = await createRulesWorker(options);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  };
  try {
    let url = await start();
    const post = async (endpoint, body) => {
      const response = await fetch(url + endpoint, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      assert.equal(response.status, 200);
      return response.json();
    };
    const input = await currentInput();
    Object.assign(input, {seed: 'saved-journey-check', commandId: 'journey:hold', check: {ability: 'str', skill: 'athletics', dc: 1}});
    const held = await post('/journey-check', {input});
    assert.equal(held.status, 'ready');
    assert.equal(held.public.phase, 'influence');
    assert.equal(held.patch, undefined);
    await new Promise(resolve => server.close(resolve));
    url = await start();
    const resolveInput = {...input, commandId: 'journey:accept', resolve: true, envelope: held.envelope};
    const accepted = await post('/journey-check', {artifactHash: held.artifactHash, input: resolveInput});
    assert.equal(accepted.public.phase, 'resolved');
    assert.deepEqual(accepted.public.roll, held.public.roll);
    assert.equal(accepted.patch.runtime_revision, Number(input.character.runtime_revision) + 1);
    assert.deepEqual(await post('/journey-check', {artifactHash: held.artifactHash, input: resolveInput}), accepted);
    const effectInput = {...input, character: {...input.character, current_hp: 1}, commandId: 'journey:effect',
      hazard: {id: 'fountain', name: 'Фонтан', sourceKind: 'environment', sourceEntityIds: ['fountain'], resolution: 'automatic', effects: [{kind: 'healing', amount: '1d4'}]}};
    const consequence = await post('/journey-effect', {artifactHash: held.artifactHash, input: effectInput});
    assert.equal(consequence.status, 'ready');
    assert.ok(consequence.patch.current_hp > 1);
    assert.equal(consequence.artifactHash, held.artifactHash);
    assert.deepEqual(await post('/journey-effect', {artifactHash: held.artifactHash, input: effectInput}), consequence);
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(directory), tmpdir());
    assert.ok(path.basename(directory).startsWith('journey-worker-'));
    await rm(directory, {recursive: true, force: true});
  }
});

test('replays actual HTTP worker transitions, RNG and projected revisions after JSON export', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'combat-replay-'));
  const token = 'private-local-replay-test-token-32-characters';
  const artifactFile = new URL('artifact.cjs', workerTestBuild());
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
    const input = await currentInput();
    Object.assign(input, {seed: 'journal-real-combat', roster: [{monster_id: 'enemy', quantity: 1}],
      monsters: {version: 1, effects: [], actions: [{id: 'slam', name: 'Slam', mechanics: {
        activation: {mode: 'active', cost: [{resource: 'action', amount: 1}]},
        targeting: {domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy']},
        effects: [{resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee', attack_bonus_override: 4, vs: 'ac', on_hit: [{kind: 'damage', amount: 3, type: 'bludgeoning'}]}],
      }}], monsters: [{id: 'enemy', name: 'Enemy', slug: 'enemy', size: 'medium', creature_type: 'humanoid', armor_class: 10, max_hp: 20, speed: 30, initiative_bonus: 0, proficiency_bonus: 2,
        abilities: {str: 14, dex: 10, con: 10, int: 10, wis: 10, cha: 10}, action_ids: ['slam'], effect_ids: [], ai: {strategy: 'tactical'}}]}});
    let result = await post('/initialize', {input});
    assert.equal(result.status, 'ready');
    assert.ok(result.combatOpeningState?.world?.actors?.[input.character.id], 'Initialize returns the exact pre-enemy board');
    assert.equal(result.combatOpeningState.entropy, undefined);
    assert.equal(result.envelope.combatOpeningState, undefined);
    assert.equal(result.envelope.state.combatOpeningState, undefined);
    const records = [{schemaVersion: 1, type: 'initialize_combat', artifactHash: result.envelope.artifactHash,
      baseline: result.envelope, baselinePosition: 'after', ...result.trace}];
    for (let i = 0; i < 3; i++) {
      const before = result.envelope;
      const intent = {type: 'end_turn', actorId: input.character.id};
      result = await post('/transition', {artifactHash: before.artifactHash, envelope: before, intent,
        character: {...input.character, runtime_revision: result.patch.runtime_revision}});
      assert.equal(result.combatOpeningState, undefined, 'Later transitions never replay an opening board');
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
  const server = await createRulesWorker({artifactFile: new URL('artifact.cjs', workerTestBuild()), artifactsDirectory: directory, token});
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const input = await currentInput();
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
