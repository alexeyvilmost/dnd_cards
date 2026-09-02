package migrations

import (
	"database/sql"
	"fmt"
)

const wildCompanionTargetingMigrationVersion = "158_repair_wild_companion_targeting"

var wildCompanionActionCardNumbers = []string{
	"ACT-wild-companion",
	"ACT-wild-companion-slot",
}

// repairWildCompanionTargeting replaces the unsupported legacy `point` shape
// with the canonical zero-actor world targeting contract. The action still
// creates a familiar in the world; it must not open an actor target picker.
func repairWildCompanionTargeting(db *sql.DB) error {
	if _, err := db.Exec(`
		UPDATE actions
		SET mechanics = jsonb_set(
			mechanics,
			'{targeting}',
			'{"domain":"world","actor_targets":false,"shape":"single","min_targets":0,"max_targets":0,"range_ft":10,"requires_line_of_sight":false,"allowed_relations":[]}'::jsonb,
			true
		), updated_at = NOW()
		WHERE card_number IN ('ACT-wild-companion', 'ACT-wild-companion-slot')
		  AND deleted_at IS NULL
	`); err != nil {
		return fmt.Errorf("repair wild companion targeting: %w", err)
	}
	return nil
}
