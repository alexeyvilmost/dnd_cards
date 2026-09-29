CREATE TABLE IF NOT EXISTS entity_reference_nodes (
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  name text NOT NULL DEFAULT '',
  aliases text[] NOT NULL DEFAULT '{}',
  stable_aliases text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY(entity_type, entity_id)
);
ALTER TABLE entity_reference_nodes ADD COLUMN IF NOT EXISTS stable_aliases text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS entity_reference_nodes_aliases ON entity_reference_nodes USING gin(aliases);
CREATE TABLE IF NOT EXISTS entity_reference_edges (
  source_type text NOT NULL,
  source_id text NOT NULL,
  target_type text NOT NULL,
  target_key text NOT NULL,
  level integer NOT NULL DEFAULT 0,
  path text NOT NULL,
  PRIMARY KEY(source_type, source_id, target_type, target_key, level, path),
  FOREIGN KEY(source_type, source_id) REFERENCES entity_reference_nodes(entity_type, entity_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS entity_reference_edges_target ON entity_reference_edges(target_type,target_key);

-- Only declared mechanic roots are walked. Display prose, support metadata,
-- rich-text links and names never become references.
CREATE OR REPLACE FUNCTION entity_reference_field_kind(field text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE
 WHEN field IN ('related_cards','card_id','cardId','item_id','itemId','item_ids','card_ids','weapon_id','weaponId','weapon_card_id','armor_card_id','requires_held_item','held_weapon_card','held_weapon_cards') THEN 'card'
 WHEN field IN ('related_actions','action_id','actionId','action_ids','actionIds','actions','granted_actions','grant_actions','action_ref','actionRef') THEN 'action'
 WHEN field IN ('related_effects','effect_id','effectId','effect_ids','effectIds','effects','granted_effects','grant_effects','mastery','mastery_effect_id','condition_id','conditionId','condition_immunities','on_failure_condition','if_condition_immunity','inside_condition','condition') THEN 'effect'
 WHEN field IN ('spell_id','spellId','spell_ids','spellIds','spells','spell_ref','spellRef','prepared_spells','known_spells','grantedSpell') THEN 'spell'
 WHEN field IN ('feat_id','featId','feat_ids','featIds','feats','origin_feat') THEN 'feat'
 WHEN field IN ('class_id','classId','class_ids','class','classes','subclasses','parent_class_id','spell_class_list_ids','spellClass') THEN 'class'
 WHEN field IN ('race_id','raceId','race_ids','parent_race_id') THEN 'race'
 WHEN field IN ('resource_id','resourceId','resource','resource_ids','resources','slotResource','materialCostResource','free_use_resource','remove_cost_resources','consume_resource') THEN 'resource'
 WHEN field IN ('variable_id','variableId','variable','variable_ids') THEN 'variable'
 WHEN field IN ('monster_id','monsterId','monster_ids','monster_ref','monsterRef','template_id','templateId') THEN 'monster'
 WHEN field IN ('decision_policies') THEN 'passive'
 WHEN field IN ('source_entity_ids','sourceEntityIds') THEN '*'
 ELSE NULL END $$;

CREATE OR REPLACE FUNCTION entity_reference_walk(node jsonb, source_kind text, at_path text, bound_level integer DEFAULT 0, expected_kind text DEFAULT NULL)
RETURNS TABLE(target_type text, target_key text, level integer, path text)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE member record; growth record; idx integer; child_kind text; object_kind text; scalar text; child_level integer; parsed jsonb; operation text; token text[];
BEGIN
  IF node IS NULL OR node = 'null'::jsonb THEN RETURN; END IF;
  IF length(at_path) > 4096 THEN RETURN; END IF;
  IF jsonb_typeof(node) = 'string' THEN
    scalar := node #>> '{}';
    -- Relative costs bind to an actor/item at execution time. They are not
    -- identities in the resource/card/condition library.
    IF expected_kind='resource' AND scalar IN ('spell_slot','self_uses','self_item','equipped_weapon_ammo','item','hit_die') THEN RETURN; END IF;
    IF expected_kind='resource' AND scalar ~ '^(uses_|freeuse-|hit_dice_d|material_|current_hp$|max_hp$)' THEN expected_kind := '$resource'; END IF;
    -- Some older text columns contain serialized JSON arrays.
    IF expected_kind IS NOT NULL AND left(ltrim(scalar),1) IN ('[','{') THEN
      BEGIN parsed := scalar::jsonb; EXCEPTION WHEN invalid_text_representation THEN RETURN; END;
      RETURN QUERY SELECT * FROM entity_reference_walk(parsed,source_kind,at_path,bound_level,expected_kind);
    ELSIF expected_kind IS NOT NULL AND scalar <> '' AND scalar !~ '[\[\]\n\r]' THEN
      RETURN QUERY SELECT expected_kind, scalar, bound_level, at_path;
    ELSIF expected_kind IS NULL AND at_path ~ '\.(formula|amount|dice|count|max|value|distance|bonus|default_value)$' THEN
      FOR token IN SELECT regexp_matches(scalar,'class_level:([A-Za-z0-9_-]+)','g') LOOP
        RETURN QUERY SELECT 'class'::text,token[1],bound_level,at_path;
      END LOOP;
      -- Formula identifiers resolve only to registered variables; builtin
      -- arithmetic/stat tokens are discarded by the resolved index view.
      FOR token IN SELECT regexp_matches(regexp_replace(scalar,'class_level:[A-Za-z0-9_-]+','','g'),'\m([A-Za-z_][A-Za-z0-9_]*)\M','g') LOOP
        RETURN QUERY SELECT '$variable'::text,token[1],bound_level,at_path;
      END LOOP;
    END IF;
    RETURN;
  END IF;
  IF jsonb_typeof(node) = 'array' THEN
    idx := 0;
    FOR member IN SELECT value FROM jsonb_array_elements(node) LOOP
      RETURN QUERY SELECT * FROM entity_reference_walk(member.value,source_kind,at_path || '[' || idx || ']',bound_level,expected_kind);
      idx := idx + 1;
    END LOOP;
    RETURN;
  END IF;
  IF jsonb_typeof(node) <> 'object' THEN RETURN; END IF;
  operation := COALESCE(node->>'kind',node->>'type',node->>'op','');
  IF operation IN ('narrative','description','text') THEN RETURN; END IF;
  object_kind := COALESCE(node->>'entity_type',node->>'entityType',node->>'kind',node->>'type', expected_kind);
  IF operation IN ('grant_action','grant_effect','grant_spell','grant_feat','grant_item') THEN object_kind := substring(operation FROM 7); END IF;
  IF operation IN ('condition_immunity','you_have_condition','target_has_condition','save_avoids_condition','state') THEN object_kind := 'effect'; END IF;
  IF object_kind = 'equipment' THEN object_kind := '$card'; END IF;
  IF operation = 'state' THEN object_kind := '$effect'; END IF;
  IF object_kind = 'species' THEN object_kind := 'race'; END IF;
  IF object_kind = 'subclass' THEN object_kind := 'class'; END IF;
  IF object_kind = 'item' THEN object_kind := 'card'; END IF;
  IF object_kind = 'condition' THEN object_kind := 'effect'; END IF;
  IF object_kind NOT IN ('card','action','effect','spell','feat','background','class','race','resource','variable','concept','monster','passive','$card','$effect') THEN object_kind := NULL; END IF;
  -- Monster loadouts embed a library card snapshot whose display `type` is
  -- weapon/armor, while the containing field owns the card identity.
  IF at_path ~ '^ai\.held_weapon_cards?(\[[0-9]+\])?$' THEN object_kind := 'card'; END IF;
  IF node ? 'source' AND at_path ~ '\.options$' THEN object_kind := NULL; END IF;
  IF node->>'source' IN ('effect','action','spell','feat','item','card','class','race','resource','variable','monster') THEN object_kind := CASE WHEN node->>'source'='item' THEN 'card' ELSE node->>'source' END; END IF;
  child_level := bound_level;
  IF source_kind IN ('race','class') AND node->>'min_level' ~ '^[0-9]{1,3}$' THEN
    child_level := (node->>'min_level')::integer;
  END IF;
  FOR member IN SELECT key,value FROM jsonb_each(node) LOOP
    IF member.key IN ('description','detailed_description','condition_description','upcast_description','name','name_en','label','text','flavor','notes','prompt','reason','narrative','image_url','support','references','referenced_by','source','idempotency_key') THEN CONTINUE; END IF;
    child_kind := entity_reference_field_kind(member.key);
    IF at_path='ai.action_weapon_ids' THEN
      RETURN QUERY SELECT 'action'::text,member.key,child_level,at_path || '.' || member.key;
      child_kind := 'card';
    END IF;
    IF at_path='resources' AND source_kind='class' THEN
      IF jsonb_typeof(member.value->'by_level')='object' THEN
        FOR growth IN SELECT key,value FROM jsonb_each(member.value->'by_level') LOOP
          IF growth.key ~ '^[0-9]{1,3}$' AND growth.value <> '0'::jsonb AND growth.value <> '"0"'::jsonb THEN
            RETURN QUERY SELECT 'resource'::text,member.key,growth.key::integer,at_path || '.' || member.key || '.by_level.' || growth.key;
          END IF;
        END LOOP;
      ELSE
        RETURN QUERY SELECT 'resource'::text,member.key,child_level,at_path || '.' || member.key;
      END IF;
    END IF;
    IF member.key IN ('id','entity_id','entityId','ref') THEN child_kind := object_kind; END IF;
    IF member.key IN ('value','values') AND object_kind IS NOT NULL AND object_kind NOT IN ('resource','variable') THEN child_kind := object_kind; END IF;
    IF member.key='value' AND object_kind IS NULL AND operation<>'' AND operation NOT IN ('modifier','damage','damage_rider','healing','reduce_damage','temp_hp','set_value','grant_ability_score','grant_speed','grant_sense') THEN CONTINUE; END IF;
    IF member.key IN ('items','options') AND object_kind IS NOT NULL THEN child_kind := object_kind; END IF;
    IF member.key IN ('filter','recommended','recommendations') AND jsonb_typeof(member.value)='array' AND object_kind IS NOT NULL THEN child_kind := object_kind; END IF;
    IF member.key = 'id' AND at_path = 'mechanics.condition' THEN child_kind := NULL; END IF;
    IF member.key = 'id' AND (node ? 'grants' OR (object_kind = 'effect' AND node ? 'value')) THEN child_kind := NULL; END IF;
    IF member.key IN ('includes','leaves') AND at_path = 'mechanics' THEN child_kind := 'effect'; END IF;
    IF member.key = 'level_source' AND jsonb_typeof(member.value) = 'string' AND member.value #>> '{}' NOT IN ('character','self_level','total') THEN child_kind := 'class'; END IF;
    IF member.key = 'key' AND at_path ~ '\.presentation$' THEN child_kind := 'passive'; END IF;
    IF member.key='card_number' AND operation='remove_effect' THEN child_kind := 'effect'; END IF;
    IF member.key='resource' AND member.value='"spell_slot"'::jsonb AND node->>'level' ~ '^[1-9]$' THEN
      RETURN QUERY SELECT 'resource'::text,'spell_slot_' || (node->>'level'),child_level,at_path || '.resource';
      CONTINUE;
    END IF;
    IF member.key = 'grant' AND jsonb_typeof(member.value) = 'string' THEN child_kind := NULL; END IF;
    IF at_path = 'level_progression' AND member.key ~ '^[0-9]{1,3}$' AND source_kind IN ('race','class') THEN
      RETURN QUERY SELECT * FROM entity_reference_walk(member.value,source_kind,at_path || '.' || member.key,member.key::integer,NULL);
    ELSE
      RETURN QUERY SELECT * FROM entity_reference_walk(member.value,source_kind,at_path || '.' || member.key,child_level,child_kind);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION entity_reference_extract(source_kind text, document jsonb)
RETURNS TABLE(target_type text,target_key text,level integer,path text)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field text; kind text; starting_level integer;
BEGIN
 starting_level := CASE WHEN source_kind IN ('race','class') THEN 1 ELSE 0 END;
 FOREACH field IN ARRAY ARRAY['mechanics','script','battle_profile','related_cards','related_actions','related_effects','mastery','contents','equipment_options','starting_equipment','level_progression','resources','resource','origin_feat','parent_class_id','parent_race_id','classes','subclasses','action_ids','effect_ids','ai'] LOOP
   IF NOT (document ? field) THEN CONTINUE; END IF;
   IF source_kind='action' AND field='resource' AND jsonb_typeof(document->field)='string' THEN
     RETURN QUERY SELECT * FROM entity_reference_walk(to_jsonb(regexp_split_to_array(document->>field,'\s*,\s*')),source_kind,'resources',starting_level,'resource');
     CONTINUE;
   END IF;
   kind := entity_reference_field_kind(field);
   IF field IN ('contents','equipment_options','starting_equipment','level_progression','mechanics','script','battle_profile','ai') THEN kind := NULL; END IF;
   RETURN QUERY SELECT * FROM entity_reference_walk(document->field,source_kind,field,starting_level,kind);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION entity_reference_sync(source_kind text, document jsonb) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE source_key text; alias_values text[]; stable_values text[];
BEGIN
 source_key := COALESCE(document->>'id',document->>'key');
 IF source_key IS NULL THEN RETURN; END IF;
 IF document->>'deleted_at' IS NOT NULL THEN
   DELETE FROM entity_reference_nodes WHERE entity_type=source_kind AND entity_id=source_key;
   RETURN;
 END IF;
 SELECT array_agg(DISTINCT alias) INTO stable_values FROM unnest(ARRAY[source_key,document->>'card_number',document->>'resource_id',document->>'variable_id',document->>'concept_id',document->>'slug',document->>'key',CASE WHEN source_kind='effect' THEN document#>>'{mechanics,condition,id}' END,CASE WHEN source_kind='class' THEN replace(lower(regexp_replace(document->>'card_number','^CLASS[-_]','','i')),'-','_') END]) alias WHERE alias IS NOT NULL AND alias<>'';
 SELECT array_agg(DISTINCT alias) INTO alias_values FROM unnest(stable_values || ARRAY[CASE WHEN source_kind='class' THEN btrim(document->>'name') END,CASE WHEN source_kind='class' THEN lower(btrim(document->>'name') COLLATE "und-x-icu") END,CASE WHEN source_kind='class' THEN btrim(document->>'name_en') END,CASE WHEN source_kind='class' THEN lower(btrim(document->>'name_en') COLLATE "und-x-icu") END,CASE WHEN source_kind='spell' THEN btrim(regexp_replace(lower(replace(document->>'name_en','''','')),'[^a-z0-9]+','_','g'),'_') END]) alias WHERE alias IS NOT NULL AND alias<>'';
 INSERT INTO entity_reference_nodes(entity_type,entity_id,name,aliases,stable_aliases)
 VALUES(source_kind,source_key,COALESCE(document->>'name',''),alias_values,stable_values)
 ON CONFLICT(entity_type,entity_id) DO UPDATE SET name=EXCLUDED.name, aliases=EXCLUDED.aliases,stable_aliases=EXCLUDED.stable_aliases;
 DELETE FROM entity_reference_edges WHERE source_type=source_kind AND source_id=source_key;
 INSERT INTO entity_reference_edges(source_type,source_id,target_type,target_key,level,path)
 SELECT DISTINCT source_kind, source_key, e.target_type, e.target_key, e.level, e.path FROM entity_reference_extract(source_kind,document) e
 ON CONFLICT DO NOTHING;
END $$;

-- Resolve aliases when reading, so adding, deleting or renaming a target is
-- reflected immediately without rewriting every source or its mechanics.
-- Match combatCatalog: stable IDs win; ambiguous English spell name aliases
-- must not silently select one of several different spells.
CREATE OR REPLACE FUNCTION entity_reference_targets(wanted_type text,wanted_key text)
RETURNS TABLE(entity_type text,entity_id text,name text) LANGUAGE sql STABLE AS $$
 SELECT candidate.entity_type,candidate.entity_id,candidate.name FROM (
  SELECT n.entity_type,n.entity_id,n.name,n.stable_aliases @> ARRAY[wanted_key] AS exact,
   bool_or(n.stable_aliases @> ARRAY[wanted_key]) OVER () AS has_exact,count(*) OVER () AS matches
  FROM entity_reference_nodes n WHERE n.aliases @> ARRAY[wanted_key]
  AND (wanted_type=n.entity_type OR wanted_type='*' OR wanted_type='$' || n.entity_type)
 ) candidate WHERE exact OR (NOT has_exact AND matches=1)
$$;

CREATE OR REPLACE VIEW entity_reference_resolved_edges AS
 SELECT e.source_type,e.source_id,COALESCE(t.entity_type,e.target_type) AS target_type,
 COALESCE(t.entity_id,e.target_key) AS target_id, COALESCE(t.name,e.target_key) AS target_name,
 t.entity_id IS NULL AS missing,e.level,e.path
 FROM entity_reference_edges e
 LEFT JOIN LATERAL entity_reference_targets(e.target_type,e.target_key) t ON true
 WHERE t.entity_id IS NOT NULL OR (left(e.target_type,1)<>'$' AND e.target_type<>'*');

CREATE OR REPLACE FUNCTION entity_reference_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   DELETE FROM entity_reference_nodes WHERE entity_type=TG_ARGV[0] AND entity_id=COALESCE(to_jsonb(OLD)->>'id',to_jsonb(OLD)->>'key');
   RETURN OLD;
 END IF;
 PERFORM entity_reference_sync(TG_ARGV[0],to_jsonb(NEW));
 RETURN NEW;
END $$;
