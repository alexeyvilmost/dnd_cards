package migrations

import (
	"database/sql"
	"fmt"
)

const wizardCantripGrowthRepairVersion = "176_repair_wizard_cantrip_growth"

// repairWizardCantripGrowth keeps the historical choice id so existing
// character selections survive, but classifies the level-zero grant as a
// cantrip.  Treating it as a spellbook grant polluted the Wizard prepared
// source with a level-zero action and made valid level-4/5 sheets impossible
// to compile for combat.
func repairWizardCantripGrowth(db *sql.DB) error {
	result, err := db.Exec(`UPDATE effects SET
		mechanics=jsonb_set(
			jsonb_set(mechanics,'{effects,0,grant,label}',to_jsonb('cantrip'::text),true),
			'{effects,0,prompt}',to_jsonb('Выберите 1 заговор'::text),true
		),
		support=jsonb_build_object(
			'status','untested',
			'certification_version',$1::text,
			'mechanics_locked',false,
			'note','Wizard level-4 cantrip growth repaired; browser verification pending'
		),
		updated_at=NOW()
		WHERE card_number='EFFECT-0258' AND deleted_at IS NULL
		AND mechanics#>>'{effects,0,kind}'='choice'
		AND mechanics#>>'{effects,0,options,filter,levels,0}'='0'`, wizardCantripGrowthRepairVersion)
	if err != nil {
		return fmt.Errorf("repair Wizard cantrip growth: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("count repaired Wizard cantrip growth rows: %w", err)
	}
	if rows != 1 {
		return fmt.Errorf("Wizard cantrip growth rows=%d, want 1", rows)
	}
	return nil
}
