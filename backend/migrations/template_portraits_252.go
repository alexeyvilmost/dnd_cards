package migrations

import (
	"database/sql"
	"dnd-cards-backend/charactertemplates"
	"encoding/json"
)

// Legacy copies had no provenance. Only an exact race/class/choice fingerprint
// is eligible for the blank-avatar backfill, never a name or species alone.
// Combat envelopes, receipts, checkpoints and event history remain immutable.
func updateTemplatePortraits252(db *sql.DB) error {
	presets, err := charactertemplates.Presets()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`ALTER TABLE characters_v3 ADD COLUMN IF NOT EXISTS source_template_id uuid;
    CREATE TABLE IF NOT EXISTS migration_252_portrait_preimages (
      kind text NOT NULL, id uuid NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(kind,id)
    )`); err != nil {
		return err
	}
	for _, preset := range presets {
		var character map[string]any
		if err = json.Unmarshal(preset.Character, &character); err != nil {
			return err
		}
		avatar, _ := character["avatar_url"].(string)
		if _, err = tx.Exec(`INSERT INTO migration_252_portrait_preimages(kind,id,payload)
      SELECT 'template',id,to_jsonb(t) FROM character_templates t WHERE id=$1 AND coalesce(character->>'avatar_url','')=''
      ON CONFLICT DO NOTHING`, preset.ID); err != nil {
			return err
		}
		if _, err = tx.Exec(`UPDATE character_templates SET character=jsonb_set(character,'{avatar_url}',to_jsonb($2::text)),
      version=version+1,updated_at=NOW() WHERE id=$1 AND coalesce(character->>'avatar_url','')=''`, preset.ID, avatar); err != nil {
			return err
		}
		// Save the exact preimage before changing descriptive fields. Do not infer
		// provenance for old sheets: the new column is populated only on real copies.
		if _, err = tx.Exec(`INSERT INTO migration_252_portrait_preimages(kind,id,payload)
      SELECT 'character',c.id,to_jsonb(c) FROM characters_v3 c JOIN character_templates t ON t.id=$1
      WHERE coalesce(c.avatar_url,'')='' AND (c.source_template_id=t.id OR (
        c.race_id::text=t.character->>'race_id' AND c.class_id::text=t.character->>'class_id'
        AND c.lineage_id IS NOT DISTINCT FROM t.character->>'lineage_id'
        AND c.resolved_choices=t.character->'resolved_choices')) ON CONFLICT DO NOTHING`, preset.ID); err != nil {
			return err
		}
		if _, err = tx.Exec(`UPDATE characters_v3 c SET avatar_url=$2,updated_at=NOW() FROM character_templates t
      WHERE t.id=$1 AND coalesce(c.avatar_url,'')='' AND (c.source_template_id=t.id OR (
        c.race_id::text=t.character->>'race_id' AND c.class_id::text=t.character->>'class_id'
        AND c.lineage_id IS NOT DISTINCT FROM t.character->>'lineage_id'
        AND c.resolved_choices=t.character->'resolved_choices'))`, preset.ID, avatar); err != nil {
			return err
		}
	}
	// Higher-level run copies may have gained new choices; their source sheet
	// supplies proven lineage. Only copy an assigned preset portrait into a blank.
	if _, err = tx.Exec(`INSERT INTO migration_252_portrait_preimages(kind,id,payload)
    SELECT 'character',c.id,to_jsonb(c) FROM characters_v3 c JOIN roguelike_runs r ON r.character_id=c.id
    JOIN characters_v3 s ON s.id=r.source_character_id WHERE coalesce(c.avatar_url,'')=''
    AND s.avatar_url LIKE '/portraits/presets/%' ON CONFLICT DO NOTHING;
    UPDATE characters_v3 c SET avatar_url=s.avatar_url,updated_at=NOW() FROM roguelike_runs r
    JOIN characters_v3 s ON s.id=r.source_character_id WHERE r.character_id=c.id AND coalesce(c.avatar_url,'')=''
    AND s.avatar_url LIKE '/portraits/presets/%'`); err != nil {
		return err
	}
	return tx.Commit()
}
