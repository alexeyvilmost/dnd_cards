// Explicit write-once corpus maintenance. Tests only read these synthetic bytes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync, gunzipSync} from 'node:zlib';
import {createRulesWorker, snapshotHash} from '../worker/server.mjs';

const fixture = new URL('../worker/fixtures/replay-v1/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', fixture), 'utf8'));
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const compressed = await readFile(new URL(manifest.artifactFile, fixture));
assert.equal(hash(compressed), manifest.compressedHash);
const artifact = gunzipSync(compressed);
assert.equal(hash(artifact), manifest.artifactHash);
const directory = await mkdtemp(path.join(tmpdir(), 'historical-corpus-'));
const artifactFile = path.join(directory, 'historical.cjs');
await writeFile(artifactFile, artifact);
const token = 'local-historical-replay-generator-only';
const server = await createRulesWorker({artifactFile, artifactsDirectory: path.join(directory, 'artifacts'), token});
const cases = [];
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const post = async (name, route, request) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: 'POST', headers: {authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify(request),
    });
    assert.equal(response.status, 200, `${name}: HTTP ${response.status}`);
    const result = await response.json();
    if (route === '/transition') assert.ok(result.envelope?.state, `${name}: expected executable transition`);
    else assert.equal(result.status, 'ready', `${name}: expected executable fixture`);
    cases.push({name, route, request, response: result, responseHash: snapshotHash(result)});
    return result;
  };
  const source = JSON.parse(await readFile(new URL('../src/roguelike/pinnedFighter.fixture.json', import.meta.url), 'utf8'));
  // This checked-in input is a synthetic fixture. Remove editorial/storage and
  // account fields anyway so a future source edit cannot publish them here.
  const privateFields = new Set(['user_id', 'owner_id', 'created_by', 'updated_by', 'author_id', 'image_url',
    'image_storage_id', 'image_cloudinary_id', 'image_generation_prompt', 'avatar_url', 'token_url', 'token_storage_id', 'notes']);
  const sanitize = value => Array.isArray(value) ? value.map(sanitize) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => !privateFields.has(key)).map(([key, item]) => [key, sanitize(item)])) : value;
  const input = sanitize(source);
  input.character.name = 'Historical synthetic fighter';
  input.character.description = '';
  input.character.user_id = 'local-replay-fixture';
  for (const check of [{ability: 'str', skill: 'athletics', dc: 1}, {ability: 'dex', skill: 'acrobatics', dc: 30}]) {
    const heldInput = {...input, seed: `historical-${check.ability}`, commandId: `historical:${check.ability}:hold`, check};
    const held = await post(`journey-${check.ability}-held`, '/journey-check', {input: heldInput});
    assert.equal(held.public.phase, 'influence');
    assert.equal(held.patch, undefined);
    const resumed = await post(`journey-${check.ability}-resume`, '/journey-check', {
      artifactHash: manifest.artifactHash,
      input: {...heldInput, commandId: `historical:${check.ability}:resume`, resolve: true, envelope: held.envelope},
    });
    assert.equal(resumed.public.phase, 'resolved');
    assert.deepEqual(resumed.public.roll, held.public.roll);
  }
  await post('short-rest', '/rest', {artifactHash: manifest.artifactHash, input: {...input,
    character: {...input.character, current_hp: 4}, long: false, hitDieRolls: [5]}});
  const combatInput = {...input, seed: 'journal-real-combat', roster: [{monster_id: 'enemy', quantity: 1}],
    monsters: {version: 1, effects: [], actions: [{id: 'slam', name: 'Synthetic slam', mechanics: {
      activation: {mode: 'active', cost: [{resource: 'action', amount: 1}]},
      targeting: {domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy']},
      effects: [{resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee', attack_bonus_override: 4, vs: 'ac', on_hit: [{kind: 'damage', amount: 3, type: 'bludgeoning'}]}],
    }}], monsters: [{id: 'enemy', name: 'Synthetic enemy', slug: 'enemy', size: 'medium', creature_type: 'humanoid', armor_class: 10, max_hp: 20, speed: 30, initiative_bonus: 0, proficiency_bonus: 2,
      abilities: {str: 14, dex: 10, con: 10, int: 10, wis: 10, cha: 10}, action_ids: ['slam'], effect_ids: [], ai: {strategy: 'tactical'}}]}};
  let result = await post('combat-initialize', '/initialize', {input: combatInput});
  for (let index = 0; index < 3; index++) {
    result = await post(`combat-end-turn-${index + 1}`, '/transition', {artifactHash: manifest.artifactHash,
      envelope: result.envelope, intent: {type: 'end_turn', actorId: input.character.id},
      character: {...input.character, runtime_revision: result.patch.runtime_revision}});
  }
  const corpus = {schemaVersion: 1, sourceCommit: manifest.sourceCommit, artifactHash: manifest.artifactHash,
    fixtureKind: 'synthetic-local-only', capturedRuntime: process.versions.node, cases};
  const bytes = Buffer.from(JSON.stringify(corpus));
  const packed = gzipSync(bytes, {level: 9});
  const metadata = {schemaVersion: 1, corpusFile: 'corpus.json.gz', corpusHash: hash(bytes), compressedHash: hash(packed),
    sourceCommit: manifest.sourceCommit, artifactHash: manifest.artifactHash, cases: cases.map(({name, route, responseHash}) => ({name, route, responseHash}))};
  for (const [name, value] of [['corpus.json.gz', packed], ['corpus-manifest.json', `${JSON.stringify(metadata, null, 2)}\n`]]) {
    const file = fileURLToPath(new URL(name, fixture));
    try {assert.deepEqual(await readFile(file), Buffer.from(value), 'Refusing to overwrite a historical corpus');}
    catch (error) {if (error.code !== 'ENOENT') throw error; await writeFile(file, value, {flag: 'wx'});}
  }
  console.log(JSON.stringify({cases: cases.length, corpusHash: metadata.corpusHash, compressedBytes: packed.length}));
} finally {
  await new Promise(resolve => server.close(resolve));
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith('historical-corpus-'));
  await rm(directory, {recursive: true, force: true});
}
