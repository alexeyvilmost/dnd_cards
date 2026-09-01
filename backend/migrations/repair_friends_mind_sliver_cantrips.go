package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const friendsMindSliverCantripMigrationVersion = "133_repair_friends_mind_sliver_cantrips"

const (
	friendsSpellID       = "5da8fe39-f54d-4ffb-a958-4ed6d9cafaa2"
	friendsCardNumber    = "SPELL-0192"
	mindSliverSpellID    = "c3fc969b-ba03-443f-a222-46f6b9a53bd6"
	mindSliverCardNumber = "SPELL-0281"
)

func canonicalFriendsMechanics() map[string]any {
	return map[string]any{
		"activation": map[string]any{"cost": []any{map[string]any{"resource": "action"}}, "mode": "active"},
		"effects": []any{map[string]any{
			"ability": "wis", "dc": "8 + prof + spellcasting", "resolution": "save", "who": "target",
			"automatic_success": map[string]any{
				"if_target_relation":          "enemy",
				"if_target_creature_type_not": "humanoid",
			},
			"on_fail": []any{map[string]any{
				"duration": map[string]any{"amount": 10, "concentration": true, "type": "rounds"},
				"kind":     "condition", "op": "apply", "value": "charmed",
			}},
			"on_success": []any{},
		}},
		"spell_class_list_ids": []string{"CLASS-bard", "CLASS-sorcerer", "CLASS-warlock", "CLASS-wizard"},
		"targeting":            map[string]any{"filter": "any", "range": "10 футов", "shape": "single"},
	}
}

func canonicalMindSliverMechanics() map[string]any {
	return map[string]any{
		"activation": map[string]any{"cost": []any{map[string]any{"resource": "action"}}, "mode": "active"},
		"effects": []any{map[string]any{
			"ability": "int", "dc": "8 + prof + spellcasting", "resolution": "save", "who": "target",
			"on_fail": []any{
				map[string]any{"dice": "1d6", "kind": "damage", "scaling": map[string]any{"dice": "1d6", "per": "character_level"}, "type": "psychic"},
				map[string]any{
					"kind": "modifier", "applies_to": map[string]any{"roll": "saving_throw"},
					"op": "bonus_die", "faces": 4, "sign": -1, "source": "Расщепление разума",
					"consume": "next", "duration": map[string]any{"type": "until_end_of_source_next_turn"},
				},
			},
			"on_success": []any{},
		}},
		"spell_class_list_ids": []string{"CLASS-sorcerer", "CLASS-warlock", "CLASS-wizard"},
		"targeting":            map[string]any{"filter": "any", "range": "60 футов", "shape": "single"},
	}
}

func repairFriendsMindSliverCantrips(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	rows := []struct {
		id, card, name string
		mechanics      map[string]any
	}{
		{friendsSpellID, friendsCardNumber, "Дружба", canonicalFriendsMechanics()},
		{mindSliverSpellID, mindSliverCardNumber, "Расщепление разума", canonicalMindSliverMechanics()},
	}
	for _, row := range rows {
		encoded, encodeErr := json.Marshal(row.mechanics)
		if encodeErr != nil {
			return fmt.Errorf("encode %s mechanics: %w", row.name, encodeErr)
		}
		var matches, exact int
		if err := tx.QueryRow(`
			SELECT count(*), count(*) FILTER (WHERE id=$1::uuid AND card_number=$2)
			FROM spells WHERE deleted_at IS NULL AND (id=$1::uuid OR card_number=$2)
		`, row.id, row.card).Scan(&matches, &exact); err != nil {
			return fmt.Errorf("inspect %s identity: %w", row.name, err)
		}
		if matches != 1 || exact != 1 {
			return fmt.Errorf("%s stable identity drifted: matching_rows=%d exact_rows=%d", row.card, matches, exact)
		}
		if _, err := tx.Exec(`DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells`); err != nil {
			return fmt.Errorf("disable spell certification guard: %w", err)
		}
		result, updateErr := tx.Exec(`
			UPDATE spells
			SET mechanics=$3::jsonb,
			    support=jsonb_build_object(
			      'status','untested', 'certification_version',$4::text, 'mechanics_locked',false,
			      'limitations',jsonb_build_array('Требуется повторная браузерная проверка.'),
			      'note',$5::text
			    ),
			    updated_at=NOW()
			WHERE id=$1::uuid AND card_number=$2 AND deleted_at IS NULL
		`, row.id, row.card, encoded, friendsMindSliverCantripMigrationVersion,
			"Исправлена проверенная в бою механика заговора.")
		if updateErr != nil {
			return fmt.Errorf("repair %s: %w", row.name, updateErr)
		}
		if affected, rowsErr := result.RowsAffected(); rowsErr != nil || affected != 1 {
			return fmt.Errorf("repair %s affected %d rows: %w", row.name, affected, rowsErr)
		}
	}
	if _, err := tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
