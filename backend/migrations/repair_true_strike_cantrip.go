package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const trueStrikeCantripMigrationVersion = "134_repair_true_strike_cantrip"

const (
	trueStrikeSpellID    = "f5d4b18f-6212-47e7-ae0b-8dda2f84d4c2"
	trueStrikeCardNumber = "SPELL-0224"
)

func canonicalTrueStrikeMechanics() map[string]any {
	return map[string]any{
		"activation": map[string]any{"cost": []any{map[string]any{"resource": "action"}}, "mode": "active"},
		"effects": []any{map[string]any{
			"resolution": "attack_roll", "ability": "spellcasting", "vs": "ac",
			"on_hit": []any{map[string]any{
				"kind": "choice", "id": "true_strike_damage_type", "context": "in_play", "count": 1,
				"prompt": "Выберите тип урона оружия",
				"options": map[string]any{"source": "explicit", "items": []any{
					map[string]any{"id": "weapon", "name": "Обычный тип оружия", "grants": []any{
						map[string]any{"kind": "damage", "dice": "weapon", "type": "weapon", "ability": "spellcasting"},
						map[string]any{"kind": "damage", "dice": "0", "type": "radiant", "scaling": map[string]any{"dice": "1d6", "per": "character_level"}},
					}},
					map[string]any{"id": "radiant", "name": "Излучение", "grants": []any{
						map[string]any{"kind": "damage", "dice": "weapon", "type": "radiant", "ability": "spellcasting"},
						map[string]any{"kind": "damage", "dice": "0", "type": "radiant", "scaling": map[string]any{"dice": "1d6", "per": "character_level"}},
					}},
				}},
			}},
		}},
		"spell_class_list_ids": []string{"CLASS-bard", "CLASS-sorcerer", "CLASS-warlock", "CLASS-wizard"},
		"targeting": map[string]any{
			"shape": "single", "domain": "actor", "actor_targets": true,
			"min_targets": 1, "max_targets": 1, "range_ft": 600,
			"requires_line_of_sight": true, "allowed_relations": []string{"enemy"},
		},
	}
}

func repairTrueStrikeCantrip(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	encoded, err := json.Marshal(canonicalTrueStrikeMechanics())
	if err != nil {
		return fmt.Errorf("encode True Strike mechanics: %w", err)
	}
	var matches, exact int
	if err := tx.QueryRow(`
		SELECT count(*), count(*) FILTER (WHERE id=$1::uuid AND card_number=$2)
		FROM spells WHERE deleted_at IS NULL AND (id=$1::uuid OR card_number=$2)
	`, trueStrikeSpellID, trueStrikeCardNumber).Scan(&matches, &exact); err != nil {
		return fmt.Errorf("inspect True Strike identity: %w", err)
	}
	if matches != 1 || exact != 1 {
		return fmt.Errorf("%s stable identity drifted: matching_rows=%d exact_rows=%d", trueStrikeCardNumber, matches, exact)
	}
	if _, err := tx.Exec(`DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells`); err != nil {
		return fmt.Errorf("disable spell certification guard: %w", err)
	}
	result, err := tx.Exec(`
		UPDATE spells
		SET mechanics=$3::jsonb,
		    support=jsonb_build_object(
		      'status','untested', 'certification_version',$4::text, 'mechanics_locked',false,
		      'limitations',jsonb_build_array('Требуется повторная браузерная проверка.'),
		      'note','Исправлены выбор типа урона и выбор цели Меткого удара.'
		    ),
		    updated_at=NOW()
		WHERE id=$1::uuid AND card_number=$2 AND deleted_at IS NULL
	`, trueStrikeSpellID, trueStrikeCardNumber, encoded, trueStrikeCantripMigrationVersion)
	if err != nil {
		return fmt.Errorf("repair True Strike: %w", err)
	}
	if affected, rowsErr := result.RowsAffected(); rowsErr != nil || affected != 1 {
		return fmt.Errorf("repair True Strike affected %d rows: %w", affected, rowsErr)
	}
	if _, err := tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
