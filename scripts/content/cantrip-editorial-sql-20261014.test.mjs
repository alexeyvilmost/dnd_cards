import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCantripEditorialSQL} from './cantrip-editorial-sql-20261014.mjs';

const manifest=JSON.parse(readFileSync(new URL('./data/cantrip-editorial-review-20261014.json',import.meta.url)));
const sql=buildCantripEditorialSQL(manifest);
test('SQL is deterministic, matches the reviewed package and adds no persistent schema',()=>{
  assert.equal(sql,readFileSync(new URL('../../database/cantrip_editorial_20261014.sql',import.meta.url),'utf8'));
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/entity_presentation_307_audit/);
  assert.match(sql,/entity_presentation_307_receipt/);
  assert.ok(!/CREATE (?!TEMP)|ALTER TABLE|DROP TRIGGER|DISABLE TRIGGER|UPDATE (characters|roguelike|effects|actions)/.test(sql));
  const changed=structuredClone(manifest);changed.entries.find(row=>row.after).after.area='changed';
  assert.throws(()=>buildCantripEditorialSQL(changed),/Only mutable prose/);
});

const dsn=process.env.CONTENT_MIGRATION_TEST_DSN;
test('PostgreSQL verifies all 83 edits, unchanged review/mechanics, atomic refusal and replay',{skip:!dsn},()=>{
  const target=new URL(dsn);
  assert.ok(['localhost','127.0.0.1','::1','[::1]'].includes(target.hostname),'Only a local PostgreSQL fixture is allowed');
  const psql=process.env.PSQL_PATH||'psql';
  const query=(text,{fail=false}={})=>{
    const result=spawnSync(psql,['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8',env:{...process.env,
      PGHOST:target.hostname,PGPORT:target.port||'5432',PGUSER:decodeURIComponent(target.username),PGPASSWORD:decodeURIComponent(target.password),
      PGDATABASE:decodeURIComponent(target.pathname.slice(1)),PGSSLMODE:target.searchParams.get('sslmode')||'disable'},maxBuffer:8*1024*1024});
    if(!fail)assert.equal(result.status,0,result.stderr||result.error?.message);
    return result;
  };
  const schema='cantrip_review_'+randomUUID().replaceAll('-','');
  const prefix=`SET search_path TO ${schema};\n`;
  const reset=()=>{
    query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema};\n`+prefix+`
      CREATE TABLE spells(id uuid PRIMARY KEY,card_number text,name text,level int,description text,detailed_description text,upcast_description text,
        mechanics jsonb,support jsonb,area text,material_text text,deleted_at timestamptz,updated_at timestamptz);
      CREATE TABLE concepts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),concept_id text UNIQUE,name text,name_en text,description text,sort_order int,deleted_at timestamptz);
      CREATE TABLE schema_migrations(version text); INSERT INTO schema_migrations VALUES('307_catalog_presentation');
      CREATE TABLE entity_presentation_307_audit(entity_type text,entity_id uuid,row_before jsonb NOT NULL,captured_at timestamptz DEFAULT now(),PRIMARY KEY(entity_type,entity_id));
      CREATE TABLE entity_presentation_307_receipt(manifest_hash text PRIMARY KEY,applied_at timestamptz DEFAULT now());
      CREATE TEMP TABLE initial_rows(payload jsonb);
      INSERT INTO initial_rows VALUES($fixture$${JSON.stringify(manifest.entries)}$fixture$);
      INSERT INTO spells(id,card_number,name,level,description,detailed_description,upcast_description,mechanics,support,area,material_text)
      SELECT (value->>'id')::uuid,value->>'card_number',value->>'name',0,value->'before'->>'description',value->'before'->>'detailed_description',
        value->'before'->>'upcast_description',value->'expected_mechanics','{"status":"verified","history":"kept"}'::jsonb,'ORIGINAL AREA','ORIGINAL MATERIAL'
        FROM initial_rows,jsonb_array_elements(payload);
    `);
    // Exercise the actual accepted review invalidator, rather than a simplified
    // trigger which would miss an accidental certification-changing field.
    const original=readFileSync(new URL('../../backend/migrations/catalog_presentation_schema_307.sql',import.meta.url),'utf8');
    const trigger=original.slice(original.indexOf('CREATE OR REPLACE FUNCTION invalidate_content_support()'));
    query(prefix+trigger+'\nCREATE TRIGGER keep_review BEFORE INSERT OR UPDATE ON spells FOR EACH ROW EXECUTE FUNCTION invalidate_content_support();');
  };
  const read=text=>query(prefix+text).stdout.trim();
  const fingerprint=()=>read("SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) FROM spells s;");
  try {
    reset();
    const unchanged=read("SELECT md5(jsonb_agg(jsonb_build_array(id,card_number,name,level,mechanics,support,area,material_text) ORDER BY id)::text) FROM spells;");
    query(prefix+sql);
    assert.equal(read('SELECT count(*) FROM spells WHERE detailed_description IS NOT NULL;'),'83');
    assert.equal(read('SELECT count(*) FROM entity_presentation_307_audit;'),'84');
    assert.equal(read('SELECT count(*) FROM entity_presentation_307_receipt;'),'1');
    assert.equal(read("SELECT count(*) FROM concepts WHERE concept_id='spellcasting_modifier' AND name='МЗ';"),'1');
    assert.equal(read("SELECT md5(jsonb_agg(jsonb_build_array(id,card_number,name,level,mechanics,support,area,material_text) ORDER BY id)::text) FROM spells;"),unchanged);
    const after=fingerprint();query(prefix+sql);assert.equal(fingerprint(),after);
    const late=manifest.entries.filter(row=>row.after).sort((a,b)=>a.id.localeCompare(b.id)).at(-1);
    for(const field of ['description','mechanics']) {
      reset();
      read(`UPDATE spells SET ${field}=${field==='description'?"'Manual edit'":"mechanics || '{\"unexpected\":true}'::jsonb"} WHERE id='${late.id}';`);
      const before=fingerprint(),result=query(prefix+sql,{fail:true});
      assert.notEqual(result.status,0);assert.ok(result.stderr.includes(late.card_number),result.stderr);
      assert.equal(fingerprint(),before);
      assert.equal(read('SELECT count(*) FROM entity_presentation_307_receipt;'),'0');
      assert.equal(read('SELECT count(*) FROM entity_presentation_307_audit;'),'0');
      assert.equal(read('SELECT count(*) FROM concepts;'),'0');
    }
  } finally {query(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`);}
});
