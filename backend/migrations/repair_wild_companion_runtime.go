package migrations

import (
	"database/sql"
	"fmt"
)

const wildCompanionRuntimeMigrationVersion = "160_repair_wild_companion_runtime"

const wildCompanionWildShapeMechanics = `{"activation":{"mode":"active","cost":[{"resource":"action"},{"resource":"wild_shape"}]},"targeting":{"domain":"world","actor_targets":false,"shape":"single","min_targets":0,"max_targets":0,"range_ft":10,"requires_line_of_sight":false,"allowed_relations":[]},"primitive":{"type":"wild_companion","policy":{"connection_range_ft":100,"reappear_range_ft":30,"ritual_casting_added_seconds":600}},"effects":[]}`

const wildCompanionSpellSlotMechanics = `{"activation":{"mode":"active","cost":[{"resource":"action"},{"resource":"spell_slot","level":1,"amount":1}]},"targeting":{"domain":"world","actor_targets":false,"shape":"single","min_targets":0,"max_targets":0,"range_ft":10,"requires_line_of_sight":false,"allowed_relations":[]},"primitive":{"type":"wild_companion","policy":{"connection_range_ft":100,"reappear_range_ft":30,"ritual_casting_added_seconds":600}},"effects":[]}`

// repairWildCompanionRuntime routes both resource variants through the pinned
// familiar actor catalog. This replaces the old generic world_entity marker,
// which could neither create nor control a real combat actor.
func repairWildCompanionRuntime(db *sql.DB) error {
	if _, err := db.Exec(`
		UPDATE actions
		SET mechanics = CASE card_number
			WHEN 'ACT-wild-companion' THEN $1::jsonb
			WHEN 'ACT-wild-companion-slot' THEN $2::jsonb
		END,
		support = jsonb_build_object(
			'status','untested',
			'certification_version',$3::text,
			'mechanics_locked',false,
			'note','Canonical familiar actor browser verification pending'
		),
		updated_at = NOW()
		WHERE card_number IN ('ACT-wild-companion', 'ACT-wild-companion-slot')
		  AND deleted_at IS NULL
	`, wildCompanionWildShapeMechanics, wildCompanionSpellSlotMechanics, wildCompanionRuntimeMigrationVersion); err != nil {
		return fmt.Errorf("repair wild companion runtime: %w", err)
	}
	return nil
}
