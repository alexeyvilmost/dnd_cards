import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {laughterTargetingPatch,targetingRepairSQL} from './repair-laughter-targeting-20261007.mjs';
import {resolveTool} from '../testing/runtime.mjs';

const dsn=process.env.CANONICAL_RUNTIME_TEST_DSN;
test('targeted repair commits once and rolls back preimage, trigger and historical conflicts', ()=>{
 assert.ok(dsn,'The owned integration PostgreSQL fixture is required');
 const uri=new URL(dsn);
 assert.ok(['127.0.0.1','localhost','postgres'].includes(uri.hostname),'Use an isolated local/CI PostgreSQL service');
 const env={...process.env,PGHOST:uri.hostname,PGPORT:uri.port||'5432',PGUSER:decodeURIComponent(uri.username),
  PGPASSWORD:decodeURIComponent(uri.password),PGDATABASE:decodeURIComponent(uri.pathname.slice(1))};
 const schema='targeting_repair_'+randomUUID().replaceAll('-','');
 function run(sql,expectFailure=false){
  const response=spawnSync(resolveTool('psql',process.env.PSQL_BIN),['-X','-q','-At','-v','ON_ERROR_STOP=1','-f','-'],
   {input:sql,env,encoding:'utf8',timeout:30000});
  if(expectFailure)assert.notEqual(response.status,0,'Unsafe repair unexpectedly committed');
  else assert.equal(response.status,0,'Local repair fixture/query failed');
  return response.stdout?.trim();
 }
 run(`CREATE SCHEMA ${schema}`);
 try {
  env.PGOPTIONS=`-c search_path=${schema}`;
  run(`CREATE TABLE spells(id uuid PRIMARY KEY, name text, mechanics jsonb, support jsonb, deleted_at timestamptz,updated_at timestamptz);
   CREATE TABLE roguelike_runs(id uuid PRIMARY KEY,combat_envelope jsonb,combat_catalog jsonb,combat_catalog_ref jsonb,encounter jsonb,checkpoint jsonb);
   CREATE TABLE frozen_combat_catalogs(user_id uuid,content_hash text,catalog jsonb);
   INSERT INTO spells VALUES('${laughterTargetingPatch.entityId}','Original','{"targeting":{"shape":"multiple","additional_target_slots_per_spell_slot_above_base":1},"effects":[]}','{"notes":"retain"}',NULL,'2026-01-01');
   INSERT INTO roguelike_runs VALUES('00000000-0000-4000-8000-000000000001','{"roll":12}','{"old":true}',NULL,'{}','{"encounter_history":["old"]}');
   INSERT INTO frozen_combat_catalogs VALUES('00000000-0000-4000-8000-000000000002','sha256:old','{"old":true}');`);
  const hash=run(`SELECT 'sha256:'||encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') FROM spells s`);
  const original=run(`SELECT jsonb_build_object('spell',(SELECT to_jsonb(s) FROM spells s),'run',(SELECT to_jsonb(r) FROM roguelike_runs r),'catalog',(SELECT to_jsonb(c) FROM frozen_combat_catalogs c))::text`);
  run(targetingRepairSQL('sha256:'+'0'.repeat(64)),true);
  assert.equal(run(`SELECT jsonb_build_object('spell',(SELECT to_jsonb(s) FROM spells s),'run',(SELECT to_jsonb(r) FROM roguelike_runs r),'catalog',(SELECT to_jsonb(c) FROM frozen_combat_catalogs c))::text`),original);
  for(const mutation of ["NEW.name:='Unexpected';", "UPDATE roguelike_runs SET combat_envelope='{\"changed\":true}';"]){
   run(`CREATE FUNCTION repair_conflict() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN ${mutation} RETURN NEW; END$$;
    CREATE TRIGGER repair_conflict BEFORE UPDATE ON spells FOR EACH ROW EXECUTE FUNCTION repair_conflict();`);
   run(targetingRepairSQL(hash),true);
   assert.equal(run(`SELECT jsonb_build_object('spell',(SELECT to_jsonb(s) FROM spells s),'run',(SELECT to_jsonb(r) FROM roguelike_runs r),'catalog',(SELECT to_jsonb(c) FROM frozen_combat_catalogs c))::text`),original);
   run('DROP TRIGGER repair_conflict ON spells; DROP FUNCTION repair_conflict()');
  }
  const result=JSON.parse(run(targetingRepairSQL(hash)));
  assert.equal(result.status,'applied');assert.equal(result.affected,1);
  const after=JSON.parse(run(`SELECT jsonb_build_object('spell',(SELECT to_jsonb(s) FROM spells s),'run',(SELECT to_jsonb(r) FROM roguelike_runs r),'catalog',(SELECT to_jsonb(c) FROM frozen_combat_catalogs c))::text`));
  assert.equal(after.spell.mechanics.targeting.max_targets,1);assert.equal(after.spell.name,'Original');
  assert.equal(after.spell.support.notes,'retain');assert.deepEqual(after.run,JSON.parse(original).run);assert.deepEqual(after.catalog,JSON.parse(original).catalog);
  const committed=JSON.stringify(after);
  run(targetingRepairSQL(hash),true);
  assert.equal(JSON.stringify(JSON.parse(run(`SELECT jsonb_build_object('spell',(SELECT to_jsonb(s) FROM spells s),'run',(SELECT to_jsonb(r) FROM roguelike_runs r),'catalog',(SELECT to_jsonb(c) FROM frozen_combat_catalogs c))::text`))),committed);
 } finally {
  delete env.PGOPTIONS;
  assert.match(schema,/^targeting_repair_[a-f0-9]{32}$/);
  run(`DROP SCHEMA ${schema} CASCADE`);
 }
});
