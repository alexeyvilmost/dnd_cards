-- Separate retirement operation. This is NOT an additive298-300 release.
-- Invoke only through a retirement release with a verified fresh backup,
-- verified archive restore and two accepted V3-only rollback applications.
-- retirement_request is JSON containing those hashes and exact row preimages.
BEGIN;
-- Full-row JSON fingerprints must not depend on the caller/server timezone.
SET LOCAL TimeZone = 'UTC';
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;
SELECT pg_advisory_xact_lock(4921946498411938899);
DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtenabled <> 'D') THEN
    RAISE EXCEPTION 'Unknown retirement DDL event trigger';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid='public.schema_migrations'::regclass AND (relrowsecurity OR relforcerowsecurity))
    OR EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class='public.schema_migrations'::regclass AND rulename <> '_RETURN')
    OR EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgrelid='public.schema_migrations'::regclass) THEN
    RAISE EXCEPTION 'Unknown migration journal policy, rule or trigger';
  END IF;
END;
$preflight$;
CREATE TEMP TABLE retirement_request_302 (request jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO retirement_request_302 VALUES (:'retirement_request'::jsonb);
DO $retirement$
DECLARE
  request jsonb := (SELECT r.request FROM retirement_request_302 r);
  prior jsonb;
  observed jsonb;
  retained_inventories_before text;
  retained_items_before text;
  retained_inventories_after text;
  retained_items_after text;
  legacy_index record;
  approved_retired_indexes oid[] := ARRAY[]::oid[];
  legacy_check record;
  approved_legacy_checks oid[] := ARRAY[]::oid[];
  had_inventory_check boolean := false;
  had_inventory_type_check boolean := false;
BEGIN
  IF request->>'kind' IS DISTINCT FROM 'retire-character-generations-302'
    OR request->>'schemaVersion' IS DISTINCT FROM '1'
    OR coalesce(request->>'backupHash','') !~ '^sha256:[0-9a-f]{64}$'
    OR coalesce(request->>'archiveRestoreReportHash','') !~ '^sha256:[0-9a-f]{64}$'
    OR coalesce(request->>'acceptedRollbackPairHash','') !~ '^sha256:[0-9a-f]{64}$'
    OR NOT request ?& ARRAY['backupHash','archiveRestoreReportHash','acceptedRollbackPairHash','preimages']
    OR (SELECT count(*) FROM jsonb_object_keys(request)) <> 6
    OR jsonb_typeof(request->'preimages') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Exact verified retirement request required';
  END IF;
  SELECT description::jsonb INTO prior FROM public.schema_migrations WHERE version = '302_retire_legacy_characters';
  IF FOUND THEN
    IF prior->>'kind' IS DISTINCT FROM 'retired-character-generations-receipt'
      OR prior->'request' IS DISTINCT FROM request THEN
      RAISE EXCEPTION 'Retirement already has a different or unknown receipt';
    END IF;
    RETURN;
  END IF;
  LOCK TABLE public.characters, public.characters_v2, public.inventories, public.inventory_items, public.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtenabled <> 'D') THEN
    RAISE EXCEPTION 'Unknown retirement DDL event trigger';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class IN ('public.inventories'::regclass,'public.inventory_items'::regclass) AND rulename <> '_RETURN')
    OR EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.characters'::regclass,'public.characters_v2'::regclass,'public.inventories'::regclass,'public.inventory_items'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Unknown shared inventory rule or row security policy';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.characters'::regclass,'public.characters_v2'::regclass,'public.inventories'::regclass,'public.inventory_items'::regclass) AND (relkind <> 'r' OR relispartition OR reloftype <> 0))
    OR EXISTS (SELECT 1 FROM pg_inherits WHERE inhparent IN ('public.characters'::regclass,'public.characters_v2'::regclass,'public.inventories'::regclass,'public.inventory_items'::regclass)
      OR inhrelid IN ('public.characters'::regclass,'public.characters_v2'::regclass,'public.inventories'::regclass,'public.inventory_items'::regclass)) THEN
    RAISE EXCEPTION 'Unknown retirement partition, inheritance or typed table';
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventories i WHERE
    (i.character_id IS NOT NULL AND i.type IS DISTINCT FROM 'character')
    OR (i.type = 'character' AND (i.character_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM (SELECT id,user_id FROM public.characters UNION ALL SELECT id,user_id FROM public.characters_v2) c
      WHERE c.id = i.character_id AND (i.user_id IS NULL OR c.user_id IS NOT DISTINCT FROM i.user_id))))) THEN
    RAISE EXCEPTION 'Unknown or protected legacy inventory association';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'f' AND (
    confrelid IN ('public.characters'::regclass, 'public.characters_v2'::regclass)
    OR confrelid = 'public.inventory_items'::regclass
    OR (confrelid = 'public.inventories'::regclass AND NOT (
      conrelid = 'public.inventory_items'::regclass
      AND pg_get_constraintdef(oid) = 'FOREIGN KEY (inventory_id) REFERENCES inventories(id) ON DELETE CASCADE')))) THEN
    RAISE EXCEPTION 'Unknown incoming retirement dependency';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND
    tgrelid IN ('public.inventories'::regclass, 'public.inventory_items'::regclass) AND (tgtype & 44) <> 0) THEN
    RAISE EXCEPTION 'Unknown shared inventory mutation trigger';
  END IF;
  FOR legacy_index IN SELECT c.oid,c.relname,pg_get_indexdef(c.oid) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('idx_inventories_character_id','idx_inventories_character_type') LOOP
    IF legacy_index.definition IS DISTINCT FROM (CASE legacy_index.relname
      WHEN 'idx_inventories_character_id' THEN 'CREATE INDEX idx_inventories_character_id ON public.inventories USING btree (character_id)'
      WHEN 'idx_inventories_character_type' THEN 'CREATE INDEX idx_inventories_character_type ON public.inventories USING btree (character_id, type)' END) THEN
      RAISE EXCEPTION 'Known legacy index has a different definition';
    END IF;
    approved_retired_indexes := array_append(approved_retired_indexes,legacy_index.oid);
  END LOOP;
  FOR legacy_check IN SELECT oid,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='public.inventories'::regclass AND conname IN ('inventories_check','inventories_type_check') LOOP
    IF legacy_check.definition IS DISTINCT FROM (CASE legacy_check.conname
      WHEN 'inventories_check' THEN $inventory_check$CHECK (((((type)::text = 'personal'::text) AND (user_id IS NOT NULL) AND (group_id IS NULL)) OR (((type)::text = 'group'::text) AND (user_id IS NULL) AND (group_id IS NOT NULL)) OR (((type)::text = 'character'::text) AND (character_id IS NOT NULL))))$inventory_check$
      WHEN 'inventories_type_check' THEN $inventory_type_check$CHECK (((type)::text = ANY (ARRAY[('personal'::character varying)::text, ('group'::character varying)::text, ('character'::character varying)::text])))$inventory_type_check$ END) THEN
      RAISE EXCEPTION 'Known legacy inventory check has a different definition';
    END IF;
    approved_legacy_checks := array_append(approved_legacy_checks,legacy_check.oid);
    had_inventory_check := had_inventory_check OR legacy_check.conname='inventories_check';
    had_inventory_type_check := had_inventory_type_check OR legacy_check.conname='inventories_type_check';
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_depend WHERE refclassid = 'pg_class'::regclass
    AND refobjid = 'public.inventories'::regclass AND refobjsubid = (
      SELECT attnum FROM pg_attribute WHERE attrelid = 'public.inventories'::regclass AND attname = 'character_id' AND NOT attisdropped)
    AND NOT ((classid='pg_class'::regclass AND objid=ANY(approved_retired_indexes))
      OR (classid='pg_constraint'::regclass AND objid=ANY(approved_legacy_checks)))) THEN
    RAISE EXCEPTION 'Unknown legacy inventory column dependency';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND p.prokind IN ('f','p')
    AND (p.prosrc ~* '(^|[^a-zA-Z0-9_])(characters_v2|characters)([^a-zA-Z0-9_]|$)'
      OR (p.prosrc ~* '(^|[^a-zA-Z0-9_])inventories([^a-zA-Z0-9_]|$)'
        AND p.prosrc ~* '(^|[^a-zA-Z0-9_])character_id([^a-zA-Z0-9_]|$)'))) THEN
    RAISE EXCEPTION 'Legacy SQL function requires an explicitly reviewed repair';
  END IF;
  SELECT jsonb_object_agg(name,preimage) INTO observed FROM (
    SELECT 'characters' AS name,jsonb_build_object('rows',count(*),'sha256','sha256:'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(c)::text,E'\n' ORDER BY c.id),''),'UTF8')),'hex')) AS preimage FROM public.characters c
    UNION ALL SELECT 'characters_v2',jsonb_build_object('rows',count(*),'sha256','sha256:'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(c)::text,E'\n' ORDER BY c.id),''),'UTF8')),'hex')) FROM public.characters_v2 c
    UNION ALL SELECT 'retired_inventories',jsonb_build_object('rows',count(*),'sha256','sha256:'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(i)::text,E'\n' ORDER BY i.id),''),'UTF8')),'hex')) FROM public.inventories i WHERE i.type = 'character'
    UNION ALL SELECT 'retired_items',jsonb_build_object('rows',count(*),'sha256','sha256:'||encode(sha256(convert_to(coalesce(string_agg(to_jsonb(i)::text,E'\n' ORDER BY i.id),''),'UTF8')),'hex')) FROM public.inventory_items i JOIN public.inventories p ON p.id = i.inventory_id WHERE p.type = 'character'
  ) x;
  IF observed IS DISTINCT FROM request->'preimages' THEN RAISE EXCEPTION 'Retirement preimages changed'; END IF;
  SELECT encode(sha256(convert_to(coalesce(string_agg((to_jsonb(i)-'character_id')::text,E'\n' ORDER BY i.id),''),'UTF8')),'hex') INTO retained_inventories_before FROM public.inventories i WHERE i.type IS DISTINCT FROM 'character';
  SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(i)::text,E'\n' ORDER BY i.id),''),'UTF8')),'hex') INTO retained_items_before FROM public.inventory_items i JOIN public.inventories p ON p.id = i.inventory_id WHERE p.type IS DISTINCT FROM 'character';
  DELETE FROM public.inventory_items i USING public.inventories p WHERE p.id = i.inventory_id AND p.type = 'character';
  DELETE FROM public.inventories WHERE type = 'character';
  FOR legacy_index IN SELECT relname FROM pg_class WHERE oid=ANY(approved_retired_indexes) LOOP
    EXECUTE format('DROP INDEX public.%I RESTRICT',legacy_index.relname);
  END LOOP;
  FOR legacy_check IN SELECT conname FROM pg_constraint WHERE oid=ANY(approved_legacy_checks) LOOP
    EXECUTE format('ALTER TABLE public.inventories DROP CONSTRAINT %I RESTRICT',legacy_check.conname);
  END LOOP;
  ALTER TABLE public.inventories DROP COLUMN character_id RESTRICT;
  IF had_inventory_check THEN
    ALTER TABLE public.inventories ADD CONSTRAINT inventories_check CHECK (
      ((type)::text='personal'::text AND user_id IS NOT NULL AND group_id IS NULL)
      OR ((type)::text='group'::text AND user_id IS NULL AND group_id IS NOT NULL));
  END IF;
  IF had_inventory_type_check THEN
    ALTER TABLE public.inventories ADD CONSTRAINT inventories_type_check CHECK ((type)::text = ANY (ARRAY['personal'::text,'group'::text]));
  END IF;
  DROP TABLE public.characters_v2 RESTRICT;
  DROP TABLE public.characters RESTRICT;
  SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(i)::text,E'\n' ORDER BY i.id),''),'UTF8')),'hex') INTO retained_inventories_after FROM public.inventories i;
  SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(i)::text,E'\n' ORDER BY i.id),''),'UTF8')),'hex') INTO retained_items_after FROM public.inventory_items i;
  IF retained_inventories_before IS DISTINCT FROM retained_inventories_after OR retained_items_before IS DISTINCT FROM retained_items_after THEN
    RAISE EXCEPTION 'Shared inventories or items changed unexpectedly';
  END IF;
  INSERT INTO public.schema_migrations(version,description,executed_at) VALUES ('302_retire_legacy_characters',
    jsonb_build_object('kind','retired-character-generations-receipt','request',request,'retainedInventoriesHash',retained_inventories_after,'retainedItemsHash',retained_items_after)::text,now());
END;
$retirement$;
COMMIT;
