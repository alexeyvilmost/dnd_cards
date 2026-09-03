package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const levelFiveSpellInteractionRepairVersion = "192_repair_level_five_spell_interactions"

type levelFiveNarrativeSpellRepair struct {
	cardNumber  string
	description string
}

type levelFiveLongCastRepair struct {
	cardNumber string
	unit       string
	amount     int
}

// These spells create a later attack, sensor, trap, or moving secondary
// entity. The current runtime cannot persist that secondary entity yet. Their
// imported target-scoped packets therefore could not be selected from their
// legal self/world cast target and, worse, some packets resolved immediately
// against the caster. Keep the truthful cast/placement narrative while
// removing the false immediate attack, save, and damage.
func levelFiveNarrativeSpellRepairs() []levelFiveNarrativeSpellRepair {
	return []levelFiveNarrativeSpellRepair{
		{
			cardNumber:  "SPELL-0184",
			description: "Вы создаёте в свободной руке Горящий клинок. Отдельное действие атаки клинком и его время существования пока не сохраняются автоматикой; разрешите последующие рукопашные атаки заклинанием вручную. Само сотворение не совершает атаку и не наносит урон.",
		},
		{
			cardNumber:  "SPELL-0239",
			description: "Вы начинаете обнаруживать поверхностные мысли существ поблизости. Выбор существа, углубление в его мысли и последующий спасбросок Мудрости пока разрешаются вручную. Само сотворение на себя не требует цели и не вызывает спасбросок.",
		},
		{
			cardNumber:  "lightning_arrow",
			description: "Заклинание применяется сразу после попадания дальнобойной атакой оружием. Привязка к вызвавшему попаданию, замена урона атаки и выбор существ во всплеске 10 футов пока разрешаются вручную. Отдельное применение карточки не наносит урон заклинателю.",
		},
		{
			cardNumber:  "SPELL-0200",
			description: "Вы размещаете боеприпасы Завесы стрел в точке касания. Их постоянное положение, обнаружение входа или окончания хода существа в пределах 30 футов и последующий спасбросок пока разрешаются вручную. Сотворение не наносит немедленный урон.",
		},
		{
			cardNumber:  "conjure_animals",
			description: "Вы размещаете стаю призрачных животных в выбранной точке. Перемещение стаи, её зона 10 футов, ограничение один раз за ход и спасброски существ при взаимодействии с зоной пока разрешаются вручную. Сотворение не наносит немедленный урон.",
		},
		{
			cardNumber:  "glyph_of_warding",
			description: "После 1 часа сотворения вы размещаете руну с выбранным условием срабатывания. Хранение руны, последующее обнаружение нарушителя, выбор варианта руны и взрывная Сфера 20 футов пока разрешаются вручную. Сотворение не вызывает немедленный спасбросок и не наносит урон.",
		},
	}
}

// activation.cast_time is consumed by both sheet preflight and the combat
// hotbar. Non-atomic durations are available outside an encounter but are
// disabled/rejected in encounter mode before action economy or slots change.
func levelFiveLongCastRepairs() []levelFiveLongCastRepair {
	return []levelFiveLongCastRepair{
		{cardNumber: "SPELL-0175", unit: "minute", amount: 1},
		{cardNumber: "SPELL-0180", unit: "minute", amount: 1},
		{cardNumber: "SPELL-0227", unit: "minute", amount: 10},
		{cardNumber: "animate_dead", unit: "minute", amount: 1},
		{cardNumber: "clairvoyance", unit: "minute", amount: 10},
		{cardNumber: "glyph_of_warding", unit: "hour", amount: 1},
		{cardNumber: "leomunds_tiny_hut", unit: "minute", amount: 1},
		{cardNumber: "magic_circle", unit: "minute", amount: 1},
		{cardNumber: "phantom_steed", unit: "minute", amount: 1},
	}
}

func levelFiveNarrativeEffects(description string) []map[string]any {
	return []map[string]any{{
		"resolution": "auto",
		"result": []map[string]any{{
			"kind":        "narrative",
			"description": description,
		}},
	}}
}

func repairLevelFiveSpellInteractions(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells`); err != nil {
		return fmt.Errorf("unlock level-five spell interaction repairs: %w", err)
	}

	for _, repair := range levelFiveNarrativeSpellRepairs() {
		effects, marshalErr := json.Marshal(levelFiveNarrativeEffects(repair.description))
		if marshalErr != nil {
			return fmt.Errorf("encode narrative spell repair %s: %w", repair.cardNumber, marshalErr)
		}
		result, execErr := tx.Exec(`UPDATE spells SET
			mechanics=jsonb_set(COALESCE(mechanics,'{}'::jsonb),'{effects}',$2::jsonb,true),
			updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL`, repair.cardNumber, string(effects))
		if execErr != nil {
			return fmt.Errorf("repair secondary spell interaction %s: %w", repair.cardNumber, execErr)
		}
		if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
			return fmt.Errorf("repair secondary spell interaction %s affected %d rows: %w", repair.cardNumber, rows, rowsErr)
		}
	}

	for _, repair := range levelFiveLongCastRepairs() {
		castTime, marshalErr := json.Marshal(map[string]any{
			"unit": repair.unit, "amount": repair.amount,
		})
		if marshalErr != nil {
			return fmt.Errorf("encode casting time %s: %w", repair.cardNumber, marshalErr)
		}
		result, execErr := tx.Exec(`UPDATE spells SET
			mechanics=jsonb_set(COALESCE(mechanics,'{}'::jsonb),'{activation,cast_time}',$2::jsonb,true),
			updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL`, repair.cardNumber, string(castTime))
		if execErr != nil {
			return fmt.Errorf("repair casting time %s: %w", repair.cardNumber, execErr)
		}
		if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
			return fmt.Errorf("repair casting time %s affected %d rows: %w", repair.cardNumber, rows, rowsErr)
		}
	}

	cards := make([]string, 0, len(levelFiveNarrativeSpellRepairs())+len(levelFiveLongCastRepairs()))
	seen := map[string]bool{}
	for _, repair := range levelFiveNarrativeSpellRepairs() {
		cards = append(cards, repair.cardNumber)
		seen[repair.cardNumber] = true
	}
	for _, repair := range levelFiveLongCastRepairs() {
		if !seen[repair.cardNumber] {
			cards = append(cards, repair.cardNumber)
			seen[repair.cardNumber] = true
		}
	}
	result, err := tx.Exec(`UPDATE spells SET
		support=jsonb_build_object(
			'status','untested','certification_version',$2::text,
			'mechanics_locked',false,
			'note','Target interaction and/or long casting time repaired. Unsupported persisted secondary entities remain explicitly narrative; browser verification pending.'),
		updated_at=NOW()
		WHERE card_number=ANY($1::text[]) AND deleted_at IS NULL`, cards, levelFiveSpellInteractionRepairVersion)
	if err != nil {
		return fmt.Errorf("stamp level-five spell interaction support: %w", err)
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != int64(len(cards)) {
		return fmt.Errorf("stamp level-five spell interaction support affected %d rows: %w", rows, rowsErr)
	}

	var safeNarratives int
	if err = tx.QueryRow(`SELECT count(*) FROM spells
		WHERE card_number=ANY($1::text[]) AND deleted_at IS NULL
		AND mechanics::text NOT LIKE '%\"resolution\": \"save\"%'
		AND mechanics::text NOT LIKE '%\"resolution\": \"attack_roll\"%'
		AND mechanics::text NOT LIKE '%\"kind\": \"damage\"%'
		AND mechanics::text NOT LIKE '%\"who\": \"target\"%'`, func() []string {
		values := make([]string, 0, len(levelFiveNarrativeSpellRepairs()))
		for _, repair := range levelFiveNarrativeSpellRepairs() {
			values = append(values, repair.cardNumber)
		}
		return values
	}()).Scan(&safeNarratives); err != nil {
		return fmt.Errorf("verify safe secondary spell narratives: %w", err)
	}
	if safeNarratives != len(levelFiveNarrativeSpellRepairs()) {
		return fmt.Errorf("safe secondary spell narratives=%d, want %d", safeNarratives, len(levelFiveNarrativeSpellRepairs()))
	}

	for _, repair := range levelFiveLongCastRepairs() {
		var unit string
		var amount int
		if err = tx.QueryRow(`SELECT mechanics#>>'{activation,cast_time,unit}',
			(mechanics#>>'{activation,cast_time,amount}')::int
			FROM spells WHERE card_number=$1 AND deleted_at IS NULL`, repair.cardNumber).Scan(&unit, &amount); err != nil {
			return fmt.Errorf("verify casting time %s: %w", repair.cardNumber, err)
		}
		if unit != repair.unit || amount != repair.amount {
			return fmt.Errorf("casting time %s=%d %s, want %d %s", repair.cardNumber, amount, unit, repair.amount, repair.unit)
		}
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
