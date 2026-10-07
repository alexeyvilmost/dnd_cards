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
			IF TG_OP = 'INSERT' THEN
				NEW.support = jsonb_build_object('status', 'not_tested');
			ELSIF (to_jsonb(NEW) - ARRAY['support', 'updated_at', 'version', 'author', 'condition_description', 'custom_rarity_color', 'description', 'description_font_size', 'detailed_description', 'detailed_description_alignment', 'detailed_description_font_size', 'image_cloudinary_id', 'image_cloudinary_url', 'image_generated', 'image_generation_prompt', 'image_url', 'is_narrative', 'is_technical', 'name', 'name_en', 'rarity', 'show_detailed_description', 'source', 'text_alignment', 'text_font_size', 'upcast_description']::text[])
				IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['support', 'updated_at', 'version', 'author', 'condition_description', 'custom_rarity_color', 'description', 'description_font_size', 'detailed_description', 'detailed_description_alignment', 'detailed_description_font_size', 'image_cloudinary_id', 'image_cloudinary_url', 'image_generated', 'image_generation_prompt', 'image_url', 'is_narrative', 'is_technical', 'name', 'name_en', 'rarity', 'show_detailed_description', 'source', 'text_alignment', 'text_font_size', 'upcast_description']::text[]) THEN
				NEW.support = jsonb_build_object('status', 'not_verified');
			ELSIF NEW.support IS DISTINCT FROM OLD.support
				AND COALESCE(NEW.support->>'status', '') NOT IN (
					'verified', 'verified_partial', 'not_verified', 'not_tested',
					'narrative', 'partial_narrative_verified', 'partial_narrative_not_verified',
					'partial_narrative_verified_partial'
				) THEN
				RAISE EXCEPTION 'Unknown manual content review status' USING ERRCODE = '23514';
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;
