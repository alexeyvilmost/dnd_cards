// Storage canaries only. Never a production seed or a historical certificate.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {repositoryRoot} from './runtime.mjs';
import {assertTestDsn} from './guards.mjs';
import {insertFixtureRows} from './fixtures.mjs';
import {snapshotHash} from '../../frontend/worker/server.mjs';

export const fixtureHash=bytes=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export async function seedUpgradeBaseline(stack,baseline){
  assert([297,298,299].includes(baseline));assertTestDsn(stack.database.dsn,stack.registry);
  assert.equal((await stack.database.query('SELECT run_id FROM test_run_ownership;')).trim(),stack.registry.runId);
  const sources={};
  async function source(relative){const bytes=await readFile(path.join(repositoryRoot,relative));sources[relative]=fixtureHash(bytes);return bytes;}
  const manifest=JSON.parse(await source('scripts/testing/fixtures/schema-manifest.json'));
  const schema=(await source('scripts/testing/fixtures/schema.sql')).toString().replace(/\r+\n/g,'\n');
  assert.equal(manifest.format,1);assert.equal(manifest.historicalChainVerified,false);assert.equal(manifest.migrationBaseline,'297_retain_generic_spell_free_uses');
  assert.equal(fixtureHash(schema),`sha256:${manifest.schemaSha256}`);
  assert(!/^\s*\\/m.test(schema)&&!/^(?:COPY|INSERT INTO) /m.test(schema),'Schema fixture must not contain rows/psql commands');
  assert.equal((await stack.database.query("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name<>'test_run_ownership';")).trim(),'0');
  await stack.database.query(schema);
  const versions=manifest.migrations.map(row=>row.version);assert.equal(new Set(versions).size,versions.length);assert.equal(versions.at(-1),manifest.migrationBaseline);
  for(const id of versions)assert(/^\d{3}_[a-z0-9_]+$/.test(id));
  await stack.database.query(`INSERT INTO schema_migrations(version,description,executed_at) VALUES ${versions.map(id=>`('${id}','Imported checked-in schema297 baseline; historical Up not executed','2026-01-01T00:00:00Z')`).join(',')};`);
  const base='frontend/worker/fixtures/replay-v1/';
  const artifactManifest=JSON.parse(await source(base+'manifest.json')),packed=await source(base+artifactManifest.artifactFile);
  assert.equal(fixtureHash(packed),artifactManifest.compressedHash);const artifact=gunzipSync(packed);assert.equal(fixtureHash(artifact),artifactManifest.artifactHash);
  const corpusManifest=JSON.parse(await source(base+'corpus-manifest.json')),packedCorpus=await source(base+corpusManifest.corpusFile);
  assert.equal(fixtureHash(packedCorpus),corpusManifest.compressedHash);const corpusBytes=gunzipSync(packedCorpus);assert.equal(fixtureHash(corpusBytes),corpusManifest.corpusHash);
  const corpus=JSON.parse(corpusBytes);assert.equal(corpus.fixtureKind,'synthetic-local-only');assert.equal(corpus.artifactHash,artifactManifest.artifactHash);assert.equal(corpus.sourceCommit,artifactManifest.sourceCommit);
  const combat=corpus.cases.find(row=>row.name==='combat-initialize'),held=corpus.cases.find(row=>row.name==='journey-str-held');assert(combat&&held);
  for(const row of [combat,held])assert.equal(snapshotHash(row.response),row.responseHash);
  assert.equal(held.response.envelope.phase,'influence');assert(held.response.envelope.cursor>0);assert(combat.response.envelope.entropy.cursor>0);
  const artifactFile=path.join(stack.registry.directory,'retained-artifact.cjs');await writeFile(artifactFile,artifact,{flag:'wx',mode:0o600});
  const user='e3000000-0000-4000-8000-000000000001',run='e3000000-0000-4000-8000-000000000002',command='e3000000-0000-4000-8000-000000000003',event='e3000000-0000-4000-8000-000000000004',action='e3000000-0000-4000-8000-000000000005';
  const character=combat.request.input.character.id,hash=artifactManifest.artifactHash,at='2026-01-01T00:00:00Z';
  await insertFixtureRows(stack.database,'users',[{id:user,username:'qa_upgrade_canary',display_name:'Synthetic storage canary',password_hash:'disabled-local-fixture',is_admin:false,created_at:at,updated_at:at}]);
  await insertFixtureRows(stack.database,'characters_v3',[{...combat.request.input.character,user_id:user,group_id:null,current_encounter_id:null,created_at:at,updated_at:at}]);
  await insertFixtureRows(stack.database,'roguelike_runs',[{id:run,user_id:user,source_character_id:character,character_id:character,status:'active',phase:'combat',revision:7,run_seed:'synthetic-upgrade-canary',combat_envelope:combat.response.envelope,combat_catalog:combat.request.input.catalog,journey_private:{syntheticHeldCheck:held.response.envelope},created_at:at,updated_at:at}]);
  await insertFixtureRows(stack.database,'roguelike_command_receipts',[{id:command,run_id:run,user_id:user,command_id:command,command_type:'initialize_combat',request_hash:snapshotHash(combat.request).slice(7),request:combat.request,response:combat.response,created_at:at}]);
  await stack.database.query(`INSERT INTO character_runtime_commands(user_id,command_id,request_hash,ruleset_ref,response,created_at) SELECT '${user}','${command}','${snapshotHash(held.request)}',jsonb_build_object('artifact_hash','${hash}'),response,'${at}' FROM roguelike_command_receipts WHERE id='${command}';`);
  await insertFixtureRows(stack.database,'roguelike_combat_events',[{id:event,run_id:run,command_id:command,revision:7,combat_key:'a'.repeat(64),attempt:1,encounter_number:1,record:{schemaVersion:1,type:'initialize_combat',artifactHash:hash,baseline:combat.response.envelope,baselinePosition:'after'},created_at:at}]);
  await insertFixtureRows(stack.database,'character_events',[{id:event,character_id:character,ts:at,type:'synthetic_upgrade_canary',payload:{artifactHash:hash,held:held.response.envelope},created_at:at,client_event_id:command}]);
  await insertFixtureRows(stack.database,'actions',[{id:action,card_number:'TEST-UPGRADE-CANARY',name:'Synthetic unreviewed storage canary',description:'No executable gameplay operation; migration preservation only',action_type:'base_action',mechanics:{},created_at:at,updated_at:at}]);
  await stack.database.query(`UPDATE actions SET support='{"status":"not_verified","note":"Synthetic unreviewed metadata preservation canary"}'::jsonb WHERE id='${action}'; INSERT INTO content_review_support_archive(entity_table,entity_id,support,archived_at,migration_version) SELECT 'actions',id::text,support,'${at}','synthetic_storage_canary' FROM actions WHERE id='${action}';`);
  const input={schemaVersion:1,runId:stack.registry.runId,baseline,versions,schemaHash:fixtureHash(schema),artifactHash:hash,historicalChainVerified:false};
  await writeFile(path.join(stack.registry.directory,'baseline-matrix-input.json'),JSON.stringify(input,null,2)+'\n',{flag:'wx',mode:0o600});
  return {input,sources,artifactFile};
}
