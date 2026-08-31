package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const (
	sleep2024LifecycleMigrationVersion = "123_repair_sleep_2024_lifecycle"
	sleep2024EntityID                  = "0f81f3e2-ff95-4629-9292-e81332a57282"
	sleep2024CardNumber                = "SPELL-0311"
	helpActionEntityID                 = "2863e54d-0d7e-4d2c-8291-0f222a7ce662"
	helpActionCardNumber               = "action_help"
)

func canonicalSleep2024Mechanics() map[string]any {
	return map[string]any{
		"activation": map[string]any{
			"mode": "active",
			"cost": []any{
				map[string]any{"resource": "action"},
				map[string]any{"resource": "spell_slot", "level": 1},
			},
		},
		"effects": []any{map[string]any{
			"resolution": "save",
			"who":        "target",
			"ability":    "wis",
			"dc":         "8+prof+spellcasting",
			"automatic_success": map[string]any{
				"if_sleep_not_required": true,
				"if_condition_immunity": "exhaustion",
			},
			"on_fail": []any{map[string]any{
				"kind":      "condition",
				"value":     "incapacitated",
				"op":        "apply",
				"duration":  map[string]any{"type": "rounds", "amount": 10, "concentration": true},
				"causeTags": []string{"spell", "magical", "sleep"},
				"end_triggers": []string{
					"actor_takes_damage",
					"wake_action_within_5_ft",
				},
				"save_ends": map[string]any{
					"timing":               "end_of_turn",
					"ability":              "wis",
					"dc":                   "8+prof+spellcasting",
					"on_failure_condition": "unconscious",
				},
			}},
			"on_success": []any{},
		}},
		"spell_class_list_ids": []string{"CLASS-bard", "CLASS-sorcerer", "CLASS-wizard"},
		"targeting": map[string]any{
			"shape":  "area",
			"range":  "60 футов",
			"filter": "creature",
			"area":   map[string]any{"kind": "sphere", "size": 5},
		},
	}
}

func canonicalHelp2024Mechanics() map[string]any {
	return map[string]any{
		"activation": map[string]any{
			"mode": "active",
			"cost": []any{map[string]any{"resource": "action"}},
		},
		"effects": []any{map[string]any{
			"resolution": "auto",
			"who":        "target",
			"result": []any{map[string]any{
				"kind":    "choice",
				"id":      "help_mode",
				"context": "in_play",
				"prompt":  "Как вы помогаете цели?",
				"count":   1,
				"options": map[string]any{
					"source": "explicit",
					"items": []any{
						map[string]any{
							"id":   "assist",
							"name": "Помочь с проверкой или атакой",
							"grants": []any{map[string]any{
								"kind":        "boon",
								"id":          "help",
								"grants":      "advantage",
								"applies_to":  []string{"ability_check", "attack_roll"},
								"count":       1,
								"expires":     "start_of_your_next_turn",
								"description": "Цель получает преимущество на следующий подходящий бросок к20.",
							}},
						},
						map[string]any{
							"id":   "wake_sleeping_target",
							"name": "Разбудить цель",
							"grants": []any{
								map[string]any{
									"kind": "condition", "value": "incapacitated", "op": "remove",
									"required_cause_tags":  []string{"magical", "sleep"},
									"required_end_trigger": "wake_action_within_5_ft",
								},
								map[string]any{
									"kind": "condition", "value": "unconscious", "op": "remove",
									"required_cause_tags":  []string{"magical", "sleep"},
									"required_end_trigger": "wake_action_within_5_ft",
								},
							},
						},
						map[string]any{
							"id":   "stabilize",
							"name": "Стабилизировать",
							"grants": []any{map[string]any{
								"kind":        "narrative",
								"description": "Совершите проверку Мудрости (Медицина) УС 10, чтобы стабилизировать умирающую цель.",
							}},
						},
					},
				},
			}},
		}},
		"targeting": map[string]any{
			"domain":                 "actor",
			"actor_targets":          true,
			"shape":                  "single",
			"min_targets":            1,
			"max_targets":            1,
			"range_ft":               5,
			"requires_line_of_sight": true,
			"allowed_relations":      []string{"ally"},
		},
	}
}

// repairSleep2024Lifecycle replaces the premature one-round Unconscious chip
// with the PHB 2024 two-stage save, exact exits and explicit Help wake choice.
// Both reviewed live identities and their known legacy preimages are required.
func repairSleep2024Lifecycle(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	sleepMechanics, err := json.Marshal(canonicalSleep2024Mechanics())
	if err != nil {
		return fmt.Errorf("encode Sleep mechanics: %w", err)
	}
	helpMechanics, err := json.Marshal(canonicalHelp2024Mechanics())
	if err != nil {
		return fmt.Errorf("encode Help mechanics: %w", err)
	}

	for _, identity := range []struct {
		table, id, card string
	}{
		{"spells", sleep2024EntityID, sleep2024CardNumber},
		{"actions", helpActionEntityID, helpActionCardNumber},
	} {
		var matching, exact int
		query := fmt.Sprintf(`
			SELECT count(*), count(*) FILTER (WHERE id = $1::uuid AND card_number = $2)
			FROM %s WHERE deleted_at IS NULL AND (id = $1::uuid OR card_number = $2)
		`, identity.table)
		if err := tx.QueryRow(query, identity.id, identity.card).Scan(&matching, &exact); err != nil {
			return fmt.Errorf("inspect %s identity: %w", identity.card, err)
		}
		if matching != 1 || exact != 1 {
			return fmt.Errorf("%s stable identity drifted: matching_rows=%d exact_rows=%d", identity.card, matching, exact)
		}
	}

	var sleepLegacy, sleepCanonical bool
	if err := tx.QueryRow(`
		SELECT mechanics #>> '{effects,0,on_fail,0,value}' = 'unconscious'
		         AND mechanics #>> '{effects,0,on_fail,0,duration,type}' = 'rounds'
		         AND mechanics #>> '{effects,0,on_fail,0,duration,amount}' = '1'
		         AND mechanics #> '{effects,0,on_fail,0,save_ends}' IS NULL,
		       mechanics = $3::jsonb
		FROM spells
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		FOR UPDATE
	`, sleep2024EntityID, sleep2024CardNumber, sleepMechanics).Scan(&sleepLegacy, &sleepCanonical); err != nil {
		return fmt.Errorf("read Sleep preimage: %w", err)
	}

	var helpLegacy, helpCanonical bool
	if err := tx.QueryRow(`
		SELECT mechanics #>> '{effects,0,result,0,kind}' = 'boon'
		         AND mechanics #>> '{effects,0,who}' IS NULL,
		       mechanics = $3::jsonb
		FROM actions
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		FOR UPDATE
	`, helpActionEntityID, helpActionCardNumber, helpMechanics).Scan(&helpLegacy, &helpCanonical); err != nil {
		return fmt.Errorf("read Help preimage: %w", err)
	}
	if sleepCanonical && helpCanonical {
		return tx.Commit()
	}
	if (!sleepLegacy && !sleepCanonical) || (!helpLegacy && !helpCanonical) {
		return fmt.Errorf("Sleep/Help lifecycle preimage drifted; refusing repair")
	}

	for _, table := range []string{"spells", "actions"} {
		if _, err := tx.Exec(fmt.Sprintf(`DROP TRIGGER IF EXISTS protect_%s_certified_mechanics ON %s`, table, table)); err != nil {
			return fmt.Errorf("disable %s certification guard: %w", table, err)
		}
	}
	if sleepLegacy {
		result, err := tx.Exec(`
			UPDATE spells
			SET mechanics = $3::jsonb,
			    support = jsonb_build_object(
			      'status', 'untested',
			      'certification_version', $4::text,
			      'mechanics_locked', false,
			      'limitations', jsonb_build_array('Требуется повторная браузерная проверка двух стадий Усыпления.'),
			      'note', 'Добавлены второй спасбросок, автоуспехи, концентрация и точные способы пробуждения.'
			    ),
			    updated_at = NOW()
			WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		`, sleep2024EntityID, sleep2024CardNumber, sleepMechanics, sleep2024LifecycleMigrationVersion)
		if err != nil {
			return fmt.Errorf("repair Sleep lifecycle: %w", err)
		}
		if affected, err := result.RowsAffected(); err != nil || affected != 1 {
			return fmt.Errorf("repair Sleep lifecycle affected %d rows: %w", affected, err)
		}
	}
	if helpLegacy {
		result, err := tx.Exec(`
			UPDATE actions
			SET mechanics = $3::jsonb,
			    support = jsonb_build_object(
			      'status', 'untested',
			      'certification_version', $4::text,
			      'mechanics_locked', false,
			      'limitations', jsonb_build_array('Требуется повторная браузерная проверка всех вариантов Помощи.'),
			      'note', 'Добавлен явный выбор разбудить цель в пределах 5 футов.'
			    ),
			    updated_at = NOW()
			WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		`, helpActionEntityID, helpActionCardNumber, helpMechanics, sleep2024LifecycleMigrationVersion)
		if err != nil {
			return fmt.Errorf("repair Help wake choice: %w", err)
		}
		if affected, err := result.RowsAffected(); err != nil || affected != 1 {
			return fmt.Errorf("repair Help wake choice affected %d rows: %w", affected, err)
		}
	}

	for _, table := range []string{"spells", "actions"} {
		if _, err := tx.Exec(fmt.Sprintf(`
			CREATE TRIGGER protect_%s_certified_mechanics
			BEFORE UPDATE OR DELETE ON %s
			FOR EACH ROW EXECUTE FUNCTION protect_certified_content_mechanics()
		`, table, table)); err != nil {
			return fmt.Errorf("restore %s certification guard: %w", table, err)
		}
	}

	var compatible int
	if err := tx.QueryRow(`
		SELECT
		  (SELECT count(*) FROM spells
		   WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL AND mechanics = $3::jsonb)
		+ (SELECT count(*) FROM actions
		   WHERE id = $4::uuid AND card_number = $5 AND deleted_at IS NULL AND mechanics = $6::jsonb)
	`, sleep2024EntityID, sleep2024CardNumber, sleepMechanics,
		helpActionEntityID, helpActionCardNumber, helpMechanics).Scan(&compatible); err != nil {
		return fmt.Errorf("verify Sleep/Help postcondition: %w", err)
	}
	if compatible != 2 {
		return fmt.Errorf("Sleep/Help postcondition failed: compatible_rows=%d", compatible)
	}
	return tx.Commit()
}
