import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {resolveTool, cleanEnvironment} from '../../scripts/testing/runtime.mjs';
import {createRulesWorker, snapshotHash} from './server.mjs';
import {GO_JSON_MAP_ENCODING, goJSONMapWireValue, replayCombatRecords} from './replay.mjs';

let directory, encoder;
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'replay-source-encoding-'));
  encoder = path.join(directory, `encoder${process.platform === 'win32' ? '.exe' : ''}`);
  const build = spawnSync(resolveTool('go'), ['build', '-o', encoder, fileURLToPath(new URL('./fixtures/json-map-wire.go', import.meta.url))],
    {cwd: directory, env: cleanEnvironment({GOWORK: 'off'}), encoding: 'utf8', timeout: 120_000, windowsHide: true});
  assert.equal(build.status, 0, 'The actual Go encoding fixture must compile');
});
after(async () => {
  if (!directory) return;
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith('replay-source-encoding-'));
  await rm(directory, {recursive: true, force: true});
});
function goWire(value) {
  const result = spawnSync(encoder, [], {input: JSON.stringify(value), encoding: 'utf8', timeout: 10_000, windowsHide: true, env: cleanEnvironment()});
  assert.equal(result.status, 0, 'The actual Go encoder must succeed');
  return result.stdout;
}
const goSource = {sourceEncoding: GO_JSON_MAP_ENCODING};
const jsonbOrder = value => Array.isArray(value) ? value.map(jsonbOrder)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value)
    .sort((a,b) => Buffer.byteLength(a)-Buffer.byteLength(b) || Buffer.compare(Buffer.from(a),Buffer.from(b)))
    .map(key => [key, jsonbOrder(value[key])])) : value;

test('actual Go bytes establish recursive UTF-8 map order and JSON optional-value semantics', () => {
  const input = {zz: {z: 1, alpha: 2}, a: [{z: 4, abc: 3}, undefined, null], optional: undefined,
    unicode: {'\u{10000}': 1, '\uE000': 2, 'я': 3, 'é': 4}, numeric: {'2': 2, '10': 10}, html: '<&>'};
  const wire = goWire(input);
  assert.ok(wire.indexOf('"10"') < wire.indexOf('"2"'), 'Go sorts numeric string map keys as strings');
  assert.ok(wire.indexOf('\uE000') < wire.indexOf('\u{10000}'), 'UTF-8 and UTF-16 differ for these keys');
  assert.match(wire, /\\u003c\\u0026\\u003e/);
  assert.equal(JSON.stringify(goJSONMapWireValue(input)), JSON.stringify(JSON.parse(wire)), 'Compare the worker-parsed values, including key iteration order');
  assert.deepEqual(goJSONMapWireValue(input).a, [{abc: 3, z: 4}, null, null]);
  assert.equal('optional' in goJSONMapWireValue(input), false);
  assert.deepEqual(Object.keys(input.zz), ['z', 'alpha'], 'Encoding must not mutate caller input');
});

// A data-driven order-sensitive fixture: different entities supply different
// nested maps/arrays. It deliberately emits a fresh nonlexical map on EVERY step
// so baseline-only sorting cannot satisfy the HTTP-produced journal.
const artifactSource = `
exports.stepRoguelikeCombat = (input, intent) => {
  const envelope = structuredClone(input);
  envelope.state.observed.push({members: Object.keys(input.state.declarations), choices: Object.keys(intent.choices), nested: Object.keys(intent.nested.map), sequence: intent.sequence});
  envelope.state.declarations = {z: 7, alpha: 9};
  return {envelope, randomValues: [0.25]};
};
exports.projectRoguelikeCombatPatch = (envelope, character) => ({envelope, patch: {runtime_revision: character.runtime_revision + 1}});
`;
async function journal(entity, encoding) {
  const file = path.join(directory, `${entity.id}-${encoding}.cjs`);
  await writeFile(file, artifactSource);
  const artifactHash = 'sha256:' + createHash('sha256').update(artifactSource).digest('hex');
  const artifact = createRequire(import.meta.url)(file);
  const token = 'synthetic-replay-transport-test-token-only';
  const server = await createRulesWorker({artifactFile: file, artifactsDirectory: path.join(directory, `${entity.id}-${encoding}`), token});
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let envelope = {artifactHash, state: {characterId: entity.id, declarations: entity.declarations, observed: []}};
    const records = [{schemaVersion: 1, artifactHash, baseline: structuredClone(envelope), baselinePosition: 'after', afterHash: snapshotHash(envelope)}];
    for (let step = 0; step < 3; step++) {
      const intent = {type: 'fixture', choices: entity.choices, nested: {map: entity.nested}, sequence: entity.sequence, omitted: undefined};
      const request = {artifactHash, envelope, intent, character: {id: entity.id, runtime_revision: step}};
      const response = await fetch(`http://127.0.0.1:${server.address().port}/transition`, {method: 'POST',
        headers: {authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: encoding === 'go' ? goWire(request) : JSON.stringify(request)});
      assert.equal(response.status, 200);
      const result = await response.json();
      records.push({schemaVersion: 1, artifactHash, intent, ...result.trace, randomValues: result.randomValues});
      envelope = result.envelope;
    }
    return {artifact, records: JSON.parse(JSON.stringify(records)), envelope};
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
const entities = [
  {id: 'fixture-first', declarations: {z: 1, alpha: 2}, choices: {z: 1, alpha: 2}, nested: {z: 1, alpha: 2}, sequence: ['z', 'alpha']},
  {id: 'fixture-second', declarations: {'\u{10000}': 1, '\uE000': 2}, choices: {long: 1, b: 2}, nested: {'я': 3, 'é': 4}, sequence: [{z: 2, alpha: 1}, 3]},
];
for (const entity of entities) {
  test(`${entity.id}: default direct Node HTTP contract keeps original order`, async () => {
    const {records, artifact, envelope} = await journal(entity, 'node');
    assert.deepEqual(replayCombatRecords(records, artifact).envelope, envelope);
    assert.throws(() => replayCombatRecords(records, artifact, goSource), /diverged/);
  });
  test(`${entity.id}: actual Go HTTP journal survives DB object ordering across all steps`, async () => {
    const original = await journal(entity, 'go');
    const records = jsonbOrder(original.records);
    const before = JSON.stringify(records);
    assert.equal(snapshotHash(records), snapshotHash(original.records), 'Only object order changed');
    const result = replayCombatRecords(records, original.artifact, goSource);
    assert.equal(result.commands, 3);
    assert.deepEqual(result.envelope, original.envelope);
    const beforeBaseline = structuredClone(records.slice(1));
    beforeBaseline[0].baseline = structuredClone(records[0].baseline);
    beforeBaseline[0].baselinePosition = 'before';
    const beforeResult = replayCombatRecords(beforeBaseline, original.artifact, goSource);
    assert.equal(beforeResult.commands, beforeBaseline.length, 'Before-baseline record is itself a command');
    assert.deepEqual(beforeResult.envelope, original.envelope);
    assert.equal(JSON.stringify(records), before, 'Saved journal remains unchanged');
    assert.throws(() => replayCombatRecords(records, original.artifact), /diverged/);
    const baselineOnly = structuredClone(records);
    baselineOnly[0].baseline = goJSONMapWireValue(baselineOnly[0].baseline);
    for (const row of baselineOnly.slice(1)) row.intent = goJSONMapWireValue(row.intent);
    assert.throws(() => replayCombatRecords(baselineOnly, original.artifact), /diverged/, 'Each newly produced envelope must cross the Go boundary');
    const altered = structuredClone(records); altered[1].afterHash = `sha256:${'0'.repeat(64)}`;
    assert.throws(() => replayCombatRecords(altered, original.artifact, goSource), /diverged/);
    const reordered = structuredClone(records); reordered[1].intent.sequence.reverse();
    assert.throws(() => replayCombatRecords(reordered, original.artifact, goSource), /diverged/);
    const rng = structuredClone(records); rng[1].randomValues = [0.5];
    assert.throws(() => replayCombatRecords(rng, original.artifact, goSource), /Random stream mismatch/);
    const schema = structuredClone(records); schema[1].schemaVersion = 99;
    assert.throws(() => replayCombatRecords(schema, original.artifact, goSource), /Unsupported journal schema/);
    assert.throws(() => replayCombatRecords([records[0], ...records.slice(2)], original.artifact, goSource), /Missing or reordered/);
    assert.throws(() => replayCombatRecords(records, original.artifact, {sourceEncoding: 'guess'}), /Unsupported replay source/);
  });
}
