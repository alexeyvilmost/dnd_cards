package migrations

import (
	"database/sql"
	"fmt"
)

const generalFeatChoiceIntegrityRepairVersion = "178_repair_general_feat_choice_integrity"

const resilientCoupledMechanics = `{
  "activation":{"mode":"passive"},
  "effects":[{
    "id":"general_feat_ability_increase",
    "kind":"choice",
    "count":1,
    "context":"level_up",
    "resolution":"on_acquire",
    "prompt":"Устойчивый: выберите характеристику (+1 и владение спасброском)",
    "options":{"source":"explicit","items":[
      {"id":"str","name":"Сила","grants":[{"kind":"grant_ability_score","ability":"str","amount":1,"cap":20},{"kind":"grant_proficiency","prof":"saving_throw","value":"str"}]},
      {"id":"dex","name":"Ловкость","grants":[{"kind":"grant_ability_score","ability":"dex","amount":1,"cap":20},{"kind":"grant_proficiency","prof":"saving_throw","value":"dex"}]},
      {"id":"con","name":"Телосложение","grants":[{"kind":"grant_ability_score","ability":"con","amount":1,"cap":20},{"kind":"grant_proficiency","prof":"saving_throw","value":"con"}]},
      {"id":"int","name":"Интеллект","grants":[{"kind":"grant_ability_score","ability":"int","amount":1,"cap":20},{"kind":"grant_proficiency","prof":"saving_throw","value":"int"}]},
      {"id":"wis","name":"Мудрость","grants":[{"kind":"grant_ability_score","ability":"wis","amount":1,"cap":20},{"kind":"grant_proficiency","prof":"saving_throw","value":"wis"}]},
      {"id":"cha","name":"Харизма","grants":[{"kind":"grant_ability_score","ability":"cha","amount":1,"cap":20},{"kind":"grant_proficiency","prof":"saving_throw","value":"cha"}]}
    ]}
  }]
}`

// repairGeneralFeatChoiceIntegrity keeps choices data-owned while enforcing
// two PHB invariants: Resilient's ability and saving throw are one atomic
// choice, and repeat acquisitions of Elemental Adept cannot reuse a damage
// type already selected by another feat instance.
func repairGeneralFeatChoiceIntegrity(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	result, err := tx.Exec(`UPDATE effects SET mechanics=$1::jsonb,
		support=jsonb_build_object(
			'status','untested','certification_version',$2::text,
			'mechanics_locked',false,
			'note','Resilient ability and saving-throw proficiency are one atomic choice; browser verification pending'),
		updated_at=NOW()
		WHERE card_number='EFF-general-FEAT-0050' AND deleted_at IS NULL`,
		resilientCoupledMechanics, generalFeatChoiceIntegrityRepairVersion)
	if err != nil {
		return fmt.Errorf("couple Resilient choice: %w", err)
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		if rowsErr != nil {
			return fmt.Errorf("count Resilient rows: %w", rowsErr)
		}
		return fmt.Errorf("Resilient rows=%d, want 1", rows)
	}

	result, err = tx.Exec(`UPDATE effects SET
		mechanics=jsonb_set(mechanics,'{effects,1,unique_across_instances}','true'::jsonb,true),
		support=jsonb_build_object(
			'status','untested','certification_version',$1::text,
			'mechanics_locked',false,
			'note','Repeat acquisitions must choose distinct damage types; browser verification pending'),
		updated_at=NOW()
		WHERE card_number='EFF-general-FEAT-0043' AND deleted_at IS NULL
		AND mechanics#>>'{effects,1,id}'='elemental_adept_damage_type'`,
		generalFeatChoiceIntegrityRepairVersion)
	if err != nil {
		return fmt.Errorf("make Elemental Adept type choice unique: %w", err)
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		if rowsErr != nil {
			return fmt.Errorf("count Elemental Adept rows: %w", rowsErr)
		}
		return fmt.Errorf("Elemental Adept rows=%d, want 1", rows)
	}

	result, err = tx.Exec(`UPDATE effects SET
		mechanics=jsonb_set(mechanics,'{effects,1,result,0,applies_to}',
			'{"roll":"saving_throw","filter":{"kind":"death"}}'::jsonb,true),
		support=jsonb_build_object(
			'status','untested','certification_version',$1::text,
			'mechanics_locked',false,
			'note','Death-save advantage uses the canonical saving-throw filter; browser verification pending'),
		updated_at=NOW()
		WHERE card_number='EFF-general-FEAT-0044' AND deleted_at IS NULL
		AND mechanics#>>'{effects,1,result,0,kind}'='modifier'`,
		generalFeatChoiceIntegrityRepairVersion)
	if err != nil {
		return fmt.Errorf("repair Durable death-save advantage: %w", err)
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		if rowsErr != nil {
			return fmt.Errorf("count Durable rows: %w", rowsErr)
		}
		return fmt.Errorf("Durable rows=%d, want 1", rows)
	}

	if _, err = tx.Exec(`UPDATE feats SET support=jsonb_build_object(
		'status','untested','certification_version',$1::text,'mechanics_locked',false,
		'note','General-feat choice integrity repaired; browser verification pending'),updated_at=NOW()
		WHERE card_number IN ('FEAT-0043','FEAT-0044','FEAT-0050') AND deleted_at IS NULL`,
		generalFeatChoiceIntegrityRepairVersion); err != nil {
		return fmt.Errorf("mark repaired General feats untested: %w", err)
	}

	return tx.Commit()
}
