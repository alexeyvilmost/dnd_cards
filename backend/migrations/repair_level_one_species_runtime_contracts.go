package migrations

import (
	"database/sql"
	"fmt"
)

const levelOneSpeciesRuntimeContractsMigrationVersion = "128_repair_level_one_species_runtime_contracts"

const (
	forestGnomeEffectID = "147fc0bb-54fd-43a0-bc6c-6c2991e8b2f8"
	forestGnomeCard     = "RE-sub-forest"
	healingHandsID      = "c1586eb6-a618-4a8a-8568-26dd5595887b"
	healingHandsCard    = "aasimar_healing_hands"
)

// repairLevelOneSpeciesRuntimeContracts repairs two exact production records
// discovered by the Forge -> sheet -> combat browser pass. Both updates are
// fail-closed: an unexpected identity or mechanics preimage aborts the release.
func repairLevelOneSpeciesRuntimeContracts(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var forestMatches, forestExact int
	if err := tx.QueryRow(`
		SELECT count(*), count(*) FILTER (WHERE id = $1::uuid AND card_number = $2)
		FROM effects
		WHERE deleted_at IS NULL AND (id = $1::uuid OR card_number = $2)
	`, forestGnomeEffectID, forestGnomeCard).Scan(&forestMatches, &forestExact); err != nil {
		return fmt.Errorf("inspect Forest Gnome identity: %w", err)
	}
	if forestMatches != 1 || forestExact != 1 {
		return fmt.Errorf("%s stable identity drifted: matching_rows=%d exact_rows=%d", forestGnomeCard, forestMatches, forestExact)
	}

	var forestLegacy, forestCanonical bool
	if err := tx.QueryRow(`
		SELECT COALESCE(mechanics #>> '{effects,0,result,1,kind}' = 'grant_spell'
		       AND mechanics #>> '{effects,0,result,1,value}' = 'SPELL-0277'
		       AND NOT (mechanics #> '{effects,0,result,1}' ? 'label'), false),
		       COALESCE(mechanics #>> '{effects,0,result,1,label}' = 'always_prepared', false)
		FROM effects
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		FOR UPDATE
	`, forestGnomeEffectID, forestGnomeCard).Scan(&forestLegacy, &forestCanonical); err != nil {
		return fmt.Errorf("read Forest Gnome grant preimage: %w", err)
	}
	if !forestLegacy && !forestCanonical {
		return fmt.Errorf("%s mechanics drifted; refusing non-declarative repair", forestGnomeCard)
	}
	if forestLegacy {
		result, err := tx.Exec(`
			UPDATE effects
			SET mechanics = jsonb_set(mechanics, '{effects,0,result,1,label}', '"always_prepared"'::jsonb, true),
			    support = NULL,
			    updated_at = NOW()
			WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
			  AND mechanics #>> '{effects,0,result,1,kind}' = 'grant_spell'
			  AND mechanics #>> '{effects,0,result,1,value}' = 'SPELL-0277'
			  AND NOT (mechanics #> '{effects,0,result,1}' ? 'label')
		`, forestGnomeEffectID, forestGnomeCard)
		if err != nil {
			return fmt.Errorf("repair Forest Gnome spell access: %w", err)
		}
		if affected, err := result.RowsAffected(); err != nil || affected != 1 {
			return fmt.Errorf("repair Forest Gnome spell access affected %d rows: %w", affected, err)
		}
	}

	var healingMatches, healingExact int
	if err := tx.QueryRow(`
		SELECT count(*), count(*) FILTER (WHERE id = $1::uuid AND card_number = $2)
		FROM actions
		WHERE deleted_at IS NULL AND (id = $1::uuid OR card_number = $2)
	`, healingHandsID, healingHandsCard).Scan(&healingMatches, &healingExact); err != nil {
		return fmt.Errorf("inspect Healing Hands identity: %w", err)
	}
	if healingMatches != 1 || healingExact != 1 {
		return fmt.Errorf("%s stable identity drifted: matching_rows=%d exact_rows=%d", healingHandsCard, healingMatches, healingExact)
	}

	var healingLegacy, healingCanonical bool
	if err := tx.QueryRow(`
		SELECT COALESCE(mechanics #>> '{effects,0,result,0,kind}' = 'healing'
		       AND mechanics #>> '{effects,0,result,0,amount}' = 'prof d4',
		       false),
		       COALESCE(mechanics #>> '{effects,0,result,0,kind}' = 'healing'
		       AND mechanics #>> '{effects,0,result,0,amount}' = 'prof_bonus d4', false)
		FROM actions
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		FOR UPDATE
	`, healingHandsID, healingHandsCard).Scan(&healingLegacy, &healingCanonical); err != nil {
		return fmt.Errorf("read Healing Hands preimage: %w", err)
	}
	if !healingLegacy && !healingCanonical {
		return fmt.Errorf("%s mechanics drifted; refusing non-declarative repair", healingHandsCard)
	}
	if healingLegacy {
		result, err := tx.Exec(`
			UPDATE actions
			SET mechanics = jsonb_set(mechanics, '{effects,0,result,0,amount}', '"prof_bonus d4"'::jsonb, false),
			    support = NULL,
			    updated_at = NOW()
			WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
			  AND mechanics #>> '{effects,0,result,0,kind}' = 'healing'
			  AND mechanics #>> '{effects,0,result,0,amount}' = 'prof d4'
		`, healingHandsID, healingHandsCard)
		if err != nil {
			return fmt.Errorf("repair Healing Hands formula: %w", err)
		}
		if affected, err := result.RowsAffected(); err != nil || affected != 1 {
			return fmt.Errorf("repair Healing Hands formula affected %d rows: %w", affected, err)
		}
	}

	var postconditions int
	if err := tx.QueryRow(`
		SELECT
		  (SELECT count(*) FROM effects WHERE id = $1::uuid AND card_number = $2
		     AND mechanics #>> '{effects,0,result,1,label}' = 'always_prepared')
		+ (SELECT count(*) FROM actions WHERE id = $3::uuid AND card_number = $4
		     AND mechanics #>> '{effects,0,result,0,amount}' = 'prof_bonus d4')
	`, forestGnomeEffectID, forestGnomeCard, healingHandsID, healingHandsCard).Scan(&postconditions); err != nil {
		return fmt.Errorf("verify level-one species postconditions: %w", err)
	}
	if postconditions != 2 {
		return fmt.Errorf("level-one species postconditions failed: compatible_records=%d", postconditions)
	}

	return tx.Commit()
}
