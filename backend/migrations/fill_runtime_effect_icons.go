package migrations

import (
	"database/sql"
	"fmt"
)

const runtimeEffectIconsMigrationVersion = "145_fill_runtime_effect_icons"
const frostGoliathRuntimeEffectCard = "EFFECT-runtime-6499f0dafa08184d0139"
const rayOfFrostIconSourceCard = "SPELL-0218"

func fillRuntimeEffectIcons(db *sql.DB) error {
	result, err := db.Exec(`
		UPDATE effects AS effect SET image_url=source.image_url,updated_at=NOW()
		FROM spells AS source
		WHERE effect.card_number=$1 AND effect.deleted_at IS NULL
		  AND source.card_number=$2 AND source.deleted_at IS NULL
		  AND NULLIF(BTRIM(source.image_url),'') IS NOT NULL
	`, frostGoliathRuntimeEffectCard, rayOfFrostIconSourceCard)
	if err != nil {
		return fmt.Errorf("fill Frost Goliath runtime effect icon: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil || rows != 1 {
		return fmt.Errorf("fill Frost Goliath runtime effect icon affected %d rows: %w", rows, err)
	}
	var missing int
	if err = db.QueryRow(`SELECT count(*) FROM effects
		WHERE deleted_at IS NULL
		  AND support->>'certification_version'=$1
		  AND NULLIF(BTRIM(image_url),'') IS NULL`,
		miniMVPRuntimeEffectsMigrationVersion).Scan(&missing); err != nil {
		return fmt.Errorf("verify runtime effect icons: %w", err)
	}
	if missing != 0 {
		return fmt.Errorf("runtime effect icon postcondition failed: %d missing", missing)
	}
	return nil
}
