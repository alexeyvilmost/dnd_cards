package migrations

import (
	"database/sql"
	"fmt"
)

const helpActionAdvantageMigrationVersion = "161_repair_help_action_advantage"

const helpActionAdvantageMechanics = `{
	"activation":{"mode":"active","cost":[{"resource":"action"}]},
	"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":5,"requires_line_of_sight":true,"allowed_relations":["ally"]},
	"effects":[{"resolution":"auto","who":"target","result":[{
		"kind":"choice","id":"help_mode","context":"in_play","count":1,"prompt":"Как вы помогаете цели?",
		"options":{"source":"explicit","items":[
			{"id":"assist_check","name":"Помочь с проверкой характеристики","grants":[{"kind":"modifier","op":"advantage","applies_to":{"roll":"ability_check"},"consume":"next","duration":{"type":"until_start_of_next_turn"}}]},
			{"id":"assist_attack","name":"Помочь с броском атаки","grants":[{"kind":"modifier","op":"advantage","applies_to":{"roll":"attack"},"consume":"next","duration":{"type":"until_start_of_next_turn"}}]},
			{"id":"wake_sleeping_target","name":"Разбудить цель","grants":[{"kind":"condition","op":"remove","value":"incapacitated","required_cause_tags":["magical","sleep"],"required_end_trigger":"wake_action_within_5_ft"},{"kind":"condition","op":"remove","value":"unconscious","required_cause_tags":["magical","sleep"],"required_end_trigger":"wake_action_within_5_ft"}]},
			{"id":"stabilize","name":"Стабилизировать","grants":[{"kind":"narrative","description":"Совершите проверку Мудрости (Медицина) УС 10, чтобы стабилизировать умирающую цель."}]}
		]}
	}]}]
}`

// repairHelpActionAdvantage replaces a malformed die-boon payload with the
// exact one-roll Advantage granted by the 2024 Help action. Attack and ability
// check are separate choices so the single-use effect expires on the selected
// roll category only.
func repairHelpActionAdvantage(db *sql.DB) error {
	if _, err := db.Exec(`
		UPDATE actions
		SET mechanics = $1::jsonb,
			support = jsonb_build_object(
				'status','untested',
				'certification_version',$2::text,
				'mechanics_locked',false,
				'note','Corrected Help Advantage contract; browser verification pending'
			),
			updated_at = NOW()
		WHERE card_number = 'action_help'
		  AND deleted_at IS NULL
	`, helpActionAdvantageMechanics, helpActionAdvantageMigrationVersion); err != nil {
		return fmt.Errorf("repair Help action Advantage contract: %w", err)
	}
	return nil
}
