package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const (
	spearWeaponProfileMigrationVersion = "121_repair_spear_weapon_profile"
	spearWeaponEntityID                = "12b175a4-cbc3-42bd-9d8d-50193a112389"
	spearWeaponCardNumber              = "CARD-0004"
	spearMasteryEffectID               = "4cfe0660-ba1c-415b-b1ed-15e3c708a8e3"
)

func canonicalSpearWeaponProfile() map[string]any {
	profile := weaponProfileBase(
		"spear",
		"simple",
		"str",
		"1d6",
		"piercing",
		"melee",
		spearMasteryEffectID,
		[]map[string]any{
			{"kind": "melee", "reach_ft": 5},
			{"kind": "ranged", "normal_ft": 20, "long_ft": 60},
		},
		[]string{"thrown", "versatile"},
		nil,
	)
	profile["versatile_grip"] = map[string]any{"dice": "1d8", "type": "piercing"}
	return profile
}

// repairSpearWeaponProfile materializes the PHB 2024 spear declaration that
// legacy rows still exposed only through display fields. The strict runtime
// remains fail-closed: only the exact reviewed entity and an absent or already
// canonical profile are accepted.
func repairSpearWeaponProfile(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	profile, err := json.Marshal(canonicalSpearWeaponProfile())
	if err != nil {
		return fmt.Errorf("encode canonical spear weapon profile: %w", err)
	}

	var matchingIdentities, exactIdentity int
	if err := tx.QueryRow(`
		SELECT count(*), count(*) FILTER (WHERE id = $1::uuid AND card_number = $2)
		FROM cards
		WHERE deleted_at IS NULL AND (id = $1::uuid OR card_number = $2)
	`, spearWeaponEntityID, spearWeaponCardNumber).Scan(&matchingIdentities, &exactIdentity); err != nil {
		return fmt.Errorf("inspect spear identity: %w", err)
	}
	if matchingIdentities != 1 || exactIdentity != 1 {
		return fmt.Errorf(
			"%s stable identity drifted: matching_rows=%d exact_rows=%d",
			spearWeaponCardNumber, matchingIdentities, exactIdentity,
		)
	}

	var profileAbsent, profileCanonical bool
	if err := tx.QueryRow(`
		SELECT COALESCE(mechanics->'weapon_profile', 'null'::jsonb) = 'null'::jsonb,
		       COALESCE(mechanics->'weapon_profile' = $3::jsonb, false)
		FROM cards
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		FOR UPDATE
	`, spearWeaponEntityID, spearWeaponCardNumber, profile).Scan(
		&profileAbsent, &profileCanonical,
	); err != nil {
		return fmt.Errorf("read spear weapon profile preimage: %w", err)
	}
	if !profileAbsent && !profileCanonical {
		return fmt.Errorf("%s weapon profile drifted; refusing non-declarative repair", spearWeaponCardNumber)
	}

	if profileAbsent {
		result, err := tx.Exec(`
			UPDATE cards
			SET mechanics = jsonb_set(COALESCE(mechanics, '{}'::jsonb), '{weapon_profile}', $3::jsonb, true),
			    updated_at = NOW()
			WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
			  AND COALESCE(mechanics->'weapon_profile', 'null'::jsonb) = 'null'::jsonb
		`, spearWeaponEntityID, spearWeaponCardNumber, profile)
		if err != nil {
			return fmt.Errorf("repair spear weapon profile: %w", err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("read spear repair row count: %w", err)
		}
		if affected != 1 {
			return fmt.Errorf("repair spear weapon profile affected %d rows", affected)
		}
	}

	var compatible int
	if err := tx.QueryRow(`
		SELECT count(*)
		FROM cards
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		  AND mechanics->'weapon_profile' = $3::jsonb
		  AND mechanics #>> '{weapon_profile,weapon_type}' = 'spear'
		  AND mechanics #>> '{weapon_profile,versatile_grip,dice}' = '1d8'
		  AND mechanics #>> '{weapon_profile,attack_modes,1,normal_ft}' = '20'
		  AND mechanics #>> '{weapon_profile,attack_modes,1,long_ft}' = '60'
	`, spearWeaponEntityID, spearWeaponCardNumber, profile).Scan(&compatible); err != nil {
		return fmt.Errorf("verify spear weapon profile postcondition: %w", err)
	}
	if compatible != 1 {
		return fmt.Errorf("spear weapon profile postcondition failed: compatible_cards=%d", compatible)
	}

	return tx.Commit()
}
