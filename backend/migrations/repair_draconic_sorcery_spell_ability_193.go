package migrations

import (
	"database/sql"
	"fmt"
)

const draconicSorcerySpellAbilityVersion = "193_repair_draconic_sorcery_spell_ability"

// Draconic Sorcery's always-prepared spells are emitted by a subclass effect.
// That source is deliberately distinct from the base class, so every grant
// must carry the Sorcerer's exact casting ability instead of relying on a
// display-name or parent-class inference in the client.
func repairDraconicSorcerySpellAbility(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects`); err != nil {
		return fmt.Errorf("unlock Draconic Sorcery spell grants: %w", err)
	}

	result, err := tx.Exec(`UPDATE effects SET
		mechanics=jsonb_set(
			mechanics,
			'{effects,0,result}',
			(SELECT jsonb_agg(
				CASE WHEN item->>'kind'='grant_spell'
					THEN item || '{"ability":"cha"}'::jsonb
					ELSE item END
				ORDER BY ordinal)
			 FROM jsonb_array_elements(mechanics#>'{effects,0,result}')
			 WITH ORDINALITY AS rows(item, ordinal)),
			true),
		support=jsonb_build_object(
			'status','untested','certification_version',$2::text,
			'mechanics_locked',false,
			'note','Every Draconic Sorcery spell grant now declares Charisma explicitly; production browser retest is required.'),
		updated_at=NOW()
		WHERE card_number=$1 AND deleted_at IS NULL`,
		"EFFECT-0234", draconicSorcerySpellAbilityVersion)
	if err != nil {
		return fmt.Errorf("repair Draconic Sorcery spell grants: %w", err)
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		return fmt.Errorf("repair Draconic Sorcery spell grants affected %d rows: %w", rows, rowsErr)
	}

	var grants, missingAbility int
	if err = tx.QueryRow(`SELECT
		count(*) FILTER (WHERE item->>'kind'='grant_spell'),
		count(*) FILTER (WHERE item->>'kind'='grant_spell' AND item->>'ability' IS DISTINCT FROM 'cha')
		FROM effects,
		LATERAL jsonb_array_elements(mechanics#>'{effects,0,result}') item
		WHERE card_number='EFFECT-0234' AND deleted_at IS NULL`).Scan(&grants, &missingAbility); err != nil {
		return fmt.Errorf("verify Draconic Sorcery spell grants: %w", err)
	}
	if grants != 6 || missingAbility != 0 {
		return fmt.Errorf("Draconic Sorcery spell grants=%d missing_charisma=%d, want 6/0", grants, missingAbility)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
