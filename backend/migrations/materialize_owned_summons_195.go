package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const ownedSummonsMigrationVersion = "195_materialize_owned_summon_lifecycle"

type ownedSummonPatch struct {
	cardNumber string
	primitive  map[string]any
}

func ownedSummonPrimitive(
	key, name, creatureType string,
	size, speed, acBase, acPerLevel, hpBase, hpPerLevel, hpScaleFrom int,
	duration any,
) map[string]any {
	return map[string]any{
		"type": "owned_summon", "summon_key": key, "name": name,
		"creature_type": creatureType, "size": size, "speed_ft": speed,
		"armor_class": map[string]any{"base": acBase, "per_spell_level": acPerLevel},
		"hit_points": map[string]any{
			"base": hpBase, "per_spell_level": hpPerLevel, "scale_from_level": hpScaleFrom,
		},
		"duration":         duration,
		"initiative":       "immediately_after_owner",
		"replace_existing": true,
	}
}

func ownedSummonPatches() []ownedSummonPatch {
	return []ownedSummonPatch{
		{"SPELL-0178", ownedSummonPrimitive(
			"bestial_spirit", "Дух зверя", "beast", 1, 40,
			11, 1, 20, 5, 2, "concentration")},
		{"SPELL-0240", ownedSummonPrimitive(
			"otherworldly_steed", "Потусторонний скакун", "celestial/fey/fiend", 3, 60,
			10, 1, 5, 10, 0, "until_destroyed")},
		{"summon_fey", ownedSummonPrimitive(
			"fey_spirit", "Дух феи", "fey", 2, 40,
			12, 1, 30, 10, 3, "concentration")},
		{"summon_undead", ownedSummonPrimitive(
			"undead_spirit", "Дух нежити", "undead", 2, 30,
			11, 1, 20, 10, 3, "concentration")},
	}
}

// This migration deliberately materializes only the common lifecycle shared
// by four reviewed spells. Form-specific attacks and secondary riders remain
// untested and are not represented by this primitive.
func materializeOwnedSummons(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells`); err != nil {
		return fmt.Errorf("unlock summon spell mechanics: %w", err)
	}
	for _, patch := range ownedSummonPatches() {
		primitive, marshalErr := json.Marshal(patch.primitive)
		if marshalErr != nil {
			return fmt.Errorf("marshal summon %s: %w", patch.cardNumber, marshalErr)
		}
		result, execErr := tx.Exec(`UPDATE spells SET
			mechanics=jsonb_set(COALESCE(mechanics, '{}'::jsonb), '{primitive}', $2::jsonb, true),
			support=jsonb_build_object(
				'status','untested','certification_version',$3::text,
				'mechanics_locked',false,
				'note','Owned actor lifecycle is automated; form-specific actions and riders still require implementation and browser verification.'),
			updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL`,
			patch.cardNumber, string(primitive), ownedSummonsMigrationVersion)
		if execErr != nil {
			return fmt.Errorf("materialize summon %s: %w", patch.cardNumber, execErr)
		}
		if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
			return fmt.Errorf("materialize summon %s affected %d rows: %w", patch.cardNumber, rows, rowsErr)
		}
	}
	var count int
	if err = tx.QueryRow(`SELECT count(*) FROM spells
		WHERE card_number=ANY($1)
		  AND mechanics->'primitive'->>'type'='owned_summon'
		  AND mechanics->'primitive'->>'initiative'='immediately_after_owner'
		  AND mechanics->'primitive'->>'replace_existing'='true'`,
		[]string{"SPELL-0178", "SPELL-0240", "summon_fey", "summon_undead"}).Scan(&count); err != nil {
		return fmt.Errorf("verify owned summons: %w", err)
	}
	if count != 4 {
		return fmt.Errorf("verified %d owned summon spells, want 4", count)
	}
	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
