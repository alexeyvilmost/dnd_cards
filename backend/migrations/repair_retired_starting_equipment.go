package migrations

import (
	"database/sql"
	"fmt"
)

const retiredStartingEquipmentMigrationVersion = "157_repair_retired_starting_equipment"

var retiredStartingEquipment = []struct {
	oldID string
	newID string
}{
	{"cb6650a8-489f-4edb-a4f3-77e32f8c2317", "e68a30ff-b0e5-41cf-b007-ddc5eb319750"}, // MVP longsword -> CARD-0319
	{"d650a76f-068c-4956-96db-56e5c50bd6c5", "b0a5fd06-4b35-480a-8a99-02aa2a60fd6b"}, // MVP shield -> CARD-0200
}

// repairRetiredStartingEquipment closes both sources of stale immutable Card
// identities: existing character runtime JSON and class starting-equipment
// templates used for future Forge characters.
func repairRetiredStartingEquipment(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, replacement := range retiredStartingEquipment {
		if _, err = tx.Exec(`
			UPDATE characters_v3
			SET inventory_items = replace(COALESCE(inventory_items, '[]'::jsonb)::text, $1, $2)::jsonb,
				equipment = replace(COALESCE(equipment, '{}'::jsonb)::text, $1, $2)::jsonb,
				updated_at = NOW()
			WHERE COALESCE(inventory_items, '[]'::jsonb)::text LIKE '%' || $1 || '%'
			   OR COALESCE(equipment, '{}'::jsonb)::text LIKE '%' || $1 || '%'
		`, replacement.oldID, replacement.newID); err != nil {
			return fmt.Errorf("repair retired character equipment %s: %w", replacement.oldID, err)
		}
		if _, err = tx.Exec(`
			UPDATE classes
			SET equipment_options = replace(COALESCE(equipment_options, '{}'::jsonb)::text, $1, $2)::jsonb,
				updated_at = NOW()
			WHERE COALESCE(equipment_options, '{}'::jsonb)::text LIKE '%' || $1 || '%'
		`, replacement.oldID, replacement.newID); err != nil {
			return fmt.Errorf("repair retired class equipment %s: %w", replacement.oldID, err)
		}
	}
	// Migration 156 raised the level-2 Wizard preparation capacity from four to
	// five. Existing characters need one deterministic in-book selection added;
	// otherwise Forge reports the mismatch but cannot edit that acquisition-time
	// choice and combat compilation fails closed.
	if _, err = tx.Exec(`
		WITH repair AS (
			SELECT character.id, prepared.choice_key, prepared.choice_value, candidate.spell_id
			FROM characters_v3 AS character
			CROSS JOIN LATERAL (
				SELECT entry.key AS choice_key, entry.value AS choice_value
				FROM jsonb_each(COALESCE(character.resolved_choices, '{}'::jsonb)) AS entry
				WHERE entry.key LIKE '%:wizard_prepared_spells_level_1'
				  AND jsonb_typeof(entry.value) = 'array'
				  AND jsonb_array_length(entry.value) = 4
				LIMIT 1
			) AS prepared
			CROSS JOIN LATERAL (
				SELECT spell.value #>> '{}' AS spell_id
				FROM jsonb_each(COALESCE(character.resolved_choices, '{}'::jsonb)) AS book
				CROSS JOIN LATERAL jsonb_array_elements(book.value) WITH ORDINALITY AS spell(value, ordinal)
				WHERE book.key LIKE '%wizard_spellbook_level_1'
				  AND jsonb_typeof(book.value) = 'array'
				  AND NOT prepared.choice_value ? (spell.value #>> '{}')
				ORDER BY book.key, spell.ordinal
				LIMIT 1
			) AS candidate
			WHERE candidate.spell_id <> ''
		)
		UPDATE characters_v3 AS character
		SET resolved_choices = jsonb_set(
			character.resolved_choices,
			ARRAY[repair.choice_key],
			repair.choice_value || jsonb_build_array(repair.spell_id),
			false
		), updated_at = NOW()
		FROM repair
		WHERE character.id = repair.id
	`); err != nil {
		return fmt.Errorf("repair existing level-two Wizard preparation: %w", err)
	}
	return tx.Commit()
}
