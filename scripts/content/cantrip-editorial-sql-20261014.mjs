#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Explicit catalog application after an accepted release. No persistent DDL,
// startup migration, trigger disabling, mechanics or history updates.
export function buildCantripEditorialSQL(manifest) {
  const rows=manifest.entries.filter(row=>row.after);
  if(manifest.application_id!=='cantrip-editorial-20261014'||rows.length!==83||rows.filter(row=>row.parent_id).length!==49)throw Error('Exact reviewed cantrip manifest required');
  for(const row of rows)for(const field of Object.keys(row.after))if(!['description','detailed_description','upcast_description'].includes(field))throw Error('Only mutable prose may change');
  const payload={application_id:manifest.application_id,concept:manifest.concept,entries:rows.map(({id,card_number,name,before,after,expected_mechanics})=>({id,card_number,name,before,after,expected_mechanics}))};
  const data=JSON.stringify(payload);
  if(data.includes('$cantrip_plan$'))throw Error('Unsafe SQL delimiter');
  const hash=createHash('sha256').update(data).digest('hex');
  return `-- Reviewed cantrip prose and selected variants, 2026-10-14.
-- Explicit post-release operation, never executed by application startup.
-- Exact text and mechanics guards; old rows and receipt commit atomically.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(4921942476843869267);
CREATE TEMP TABLE cantrip_editorial_plan(payload jsonb) ON COMMIT DROP;
INSERT INTO cantrip_editorial_plan VALUES ($cantrip_plan$${data}$cantrip_plan$::jsonb);
DO $cantrip_apply$
DECLARE
  plan jsonb;
  current_row spells%ROWTYPE;
  current_text jsonb;
  updated_row jsonb;
  definition jsonb;
  concept_uuid uuid;
  operation_hash text := '${hash}';
  audit_kind text := 'cantrip-editorial-20261014:${hash}';
  previously_applied boolean;
  changed integer := 0;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version='307_catalog_presentation')
    OR to_regclass('entity_presentation_307_audit') IS NULL
    OR to_regclass('entity_presentation_307_receipt') IS NULL THEN
    RAISE EXCEPTION 'Verified presentation schema must already exist';
  END IF;
  SELECT EXISTS(SELECT 1 FROM entity_presentation_307_receipt WHERE manifest_hash=operation_hash) INTO previously_applied;
  SELECT payload->'concept' INTO definition FROM cantrip_editorial_plan;
  SELECT id INTO concept_uuid FROM concepts WHERE concept_id=definition->>'concept_id' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    IF previously_applied THEN RAISE EXCEPTION 'Previously created glossary concept is missing'; END IF;
    INSERT INTO concepts(concept_id,name,name_en,description,sort_order)
      VALUES(definition->>'concept_id',definition->>'name',definition->>'name_en',definition->>'description',(definition->>'sort_order')::integer)
      RETURNING id INTO concept_uuid;
    INSERT INTO entity_presentation_307_audit(entity_type,entity_id,row_before)
      VALUES(audit_kind||':concept',concept_uuid,'{"absent":true}'::jsonb);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM concepts WHERE id=concept_uuid AND name=definition->>'name' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Glossary identity differs';
  END IF;
  FOR plan IN SELECT value FROM cantrip_editorial_plan,jsonb_array_elements(payload->'entries') ORDER BY value->>'id' LOOP
    SELECT * INTO current_row FROM spells WHERE id=(plan->>'id')::uuid AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR current_row.card_number IS DISTINCT FROM plan->>'card_number'
      OR current_row.name IS DISTINCT FROM plan->>'name' OR current_row.level IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'Cantrip identity drift: %',plan->>'card_number';
    END IF;
    IF current_row.mechanics IS DISTINCT FROM plan->'expected_mechanics' THEN
      RAISE EXCEPTION 'Cantrip mechanics drift: %',plan->>'card_number';
    END IF;
    current_text:=jsonb_build_object('description',current_row.description,'detailed_description',current_row.detailed_description,'upcast_description',current_row.upcast_description);
    IF current_text=plan->'after' THEN CONTINUE; END IF;
    IF previously_applied OR current_text IS DISTINCT FROM plan->'before' THEN
      RAISE EXCEPTION 'Cantrip prose drift: %',plan->>'card_number';
    END IF;
    INSERT INTO entity_presentation_307_audit(entity_type,entity_id,row_before)
      VALUES(audit_kind||':spell',current_row.id,to_jsonb(current_row));
    UPDATE spells SET description=plan->'after'->>'description',
      detailed_description=plan->'after'->>'detailed_description',
      upcast_description=plan->'after'->>'upcast_description',updated_at=NOW()
      WHERE id=current_row.id RETURNING to_jsonb(spells) INTO updated_row;
    IF (updated_row-ARRAY['description','detailed_description','upcast_description','updated_at'])
      IS DISTINCT FROM (to_jsonb(current_row)-ARRAY['description','detailed_description','upcast_description','updated_at']) THEN
      RAISE EXCEPTION 'Non-editorial field changed: %',plan->>'card_number';
    END IF;
    changed:=changed+1;
  END LOOP;
  IF NOT previously_applied THEN
    INSERT INTO entity_presentation_307_receipt(manifest_hash) VALUES(operation_hash);
  END IF;
  RAISE NOTICE 'Cantrip editorial: % rows updated; receipt %',changed,operation_hash;
END;
$cantrip_apply$;
COMMIT;
`;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const manifest=JSON.parse(readFileSync(new URL('./data/cantrip-editorial-review-20261014.json',import.meta.url)));
  const target=resolve(process.argv[2]??'database/cantrip_editorial_20261014.sql');
  writeFileSync(target,buildCantripEditorialSQL(manifest));
  console.log(JSON.stringify({file:target,entries:83,persistentDDL:false}));
}
