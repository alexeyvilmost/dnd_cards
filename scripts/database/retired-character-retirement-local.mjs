import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from "node:url";
import path from 'node:path';
import {startTestStack} from '../testing/stack.mjs';
const root=fileURLToPath(new URL("../../",import.meta.url));
const source=path.join(root,'infra/migrations/301_retire_legacy_characters.sql'),sql=await readFile(source,'utf8');
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const sourceHash=hash(sql),startedAt=new Date().toISOString(),directory=path.join(root,'outputs/testing/retired-character-301-'+startedAt.replaceAll(':','-'));
await mkdir(path.join(root,"outputs/testing"),{recursive:true});
await mkdir(directory,{recursive:false});
const receipt={schemaVersion:1,scope:'owned-synthetic-postgres-retirement-301-transaction',startedAt,status:'running',sqlSourceHash:sourceHash,testSourceHash:hash(await readFile(new URL(import.meta.url))),sqlSource:source,syntheticExternalProofHashes:true,actualArchiveRestoreProven:false,productionChanges:0,tests:[],cleanup:{status:'pending'}};
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const fixture=`CREATE TABLE users(id integer PRIMARY KEY); INSERT INTO users VALUES(1),(2);
CREATE TABLE groups(id integer PRIMARY KEY); INSERT INTO groups VALUES(1);
CREATE TABLE characters(id integer PRIMARY KEY,user_id integer,payload jsonb);INSERT INTO characters VALUES(10,1,'{"v":1,"keepOriginal":true}');
CREATE TABLE characters_v2(id integer PRIMARY KEY,user_id integer,payload jsonb);INSERT INTO characters_v2 VALUES(20,2,'{"v":2,"differentData":[2,3]}');
CREATE TABLE characters_v3(id integer PRIMARY KEY,payload jsonb);INSERT INTO characters_v3 VALUES(30,'{"v":3,"inventory":["current"],"resources":{"uses":2}}');
CREATE TABLE canonical_history(id integer PRIMARY KEY,payload jsonb);INSERT INTO canonical_history VALUES(40,'{"immutable":true,"command":"already-done"}');
CREATE TABLE inventories(id integer PRIMARY KEY,type character varying,user_id integer,group_id integer,character_id integer,payload jsonb);
INSERT INTO inventories VALUES(1,'character',1,NULL,10,'{"legacy":1}'),(2,'character',2,NULL,20,'{"legacy":2}'),(3,'personal',1,NULL,NULL,'{"notes":"preserve personal"}'),(4,'group',2,1,NULL,'{"notes":"preserve group"}'),(5,'other',1,NULL,NULL,'{"notes":"preserve unknown unrelated"}');
CREATE TABLE inventory_items(id integer PRIMARY KEY,inventory_id integer REFERENCES inventories(id) ON DELETE CASCADE,payload jsonb);
INSERT INTO inventory_items VALUES(1,1,'{"old":1}'),(2,2,'{"old":2}'),(3,3,'{"current":1}'),(4,4,'{"current":2}'),(5,5,'{"current":3}');
CREATE TABLE schema_migrations(version text PRIMARY KEY,description text,executed_at timestamptz DEFAULT now());`;
const preimages=`SELECT jsonb_object_agg(name,preimage) FROM (
SELECT 'characters' AS name,jsonb_build_object('rows',count(*),'sha256','sha256:'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(c)::text,E'\\n' ORDER BY c.id),''),'UTF8')),'hex')) AS preimage FROM characters c
UNION ALL SELECT 'characters_v2',jsonb_build_object('rows',count(*),'sha256','sha256:'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(c)::text,E'\\n' ORDER BY c.id),''),'UTF8')),'hex')) FROM characters_v2 c
UNION ALL SELECT 'retired_inventories',jsonb_build_object('rows',count(*),'sha256','sha256:'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(i)::text,E'\\n' ORDER BY i.id),''),'UTF8')),'hex')) FROM inventories i WHERE i.type='character'
UNION ALL SELECT 'retired_items',jsonb_build_object('rows',count(*),'sha256','sha256:'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(i)::text,E'\\n' ORDER BY i.id),''),'UTF8')),'hex')) FROM inventory_items i JOIN inventories p ON p.id=i.inventory_id WHERE p.type='character') x;`;
const tables=['users','groups','characters','characters_v2','characters_v3','canonical_history','inventories','inventory_items','schema_migrations'];
const snapshotSQL=`SELECT jsonb_object_agg(name,rows) FROM (${tables.map(name=>`SELECT '${name}' AS name,coalesce(jsonb_agg(to_jsonb(t) ORDER BY ${name==='schema_migrations'?'version':'id'}),'[]'::jsonb) AS rows FROM ${name} t`).join(' UNION ALL ')}) x;`;
const protectedSQL=`SELECT jsonb_build_object('v3',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM characters_v3 t),'history',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM canonical_history t),'users',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM users t),'groups',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM groups t),'inventories',(SELECT jsonb_agg(to_jsonb(t)-'character_id' ORDER BY id) FROM inventories t WHERE type IS DISTINCT FROM 'character'),'items',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM inventory_items t JOIN inventories p ON p.id=t.inventory_id WHERE p.type IS DISTINCT FROM 'character'));`;
const cases=[
  {name:'atomic retirement keeps V3, history, personal, group and unrelated inventories'},
  {name:'UTC row preimages remain exact with a Europe Moscow execution session',timestamps:true,executionTimezone:'Europe/Moscow',success:true},
  {name:'UTC row preimages remain exact with an America Los Angeles execution session',timestamps:true,executionTimezone:'America/Los_Angeles',success:true},
  {name:'historical inventory owner derives from the linked retired character',setup:"UPDATE inventories SET user_id=NULL WHERE type='character';",success:true},
  {name:'the two exact original retired indexes are removed explicitly',setup:'CREATE INDEX idx_inventories_character_id ON public.inventories USING btree(character_id);CREATE INDEX idx_inventories_character_type ON public.inventories USING btree(character_id,type);',success:true},
  {name:'a changed definition of a known legacy index is refused',setup:"CREATE INDEX idx_inventories_character_id ON public.inventories USING btree(character_id) WHERE type='character';",expected:'Known legacy index has a different definition'},
  {name:'original shared ownership and type checks are retained for supported inventories',setup:"DELETE FROM inventory_items WHERE inventory_id=5;DELETE FROM inventories WHERE id=5;UPDATE inventories SET user_id=NULL WHERE type='group';ALTER TABLE inventories ADD CONSTRAINT inventories_check CHECK (((((type)::text = 'personal'::text) AND (user_id IS NOT NULL) AND (group_id IS NULL)) OR (((type)::text = 'group'::text) AND (user_id IS NULL) AND (group_id IS NOT NULL)) OR (((type)::text = 'character'::text) AND (character_id IS NOT NULL))));ALTER TABLE inventories ADD CONSTRAINT inventories_type_check CHECK (((type)::text = ANY (ARRAY[('personal'::character varying)::text, ('group'::character varying)::text, ('character'::character varying)::text])));",success:true,ownershipChecks:true},
  {name:'an altered original inventory check is not removed silently',setup:'ALTER TABLE inventories ADD CONSTRAINT inventories_check CHECK (user_id IS NOT NULL OR character_id IS NOT NULL);',expected:'Known legacy inventory check has a different definition'},
  {name:'an explicit different owner remains protected',setup:'UPDATE inventories SET user_id=2 WHERE id=1;',expected:'Unknown or protected legacy inventory association'},
  {name:'late legacy mutation refuses stale preimage',afterRequest:"UPDATE characters_v2 SET payload='{"+'"changedAfterBackup":true'+"}';",expected:'Retirement preimages changed'},
  {name:'personal legacy association is preserved and blocks retirement',setup:'UPDATE inventories SET character_id=10 WHERE id=3;'},
  {name:'unknown incoming FK blocks removal',setup:'ALTER TABLE characters_v3 ADD COLUMN legacy_link integer REFERENCES characters(id);'},
  {name:'dependent view rolls back even after inventory deletes',setup:'CREATE VIEW legacy_view AS SELECT id FROM characters;'},
  {name:'shared delete trigger cannot mutate preserved history',setup:"CREATE FUNCTION forbidden_delete() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO canonical_history VALUES(99,'{}');RETURN OLD;END$$;CREATE TRIGGER forbidden_delete BEFORE DELETE ON inventory_items FOR EACH ROW EXECUTE FUNCTION forbidden_delete();"},
  {name:'legacy SQL function requires explicit repair',setup:"CREATE FUNCTION stale_reader() RETURNS integer LANGUAGE sql AS $$SELECT count(*)::integer FROM characters_v2$$;"},
  {name:'unknown inventory column dependency blocks removal',setup:'CREATE INDEX unknown_legacy_column_index ON inventories(character_id);'},
  {name:'delete rewrite rule cannot redirect into preserved history',setup:"CREATE RULE redirected_delete AS ON DELETE TO inventory_items DO ALSO INSERT INTO canonical_history VALUES(99,'{}');"},
  {name:'unknown row security cannot influence the retired closure',setup:'ALTER TABLE inventories ENABLE ROW LEVEL SECURITY;CREATE POLICY unknown_inventory_policy ON inventories USING(true);'},
  {name:'DDL event trigger is rejected before creating a temporary table',setup:"CREATE FUNCTION unknown_ddl() RETURNS event_trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'event-trigger-fired';END$$;CREATE EVENT TRIGGER unknown_ddl ON ddl_command_start EXECUTE FUNCTION unknown_ddl();",expected:'Unknown retirement DDL event trigger'},
  {name:'partitioned legacy relation requires explicit closure review',setup:'ALTER TABLE characters RENAME TO legacy_original;CREATE TABLE characters(LIKE legacy_original INCLUDING ALL) PARTITION BY RANGE(id);CREATE TABLE legacy_partition PARTITION OF characters FOR VALUES FROM(0) TO(100);INSERT INTO characters SELECT * FROM legacy_original;DROP TABLE legacy_original RESTRICT;',expected:'Unknown retirement partition, inheritance or typed table'},
  {name:'journal insert trigger cannot mutate preserved game history',setup:"CREATE FUNCTION journal_side_effect() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO canonical_history VALUES(97,'{}');RETURN NEW;END$$;CREATE TRIGGER journal_side_effect BEFORE INSERT ON schema_migrations FOR EACH ROW EXECUTE FUNCTION journal_side_effect();",expected:'Unknown migration journal policy, rule or trigger'},
  {name:'missing genuine proof binding is rejected',changeRequest:request=>{request.backupHash=null;}},
];
let stack;
try {
  assert(sql.includes('4921946498411938899'));assert(!/DROP\s+(?:TABLE|COLUMN)[^;]*\bCASCADE\b/i.test(sql));
  stack=await startTestStack({dbOnly:true});receipt.runId=stack.registry.runId;
  for(const [index,item] of cases.entries()) {
    const database=stack.registry.runId+'_retire_'+index;
    await stack.database.query('CREATE DATABASE '+database+';','postgres');
    const query=input=>stack.database.query("SET TIME ZONE 'UTC';"+input,database,{sensitive:true});
    await query("CREATE TABLE test_run_ownership(run_id text PRIMARY KEY); INSERT INTO test_run_ownership VALUES("+quote(stack.registry.runId)+");"+fixture+(item.setup??''));
    assert.equal((await query('SELECT run_id FROM test_run_ownership;')).trim(),stack.registry.runId);
    if(item.timestamps)for(const table of ['characters','characters_v2','inventories','inventory_items'])await query(`ALTER TABLE ${table} ADD COLUMN created_at timestamptz NOT NULL DEFAULT '2026-01-01T03:00:00+03:00';`);
    const request={schemaVersion:1,kind:'retire-character-generations-301',backupHash:hash('synthetic-backup'),archiveRestoreReportHash:hash('synthetic-archive-restore'),acceptedRollbackPairHash:hash('synthetic-rollback-pair'),preimages:JSON.parse((await query(preimages)).trim())};
    item.changeRequest?.(request);if(item.afterRequest)await query(item.afterRequest);
    const before=JSON.parse((await query(snapshotSQL)).trim()),protectedBefore=JSON.parse((await query(protectedSQL)).trim());
    const program=(item.executionTimezone?"SET TIME ZONE "+quote(item.executionTimezone)+";":'')+sql.replace(":'retirement_request'",quote(JSON.stringify(request)));
    if(item.timestamps){
      const foreign=JSON.parse((await query("SET TIME ZONE "+quote(item.executionTimezone)+";"+preimages)).trim());assert.notDeepEqual(foreign,request.preimages);
      await assert.rejects(query(program.replace("SET LOCAL TimeZone = 'UTC';",'')),error=>error.output?.includes('Retirement preimages changed'));
      assert.deepEqual(JSON.parse((await query(snapshotSQL)).trim()),before);
    }
    if(index===0||item.success) {
      await query(program);
      assert.deepEqual(JSON.parse((await query(protectedSQL)).trim()),protectedBefore);
      assert.equal((await query("SELECT to_regclass('public.characters') IS NULL AND to_regclass('public.characters_v2') IS NULL AND NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inventories' AND column_name='character_id');")).trim(),'t');
      const first=(await query("SELECT description FROM schema_migrations WHERE version='301_retire_legacy_characters';")).trim();
      assert.deepEqual(JSON.parse(first).request,request);
      await query(program);assert.equal((await query("SELECT description FROM schema_migrations WHERE version='301_retire_legacy_characters';")).trim(),first);
      if(item.ownershipChecks){
        for(const invalid of ["INSERT INTO inventories VALUES(10,'personal',NULL,NULL,'{}');","INSERT INTO inventories VALUES(11,'group',NULL,NULL,'{}');","INSERT INTO inventories VALUES(12,'character',1,NULL,'{}');"]){await assert.rejects(query(invalid));}
        assert.deepEqual(JSON.parse((await query(protectedSQL)).trim()),protectedBefore);
      }
      const other=sql.replace(":'retirement_request'",quote(JSON.stringify({...request,backupHash:hash('different-backup')})));
      await assert.rejects(query(other));
      assert.equal((await query("SELECT description FROM schema_migrations WHERE version='301_retire_legacy_characters';")).trim(),first);
      receipt.tests.push({name:item.name,status:'passed',sameRequestRetry:'same-receipt',differentRequestRetry:'refused'});
    } else {
      await assert.rejects(query(program),error=>!item.expected||(typeof error.output==='string'&&error.output.includes(item.expected)));
      assert.deepEqual(JSON.parse((await query(snapshotSQL)).trim()),before);
      assert.deepEqual(JSON.parse((await query(protectedSQL)).trim()),protectedBefore);
      assert.equal((await query("SELECT count(*) FROM schema_migrations WHERE version='301_retire_legacy_characters';")).trim(),'0');
      receipt.tests.push({name:item.name,status:'passed',partialMutation:false});
    }
    console.log(JSON.stringify({check:receipt.tests.at(-1)}));
  }
  receipt.status='passed';
} catch(error) {
  receipt.status='failed';receipt.failure={completedChecks:receipt.tests.length};
  await writeFile(path.join(directory,'failure.json'),JSON.stringify({message:error.message,output:error.output,stack:error.stack},null,2)+'\n',{flag:'wx'});
} finally {
  if(stack)try{await stack.cleanup();const registry=JSON.parse(await readFile(path.join(stack.registry.directory,'registry.json'),'utf8'));receipt.cleanup={status:registry.status,errors:registry.cleanupErrors};}catch{receipt.cleanup={status:'failed'};receipt.status='failed';}
  receipt.sourceUnchanged=hash(await readFile(source))===sourceHash;if(!receipt.sourceUnchanged)receipt.status='failed';
  receipt.completedAt=new Date().toISOString();await writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({directory,status:receipt.status,checks:receipt.tests.length,sourceUnchanged:receipt.sourceUnchanged,cleanup:receipt.cleanup,productionChanges:0,actualArchiveRestoreProven:false}));
  if(receipt.status!=='passed')process.exitCode=1;
}
