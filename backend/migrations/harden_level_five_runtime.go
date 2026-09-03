package migrations

import (
	"database/sql"
	"fmt"
)

const levelFiveRuntimeHardeningMigrationVersion = "169_harden_level_five_runtime"

const levelFiveUntestedSupport = `jsonb_build_object(
	'status', 'untested',
	'certification_version', $1::text,
	'mechanics_locked', false,
	'note', 'Level-5 runtime hardening requires retained-character browser verification'
)`

const stunningStrikeHardenedMechanics = `{
  "activation":{"mode":"triggered","optional":true,"cost":[{"resource":"focus","amount":1}],"trigger":{"event":"hit","timing":"after","source_action_card_numbers":["action_basic_unarmed","action_basic_weapon"],"source_weapon_qualifier":"monk_weapon"}},
  "targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":5,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]},
  "effects":[{"resolution":"save","ability":"con","dc":"8 + prof + wis","on_fail":[{"kind":"grant_effect","value":"COND-stunned","duration":{"type":"rounds","amount":1}}],"on_success":[{"kind":"grant_effect","value":"EFFECT-monk-stunning-strike-slow","duration":{"type":"rounds","amount":1}},{"kind":"grant_effect","value":"EFFECT-monk-stunning-strike-opening","duration":{"type":"rounds","amount":1}}]}],
  "uses":{"count":1,"per":"turn"}
}`

func cunningStrikeHardenedMechanics(effect string, self bool) string {
	targeting := `"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":120,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]},`
	if self {
		targeting = `"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},`
	}
	return fmt.Sprintf(`{
  "activation":{"mode":"triggered","optional":true,"cost":[],"trigger":{"event":"sneak_attack_hit","timing":"after"}},
  %s
  "effects":[%s]
}`, targeting, effect)
}

const uncannyDodgeHardenedMechanics = `{
  "activation":{"mode":"reaction","cost":[{"resource":"reaction","amount":1}],"trigger":{"event":"damage_taken","timing":"before","circumstances":[{"kind":"event_data_equals","key":"delivery","value":"attack"},{"kind":"event_data_equals","key":"source_visible","value":true}]}},
  "targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},
  "effects":[{"resolution":"auto","result":[{"kind":"reduce_damage","amount":"floor(incoming_damage/2)"}]}]
}`

func hardenLevelFiveRuntime(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
	`); err != nil {
		return fmt.Errorf("temporarily unlock level-five runtime repairs: %w", err)
	}

	var actionCount int
	if err := tx.QueryRow(`
		SELECT count(*) FROM actions
		WHERE deleted_at IS NULL AND card_number IN (
		  'action_basic_unarmed', 'ACT-monk-stunning-strike',
		  'ACT-rogue-cunning-strike-poison', 'ACT-rogue-cunning-strike-trip',
		  'ACT-rogue-cunning-strike-withdraw', 'ACT-rogue-uncanny-dodge'
		)
	`).Scan(&actionCount); err != nil {
		return fmt.Errorf("inspect level-five action identities: %w", err)
	}
	if actionCount != 6 {
		return fmt.Errorf("level-five runtime action identity drift: matching_rows=%d, want 6", actionCount)
	}

	if _, err := tx.Exec(`
		UPDATE actions
		SET mechanics = jsonb_set(mechanics, '{primitive}', '{"type":"unarmed_strike"}'::jsonb, true),
		    updated_at = NOW()
		WHERE card_number = 'action_basic_unarmed' AND deleted_at IS NULL
	`); err != nil {
		return fmt.Errorf("bind Unarmed Strike to the canonical Attack-action ledger: %w", err)
	}

	cunningPoison := cunningStrikeHardenedMechanics(`{"resolution":"save","ability":"con","dc":"8 + prof + dex","on_fail":[{"kind":"grant_effect","value":"COND-poisoned","duration":{"type":"minutes","amount":1}}]}`, false)
	cunningTrip := cunningStrikeHardenedMechanics(`{"resolution":"save","ability":"dex","dc":"8 + prof + dex","on_fail":[{"kind":"grant_effect","value":"COND-prone","duration":{"type":"manual"}}]}`, false)
	cunningWithdraw := cunningStrikeHardenedMechanics(`{"resolution":"auto","result":[{"kind":"movement","distance":"floor(speed/2)"},{"kind":"modifier","op":"deny","applies_to":{"interaction":"opportunity_attack","trigger":"self_movement"},"duration":{"type":"until_end_of_turn"}}]}`, true)
	for _, action := range []struct {
		card      string
		mechanics string
	}{
		{"ACT-monk-stunning-strike", stunningStrikeHardenedMechanics},
		{"ACT-rogue-cunning-strike-poison", cunningPoison},
		{"ACT-rogue-cunning-strike-trip", cunningTrip},
		{"ACT-rogue-cunning-strike-withdraw", cunningWithdraw},
		{"ACT-rogue-uncanny-dodge", uncannyDodgeHardenedMechanics},
	} {
		result, updateErr := tx.Exec(`
			UPDATE actions SET mechanics=$1::jsonb, updated_at=NOW()
			WHERE card_number=$2 AND deleted_at IS NULL
		`, action.mechanics, action.card)
		if updateErr != nil {
			return fmt.Errorf("harden %s: %w", action.card, updateErr)
		}
		updated, rowsErr := result.RowsAffected()
		if rowsErr != nil || updated != 1 {
			return fmt.Errorf("harden %s: updated=%d err=%v", action.card, updated, rowsErr)
		}
	}

	// The visible prompt must not contain a stale capacity. The effective
	// count is selected from count_by_level by the owning Wizard class level.
	result, err := tx.Exec(`
		UPDATE effects
		SET mechanics = jsonb_set(
		      jsonb_set(mechanics, '{effects,3,count_by_level}',
		        '{"1":4,"2":5,"3":6,"4":7,"5":9}'::jsonb, true),
		      '{effects,3,prompt}', '"Подготовьте заклинания из книги заклинаний"'::jsonb, true
		    ),
		    updated_at = NOW()
		WHERE card_number='EFF-wizard-spellcasting' AND deleted_at IS NULL
		  AND mechanics#>>'{effects,3,kind}'='prepared_spell_choice'
	`)
	if err != nil {
		return fmt.Errorf("repair Wizard prepared-spell progression: %w", err)
	}
	if updated, rowsErr := result.RowsAffected(); rowsErr != nil || updated != 1 {
		return fmt.Errorf("repair Wizard prepared-spell progression: updated=%d err=%v", updated, rowsErr)
	}

	// Support invalidation triggers intentionally clear the certificate when a
	// mechanics column changes. Write the honest untested metadata only after
	// every mechanics update, in a statement that does not retrigger it.
	if _, err := tx.Exec(fmt.Sprintf(`
		UPDATE actions SET support=%s, updated_at=NOW()
		WHERE card_number IN (
		  'action_basic_unarmed', 'ACT-monk-stunning-strike',
		  'ACT-rogue-cunning-strike-poison', 'ACT-rogue-cunning-strike-trip',
		  'ACT-rogue-cunning-strike-withdraw', 'ACT-rogue-uncanny-dodge'
		) AND deleted_at IS NULL
	`, levelFiveUntestedSupport), levelFiveRuntimeHardeningMigrationVersion); err != nil {
		return fmt.Errorf("mark level-five hardened actions untested: %w", err)
	}
	if _, err := tx.Exec(fmt.Sprintf(`
		UPDATE effects SET support=%s, updated_at=NOW()
		WHERE card_number='EFF-wizard-spellcasting' AND deleted_at IS NULL
	`, levelFiveUntestedSupport), levelFiveRuntimeHardeningMigrationVersion); err != nil {
		return fmt.Errorf("mark Wizard spellcasting untested: %w", err)
	}

	var unarmedReady, stunningReady, cunningReady, uncannyReady, wizardReady int
	if err := tx.QueryRow(`
		SELECT
		  (SELECT count(*) FROM actions WHERE card_number='action_basic_unarmed'
		     AND mechanics#>>'{primitive,type}'='unarmed_strike'
		     AND support->>'status'='untested'),
		  (SELECT count(*) FROM actions WHERE card_number='ACT-monk-stunning-strike'
		     AND mechanics#>>'{activation,mode}'='triggered'
		     AND mechanics#>>'{activation,trigger,event}'='hit'
		     AND mechanics#>>'{uses,per}'='turn'),
		  (SELECT count(*) FROM actions WHERE card_number LIKE 'ACT-rogue-cunning-strike-%%'
		     AND mechanics#>>'{activation,mode}'='triggered'
		     AND mechanics#>>'{activation,trigger,event}'='sneak_attack_hit'),
		  (SELECT count(*) FROM actions WHERE card_number='ACT-rogue-uncanny-dodge'
		     AND mechanics#>>'{activation,trigger,timing}'='before'
		     AND mechanics#>'{activation,trigger,circumstances}' @> '[{"kind":"event_data_equals","key":"delivery","value":"attack"}]'::jsonb),
		  (SELECT count(*) FROM effects WHERE card_number='EFF-wizard-spellcasting'
		     AND mechanics#>>'{effects,3,count_by_level,5}'='9'
		     AND mechanics#>>'{effects,3,prompt}'='Подготовьте заклинания из книги заклинаний')
	`).Scan(&unarmedReady, &stunningReady, &cunningReady, &uncannyReady, &wizardReady); err != nil {
		return fmt.Errorf("verify level-five runtime hardening: %w", err)
	}
	if unarmedReady != 1 || stunningReady != 1 || cunningReady != 3 || uncannyReady != 1 || wizardReady != 1 {
		var unarmedPrimitive, unarmedStatus string
		_ = tx.QueryRow(`
			SELECT COALESCE(mechanics#>>'{primitive,type}', ''), COALESCE(support->>'status', '')
			FROM actions WHERE card_number='action_basic_unarmed' AND deleted_at IS NULL
		`).Scan(&unarmedPrimitive, &unarmedStatus)
		return fmt.Errorf(
			"level-five runtime hardening postconditions failed: unarmed=%d(%q/%q) stunning=%d cunning=%d uncanny=%d wizard=%d",
			unarmedReady, unarmedPrimitive, unarmedStatus, stunningReady, cunningReady, uncannyReady, wizardReady,
		)
	}

	if _, err := tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
