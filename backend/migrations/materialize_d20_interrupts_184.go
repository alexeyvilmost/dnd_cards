package migrations

import (
	"database/sql"
	"fmt"
)

const d20InterruptsMigrationVersion = "184_materialize_d20_interrupts"

const cuttingWordsInterruptMechanics = `{"activation":{"mode":"triggered","optional":true,"cost":[{"resource":"reaction"},{"resource":"bardic_inspiration"}],"trigger":{"events":["attack_roll_made","ability_check_made"],"timing":"after"}},"effects":[{"resolution":"auto","result":[{"kind":"d20_interrupt","operation":"subtract_die","timing":"after_outcome","eligible_rolls":["attack_roll","ability_check"],"eligible_outcomes":["hit","success"],"range_ft":60,"requires_line_of_sight":true,"allowed_relations":["enemy"],"die":{"class":"bard","by_level":{"1":6,"5":8,"10":10,"15":12}}}]}]}`

const wardingFlareInterruptMechanics = `{"activation":{"mode":"triggered","optional":true,"cost":[{"resource":"reaction"},{"resource":"warding_flare"}],"trigger":{"event":"attack_roll_made","timing":"before"}},"effects":[{"resolution":"auto","result":[{"kind":"resource","op":"grant","id":"warding_flare","amount":"max(1,wis)","per":"long_rest"},{"kind":"d20_interrupt","operation":"impose_disadvantage","timing":"before_roll","eligible_rolls":["attack_roll"],"range_ft":30,"requires_line_of_sight":true,"allowed_relations":["enemy"]}]}]}`

func materializeD20Interrupts(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
	`); err != nil {
		return fmt.Errorf("unlock d20 interrupt repairs: %w", err)
	}

	repairs := []struct {
		card, mechanics, description, note string
	}{
		{
			"EFFECT-0012", cuttingWordsInterruptMechanics,
			"Реакцией после успешного броска атаки или проверки видимого врага в пределах 60 футов потратьте Бардовское вдохновение, бросьте его кость и вычтите результат из броска.",
			"Persisted post-outcome d20 continuation is executable for attack rolls and DC ability checks. Damage-roll subtraction and contested checks remain outside this bounded runtime.",
		},
		{
			"EFFECT-0121", wardingFlareInterruptMechanics,
			"Когда видимый враг в пределах 30 футов совершает бросок атаки, Реакцией потратьте использование Защищающей вспышки и наложите Помеху до броска. Использований: модификатор Мудрости (минимум 1), восстановление после Долгого отдыха.",
			"Persisted pre-roll d20 continuation, reaction spend, Wisdom-scaled long-rest pool, range and line of sight are executable; browser verification is still required.",
		},
	}
	for _, repair := range repairs {
		result, execErr := tx.Exec(`UPDATE effects SET
			mechanics=$2::jsonb,description=$3,
			support=jsonb_build_object(
				'status','untested','certification_version',$4::text,
				'mechanics_locked',false,'note',$5::text),
			updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL`,
			repair.card, repair.mechanics, repair.description,
			d20InterruptsMigrationVersion, repair.note)
		if execErr != nil {
			return fmt.Errorf("materialize d20 interrupt %s: %w", repair.card, execErr)
		}
		if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
			return fmt.Errorf("materialize d20 interrupt %s affected %d rows: %w", repair.card, rows, rowsErr)
		}
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
