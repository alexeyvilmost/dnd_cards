-- A level belongs to an explicitly declared progression/min_level, not to the
-- source type itself. In particular an unlevelled class/species relation does
-- not mean level 1. Keep the existing recursive walker and mechanical roots.
CREATE OR REPLACE FUNCTION entity_reference_extract(source_kind text, document jsonb)
RETURNS TABLE(target_type text,target_key text,level integer,path text)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE field text; kind text;
BEGIN
 FOREACH field IN ARRAY ARRAY['mechanics','script','battle_profile','related_cards','related_actions','related_effects','mastery','contents','equipment_options','starting_equipment','level_progression','resources','resource','origin_feat','parent_class_id','parent_race_id','classes','subclasses','action_ids','effect_ids','ai'] LOOP
   IF NOT (document ? field) THEN CONTINUE; END IF;
   IF source_kind='action' AND field='resource' AND jsonb_typeof(document->field)='string' THEN
     RETURN QUERY SELECT * FROM entity_reference_walk(to_jsonb(regexp_split_to_array(document->>field,'\s*,\s*')),source_kind,'resources',0,'resource');
     CONTINUE;
   END IF;
   kind := entity_reference_field_kind(field);
   IF field IN ('contents','equipment_options','starting_equipment','level_progression','mechanics','script','battle_profile','ai') THEN kind := NULL; END IF;
   RETURN QUERY SELECT * FROM entity_reference_walk(document->field,source_kind,field,0,kind);
 END LOOP;
END $$;
