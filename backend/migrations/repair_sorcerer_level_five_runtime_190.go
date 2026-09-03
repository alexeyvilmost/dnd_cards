package migrations

import (
	"database/sql"
	"fmt"
)

const sorcererLevelFiveRuntimeVersion = "190_repair_sorcerer_level_five_runtime"

// Sorcerous Restoration is a rest-bound class trigger, not an always-visible
// free action. The once-per-long-rest gate is owned by the trigger ledger and
// therefore survives sheet/combat transitions without a client-only flag.
const sorcerousRestorationTriggerMechanics = `{"activation":{"mode":"triggered","trigger":{"event":"short_rest","timing":"during"}},"uses":{"count":1,"per":"long_rest"},"effects":[{"resolution":"auto","result":[{"kind":"resource","op":"restore","id":"sorcery_points","amount":"floor(class_level:sorcerer/2)"}]}]}`

func repairSorcererLevelFiveRuntime(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
	`); err != nil {
		return fmt.Errorf("unlock Sorcerer level-five repairs: %w", err)
	}

	// Fly is granted automatically by Draconic Sorcery. Fly and Slow were the
	// two level-2/3 rows without immutable class ownership; either one can make
	// the strict action compiler reject every spell on an owning sheet.
	result, err := tx.Exec(`UPDATE spells SET
		mechanics=jsonb_set(COALESCE(mechanics,'{}'::jsonb),
			'{spell_class_list_ids}',
			CASE card_number
				WHEN 'fly' THEN '["CLASS-sorcerer","CLASS-warlock","CLASS-wizard"]'::jsonb
				WHEN 'slow' THEN '["CLASS-bard","CLASS-sorcerer","CLASS-wizard"]'::jsonb
			END,true),
		support=jsonb_build_object(
			'status','untested','certification_version',$2::text,
			'mechanics_locked',false,
			'note','Immutable class-list ownership repaired after a production level-5 browser failure; full spell semantics still require certification.'),
		updated_at=NOW()
		WHERE card_number=ANY($1::text[]) AND deleted_at IS NULL`,
		[]string{"fly", "slow"}, sorcererLevelFiveRuntimeVersion)
	if err != nil {
		return fmt.Errorf("repair level-five spell class ownership: %w", err)
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 2 {
		return fmt.Errorf("repair level-five spell class ownership affected %d rows: %w", rows, rowsErr)
	}

	result, err = tx.Exec(`UPDATE effects SET
		mechanics=$2::jsonb,
		description='После Короткого отдыха восстановите половину уровня Чародея (округляя вниз) очков чародейства; один раз до следующего Долгого отдыха.',
		detailed_description='После Короткого отдыха восстановите половину уровня Чародея (округляя вниз) очков чародейства; один раз до следующего Долгого отдыха.',
		support=jsonb_build_object(
			'status','untested','certification_version',$3::text,
			'mechanics_locked',false,
			'note','Short-rest trigger and once-per-long-rest ledger are executable; production browser retest pending.'),
		updated_at=NOW()
		WHERE card_number=$1 AND deleted_at IS NULL`,
		"EFF-sorcerous-restoration", sorcerousRestorationTriggerMechanics,
		sorcererLevelFiveRuntimeVersion)
	if err != nil {
		return fmt.Errorf("repair Sorcerous Restoration trigger: %w", err)
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		return fmt.Errorf("repair Sorcerous Restoration trigger affected %d rows: %w", rows, rowsErr)
	}

	// Retain the old card for references and audit history, but it is no longer
	// granted by the class effect and must never look independently certified.
	if _, err = tx.Exec(`UPDATE actions SET support=jsonb_build_object(
		'status','untested','certification_version',$2::text,
		'mechanics_locked',false,
		'note','Superseded action: Sorcerous Restoration is now owned by the short-rest trigger effect.'),
		updated_at=NOW() WHERE card_number=$1 AND deleted_at IS NULL`,
		"ACT-sorcerous-restoration", sorcererLevelFiveRuntimeVersion); err != nil {
		return fmt.Errorf("mark superseded Sorcerous Restoration action: %w", err)
	}

	var spellOwnershipRows, restorationRows int
	if err = tx.QueryRow(`SELECT count(*) FROM spells
		WHERE deleted_at IS NULL AND (
			(card_number='fly' AND mechanics->'spell_class_list_ids'=
				'["CLASS-sorcerer","CLASS-warlock","CLASS-wizard"]'::jsonb)
			OR (card_number='slow' AND mechanics->'spell_class_list_ids'=
				'["CLASS-bard","CLASS-sorcerer","CLASS-wizard"]'::jsonb)
		)`).Scan(&spellOwnershipRows); err != nil {
		return fmt.Errorf("verify level-five spell class ownership: %w", err)
	}
	if err = tx.QueryRow(`SELECT count(*) FROM effects
		WHERE card_number='EFF-sorcerous-restoration' AND deleted_at IS NULL
		AND mechanics#>>'{activation,mode}'='triggered'
		AND mechanics#>>'{activation,trigger,event}'='short_rest'
		AND mechanics#>>'{uses,per}'='long_rest'
		AND mechanics::text NOT LIKE '%grant_action%'`).Scan(&restorationRows); err != nil {
		return fmt.Errorf("verify Sorcerous Restoration trigger: %w", err)
	}
	if spellOwnershipRows != 2 || restorationRows != 1 {
		return fmt.Errorf("bad Sorcerer level-five postimage spell_ownership=%d restoration=%d",
			spellOwnershipRows, restorationRows)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
