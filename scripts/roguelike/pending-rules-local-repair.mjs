// Explicit LOCAL-only repair of a saved post-hit choice. Prepared reviewed
// rules are applied at a journaled boundary; no action, RNG or history rewrite.
// Usage: node pending-rules-local-repair.mjs plan|apply --run UUID --database NAME
//   --before-run FILE --character-before FILE --after-envelope FILE --after-patch FILE
//   --reviewed-actions FILE --artifact FILE --repair-id UUID --reason TEXT
// Optional: --config FILE --psql FILE --audit-dir DIR --worker-origin LOCAL_URL
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {snapshotHash} from '../../frontend/worker/server.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^sha256:[a-f0-9]{64}$/;
const TYPE = 'local_pending_rules_repair';
const SOLO_KEY = 'solo_combat_v1';
const require = createRequire(import.meta.url);
const json = value => JSON.stringify(value);
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const jsonLiteral = value => `${literal(json(value))}::jsonb`;
const combatKey = envelope => createHash('sha256').update(`${envelope.artifactHash}:${envelope.entropy.seed}`).digest('hex');
const id = (value, label) => assert.ok(UUID.test(value ?? ''), `${label} must be an explicit UUID`);
const integer = (value, label) => assert.ok(Number.isSafeInteger(value) && value >= 0, `${label} must be a nonnegative safe integer`);

/** Validates the complete diff, including canonical projection bookkeeping. */
export function preparePendingRulesRepair({run, character, afterEnvelope, patch, reviewedActions,
  artifactHash, project, runId, repairId, database, reason}) {
  id(runId, 'Run ID'); id(repairId, 'Repair ID'); id(run.user_id, 'Stored run owner');
  assert.equal(run.id, runId, 'Prepared run ID differs');
  assert.equal(run.status, 'active'); assert.equal(run.phase, 'combat');
  integer(run.revision, 'Run revision'); integer(run.attempt, 'Run attempt');
  integer(run.revision + 1, 'Next run revision');
  assert.ok(/^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,62}$/.test(database ?? ''), 'Explicit named local database required');
  assert.ok(typeof reason === 'string' && reason.trim().length >= 8 && reason.length <= 2000, 'Explicit repair reason required');
  assert.ok(HASH.test(artifactHash), 'Target artifact hash required');
  const before = run.combat_envelope;
  assert.equal(before?.schemaVersion, 1); assert.ok(HASH.test(before.artifactHash));
  assert.equal(afterEnvelope?.artifactHash, artifactHash, 'Prepared target differs from executable artifact');
  assert.notEqual(before.artifactHash, artifactHash, 'A repair must start a new pinned-artifact journal segment');
  assert.ok(before.entropy?.seed); integer(before.entropy.cursor, 'Entropy cursor');
  const state = before.state;
  assert.equal(state?.outcome, 'active'); assert.equal(state.world?.scene?.mode, 'encounter');
  assert.ok(!state.world.pendingResolution && !state.pendingD20Interrupt && !state.pendingInterception,
    'Only an unresolved post-hit choice, before its action is committed, can be repaired');
  const controlled = state.controlledCharacterIds ?? [state.characterId];
  assert.deepEqual(controlled, [run.character_id], 'This utility supports a single controlled character only');
  id(character.id, 'Stored character ID'); assert.equal(character.id, run.character_id);
  assert.equal(character.user_id, run.user_id, 'Character owner differs');
  assert.equal(character.character_type, 'dungeon_crawl');
  integer(character.runtime_revision, 'Character revision');
  integer(character.runtime_revision + 1, 'Next character revision');
  assert.equal(state.runtimeRevision, character.runtime_revision, 'Envelope and character revisions differ');
  assert.equal(state.participantRuntimeRevisions?.[character.id], character.runtime_revision);
  const pending = state.pendingTriggeredAction;
  assert.ok(pending && ['hit', 'crit', 'sneak_attack_hit'].includes(pending.event), 'Saved hit choice required');
  assert.equal(pending.sourceActorId, character.id);
  assert.equal(pending.targetIds?.length, 1);
  assert.equal(pending.triggeringAttack?.targetActorId, pending.targetIds[0]);
  assert.ok(Number.isFinite(pending.triggeringAttack?.meleeReachFt) && pending.triggeringAttack.meleeReachFt > 0,
    'Original captured melee reach is required; this repair never reconstructs hit context');
  assert.ok(state.world.actors[pending.targetIds[0]], 'Original hit target must remain in the snapshot');

  assert.ok(Array.isArray(reviewedActions) && reviewedActions.length > 0, 'Exact reviewed action list required');
  assert.equal(new Set(reviewedActions.map(row => row.actionId)).size, reviewedActions.length, 'Duplicate reviewed action');
  const expected = structuredClone(before);
  expected.artifactHash = artifactHash;
  const changes = reviewedActions.map(spec => {
    assert.ok(typeof spec.actionId === 'string' && spec.actionId.length > 0 && spec.actionId.length <= 256, 'Exact action ID required');
    assert.ok(HASH.test(spec.beforeHash) && HASH.test(spec.afterHash), 'Reviewed before/after mechanics hashes required');
    assert.ok(HASH.test(spec.beforeTargetingHash) && HASH.test(spec.afterTargetingHash), 'Reviewed before/after compiled targeting hashes required');
    const indexes = before.state.catalogActions.flatMap((row, index) => row.id === spec.actionId ? [index] : []);
    assert.equal(indexes.length, 1, `Missing or duplicate original action ${spec.actionId}`);
    const index = indexes[0], previous = before.state.catalogActions[index], next = afterEnvelope.state?.catalogActions?.[index];
    assert.equal(next?.id, previous.id, 'Catalog rows cannot be added, removed or reordered');
    assert.equal(snapshotHash(previous.mechanics), spec.beforeHash, `Unreviewed original mechanics ${spec.actionId}`);
    assert.equal(snapshotHash(next.mechanics), spec.afterHash, `Unreviewed target mechanics ${spec.actionId}`);
    assert.equal(snapshotHash(previous.targeting ?? null), spec.beforeTargetingHash, `Unreviewed original targeting ${spec.actionId}`);
    assert.equal(snapshotHash(next.targeting ?? null), spec.afterTargetingHash, `Unreviewed target targeting ${spec.actionId}`);
    const oldAllowed = {mechanics: previous.mechanics, ...(Object.hasOwn(previous, 'targeting') ? {targeting: previous.targeting} : {})};
    const newAllowed = {mechanics: next.mechanics, ...(Object.hasOwn(next, 'targeting') ? {targeting: next.targeting} : {})};
    assert.notEqual(snapshotHash(oldAllowed), snapshotHash(newAllowed), `Unchanged reviewed action ${spec.actionId}`);
    expected.state.catalogActions[index].mechanics = structuredClone(next.mechanics);
    if (Object.hasOwn(next, 'targeting')) expected.state.catalogActions[index].targeting = structuredClone(next.targeting);
    else delete expected.state.catalogActions[index].targeting;
    return {...spec};
  });
  assert.ok(changes.some(spec => pending.optionActionIds.includes(spec.actionId)), 'At least one reviewed action must belong to the saved choice');
  // Only these two revision fields may differ in addition to reviewed rules.
  const withoutBookkeeping = structuredClone(afterEnvelope);
  withoutBookkeeping.state.runtimeRevision = state.runtimeRevision;
  withoutBookkeeping.state.participantRuntimeRevisions = structuredClone(state.participantRuntimeRevisions);
  assert.deepEqual(withoutBookkeeping, expected, 'Prepared repair changes fields outside the strict rules allowlist');
  assert.equal(typeof project, 'function', 'Canonical artifact projector required');
  const projected = project(structuredClone(expected), structuredClone(character));
  assert.deepEqual(projected.envelope, afterEnvelope, 'Prepared envelope is not the canonical projection');
  assert.deepEqual(projected.patch, patch, 'Prepared character patch is not the canonical projection');
  assert.equal(patch.runtime_revision, character.runtime_revision + 1);
  assert.equal(afterEnvelope.state.runtimeRevision, patch.runtime_revision);
  assert.deepEqual(afterEnvelope.state.participantRuntimeRevisions,
    {...state.participantRuntimeRevisions, [character.id]: patch.runtime_revision});
  for (const key of Object.keys(patch)) {
    assert.ok(['current_hp', 'resources', 'max_resources', 'active_effects', 'inventory_items', 'equipment', 'turn_state', 'runtime_revision'].includes(key),
      `Unexpected character patch field ${key}`);
    if (!['turn_state', 'runtime_revision'].includes(key)) assert.deepEqual(patch[key], character[key], `Repair changes character ${key}`);
  }
  const oldTurn = structuredClone(character.turn_state), newTurn = structuredClone(patch.turn_state);
  assert.ok(oldTurn?.[SOLO_KEY] && newTurn?.[SOLO_KEY], 'Canonical dedicated combat mirror required');
  delete oldTurn[SOLO_KEY]; delete newTurn[SOLO_KEY];
  assert.deepEqual(newTurn, oldTurn, 'Only the dedicated combat mirror may change in character turn_state');

  const request = {schemaVersion: 1, type: TYPE, repairId, runId, database, reason: reason.trim(),
    expectedRunRevision: run.revision, expectedCharacterRevision: character.runtime_revision,
    characterId: character.id, previousArtifactHash: before.artifactHash, artifactHash,
    beforeHash: snapshotHash(before), afterHash: snapshotHash(afterEnvelope),
    previousCombatKey: combatKey(before), combatKey: combatKey(afterEnvelope),
    beforeTurnStateHash: snapshotHash(character.turn_state), afterTurnStateHash: snapshotHash(patch.turn_state),
    reviewedActions: changes, sourceCombatCatalogHash: snapshotHash(run.combat_catalog)};
  const requestHash = snapshotHash(request).slice(7);
  const response = {status: 'applied', type: TYPE, repair_id: repairId, run_id: runId,
    revision: run.revision + 1, character_id: character.id, runtime_revision: patch.runtime_revision,
    beforeHash: request.beforeHash, afterHash: request.afterHash, randomValues: [], sourceCombatCatalog: 'retained'};
  const auditHash = snapshotHash({run, character, afterEnvelope, patch, request});
  return {run, character, beforeEnvelope: before, afterEnvelope, patch, request, requestHash, response, auditHash};
}

/** sslmode is allowed; query parameters cannot override host/service routing. */
export function localDatabaseConnection(databaseUrl, database) {
  const url = new URL(databaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL connection required');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Local database required');
  const options = [...url.searchParams.entries()];
  assert.ok(options.every(([key]) => key === 'sslmode') && options.length <= 1,
    'Database URL options must not override the local connection');
  const sslmode = url.searchParams.get('sslmode');
  assert.ok(sslmode === null || ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(sslmode), 'Invalid PostgreSQL sslmode');
  assert.ok(/^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,62}$/.test(database ?? ''), 'Explicit named database required');
  const port = url.port || '5432'; assert.ok(/^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535);
  return {host: url.hostname === '[::1]' ? '::1' : url.hostname, port,
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database,
    ...(sslmode === null ? {} : {sslmode})};
}

/** Explicit -h/-d plus no inherited host/service routing, including Windows
 * case-insensitive environment variants. Empty PGSERVICEFILE is not equivalent
 * to absence: libpq attempts to open the empty filename. */
export function localPostgresEnvironment(connection, inherited = process.env) {
  const environment = {...inherited};
  for (const key of Object.keys(environment)) {
    if (/^PG/i.test(key)) delete environment[key];
  }
  return {...environment, PGPASSWORD: connection.password, PGSSLMODE: connection.sslmode ?? 'prefer',
    PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: '5'};
}

export function snapshotSql(plan) {
  const {request: r} = plan;
  return `BEGIN READ ONLY;
SELECT jsonb_build_object('database',current_database(),'serverAddress',host(inet_server_addr()),
 'run',to_jsonb(r),'character',(SELECT to_jsonb(c) FROM characters_v3 c WHERE c.id=${literal(r.characterId)}::uuid),
 'receipt',(SELECT to_jsonb(x) FROM roguelike_command_receipts x WHERE x.run_id=r.id AND x.command_id=${literal(r.repairId)}::uuid),
 'repairEvent',(SELECT to_jsonb(e) FROM roguelike_combat_events e WHERE e.run_id=r.id AND e.command_id=${literal(r.repairId)}::uuid AND e.combat_key=${literal(r.combatKey)} LIMIT 1),
 'eventCount',(SELECT count(*) FROM roguelike_combat_events e WHERE e.run_id=r.id),
 'newKeyEventCount',(SELECT count(*) FROM roguelike_combat_events e WHERE e.run_id=r.id AND e.combat_key=${literal(r.combatKey)}),
 'previousEvent',(SELECT to_jsonb(e) FROM roguelike_combat_events e WHERE e.run_id=r.id AND e.combat_key=${literal(r.previousCombatKey)} ORDER BY e.revision DESC,e.created_at DESC,e.id DESC LIMIT 1))
FROM roguelike_runs r WHERE r.id=${literal(r.runId)}::uuid;
ROLLBACK;`;
}

export function validateDatabaseSnapshot(observed, plan) {
  assert.ok(observed, 'Named run not found');
  assert.equal(observed.database, plan.request.database, 'Connected database differs');
  assert.ok(['127.0.0.1', '::1'].includes(observed.serverAddress), 'Database server must itself be local; tunnels are not permitted');
  if (observed.receipt) {
    assert.equal(observed.receipt.command_type, TYPE, 'Repair ID already used by another command');
    assert.equal(observed.receipt.request_hash, plan.requestHash, 'Repair ID reused for different prepared inputs');
    assert.equal(observed.receipt.user_id, plan.run.user_id, 'Repair receipt owner differs');
    assert.deepEqual(observed.receipt.response, plan.response, 'Stored repair receipt differs');
    return 'already_applied';
  }
  assert.deepEqual(observed.run, plan.run, 'Run changed since prepared snapshot');
  assert.equal(observed.character?.id, plan.character.id);
  assert.equal(observed.character?.user_id, plan.run.user_id);
  assert.equal(observed.character?.character_type, 'dungeon_crawl');
  for (const key of ['runtime_revision', 'turn_state', 'current_hp', 'resources', 'max_resources', 'active_effects', 'inventory_items', 'equipment']) {
    assert.deepEqual(observed.character[key], plan.character[key], `Character ${key} changed since prepared snapshot`);
  }
  assert.equal(observed.newKeyEventCount, 0, 'New pinned artifact already has a journal segment');
  if (observed.previousEvent) assert.equal(observed.previousEvent.record.afterHash, plan.request.beforeHash, 'Previous journal does not end at the prepared envelope');
  return 'ready';
}

/** One transaction, real stored ownership, idempotent receipt, append-only journal. */
export function applySql(plan, observed) {
  const {request: r, run, character, patch} = plan;
  const record = {schemaVersion: 1, type: TYPE, reason: r.reason,
    previousArtifactHash: r.previousArtifactHash, artifactHash: r.artifactHash,
    previousCombatKey: r.previousCombatKey, beforeHash: r.beforeHash, afterHash: r.afterHash,
    previousJournalEventId: observed.previousEvent?.id ?? null,
    randomValues: [], runtimeRevision: patch.runtime_revision,
    baseline: plan.afterEnvelope, baselinePosition: 'after',
    repair: {requestHash: plan.requestHash, auditHash: plan.auditHash, reviewedActions: r.reviewedActions,
      beforeTurnStateHash: r.beforeTurnStateHash, afterTurnStateHash: r.afterTurnStateHash,
      runRevision: [run.revision, run.revision + 1], characterRevision: [character.runtime_revision, patch.runtime_revision],
      pendingContext: 'preserved exactly', entropy: 'preserved; zero draws', sourceCombatCatalog: 'retained'}};
  const delimiter = `$repair_${plan.requestHash}$`;
  assert.ok(!json([run, character, patch, plan.afterEnvelope, record, r, plan.response]).includes(delimiter), 'Reserved SQL delimiter in prepared input');
  integer(Number(run.encounter?.number ?? 0), 'Encounter number');
  const characterCas = ['runtime_revision', 'turn_state', 'current_hp', 'resources', 'max_resources', 'active_effects', 'inventory_items', 'equipment']
    .map(key => `COALESCE(to_jsonb(locked_character.${key}),'null'::jsonb) IS NOT DISTINCT FROM ${jsonLiteral(character[key])}`).join('\n   AND ');
  return `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL standard_conforming_strings=on;
DO ${delimiter}
DECLARE locked_run roguelike_runs%ROWTYPE; locked_character characters_v3%ROWTYPE; receipt roguelike_command_receipts%ROWTYPE;
BEGIN
 SELECT * INTO locked_run FROM roguelike_runs WHERE id=${literal(r.runId)}::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Named local run not found'; END IF;
 SELECT * INTO locked_character FROM characters_v3 WHERE id=${literal(r.characterId)}::uuid AND user_id=locked_run.user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owned local character not found'; END IF;
 SELECT * INTO receipt FROM roguelike_command_receipts WHERE run_id=locked_run.id AND command_id=${literal(r.repairId)}::uuid;
 IF FOUND THEN
  IF receipt.command_type<>${literal(TYPE)} OR receipt.request_hash<>${literal(plan.requestHash)} OR receipt.user_id<>locked_run.user_id
   OR receipt.response<>${jsonLiteral(plan.response)} THEN RAISE EXCEPTION 'Repair ID already used'; END IF;
  RETURN;
 END IF;
 IF to_jsonb(locked_run)<>${jsonLiteral(run)} THEN RAISE EXCEPTION 'Run changed; repair aborted'; END IF;
 IF locked_run.revision<>${run.revision} OR locked_run.combat_envelope<>${jsonLiteral(plan.beforeEnvelope)}
  OR locked_run.character_id<>locked_character.id OR locked_run.user_id<>${literal(run.user_id)}::uuid
  OR locked_character.character_type<>'dungeon_crawl' OR NOT (${characterCas})
  THEN RAISE EXCEPTION 'Encounter or character changed; repair aborted'; END IF;
 IF EXISTS(SELECT 1 FROM roguelike_combat_events WHERE run_id=locked_run.id AND combat_key=${literal(r.combatKey)})
  THEN RAISE EXCEPTION 'New artifact journal segment already exists'; END IF;
 UPDATE roguelike_runs SET combat_envelope=${jsonLiteral(plan.afterEnvelope)},revision=${run.revision + 1},updated_at=NOW() WHERE id=locked_run.id;
 UPDATE characters_v3 SET turn_state=${jsonLiteral(patch.turn_state)},runtime_revision=${patch.runtime_revision},updated_at=NOW() WHERE id=locked_character.id;
 INSERT INTO roguelike_combat_events(id,run_id,command_id,revision,combat_key,attempt,encounter_number,record,created_at)
 VALUES(gen_random_uuid(),locked_run.id,${literal(r.repairId)}::uuid,${run.revision + 1},${literal(r.combatKey)},${run.attempt},${Number(run.encounter?.number ?? 0)},${jsonLiteral(record)},NOW());
 INSERT INTO roguelike_command_receipts(id,run_id,user_id,command_id,command_type,request_hash,response,request,created_at)
 VALUES(gen_random_uuid(),locked_run.id,locked_run.user_id,${literal(r.repairId)}::uuid,${literal(TYPE)},${literal(plan.requestHash)},${jsonLiteral(plan.response)},${jsonLiteral(r)},NOW());
END;
${delimiter};
SELECT response FROM roguelike_command_receipts WHERE run_id=${literal(r.runId)}::uuid AND command_id=${literal(r.repairId)}::uuid;
COMMIT;`;
}

function cli(argv) {
  const options = {mode: 'plan'};
  if (['plan', 'apply'].includes(argv[0])) options.mode = argv.shift();
  for (let i = 0; i < argv.length; i += 2) {
    assert.ok(/^--[a-z-]+$/.test(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('--'), 'Expected named option and value');
    const key = argv[i].slice(2); assert.ok(!Object.hasOwn(options, key), `Duplicate option ${key}`);
    assert.ok(['run', 'database', 'before-run', 'character-before', 'after-envelope', 'after-patch', 'reviewed-actions', 'artifact', 'repair-id', 'reason', 'config', 'psql', 'audit-dir', 'worker-origin'].includes(key), `Unknown option ${key}`);
    options[key] = argv[i + 1];
  }
  for (const key of ['run', 'database', 'before-run', 'character-before', 'after-envelope', 'after-patch', 'reviewed-actions', 'artifact', 'repair-id', 'reason']) assert.ok(options[key], `--${key} is required`);
  return options;
}

export async function writePrivateAudit(directory, plan) {
  await mkdir(directory, {recursive: true, mode: 0o700});
  for (const [name, value] of Object.entries({'before-run.json': plan.run, 'character-before.json': plan.character,
    'before-envelope.json': plan.beforeEnvelope, 'after-envelope.json': plan.afterEnvelope,
    'after-character-patch.json': plan.patch, 'repair-request.json': plan.request,
    'repair-audit.json': {requestHash: plan.requestHash, auditHash: plan.auditHash, response: plan.response}})) {
    const file = path.join(directory, name), bytes = json(value) + '\n';
    try { await writeFile(file, bytes, {flag: 'wx', mode: 0o600}); }
    catch (error) { if (error.code !== 'EEXIST') throw error;
      assert.equal(await readFile(file, 'utf8'), bytes, `Existing private backup differs: ${name}`); }
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = cli([...argv]);
  const readJson = async file => JSON.parse(await readFile(path.resolve(file), 'utf8'));
  const [run, character, afterEnvelope, patch, reviewedActions, artifactBytes] = await Promise.all([
    readJson(args['before-run']), readJson(args['character-before']), readJson(args['after-envelope']),
    readJson(args['after-patch']), readJson(args['reviewed-actions']), readFile(path.resolve(args.artifact)),
  ]);
  const artifactHash = `sha256:${createHash('sha256').update(artifactBytes).digest('hex')}`;
  const artifact = require(path.resolve(args.artifact));
  const plan = preparePendingRulesRepair({run, character, afterEnvelope, patch, reviewedActions, artifactHash,
    project: artifact.projectRoguelikeCombatPatch, runId: args.run, repairId: args['repair-id'], database: args.database, reason: args.reason});
  const dev = path.join(process.env.LOCALAPPDATA ?? '', 'dnd-cards-dev');
  const config = await readJson(args.config ?? path.join(dev, 'local-env.json'));
  const db = localDatabaseConnection(config.DATABASE_URL, args.database);
  const psql = args.psql ?? path.join(dev, 'tools', 'postgresql-17.11', 'pgsql', 'bin', 'psql.exe');
  const query = sql => {
    const result = spawnSync(psql, ['-h', db.host, '-p', db.port, '-U', db.user, '-d', db.database, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
      {input: sql, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024,
        env: localPostgresEnvironment(db)});
    if (result.error || result.status !== 0) throw Error('Local database operation failed; no uncommitted repair was saved');
    const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('{'));
    assert.ok(line, 'Named run/receipt not found'); return JSON.parse(line);
  };
  const observed = query(snapshotSql(plan));
  const status = validateDatabaseSnapshot(observed, plan);
  const summary = {mode: args.mode, status, runId: args.run, repairId: args['repair-id'], database: args.database,
    runRevision: [run.revision, run.revision + 1], characterRevision: [character.runtime_revision, patch.runtime_revision],
    previousArtifactHash: run.combat_envelope.artifactHash, artifactHash,
    reviewedActions: plan.request.reviewedActions.map(row => row.actionId), beforeHash: plan.request.beforeHash, afterHash: plan.request.afterHash,
    pendingContext: 'preserved exactly', entropy: 'unchanged; zero draws', characterRuntime: 'unchanged; mirror/revision only', sourceCombatCatalog: 'retained'};
  if (args.mode === 'plan' || status === 'already_applied') {console.log(json(summary)); return summary;}
  const origin = new URL(args['worker-origin'] ?? 'http://127.0.0.1:8090');
  assert.ok(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) && !origin.username && !origin.password, 'Local worker origin required');
  const healthResponse = await fetch(new URL('/health', origin), {redirect: 'error'});
  assert.ok(healthResponse.ok, 'Local worker health check failed');
  assert.equal((await healthResponse.json()).artifactHash, artifactHash, 'Restart the local worker with the reviewed artifact first');
  const auditDirectory = path.resolve(args['audit-dir'] ?? 'outputs/pending-rules-local-repair', args['repair-id']);
  await writePrivateAudit(auditDirectory, plan); // Must succeed before any SQL writes.
  const receipt = query(applySql(plan, observed)); assert.deepEqual(receipt, plan.response);
  const verified = query(snapshotSql(plan));
  assert.deepEqual(verified.receipt.response, plan.response);
  // A following normal command may win immediately after commit; the receipt
  // remains authoritative. In the unchanged revision, verify the complete repair.
  if (verified.run.revision === run.revision + 1) {
    assert.deepEqual(verified.run.combat_envelope, afterEnvelope);
    assert.deepEqual(verified.run.combat_catalog, run.combat_catalog);
    assert.equal(verified.character.runtime_revision, patch.runtime_revision);
    assert.deepEqual(verified.character.turn_state, patch.turn_state);
    for (const key of ['current_hp', 'resources', 'max_resources', 'active_effects', 'inventory_items', 'equipment']) {
      assert.deepEqual(verified.character[key], character[key], `Committed repair changed character ${key}`);
    }
    assert.equal(verified.eventCount, observed.eventCount + 1);
  }
  assert.equal(verified.repairEvent?.record.beforeHash, plan.request.beforeHash);
  assert.equal(verified.repairEvent?.record.afterHash, plan.request.afterHash);
  assert.deepEqual(verified.repairEvent?.record.baseline, afterEnvelope);
  const auditAfter = path.join(auditDirectory, `after-database-revision-${verified.run.revision}.json`);
  await writeFile(auditAfter, json(verified) + '\n', {flag: 'wx', mode: 0o600});
  await writeFile(path.join(auditDirectory, 'applied-receipt.json'), json(receipt) + '\n', {flag: 'wx', mode: 0o600});
  const result = {...summary, status: 'verified', auditDirectory}; console.log(json(result)); return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const message = error instanceof assert.AssertionError
      ? String(error.message).split(/[\r\n]/)[0].slice(0, 500)
      : 'Invalid prepared input or failed local operation; private diagnostics omitted';
    console.error(`Pending rules local repair rejected: ${message}`); process.exitCode = 1;
  });
}
