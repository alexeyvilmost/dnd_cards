package migrations

import (
	"database/sql"
	"fmt"
)

const conditionLibraryIconsMigrationVersion = "143_materialize_condition_library_icons"

const (
	petrifiedConditionCard   = "COND-petrified"
	exhaustionConditionCard  = "COND-exhaustion"
	petrifiedIconSourceCard  = "flesh_to_stone"
	exhaustionIconSourceCard = "SPELL-0483"
)

// materializeConditionLibraryIcons ensures every executable condition has a
// real library-owned icon. The source spell images already live in the same
// catalog and remain editable data rather than frontend-generated artwork.
func materializeConditionLibraryIcons(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	type target struct {
		conditionCard string
		sourceCard    string
	}
	for _, target := range []target{
		{petrifiedConditionCard, petrifiedIconSourceCard},
		{exhaustionConditionCard, exhaustionIconSourceCard},
	} {
		result, execErr := tx.Exec(`
			UPDATE effects AS effect SET
				image_url=source.image_url,
				updated_at=NOW()
			FROM spells AS source
			WHERE effect.card_number=$1 AND effect.deleted_at IS NULL
			  AND source.card_number=$2 AND source.deleted_at IS NULL
			  AND NULLIF(BTRIM(source.image_url),'') IS NOT NULL
		`, target.conditionCard, target.sourceCard)
		if execErr != nil {
			return fmt.Errorf("materialize %s icon: %w", target.conditionCard, execErr)
		}
		rows, rowsErr := result.RowsAffected()
		if rowsErr != nil {
			return fmt.Errorf("inspect %s icon update: %w", target.conditionCard, rowsErr)
		}
		if rows != 1 {
			return fmt.Errorf("%s icon source is missing or ambiguous: updated=%d", target.conditionCard, rows)
		}
	}

	var missing int
	if err = tx.QueryRow(`
		SELECT count(*) FROM effects
		WHERE deleted_at IS NULL
		  AND NULLIF(mechanics #>> '{condition,id}','') IS NOT NULL
		  AND NULLIF(BTRIM(image_url),'') IS NULL
	`).Scan(&missing); err != nil {
		return fmt.Errorf("verify condition library icons: %w", err)
	}
	if missing != 0 {
		return fmt.Errorf("condition library icon postcondition failed: %d missing", missing)
	}

	return tx.Commit()
}
