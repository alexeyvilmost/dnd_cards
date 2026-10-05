/** Local differential replay: compare two exact executable files, never repin saved combats. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {snapshotHash} from '../worker/server.mjs';

const require = createRequire(import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('../src/roguelike/pinnedFighter.fixture.json', import.meta.url), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const identity = file => `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
// The executable changed, so its identity must change. All other saved fields,
// including ruleset/content hashes, event IDs, rolls and breakdowns are compared.
function behavioral(value) {
  if (Array.isArray(value)) return value.map(behavioral);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, entry]) => [key, key === 'artifactHash' ? '<executable-identity>' : behavioral(entry)]));
  return value;
}

function encounter(seed, variant) {
  return {...clone(fixture), seed, roster: [{monster_id: 'enemy', quantity: 1}],
    monsters: {version: 1, effects: [], actions: [{id: 'slam', name: `Fixture ${variant}`, mechanics: {
      activation: {mode: 'active', cost: [{resource: 'action', amount: 1}]},
      targeting: {domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 5,
        requires_line_of_sight: true, allowed_relations: ['enemy']},
      effects: [{resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee', attack_bonus_override: variant + 3,
        vs: 'ac', on_hit: [{kind: 'damage', amount: variant + 2, type: 'bludgeoning'}]}],
    }}], monsters: [{id: 'enemy', name: `Enemy ${variant}`, slug: 'enemy', size: 'medium', creature_type: 'humanoid',
      armor_class: 9 + variant, max_hp: 20 + variant, speed: 30, initiative_bonus: 0, proficiency_bonus: 2,
      abilities: {str: 14, dex: 10, con: 10, int: 10, wis: 10, cha: 10}, action_ids: ['slam'], effect_ids: [], ai: {strategy: 'tactical'}}]}};
}

async function corpus(file) {
  const artifact = require(file), hash = identity(file), traces = [];
  const record = (name, value) => traces.push({name, value: clone(value)});
  for (const variant of [1, 2]) {
    const input = encounter(`architecture-fixture-${variant}`, variant);
    const initialized = await artifact.initializeRoguelikeCombat(input, hash);
    assert.equal(initialized.status, 'ready');
    let result = {...initialized, ...artifact.projectRoguelikeCombatPatch(initialized.envelope, input.character)};
    record(`combat-${variant}:initialize`, result);
    for (let turn = 0; turn < 3; turn++) {
      const envelope = clone(result.envelope); // A persisted/reloaded state, not an object reference.
      const intent = {type: 'end_turn', actorId: input.character.id};
      const next = artifact.stepRoguelikeCombat(envelope, intent, hash);
      assert.deepEqual(artifact.stepRoguelikeCombat(clone(envelope), intent, hash), next, 'A repeated input must consume the same entropy');
      result = {...next, ...artifact.projectRoguelikeCombatPatch(next.envelope, {...input.character, runtime_revision: result.patch.runtime_revision})};
      record(`combat-${variant}:turn-${turn}`, result);
    }
    const heldInput = {...clone(fixture), seed: `held-check-${variant}`, commandId: `held:${variant}`,
      check: {ability: variant === 1 ? 'str' : 'dex', skill: variant === 1 ? 'athletics' : 'acrobatics', dc: variant === 1 ? 1 : 18}};
    const held = await artifact.executeJourneyCheck(heldInput);
    assert.equal(held.status, 'ready'); assert.equal(held.public.phase, 'influence');
    record(`check-${variant}:held`, held);
    const resumedInput = {...heldInput, commandId: `accept:${variant}`, resolve: true, envelope: clone(held.envelope)};
    const resumed = await artifact.executeJourneyCheck(resumedInput);
    assert.deepEqual(await artifact.executeJourneyCheck(clone(resumedInput)), resumed, 'Retry uses the same command ID and held dice');
    assert.deepEqual(resumed.public.roll, held.public.roll);
    record(`check-${variant}:resolved`, resumed);
    const restInput = {...clone(fixture), long: false, hitDieRolls: [variant + 3]};
    restInput.character.current_hp = variant + 2;
    const rest = await artifact.executeRoguelikeCampRest(restInput);
    assert.equal(rest.status, 'ready');
    assert.ok(rest.patch.current_hp > restInput.character.current_hp, 'Rest actually restores HP');
    record(`rest-${variant}`, rest);
    const hazardInput = {...clone(fixture), seed: `hazard-${variant}`, commandId: `hazard:${variant}`,
      hazard: {id: `recovery-${variant}`, name: `Recovery ${variant}`, sourceKind: 'environment', sourceEntityIds: [`recovery-${variant}`],
        resolution: 'automatic', effects: [{kind: 'healing', amount: variant === 1 ? '1d4' : '1d6'}]}};
    hazardInput.character.current_hp = 1;
    const hazard = await artifact.executeJourneyEffect(hazardInput);
    assert.equal(hazard.status, 'ready');
    assert.ok(hazard.patch.current_hp > hazardInput.character.current_hp, 'Healing hazard actually executes');
    record(`hazard-${variant}`, hazard);
    let rejection;
    try {artifact.stepRoguelikeCombat(clone(initialized.envelope), {type: 'unknown-operation'}, hash);}
    catch (error) {rejection = error.message;}
    assert.ok(rejection, 'An unknown operation must not be accepted');
    record(`unknown-${variant}`, {rejection});
  }
  return {artifactHash: hash, traces};
}

export async function compareArtifacts(beforeFile, afterFile) {
  const before = await corpus(path.resolve(beforeFile));
  const after = await corpus(path.resolve(afterFile));
  assert.equal(before.traces.length, after.traces.length);
  for (let index = 0; index < before.traces.length; index++) {
    assert.equal(before.traces[index].name, after.traces[index].name);
    assert.deepEqual(behavioral(after.traces[index].value), behavioral(before.traces[index].value), before.traces[index].name);
  }
  return {status: 'equivalent', beforeArtifactHash: before.artifactHash, afterArtifactHash: after.artifactHash,
    comparedRecords: before.traces.length, identityFieldsExcluded: ['artifactHash'],
    traces: after.traces.map(({name, value}) => ({name, behavioralHash: snapshotHash(behavioral(value))}))};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 4, 'Usage: node scripts/check-rules-artifact-equivalence.mjs BASELINE.cjs CANDIDATE.cjs');
  console.log(JSON.stringify(await compareArtifacts(process.argv[2], process.argv[3]), null, 2));
}
