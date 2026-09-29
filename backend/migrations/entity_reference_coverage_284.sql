-- Extend only declared mechanical references introduced by the catalog item /
-- variant primitives. Runtime instance, choice and attack_maneuver IDs remain
-- outside this index. Formula fields follow mechanics.schema.json, with the
-- legacy card.bonus_value armor formula used by engine/ac.ts.
CREATE OR REPLACE FUNCTION entity_reference_field_kind(field text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE
 WHEN field IN ('related_cards','card_id','cardId','item_id','itemId','item_ids','card_ids','weapon_id','weaponId','weapon_card_id','armor_card_id','requires_held_item','held_weapon_card','held_weapon_cards','item_card_id','key_item_card_id','requires_fuel_card_id','requires_item_source','requires_equipped_item_id') THEN 'card'
 WHEN field IN ('related_actions','action_id','actionId','action_ids','actionIds','actions','granted_actions','grant_actions','action_ref','actionRef','granted_action_refs','entry_action_ref','exit_action_ref','requires_runtime_action_grant','variant_of_action_id','action_variant_ids') THEN 'action'
 WHEN field IN ('related_effects','effect_id','effectId','effect_ids','effectIds','effects','granted_effects','grant_effects','mastery','mastery_effect_id','condition_id','conditionId','condition_immunities','on_failure_condition','if_condition_immunity','inside_condition','condition') THEN 'effect'
 WHEN field IN ('spell_id','spellId','spell_ids','spellIds','spells','spell_ref','spellRef','prepared_spells','known_spells','grantedSpell','variant_of_spell_id','spell_variant_ids') THEN 'spell'
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
    ELSIF expected_kind IS NULL AND (at_path ~ '(^|\.)(formula|amount|dice|count|max|value|distance|bonus|default_value|dc|cr_max|limit|investigation_dc|bonus_value)$' OR at_path ~ '\.(formula_bindings|event_formula_bindings)\.[^.]+$') THEN
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
  -- Binding keys name local formula slots, even if a key happens to equal
  -- 'resource', 'effect_id', or another library-reference field name.
  IF at_path ~ '\.(formula_bindings|event_formula_bindings)$' THEN
    FOR member IN SELECT key,value FROM jsonb_each(node) LOOP
      RETURN QUERY SELECT * FROM entity_reference_walk(member.value,source_kind,at_path || '.' || member.key,bound_level,NULL);
    END LOOP;
    RETURN;
  END IF;
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

-- A level belongs to an explicitly declared progression/min_level, not to the
-- source type itself. In particular an unlevelled class/species relation does
-- not mean level 1. Keep the existing recursive walker and mechanical roots.
CREATE OR REPLACE FUNCTION entity_reference_extract(source_kind text, document jsonb)
RETURNS TABLE(target_type text,target_key text,level integer,path text)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field text; kind text;
BEGIN
 FOREACH field IN ARRAY ARRAY['mechanics','script','battle_profile','related_cards','related_actions','related_effects','mastery','contents','equipment_options','starting_equipment','level_progression','resources','resource','origin_feat','parent_class_id','parent_race_id','classes','subclasses','action_ids','effect_ids','ai','bonus_value'] LOOP
   IF NOT (document ? field) THEN CONTINUE; END IF;
   IF field='bonus_value' AND source_kind<>'card' THEN CONTINUE; END IF;
   IF source_kind='action' AND field='resource' AND jsonb_typeof(document->field)='string' THEN
     RETURN QUERY SELECT * FROM entity_reference_walk(to_jsonb(regexp_split_to_array(document->>field,'\s*,\s*')),source_kind,'resources',0,'resource');
     CONTINUE;
   END IF;
   kind := entity_reference_field_kind(field);
   IF field IN ('contents','equipment_options','starting_equipment','level_progression','mechanics','script','battle_profile','ai') THEN kind := NULL; END IF;
   RETURN QUERY SELECT * FROM entity_reference_walk(document->field,source_kind,field,0,kind);
 END LOOP;
END $$;

-- A stable alias beats display aliases only when exactly one entity owns it.
-- Duplicate condition IDs or normalized class keys are unresolved, just like
-- ambiguous English spell names; never fan one reference out to several rows.
CREATE OR REPLACE FUNCTION entity_reference_targets(wanted_type text,wanted_key text)
RETURNS TABLE(entity_type text,entity_id text,name text) LANGUAGE sql STABLE AS $$
 SELECT candidate.entity_type,candidate.entity_id,candidate.name FROM (
  SELECT n.entity_type,n.entity_id,n.name,n.stable_aliases @> ARRAY[wanted_key] AS exact,
   count(*) FILTER (WHERE n.stable_aliases @> ARRAY[wanted_key]) OVER () AS exact_matches,
   count(*) OVER () AS matches
  FROM entity_reference_nodes n WHERE n.aliases @> ARRAY[wanted_key]
  AND (wanted_type=n.entity_type OR wanted_type='*' OR wanted_type='$' || n.entity_type)
 ) candidate WHERE (exact AND exact_matches=1) OR (exact_matches=0 AND matches=1)
$$;
