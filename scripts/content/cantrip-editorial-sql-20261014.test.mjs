import {readFileSync} from 'node:fs';
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
