package migrations

import (
	"database/sql"
	"fmt"
)

const levelTwoActorTargetingMigrationVersion = "155_repair_level_two_actor_targeting"

// repairLevelTwoActorTargeting is a forward-only repair for databases that
// applied migration 154 before actor_targets became an explicit compiler
// invariant. Self actions do not expose the actor-target picker.
func repairLevelTwoActorTargeting(db *sql.DB) error {
	if _, err := db.Exec(`
		UPDATE actions
		SET mechanics = jsonb_set(mechanics, '{targeting,actor_targets}', 'false'::jsonb, true),
			updated_at = NOW()
		WHERE card_number IN (
			'ACT-reckless-attack',
			'ACT-monk-patient-defense',
			'ACT-monk-patient-defense-focus',
			'ACT-monk-step-of-the-wind',
			'ACT-monk-step-of-the-wind-focus',
			'ACT-monk-uncanny-metabolism',
			'ACT-cunning-dash',
			'ACT-cunning-disengage',
			'ACT-cunning-hide',
			'ACT-font-create-slot-1',
			'ACT-font-convert-slot-1',
			'ACT-magical-cunning',
			'ACT-tactical-mind',
			'ACT-action-surge',
			'ACT-wild-shape'
		)
		AND deleted_at IS NULL
		AND mechanics#>>'{targeting,domain}' = 'actor'
	`); err != nil {
		return fmt.Errorf("repair level-two actor targeting: %w", err)
	}
	return nil
}
