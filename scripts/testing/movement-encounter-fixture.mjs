import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertTestDsn} from './guards.mjs';
import {localAcceptanceContext} from './acceptance-context.mjs';
import {cleanEnvironment,execute,resolveTool,repositoryRoot} from './runtime.mjs';

// Playwright's Node loader does not bundle JSON imports from the application.
// Bundle the existing read-only projection, just as the performance bridge does;
// this is not a second pathfinder and does not build or overwrite frontend/dist.
let projection;
export async function loadMovementProjection(env=process.env) {
  const local=await localAcceptanceContext(env);
  if(!projection)projection=(async()=>{
    const {build}=createRequire(new URL('../../frontend/package.json',import.meta.url))('esbuild');
    const outfile=path.join(local.output,`movement-projection-${process.pid}.mjs`);
    await build({stdin:{contents:"export {actorFootprint,footprintDistanceFt} from './frontend/src/solo-combat/footprint'; export {combatActionRangeFt,combatApproachRoute} from './frontend/src/solo-combat/defaultInteraction';",resolveDir:repositoryRoot},bundle:true,platform:'node',format:'esm',outfile,logLevel:'silent'});
    return import(pathToFileURL(outfile).href);
  })();
  return projection;
}

const uuid=/^[a-f0-9-]{36}$/i;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export async function updateTrainingEntity(api,changes,kind,before,patch) {
  assert.ok(['actions','monsters'].includes(kind));assert.match(before.id,uuid);
  assert.equal(before.source,'Local tests','Training fixture must not modify an unrelated catalog entity');
  const resource=`/${kind}/${before.id}`;
  // NameEn is unconditionally assigned by the action controller even for a
  // mechanics-only PUT, so preserve it explicitly in both directions.
  const restore=kind==='actions'?{mechanics:before.mechanics,name_en:before.name_en??null}:before;
  const keys=kind==='actions'?['mechanics','name_en']:['name','name_en','description','size','creature_type','alignment','challenge_rating','armor_class','max_hp','speed','initiative_bonus','proficiency_bonus','abilities','action_ids','effect_ids','ai','token_url','source'];
  changes.push({resource,restore,expected:Object.fromEntries(keys.map(key=>[key,before[key]??null]))});
  await api.request('PUT',resource,{...patch,...(kind==='actions'?{name_en:before.name_en??null}:{})});
}

export async function restoreTrainingEntities(api,changes,temporaryEffectId) {
  const failures=[];
  for(const change of [...changes].reverse()) {
    try{await api.request('PUT',change.resource,change.restore);}catch{failures.push(`${change.resource}: restore failed`);}
    // Always attempt the remaining restores and reread every affected mutable
    // declaration. Never let the first rejected/unknown PUT abandon cleanup.
    try{
      const actual=await api.request('GET',change.resource);
      const selected=Object.fromEntries(Object.keys(change.expected).map(key=>[key,actual[key]??null]));
      if(JSON.stringify(canonical(selected))!==JSON.stringify(canonical(change.expected)))throw Error('mismatch');
    }catch{failures.push(`${change.resource}: restored declaration not verified`);}
  }
  if(temporaryEffectId){
    assert.match(temporaryEffectId,uuid);
    try{await api.request('DELETE',`/effects/${temporaryEffectId}`);}catch{failures.push('temporary effect: delete failed');}
    try{await api.request('GET',`/effects/${temporaryEffectId}`,undefined,404);}catch{failures.push('temporary effect: deletion not verified');}
  }
  if(failures.length)throw new AggregateError(failures.map(message=>Error(message)),'Training catalog cleanup failed; stand is not acceptable');
}

export function assertUninitializedMovementEncounter(run,owner) {
  assert.match(run?.id??'',uuid);assert.match(owner??'',uuid);
  assert.equal(run.revision,1,'Only the just-created encounter may be arranged');
  assert.equal(run.phase,'combat');
  assert.ok(!run.combat_state,'An initialized combat is immutable to this fixture');
  assert.ok(run.encounter&&typeof run.encounter==='object');
}

/** Scenery input only, before the first worker initialization. No combat RNG,
 * envelope, character, accepted receipt or journal row is edited. SQL repeats
 * ownership and initialization guards even if the caller passes stale data. */
export async function arrangeMovementEncounter(run,owner,env=process.env) {
  assertUninitializedMovementEncounter(run,owner);
  const local=await localAcceptanceContext(env);
  const dsn=new URL(assertTestDsn(env.TEST_DATABASE_URL,local.registry));
  const literal=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
  const sql=`BEGIN;
    WITH owned AS (SELECT 1 FROM test_run_ownership WHERE run_id='${local.registry.runId}'),
    changed AS (UPDATE roguelike_runs SET encounter=encounter || '{"map_id":"clearing-v1","map_seed":7}'::jsonb
      WHERE id='${run.id}' AND user_id='${owner}' AND revision=1 AND phase='combat'
      AND encounter=${literal(run.encounter)} AND combat_envelope='{}'::jsonb AND combat_catalog='{}'::jsonb
      AND EXISTS(SELECT 1 FROM owned)
      AND (SELECT count(*) FROM roguelike_command_receipts WHERE run_id='${run.id}')=1
      AND NOT EXISTS(SELECT 1 FROM roguelike_combat_events WHERE run_id='${run.id}') RETURNING id)
    SELECT count(*) FROM changed;
    COMMIT;`;
  const output=await execute(resolveTool('psql',local.registry.database.psql),[
    '-X','-qAt','-v','ON_ERROR_STOP=1','-h',dsn.hostname,'-p',dsn.port,'-U',dsn.username,'-d',local.registry.runId,
  ],{env:cleanEnvironment({PGPASSWORD:decodeURIComponent(dsn.password),PGOPTIONS:'-c statement_timeout=5000 -c log_min_error_statement=PANIC'}),input:sql});
  assert.equal(output.trim(),'1','Encounter fixture refused foreign, changed or initialized state');
  return {mapId:'clearing-v1',mapSeed:7,combatEntropyModified:false};
}
