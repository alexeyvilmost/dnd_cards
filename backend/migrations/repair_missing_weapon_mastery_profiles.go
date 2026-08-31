package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const missingWeaponMasteryProfilesMigrationVersion = "127_repair_missing_weapon_mastery_profiles"

type exactWeaponProfileRepair struct {
	EntityID   string
	CardNumber string
	Profile    map[string]any
}

func canonicalMissingWeaponMasteryProfiles() []exactWeaponProfileRepair {
	melee := []map[string]any{{"kind": "melee", "reach_ft": 5}}
	greataxe := weaponProfileBase(
		"greataxe", "martial", "str", "1d12", "slashing", "melee",
		"3ad18858-a1a9-44fc-a412-4748d8daaeaa", melee,
		[]string{"heavy", "two_handed"}, nil,
	)
	greataxe["heavy"] = map[string]any{
		"minimum_ability_score": 13,
		"ability_by_mode":       map[string]any{"melee": "str", "ranged": "dex"},
		"consequence":           "attack_disadvantage",
	}
	greatclub := weaponProfileBase(
		"greatclub", "simple", "str", "1d8", "bludgeoning", "melee",
		"82ec5a23-18f9-4c68-9119-470c1ef120d9", melee,
		[]string{"two_handed"}, nil,
	)
	return []exactWeaponProfileRepair{
		{
			EntityID:   "9515fd6f-7478-4363-affa-14bc0e3a4e36",
			CardNumber: "CARD-0312",
			Profile:    greataxe,
		},
		{
			EntityID:   "e0a1174c-7a7a-4db0-9a57-175e61487691",
			CardNumber: "CARD-0566",
			Profile:    greatclub,
		},
	}
}

// repairMissingWeaponMasteryProfiles makes Cleave and Push reachable through
// the strict weapon-action runtime. It accepts only the two reviewed catalog
// identities and refuses to overwrite a non-canonical declared profile.
func repairMissingWeaponMasteryProfiles(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, repair := range canonicalMissingWeaponMasteryProfiles() {
		profile, err := json.Marshal(repair.Profile)
		if err != nil {
			return fmt.Errorf("encode %s weapon profile: %w", repair.CardNumber, err)
		}

		var matchingIdentities, exactIdentity int
		if err := tx.QueryRow(`
			SELECT count(*), count(*) FILTER (WHERE id = $1::uuid AND card_number = $2)
			FROM cards
			WHERE deleted_at IS NULL AND (id = $1::uuid OR card_number = $2)
		`, repair.EntityID, repair.CardNumber).Scan(&matchingIdentities, &exactIdentity); err != nil {
			return fmt.Errorf("inspect %s identity: %w", repair.CardNumber, err)
		}
		if matchingIdentities != 1 || exactIdentity != 1 {
			return fmt.Errorf(
				"%s stable identity drifted: matching_rows=%d exact_rows=%d",
				repair.CardNumber, matchingIdentities, exactIdentity,
			)
		}

		var profileAbsent, profileCanonical bool
		if err := tx.QueryRow(`
			SELECT COALESCE(mechanics->'weapon_profile', 'null'::jsonb) = 'null'::jsonb,
			       COALESCE(mechanics->'weapon_profile' = $3::jsonb, false)
			FROM cards
			WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
			FOR UPDATE
		`, repair.EntityID, repair.CardNumber, profile).Scan(&profileAbsent, &profileCanonical); err != nil {
			return fmt.Errorf("read %s weapon profile preimage: %w", repair.CardNumber, err)
		}
		if !profileAbsent && !profileCanonical {
			return fmt.Errorf("%s weapon profile drifted; refusing non-declarative repair", repair.CardNumber)
		}

		if profileAbsent {
			result, err := tx.Exec(`
				UPDATE cards
				SET mechanics = jsonb_set(COALESCE(mechanics, '{}'::jsonb), '{weapon_profile}', $3::jsonb, true),
				    updated_at = NOW()
				WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
				  AND COALESCE(mechanics->'weapon_profile', 'null'::jsonb) = 'null'::jsonb
			`, repair.EntityID, repair.CardNumber, profile)
			if err != nil {
				return fmt.Errorf("repair %s weapon profile: %w", repair.CardNumber, err)
			}
			affected, err := result.RowsAffected()
			if err != nil {
				return fmt.Errorf("read %s repair row count: %w", repair.CardNumber, err)
			}
			if affected != 1 {
				return fmt.Errorf("repair %s weapon profile affected %d rows", repair.CardNumber, affected)
			}
		}

		var compatible int
		if err := tx.QueryRow(`
			SELECT count(*)
			FROM cards
			WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
			  AND mechanics->'weapon_profile' = $3::jsonb
			  AND mechanics #>> '{weapon_profile,mastery_effect_id}' <> ''
		`, repair.EntityID, repair.CardNumber, profile).Scan(&compatible); err != nil {
			return fmt.Errorf("verify %s weapon profile postcondition: %w", repair.CardNumber, err)
		}
		if compatible != 1 {
			return fmt.Errorf("%s weapon profile postcondition failed: compatible_cards=%d", repair.CardNumber, compatible)
		}
	}

	return tx.Commit()
}
