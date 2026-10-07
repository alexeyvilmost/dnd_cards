-- Reviewed schema-only expansion. Catalog application is a separate atomic command.
ALTER TABLE actions ADD COLUMN IF NOT EXISTS is_narrative boolean NOT NULL DEFAULT false;
ALTER TABLE spells ADD COLUMN IF NOT EXISTS is_narrative boolean NOT NULL DEFAULT false;
ALTER TABLE effects ADD COLUMN IF NOT EXISTS is_technical boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS entity_presentation_307_audit(entity_type text NOT NULL, entity_id uuid NOT NULL,
row_before jsonb NOT NULL, captured_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(entity_type,entity_id));
CREATE TABLE IF NOT EXISTS entity_presentation_307_receipt(manifest_hash text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION invalidate_content_support()
		RETURNS TRIGGER AS $$
		BEGIN
			IF (to_jsonb(NEW) - ARRAY['support', 'updated_at', 'author', 'condition_description', 'custom_rarity_color', 'description', 'description_font_size', 'detailed_description', 'detailed_description_alignment', 'detailed_description_font_size', 'image_cloudinary_id', 'image_cloudinary_url', 'image_generated', 'image_generation_prompt', 'image_url', 'is_narrative', 'is_technical', 'name', 'name_en', 'rarity', 'show_detailed_description', 'source', 'text_alignment', 'text_font_size', 'upcast_description']::text[])
				IS DISTINCT FROM
			   (to_jsonb(OLD) - ARRAY['support', 'updated_at', 'author', 'condition_description', 'custom_rarity_color', 'description', 'description_font_size', 'detailed_description', 'detailed_description_alignment', 'detailed_description_font_size', 'image_cloudinary_id', 'image_cloudinary_url', 'image_generated', 'image_generation_prompt', 'image_url', 'is_narrative', 'is_technical', 'name', 'name_en', 'rarity', 'show_detailed_description', 'source', 'text_alignment', 'text_font_size', 'upcast_description']::text[]) THEN
				NEW.support = NULL;
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_certified_content_mechanics()
RETURNS TRIGGER AS $$
BEGIN
    IF COALESCE(OLD.support->>'mechanics_locked', 'false') <> 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'certified content mechanics are locked'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.mechanics IS DISTINCT FROM OLD.mechanics THEN
        RAISE EXCEPTION 'certified content mechanics cannot be changed'
            USING ERRCODE = 'check_violation';
    END IF;
    -- A structural edit invalidates the old certificate. A standalone
    -- certificate removal still cannot unlock the mechanics.
    IF COALESCE(NEW.support->>'mechanics_locked', 'false') <> 'true'
        AND (to_jsonb(NEW) - ARRAY['support', 'updated_at', 'mechanics', 'author', 'condition_description', 'custom_rarity_color', 'description', 'description_font_size', 'detailed_description', 'detailed_description_alignment', 'detailed_description_font_size', 'image_cloudinary_id', 'image_cloudinary_url', 'image_generated', 'image_generation_prompt', 'image_url', 'is_narrative', 'is_technical', 'name', 'name_en', 'rarity', 'show_detailed_description', 'source', 'text_alignment', 'text_font_size', 'upcast_description']::text[])
            IS NOT DISTINCT FROM
            (to_jsonb(OLD) - ARRAY['support', 'updated_at', 'mechanics', 'author', 'condition_description', 'custom_rarity_color', 'description', 'description_font_size', 'detailed_description', 'detailed_description_alignment', 'detailed_description_font_size', 'image_cloudinary_id', 'image_cloudinary_url', 'image_generated', 'image_generation_prompt', 'image_url', 'is_narrative', 'is_technical', 'name', 'name_en', 'rarity', 'show_detailed_description', 'source', 'text_alignment', 'text_font_size', 'upcast_description']::text[]) THEN
        RAISE EXCEPTION 'certified content mechanics lock cannot be removed'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
CREATE TRIGGER protect_actions_certified_mechanics
    BEFORE UPDATE OR DELETE ON actions
    FOR EACH ROW EXECUTE FUNCTION protect_certified_content_mechanics();
DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
CREATE TRIGGER protect_effects_certified_mechanics
    BEFORE UPDATE OR DELETE ON effects
    FOR EACH ROW EXECUTE FUNCTION protect_certified_content_mechanics();
DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells;
CREATE TRIGGER protect_spells_certified_mechanics
    BEFORE UPDATE OR DELETE ON spells
    FOR EACH ROW EXECUTE FUNCTION protect_certified_content_mechanics();
