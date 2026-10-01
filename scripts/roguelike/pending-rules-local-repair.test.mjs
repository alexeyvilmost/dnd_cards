import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotHash} from '../../frontend/worker/server.mjs';
import {preparePendingRulesRepair, localDatabaseConnection, localPostgresEnvironment, validateDatabaseSnapshot, snapshotSql, applySql} from './pending-rules-local-repair.mjs';

const runId = '10000000-0000-4000-8000-000000000001';
const characterId = '20000000-0000-4000-8000-000000000001';
const ownerId = '30000000-0000-4000-8000-000000000001';
const repairId = '40000000-0000-4000-8000-000000000001';
const oldHash = 'sha256:' + '1'.repeat(64), newHash = 'sha256:' + '2'.repeat(64);

function fixture() {
  const actor = {id: characterId, runtime: {hp: {current: 21, max: 36, temp: 2}, resources: {slot2: 2, bonus: 1}}};
  const state = {schemaVersion: 1, characterId, controlledCharacterIds: [characterId],
    runtimeRevision: 175, participantRuntimeRevisions: {[characterId]: 175}, outcome: 'active',
    world: {scene: {mode: 'encounter', activeIndex: 0}, pendingResolution: null,
      actors: {[characterId]: actor, victim: {id: 'victim', runtime: {hp: {current: 11, max: 20, temp: 0}}}},
      events: [{type: 'roll', total: 23}, {type: 'damage', amount: 6}]},
    log: [{id: 7, text: 'Confirmed attack', records: [{actionId: 'attack', targetIds: ['victim']}]}],
    tokens: {[characterId]: {position: {x: 3, y: 2}}, victim: {position: {x: 4, y: 2}}},
    initiative: [characterId, 'victim'], actionPresentation: {rider: {imageUrl: 'data:image/png;base64,abc'}},
    catalogActions: [{id: 'rider-a', kind: 'spell', name: 'First unrelated rider', spell: {level: 1},
      sourceEntityIds: ['entity-a'], mechanics: {effects: [{kind: 'damage', formula: '2d6', damage_type: 'cold'}], targeting: {range_ft: 0}},
      targeting: {rangeFt: 0}},
    {id: 'rider-b', kind: 'spell', name: 'Second unrelated rider', spell: {level: 1},
      sourceEntityIds: ['entity-b'], mechanics: {effects: [{kind: 'damage', formula: '1d4', damage_type: 'force'}], targeting: {range_ft: 0}},
      targeting: {rangeFt: 0}}, {id: 'unchanged', mechanics: {effects: []}}],
    pendingTriggeredAction: {event: 'hit', sourceActorId: characterId, sourceActionId: 'attack', targetIds: ['victim'],
      optionActionIds: ['rider-a', 'rider-b'], triggeringAttack: {targetActorId: 'victim', meleeReachFt: 5,
        damageType: 'slashing', critical: false, roll: {outcome: 'hit', dice: [{sides: 20, result: 18}], total: 23}}}};
  const before = {schemaVersion: 1, artifactHash: oldHash, entropy: {seed: 'private-seed-never-log', cursor: 53}, state};
  const mirror = structuredClone(state); delete mirror.actionPresentation.rider.imageUrl;
  const character = {id: characterId, user_id: ownerId, character_type: 'dungeon_crawl', runtime_revision: 175,
    current_hp: 21, resources: {slot2: 2, bonus: 1}, max_resources: {slot2: 2, bonus: 1}, active_effects: [],
    equipment: {body: 'armor'}, inventory_items: [{id: 'armor'}],
    turn_state: {solo_combat_v1: mirror, rules_engine_runtime_v1: {hp: actor.runtime.hp}, temp_hp: 2}};
  const run = {id: runId, user_id: ownerId, character_id: characterId, phase: 'combat', status: 'active', revision: 189,
    attempt: 1, encounter: {number: 7}, party: {}, gold: 50, combat_envelope: before,
    combat_catalog: {artifactHash: oldHash, entities: [{id: 'entity-a', mechanics: 'old immutable source'}]}};
  const afterRules = structuredClone(before); afterRules.artifactHash = newHash;
  afterRules.state.catalogActions[0].mechanics.targeting.range_from_triggering_attack = true;
  afterRules.state.catalogActions[0].mechanics.effects[0].inherit_attack_critical = true;
  afterRules.state.catalogActions[0].targeting.rangeFt = 5;
  afterRules.state.catalogActions[1].mechanics.effects[0].formula = '2d4';
  afterRules.state.catalogActions[1].mechanics.targeting.range_ft = 15;
  afterRules.state.catalogActions[1].targeting.rangeFt = 15;
  const reviewedActions = [0, 1].map(index => ({actionId: before.state.catalogActions[index].id,
    beforeHash: snapshotHash(before.state.catalogActions[index].mechanics),
    afterHash: snapshotHash(afterRules.state.catalogActions[index].mechanics),
    beforeTargetingHash: snapshotHash(before.state.catalogActions[index].targeting ?? null),
    afterTargetingHash: snapshotHash(afterRules.state.catalogActions[index].targeting ?? null)}));
  const project = (envelope, char) => {
    const projectedState = {...envelope.state, runtimeRevision: char.runtime_revision + 1,
      participantRuntimeRevisions: {...envelope.state.participantRuntimeRevisions, [char.id]: char.runtime_revision + 1}};
    const saved = structuredClone(projectedState); delete saved.actionPresentation.rider.imageUrl;
    return {envelope: {...envelope, state: projectedState}, patch: {
      ...Object.fromEntries(['current_hp', 'resources', 'max_resources', 'active_effects', 'inventory_items', 'equipment'].map(key => [key, structuredClone(char[key])])),
      runtime_revision: char.runtime_revision + 1, turn_state: {...char.turn_state, solo_combat_v1: saved}}};
  };
  const {envelope: afterEnvelope, patch} = project(afterRules, character);
  return {run, character, afterEnvelope, patch, reviewedActions, artifactHash: newHash, project,
    runId, repairId, database: 'isolated_local_qa', reason: 'Reviewed post-hit data repair'};
}

function observed(plan) {
  return {database: plan.request.database, serverAddress: '127.0.0.1', run: structuredClone(plan.run),
    character: structuredClone(plan.character), receipt: null, eventCount: 155, newKeyEventCount: 0,
    previousEvent: {id: '50000000-0000-4000-8000-000000000001', record: {afterHash: plan.request.beforeHash}}};
}

test('two different reviewed riders repair only data, canonical mirror and +1 bookkeeping', () => {
  const input = fixture(), savedInput = structuredClone({...input, project: undefined});
  const plan = preparePendingRulesRepair(input);
  assert.deepEqual({...input, project: undefined}, savedInput);
  assert.deepEqual(plan.afterEnvelope.entropy, plan.beforeEnvelope.entropy);
  assert.deepEqual(plan.afterEnvelope.state.world, plan.beforeEnvelope.state.world);
  assert.deepEqual(plan.afterEnvelope.state.pendingTriggeredAction, plan.beforeEnvelope.state.pendingTriggeredAction);
  assert.deepEqual(plan.afterEnvelope.state.log, plan.beforeEnvelope.state.log);
  assert.equal(plan.request.reviewedActions.length, 2);
  assert.equal(plan.response.revision, 190); assert.equal(plan.patch.runtime_revision, 176);
  assert.deepEqual(plan.response.randomValues, []);
  assert.equal(validateDatabaseSnapshot(observed(plan), plan), 'ready');
});

for (const [name, change] of [
  ['entropy cursor', input => input.afterEnvelope.entropy.cursor++],
  ['captured reach', input => input.afterEnvelope.state.pendingTriggeredAction.triggeringAttack.meleeReachFt = 10],
  ['saved attack roll', input => input.afterEnvelope.state.pendingTriggeredAction.triggeringAttack.roll.total = 24],
  ['HP', input => input.afterEnvelope.state.world.actors.victim.runtime.hp.current--],
  ['history', input => input.afterEnvelope.state.log[0].text = 'Rewritten'],
  ['target', input => input.afterEnvelope.state.pendingTriggeredAction.targetIds = ['someone-else']],
  ['action name', input => input.afterEnvelope.state.catalogActions[0].name = 'Changed'],
  ['unreviewed mechanics', input => input.afterEnvelope.state.catalogActions[2].mechanics.effects.push({kind: 'heal'})],
  ['catalog order', input => input.afterEnvelope.state.catalogActions.reverse()],
]) test(`rejects repair of ${name}`, () => {
  const input = fixture(); change(input);
  assert.throws(() => preparePendingRulesRepair(input));
});

test('rejects missing reach rather than reconstructing it from current equipment', () => {
  const input = fixture(); delete input.run.combat_envelope.state.pendingTriggeredAction.triggeringAttack.meleeReachFt;
  assert.throws(() => preparePendingRulesRepair(input), /captured melee reach/);
});

test('rejects unreviewed mechanics hashes, arbitrary revision and noncanonical mirror', () => {
  let input = fixture(); input.reviewedActions[1].afterHash = oldHash;
  assert.throws(() => preparePendingRulesRepair(input), /Unreviewed target mechanics/);
  input = fixture(); input.afterEnvelope.state.runtimeRevision = 177;
  assert.throws(() => preparePendingRulesRepair(input), /canonical projection/);
  input = fixture(); input.patch.turn_state.temp_hp = 99;
  assert.throws(() => preparePendingRulesRepair(input), /canonical projection/);
});

test('requires separately reviewed compiled geometry rather than trusting mechanics hash alone', () => {
  let input = fixture(); delete input.reviewedActions[0].afterTargetingHash;
  assert.throws(() => preparePendingRulesRepair(input), /compiled targeting hashes required/);
  input = fixture(); input.afterEnvelope.state.catalogActions[0].targeting.rangeFt = 100;
  assert.throws(() => preparePendingRulesRepair(input), /Unreviewed target targeting/);
  input = fixture(); input.reviewedActions[1].beforeTargetingHash = newHash;
  assert.throws(() => preparePendingRulesRepair(input), /Unreviewed original targeting/);
});

test('canonical projector cannot make the repair change resources or non-combat turn_state', () => {
  const input = fixture(), original = input.project;
  input.project = (...args) => {const result = original(...args); result.patch.resources.slot2--; return result;};
  input.patch = input.project(input.afterEnvelope, input.character).patch;
  assert.throws(() => preparePendingRulesRepair(input), /changes character resources/);
  const other = fixture(), projector = other.project;
  other.project = (...args) => {const result = projector(...args); result.patch.turn_state.temp_hp = 3; return result;};
  other.patch = other.project(other.afterEnvelope, other.character).patch;
  assert.throws(() => preparePendingRulesRepair(other), /dedicated combat mirror/);
});

test('requires single owned character and valid original unresolved choice', () => {
  let input = fixture(); input.character.user_id = repairId;
  assert.throws(() => preparePendingRulesRepair(input), /owner differs/);
  input = fixture(); input.run.combat_envelope.state.controlledCharacterIds.push(repairId);
  assert.throws(() => preparePendingRulesRepair(input), /single controlled character/);
  input = fixture(); input.run.combat_envelope.state.world.pendingResolution = {id: 'already-paid'};
  assert.throws(() => preparePendingRulesRepair(input), /before its action is committed/);
});

test('CAS refuses changed envelope, run revision, whole turn_state and runtime fields', () => {
  const plan = preparePendingRulesRepair(fixture());
  for (const mutate of [snapshot => snapshot.run.revision++, snapshot => snapshot.run.combat_envelope.entropy.cursor++,
    snapshot => snapshot.character.runtime_revision++, snapshot => snapshot.character.turn_state.temp_hp++,
    snapshot => snapshot.character.resources.slot2--, snapshot => snapshot.character.equipment.body = 'other']) {
    const snapshot = observed(plan); mutate(snapshot);
    assert.throws(() => validateDatabaseSnapshot(snapshot, plan));
  }
  const snapshot = observed(plan); snapshot.previousEvent.record.afterHash = oldHash;
  assert.throws(() => validateDatabaseSnapshot(snapshot, plan), /journal does not end/);
});

test('same repair receipt is idempotent even after later ordinary actions', () => {
  const plan = preparePendingRulesRepair(fixture()), snapshot = observed(plan);
  snapshot.receipt = {command_type: plan.request.type, request_hash: plan.requestHash, user_id: ownerId, response: plan.response};
  snapshot.run.revision += 8; snapshot.run.combat_envelope.entropy.cursor += 4;
  snapshot.character.runtime_revision += 8;
  assert.equal(validateDatabaseSnapshot(snapshot, plan), 'already_applied');
  snapshot.receipt.request_hash = '0'.repeat(64);
  assert.throws(() => validateDatabaseSnapshot(snapshot, plan), /different prepared inputs/);
});

test('SQL transaction locks both rows, checks exact CAS, appends new baseline and real-owner receipt', () => {
  const plan = preparePendingRulesRepair(fixture()), sql = applySql(plan, observed(plan));
  assert.match(sql, /roguelike_runs WHERE id=.*FOR UPDATE/);
  assert.match(sql, /characters_v3 WHERE id=.*user_id=locked_run.user_id FOR UPDATE/);
  assert.match(sql, /to_jsonb\(locked_run\)/); assert.match(sql, /to_jsonb\(locked_character.turn_state\)/);
  assert.match(sql, /INSERT INTO roguelike_combat_events/);
  assert.match(sql, /INSERT INTO roguelike_command_receipts/);
  assert.match(sql, /locked_run.user_id,/);
  assert.match(sql, /"baselinePosition":"after"/); assert.match(sql, /"randomValues":\[\]/);
  assert.match(sql, /"previousCombatKey"/); assert.match(sql, /"pendingContext":"preserved exactly"/);
  assert.ok(sql.indexOf('IF FOUND THEN') < sql.indexOf('IF to_jsonb(locked_run)'), 'Receipt must win before stale-input CAS');
  assert.doesNotMatch(sql, /(?:UPDATE|DELETE FROM) roguelike_combat_events/);
  assert.doesNotMatch(sql, /SET (?:combat_catalog|current_hp|resources|equipment)/);
  assert.match(snapshotSql(plan), /BEGIN READ ONLY/);
  assert.match(snapshotSql(plan), /'serverAddress',host\(inet_server_addr\(\)\)/,
    'Use canonical PostgreSQL host text, without its inet /32 or /128 prefix');
  assert.doesNotMatch(snapshotSql(plan), /inet_server_addr\(\)::text/);
});

test('SQL strings remain literal for quoted reasons and private action descriptions', () => {
  const input = fixture(); input.reason = "Reviewed fix: user's data; $pending_rules_repair$ is plain text";
  const plan = preparePendingRulesRepair(input), sql = applySql(plan, observed(plan));
  assert.match(sql, /user''s data/); assert.match(sql, /SET LOCAL standard_conforming_strings=on/);
  assert.match(sql, /DO \$repair_[a-f0-9]{64}\$/);
});

// Dummy credentials belong to these parser fixtures only; assemble the URL
// instead of committing a credential-bearing connection string.
const parserFixtureDatabaseUrl = (address, password = 'pw') => {
  const url = new URL(`postgres://${address}`);
  url.username = 'dev';
  url.password = password;
  return url.toString();
};

test('local connection rejects remote hosts, option overrides, unnamed DB and remote tunnels', () => {
  const connection = localDatabaseConnection(parserFixtureDatabaseUrl('127.0.0.1:5433/ignored', 'p@ss'), 'named_qa');
  assert.deepEqual(connection, {host: '127.0.0.1', port: '5433', user: 'dev', password: 'p@ss', database: 'named_qa'});
  assert.equal(localDatabaseConnection(parserFixtureDatabaseUrl('localhost/db?sslmode=disable'), 'named_qa').sslmode, 'disable');
  for (const url of ['production.example/db', '127.0.0.1/db?host=production.example',
    '127.0.0.1/db?service=prod', '127.0.0.1/db?sslmode=disable&sslmode=require',
    '127.0.0.1/db?sslmode=invalid'].map(address => parserFixtureDatabaseUrl(address)).concat('https://127.0.0.1/db')) {
    assert.throws(() => localDatabaseConnection(url, 'named_qa'));
  }
  assert.throws(() => localDatabaseConnection(parserFixtureDatabaseUrl('localhost/db'), "x';DROP TABLE users;--"));
  const plan = preparePendingRulesRepair(fixture()), snapshot = observed(plan); snapshot.serverAddress = '10.0.0.1';
  assert.throws(() => validateDatabaseSnapshot(snapshot, plan), /tunnels are not permitted/);
});

test('inherited production service/host routing cannot redirect the named local connection', () => {
  const original = {PATH: '/tools', PGSERVICE: 'production', PGSERVICEFILE: '/private/prod-service.conf',
    PGHOSTADDR: '198.51.100.1', PGHOST: 'prod.example', PGOPTIONS: '-c search_path=other',
    pgServiceFile: '/another/alias.conf', pgHostAddr: '198.51.100.2', PGPASSWORD: 'old-secret', PGSSLMODE: 'invalid',
    PGDATABASE: 'production', PgPort: '6432', PGUSER: 'production-user', PGCLIENTENCODING: 'WIN1251', PGCONNECT_TIMEOUT: '0'};
  const connection = localDatabaseConnection(parserFixtureDatabaseUrl('127.0.0.1/ignored?sslmode=disable', 'local-secret'), 'named_local');
  const environment = localPostgresEnvironment(connection, original);
  assert.equal(environment.PATH, original.PATH);
  assert.equal(environment.PGPASSWORD, 'local-secret'); assert.equal(environment.PGSSLMODE, 'disable');
  assert.equal(environment.PGCLIENTENCODING, 'UTF8'); assert.equal(environment.PGCONNECT_TIMEOUT, '5');
  assert.equal(Object.keys(environment).filter(key => /^PG/i.test(key)).length, 4);
  assert.ok(!Object.keys(environment).some(key => /^(PGSERVICE|PGSERVICEFILE|PGHOSTADDR|PGHOST|PGOPTIONS)$/i.test(key)));
  assert.equal(original.PGSERVICE, 'production', 'Do not mutate the calling process environment');
});
