#!/usr/bin/env node
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startTestStack} from '../testing/stack.mjs';
import {localAcceptanceContext} from '../testing/acceptance-context.mjs';
import {readRunInvariant} from '../testing/acceptance-observer.mjs';
import {captureNativeBackup} from './native-backup.mjs';
import {evidenceHash} from './validate-manifest.mjs';
async function connect(stack, credentials) {
  const local = await localAcceptanceContext(stack.env); let token;
  async function request(method, resource, body, status = 200) {
    const response = await local.request(`/api${resource}`, {method, headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {})}, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000)});
    const result = await response.json(); assert.equal(response.status, status, `${method} ${resource}: unexpected status`); return result;
  }
  const auth = await request('POST', '/auth/login', credentials ?? local.player); token = auth.token;
  return {local, request};
}
function decline(state) {
  if (state.pendingAlertSwapActorIds?.length) return {type: 'alert_swap', actorId: state.pendingAlertSwapActorIds[0], allyActorId: null};
  if (state.pendingD20Interrupt) return {type: 'd20_interrupt', actorId: null};
  if (state.pendingTriggeredAction) return {type: 'triggered_action', actionId: null};
  if (state.world.pendingResolution?.request.type === 'reaction') return {type: 'reaction', response: {kind: 'reaction', actionId: null}};
  if (state.world.pendingResolution?.request.type === 'saving_throw') return {type: 'saving_throw'};
  if (state.world.scene.initiative[state.world.scene.activeIndex] !== state.characterId) return {type: 'resume'};
}
export async function runRestoreDrill({go, pgBin, output, compactReceipts = false, frozenCatalogs = false} = {}) {
  let source, restored, backup; const started = performance.now();
  const report = {schemaVersion: 1, scope: 'owned-synthetic-recovery', status: 'running', checks: [], limitations: ['synthetic local integration data', 'new current CJS byte revision is a comment-only routing fixture; not all historical production artifacts', 'media URLs restored, off-host object bytes not copied', 'UI assets reuse existing local build; browser correctness belongs to TEST-04']};
  try {
    source = await startTestStack({profile: 'integration', reuseBuild: true, go, pgBin, compactReceipts, frozenCatalogs});
    const api = await connect(source), admin = await connect(source, api.local.admin);
    const templates = await api.request('GET', '/character-templates'), template = templates.templates.find(row => row.preset_key === 'archer'); assert(template);
    let character = await api.request('POST', `/character-templates/${template.id}/copies`, {name: 'Owned recovery archer'}, 201);
    const mediaReference = `${source.registry.origins.ui}/assets/owned-recovery-reference.svg`;
    character = await api.request('PUT', `/characters-v3/${character.id}`, {...character, avatar_url: mediaReference});
    assert.equal(character.avatar_url, mediaReference);
    let run = (await api.request('POST', '/roguelike/runs', {source_character_id: character.id}, 201)).run;
    async function command(type, payload = {}) {
      const body = {command_id: randomUUID(), expected_revision: run.revision, type, payload};
      const result = await api.request('POST', `/roguelike/runs/${run.id}/commands`, body); run = result.run; return {body, result};
    }
    // Declare durable fixture opponents before pinning, through the normal admin API.
    const monsters = (await admin.request('GET', '/monsters?limit=100')).monsters;
    assert.equal(monsters.length, 2); assert(monsters.every(row => row.source === 'Local tests'));
    try {
      for (const monster of monsters) await admin.request('PUT', `/monsters/${monster.id}`, {...monster, max_hp: 1000});
      await command('start_encounter'); await command('initialize_combat');
    } finally {for (const monster of monsters) await admin.request('PUT', `/monsters/${monster.id}`, monster);}
    for (let i = 0; i < 30; i++) {const intent = decline(run.combat_state); if (!intent) break; await command('combat_intent', {intent});}
    assert.equal(decline(run.combat_state), undefined, 'Initial authoritative choices did not settle');
    const before = run.combat_state, actorId = before.characterId;
    const action = before.catalogActions.find(row => row.mechanics?.primitive?.type === 'weapon_attack' && row.mechanics.effects?.some(effect => effect.attack_kind === 'weapon_ranged'));
    const target = Object.values(before.world.actors).find(row => row.kind === 'monster' && row.runtime.hp.current > 0); assert(action && target);
    const accepted = await command('combat_intent', {intent: {type: 'approach_action', actorId, actionId: action.id, targetActorId: target.id}});
    const held = run.combat_state.pendingD20Interrupt; assert.equal(held?.operation, 'roll_influence');
    assert.equal(evidenceHash(run.combat_state.world.actors[target.id].runtime.hp), evidenceHash(target.runtime.hp), 'Damage applied before pending choice');
    const invariantBefore = await readRunInvariant(api.local, run.id, accepted.body.command_id, source.env);
    const heldHash = evidenceHash(held);
    if(frozenCatalogs) {
      const count=Number((await source.database.query('SELECT count(*) FROM roguelike_runs WHERE combat_catalog_ref IS NOT NULL;')).trim());
      assert(count>0,'No new immutable catalog was referenced');report.frozenCatalogs=count;
    }
    if (compactReceipts) {
      const count=Number((await source.database.query('SELECT count(*) FROM roguelike_command_receipts WHERE response_version=2;')).trim());
      assert(count>0,'Compact receipt recovery did not create version 2 rows');
      report.compactReceipts=count;
    }
    backup = await captureNativeBackup(source);
    const mediaManifest = JSON.parse(await readFile(path.join(backup.directory, 'media-references.json'), 'utf8'));
    assert(mediaManifest.references.includes(mediaReference), 'Recovery media inventory is empty or omitted the owned avatar');
    report.mediaReferenceCount = mediaManifest.references.length;
    report.backupHash = evidenceHash(backup.manifest); report.schemaFingerprint = backup.manifest.schemaFingerprint;
    report.sourceRunId = source.registry.runId; report.snapshotBytes = backup.manifest.files.find(file => file.category === 'database').bytes;
    report.snapshotDurationMs = backup.manifest.snapshotDurationMs;
    const priorArtifact = path.join(source.registry.directory, 'rules-artifacts', `${source.registry.artifactHash.slice(7)}.cjs`);
    const revision = path.join(source.registry.directory, 'recovery-current-artifact.cjs');
    await writeFile(revision, Buffer.concat([await readFile(priorArtifact), Buffer.from('\n// Owned restore routing fixture: new byte identity, unchanged operations.\n')]), {flag: 'wx', mode: 0o600});
    // The restored target intentionally disables the new writer. Existing v2
    // receipts must still replay, while subsequent commands may use version 1.
    restored = await startTestStack({recoverySnapshot: backup.directory, recoveryWorkerArtifact: revision, reuseBuild: true, go, pgBin});
    assert.notEqual(restored.registry.artifactHash, source.registry.artifactHash);
    report.restoredRunId = restored.registry.runId; report.restoreDurationMs = restored.registry.fixture.restoreDurationMs;
    report.checks.push(...restored.registry.fixture.checks);
    const recoveredAPI = await connect(restored, api.local.player);
    const recovered = (await recoveredAPI.request('GET', `/roguelike/runs/${run.id}`)).run;
    assert.equal(evidenceHash(recovered), evidenceHash(run), 'Full restored run differs');
    assert.equal(evidenceHash(recovered.combat_state.pendingD20Interrupt), heldHash);
    assert.deepEqual(await readRunInvariant(recoveredAPI.local, run.id, accepted.body.command_id, restored.env), invariantBefore);
    assert.deepEqual(await recoveredAPI.request('POST', `/roguelike/runs/${run.id}/commands`, accepted.body), accepted.result);
    assert.deepEqual(await readRunInvariant(recoveredAPI.local, run.id, accepted.body.command_id, restored.env), invariantBefore, 'Restored prior receipt changed RNG/history');
    const offered = held.responders.find(row => row.effectId); assert(offered, 'No authoritative offered influence');
    const canonical = JSON.parse(await readFile(new URL('../../frontend/src/engine/data/rollInfluences.json', import.meta.url), 'utf8'));
    const chosen = canonical.find(row => row.id === offered.effectId) ?? recovered.combat_state.catalogActions.find(row => row.id === offered.effectId)?.mechanics;
    assert(chosen?.activation?.cost?.length, 'Influence must declare a real resource price');
    const body = {command_id: randomUUID(), expected_revision: recovered.revision, type: 'combat_intent', payload: {intent: {type: 'd20_interrupt', actorId, effectId: offered.effectId}}};
    const completed = await recoveredAPI.request('POST', `/roguelike/runs/${run.id}/commands`, body);
    const after = await readRunInvariant(recoveredAPI.local, run.id, body.command_id, restored.env);
    assert.equal(after.command_receipts, 1); assert.equal(completed.run.combat_state.pendingD20Interrupt ?? null, null);
    for (const cost of chosen.activation.cost) assert.equal(completed.run.combat_state.world.actors[actorId].runtime.resources[cost.resource], before.world.actors[actorId].runtime.resources[cost.resource] - Number(cost.amount ?? 1));
    const inventory = before.world.actors[actorId].runtime.inventory, finalInventory = completed.run.combat_state.world.actors[actorId].runtime.inventory;
    const spent = inventory.filter(row => Number(finalInventory.find(item => item.cardId === row.cardId)?.qty ?? 0) !== Number(row.qty));
    assert.equal(spent.length, 1); assert.equal(finalInventory.find(item => item.cardId === spent[0].cardId)?.qty ?? 0, spent[0].qty - 1);
    assert.deepEqual(await recoveredAPI.request('POST', `/roguelike/runs/${run.id}/commands`, body), completed);
    assert.deepEqual(await readRunInvariant(recoveredAPI.local, run.id, body.command_id, restored.env), after);
    report.checks.push({id: 'pending-decision', status: 'passed', heldHash, previousArtifact: source.registry.artifactHash, currentArtifact: restored.registry.artifactHash},
      {id: 'duplicate-command', status: 'passed', before: invariantBefore, after});
    assert.match(run.id, /^[a-f0-9-]{36}$/);
    assert.equal((await restored.database.query(`SELECT combat_envelope->>'artifactHash' FROM roguelike_runs WHERE id='${run.id}';`)).trim(), source.registry.artifactHash, 'Restored history was rebound to current rules');
    const currentCharacter = await recoveredAPI.request('POST', `/character-templates/${template.id}/copies`, {name: 'Owned current recovery rules'}, 201);
    let currentRun = (await recoveredAPI.request('POST', '/roguelike/runs', {source_character_id: currentCharacter.id}, 201)).run;
    for (const type of ['start_encounter', 'initialize_combat']) currentRun = (await recoveredAPI.request('POST', `/roguelike/runs/${currentRun.id}/commands`, {command_id: randomUUID(), expected_revision: currentRun.revision, type, payload: {}})).run;
    assert(currentRun.combat_state); assert.match(currentRun.id, /^[a-f0-9-]{36}$/);
    assert.equal((await restored.database.query(`SELECT combat_envelope->>'artifactHash' FROM roguelike_runs WHERE id='${currentRun.id}';`)).trim(), restored.registry.artifactHash);
    report.checks.push({id: 'current-artifact', status: 'passed', artifactHash: restored.registry.artifactHash});
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = 'restore-drill-check-failed'; throw error;
  } finally {
    const cleanup = [];
    for (const stack of [restored, source].filter(Boolean)) {
      try {await stack.cleanup(); cleanup.push({runId: stack.registry.runId, status: stack.registry.status});}
      catch {cleanup.push({runId: stack.registry.runId, status: 'cleanup_failed'}); report.status = 'failed';}
    }
    report.cleanup = cleanup; report.totalDurationMs = performance.now() - started;
    if (backup) await writeFile(path.join(backup.directory, 'restore-report.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  }
  assert.equal(report.status, 'passed'); return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {}; for (let i = 2; i < process.argv.length; i += 2) {const key = {'--go': 'go', '--pg-bin': 'pgBin', '--output': 'output', '--compact-receipts':'compactReceipts','--frozen-catalogs':'frozenCatalogs'}[process.argv[i]]; if (!key || !process.argv[i + 1]) throw Error('Expected a known option/value'); const flag=['compactReceipts','frozenCatalogs'].includes(key); options[key] = flag ? process.argv[i+1]==='1' : process.argv[i + 1]; if(flag&&!['0','1'].includes(process.argv[i+1]))throw Error('Storage flags must be 0 or 1'); }
  try {const report = await runRestoreDrill(options); console.log(`PASS: owned snapshot restored, retained artifact pending decision and duplicate commands; ${Math.round(report.restoreDurationMs)} ms restore.`);}
  catch (error) {console.error(`Restore drill failed: ${error.message}`); process.exitCode = 1;}
}
