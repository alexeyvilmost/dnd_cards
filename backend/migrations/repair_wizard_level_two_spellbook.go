package migrations

import (
	"database/sql"
	"fmt"
)

const wizardLevelTwoSpellbookMigrationVersion = "156_repair_wizard_level_two_spellbook"

func repairWizardLevelTwoSpellbook(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects`); err != nil {
		return fmt.Errorf("temporarily unlock level-two effect repairs: %w", err)
	}
	if _, err = tx.Exec(`
		UPDATE effects
		SET mechanics = jsonb_set(
			mechanics,
			'{effects,3,count_by_level}',
			'{"1":4,"2":5}'::jsonb,
			true
		), updated_at = NOW()
		WHERE card_number = 'EFF-wizard-spellcasting'
		  AND deleted_at IS NULL
		  AND mechanics#>>'{effects,3,kind}' = 'prepared_spell_choice'
	`); err != nil {
		return fmt.Errorf("repair wizard level-two spellbook preparation: %w", err)
	}
	if _, err = tx.Exec(`
		UPDATE effects
		SET mechanics = jsonb_set(
			mechanics,
			'{effects,0,count_by_level}',
			'{"1":1,"2":3}'::jsonb,
			true
		),
		support = jsonb_build_object(
			'status', 'untested',
			'certification_version', $1::text,
			'mechanics_locked', false,
			'note', 'Level-2 invocation capacity browser verification pending'
		),
		updated_at = NOW()
		WHERE card_number = 'EFF-eldritch-invocations'
		  AND deleted_at IS NULL
		  AND mechanics#>>'{effects,0,kind}' = 'choice'
	`, wizardLevelTwoSpellbookMigrationVersion); err != nil {
		return fmt.Errorf("repair warlock level-two invocation capacity: %w", err)
	}
	// Early MVP characters can retain the retired seed longsword UUID. Replace
	// only that exact historical reference with the canonical active longsword;
	// otherwise combat compilation fails before any level-two action is usable.
	if _, err = tx.Exec(`
		UPDATE characters_v3
		SET inventory_items = (
			SELECT COALESCE(jsonb_agg(
				CASE WHEN entry->>'card_id' = 'cb6650a8-489f-4edb-a4f3-77e32f8c2317'
				THEN jsonb_set(entry, '{card_id}', '"e68a30ff-b0e5-41cf-b007-ddc5eb319750"'::jsonb, false)
				ELSE entry END
			), '[]'::jsonb)
			FROM jsonb_array_elements(COALESCE(inventory_items, '[]'::jsonb)) AS entry
		), updated_at = NOW()
		WHERE COALESCE(inventory_items, '[]'::jsonb) @> '[{"card_id":"cb6650a8-489f-4edb-a4f3-77e32f8c2317"}]'::jsonb
	`); err != nil {
		return fmt.Errorf("repair retired MVP longsword references: %w", err)
	}
	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
