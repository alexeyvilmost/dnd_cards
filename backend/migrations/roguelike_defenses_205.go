package migrations

import (
	"database/sql"
	"fmt"
)

// SRD5.2.1 pp259,325,343: stat-block defenses and senses, independent
// of the progressively certified action/AI capabilities.
func materializeRoguelikeDefenses(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, row := range []struct{ slug, traits string }{
		{"zombie", `{"condition_immunities":["exhaustion","poisoned"],"darkvision_ft":60,"save_proficiencies":["wis"]}`},
		{"skeleton", `{"condition_immunities":["exhaustion","poisoned"],"darkvision_ft":60}`},
		{"animated-armor", `{"condition_immunities":["charmed","deafened","exhaustion","frightened","paralyzed","petrified","poisoned"],"blindsight_ft":60}`},
	} {
		result, err := tx.Exec(`UPDATE monsters SET ai=ai || $2::jsonb,updated_at=NOW() WHERE slug=$1 AND deleted_at IS NULL`, row.slug, row.traits)
		if err != nil {
			return err
		}
		if n, err := result.RowsAffected(); err != nil || n != 1 {
			return fmt.Errorf("missing defense stat block for %s: %v", row.slug, err)
		}
	}
	return tx.Commit()
}
