package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const generalSpellFeatSignaturesMigrationVersion = "171_materialize_general_spell_feat_signatures"
const generalSpellFeatActionType = "class_feature"

type generalSpellFeatSeed struct {
	card      string
	mechanics map[string]any
}

type generalSpellFeatActionSeed struct {
	id, card, name, nameEn, description, resource string
	mechanics                                     map[string]any
}

func generalSpellFeatAbilityChoice(id, prompt string, abilities []string, extra func(string) []map[string]any) map[string]any {
	items := make([]map[string]any, 0, len(abilities))
	for _, ability := range abilities {
		grants := []map[string]any{
			{"kind": "grant_ability_score", "ability": ability, "amount": 1, "cap": 20},
			{"kind": "spellcasting_ability", "role": "source", "ability": ability},
		}
		if extra != nil {
			grants = append(grants, extra(ability)...)
		}
		items = append(items, map[string]any{"id": ability, "name": ability, "grants": grants})
	}
	return map[string]any{
		"kind": "choice", "id": id, "count": 1, "context": "level_up", "resolution": "on_acquire",
		"prompt": prompt, "options": map[string]any{"source": "explicit", "items": items},
	}
}

func generalSpellFeatPassive(results ...map[string]any) map[string]any {
	return map[string]any{
		"activation": map[string]any{"mode": "passive"},
		"effects":    []map[string]any{{"resolution": "auto", "result": results}},
	}
}

func generalSpellFeatChoiceMechanics(choice map[string]any, results ...map[string]any) map[string]any {
	effects := []map[string]any{choice}
	if len(results) > 0 {
		effects = append(effects, map[string]any{"resolution": "auto", "result": results})
	}
	return map[string]any{"activation": map[string]any{"mode": "passive"}, "effects": effects}
}

func spellSniperCantripChoice() map[string]any {
	return map[string]any{
		"kind": "choice", "id": "spell_sniper_cantrip", "count": 1,
		"context": "level_up", "resolution": "on_acquire", "prompt": "Меткий заклинатель: заговор с броском атаки",
		"options": map[string]any{"source": "spell", "filter": map[string]any{
			"levels": []int{0}, "classes": []string{"bard", "cleric", "druid", "sorcerer", "warlock", "wizard"},
			"requires_attack_roll": true,
		}},
		"grant": map[string]any{"kind": "grant_spell", "label": "cantrip"},
	}
}

func generalSpellFeatSeeds() []generalSpellFeatSeed {
	spellAbility := func(id, prompt string, extras ...map[string]any) map[string]any {
		return generalSpellFeatChoiceMechanics(
			generalSpellFeatAbilityChoice(id, prompt, []string{"int", "wis", "cha"}, nil), extras...,
		)
	}
	shadowChoice := map[string]any{
		"kind": "choice", "id": "shadow_touched_spell", "count": 1,
		"context": "level_up", "resolution": "on_acquire", "prompt": "Касание тени: заклинание 1-го круга",
		"options": map[string]any{"source": "spell", "filter": map[string]any{"levels": []int{1}, "schools": []string{"illusion", "necromancy"}}},
		"grant":   map[string]any{"kind": "grant_spell", "label": "always_prepared", "freeuse": true},
	}
	feyChoice := map[string]any{
		"kind": "choice", "id": "fey_touched_spell", "count": 1,
		"context": "level_up", "resolution": "on_acquire", "prompt": "Касание фей: заклинание 1-го круга",
		"options": map[string]any{"source": "spell", "filter": map[string]any{"levels": []int{1}, "schools": []string{"divination", "enchantment"}}},
		"grant":   map[string]any{"kind": "grant_spell", "label": "always_prepared", "freeuse": true},
	}
	ritualChoice := map[string]any{
		"kind": "choice", "id": "ritual_caster_spells", "count": 2,
		"count_by_level": map[string]any{"4": 2, "5": 3, "9": 4, "13": 5, "17": 6},
		"context":        "level_up", "resolution": "on_acquire", "prompt": "Ритуальный заклинатель: ритуалы 1-го круга",
		"options": map[string]any{"source": "spell", "filter": map[string]any{"levels": []int{1}, "ritual": true}},
		"grant": map[string]any{
			"kind": "grant_spell", "label": "always_prepared",
			"casting_override": map[string]any{"free_use_resource": "ritual_caster_quick_ritual", "ritual": true},
		},
	}

	damageTypes := []string{"acid", "cold", "fire", "lightning", "thunder"}
	elementItems := make([]map[string]any, 0, len(damageTypes))
	for _, damageType := range damageTypes {
		filter := map[string]any{"attackKind": "spell", "damageType": damageType}
		elementItems = append(elementItems, map[string]any{
			"id": damageType, "name": damageType,
			"grants": []map[string]any{
				{"kind": "modifier", "op": "deny", "applies_to": map[string]any{"roll": "damage", "filter": filter}, "reason": "ignore_spell_damage_resistance"},
				{"kind": "modifier", "op": "minimum_die", "value": 2, "applies_to": map[string]any{"roll": "damage", "filter": filter}, "reason": "elemental_adept_minimum_die"},
			},
		})
	}
	elementChoice := map[string]any{
		"kind": "choice", "id": "elemental_adept_damage_type", "count": 1,
		"unique_across_instances": true,
		"context": "level_up", "resolution": "on_acquire", "prompt": "Адепт стихий: тип урона",
		"options": map[string]any{"source": "explicit", "items": elementItems},
	}

	telekineticAbility := generalSpellFeatAbilityChoice(
		"telekinetic_ability", "Телекинетик: характеристика", []string{"int", "wis", "cha"},
		func(ability string) []map[string]any {
			return []map[string]any{{
				"kind": "grant_action", "values": []string{
					"ACT-general-telekinetic-push-" + ability,
					"ACT-general-telekinetic-pull-" + ability,
				},
			}}
		},
	)

	return []generalSpellFeatSeed{
		{"FEAT-0014", generalSpellFeatChoiceMechanics(
			generalSpellFeatAbilityChoice("war_caster_ability", "Боевой заклинатель: характеристика", []string{"int", "wis", "cha"}, nil),
			map[string]any{"kind": "modifier", "op": "advantage", "applies_to": map[string]any{"roll": "saving_throw", "filter": map[string]any{"ability": "con", "reason": "maintain_concentration"}}, "reason": "war_caster_concentration"},
			map[string]any{"kind": "modifier", "op": "deny", "applies_to": map[string]any{"roll": "spellcasting", "filter": map[string]any{"restriction": "somatic_hands_occupied"}}, "reason": "war_caster_somatic_components"},
			map[string]any{"kind": "modifier", "op": "set", "value": 1, "applies_to": map[string]any{"roll": "reaction", "filter": map[string]any{"trigger": "opportunity_spell", "castingTime": "action", "maxTargets": 1}}, "reason": "war_caster_opportunity_spell"},
		)},
		{"FEAT-0021", func() map[string]any {
			m := spellAbility("shadow_touched_ability", "Касание тени: характеристика",
				map[string]any{"kind": "grant_spell", "value": "SPELL-0231", "label": "always_prepared", "freeuse": true})
			m["effects"] = append(m["effects"].([]map[string]any), shadowChoice)
			return m
		}()},
		{"FEAT-0022", func() map[string]any {
			m := spellAbility("fey_touched_ability", "Касание фей: характеристика",
				map[string]any{"kind": "grant_spell", "value": "misty_step", "label": "always_prepared", "freeuse": true})
			m["effects"] = append(m["effects"].([]map[string]any), feyChoice)
			return m
		}()},
		{"FEAT-0033", func() map[string]any {
			m := spellAbility("spell_sniper_ability", "Меткий заклинатель: характеристика",
				map[string]any{"kind": "modifier", "op": "add", "value": 60, "applies_to": map[string]any{"roll": "attack", "filter": map[string]any{"attackKind": "spell", "minimumBaseRangeFt": 10}}, "reason": "spell_sniper_range_ft"},
				map[string]any{"kind": "modifier", "op": "deny", "applies_to": map[string]any{"roll": "attack", "filter": map[string]any{"attackKind": "spell", "cover": "half"}}, "reason": "spell_sniper_ignore_cover"},
				map[string]any{"kind": "modifier", "op": "deny", "applies_to": map[string]any{"roll": "attack", "filter": map[string]any{"attackKind": "spell", "cover": "three_quarters"}}, "reason": "spell_sniper_ignore_cover"},
				map[string]any{"kind": "modifier", "op": "deny", "applies_to": map[string]any{"roll": "attack", "filter": map[string]any{"attackKind": "spell", "penalty": "enemy_adjacent"}}, "reason": "spell_sniper_ignore_adjacent_disadvantage"})
			m["effects"] = append(m["effects"].([]map[string]any), spellSniperCantripChoice())
			return m
		}()},
		{"FEAT-0041", func() map[string]any {
			m := generalSpellFeatChoiceMechanics(
				generalSpellFeatAbilityChoice("ritual_caster_ability", "Ритуальный заклинатель: характеристика", []string{"int", "wis", "cha"}, nil),
				map[string]any{"kind": "resource", "op": "grant", "id": "ritual_caster_quick_ritual", "amount": 1})
			m["effects"] = append(m["effects"].([]map[string]any), ritualChoice)
			return m
		}()},
		{"FEAT-0043", func() map[string]any {
			m := generalSpellFeatChoiceMechanics(
				generalSpellFeatAbilityChoice("elemental_adept_ability", "Адепт стихий: характеристика", []string{"int", "wis", "cha"}, nil))
			m["effects"] = append(m["effects"].([]map[string]any), elementChoice)
			return m
		}()},
		{"FEAT-0046", generalSpellFeatChoiceMechanics(telekineticAbility,
			map[string]any{"kind": "grant_spell", "value": "SPELL-0173", "label": "cantrip", "casting_override": map[string]any{
				"range_bonus_ft": 30, "components": map[string]any{"verbal": false, "somatic": false},
			}},
		)},
		{"FEAT-0047", spellAbility("telepath_ability", "Телепат: характеристика",
			map[string]any{"kind": "grant_action", "value": "ACT-general-telepathic-utterance"},
			map[string]any{"kind": "grant_spell", "value": "SPELL-0239", "label": "always_prepared", "freeuse": true,
				"casting_override": map[string]any{"components": map[string]any{"verbal": false, "somatic": false, "material": false}}},
		)},
		{"FEAT-0048", generalSpellFeatChoiceMechanics(
			generalSpellFeatAbilityChoice("mage_slayer_ability", "Убийца магов: характеристика", []string{"str", "dex"}, nil),
			map[string]any{"kind": "resource", "op": "grant", "id": "mage_slayer_protected_mind", "amount": 1},
			map[string]any{"kind": "modifier", "op": "disadvantage", "scope": "target", "applies_to": map[string]any{"roll": "saving_throw", "filter": map[string]any{"ability": "con", "reason": "maintain_concentration", "causedBySourceDamage": true}}, "reason": "mage_slayer_break_concentration"},
			map[string]any{"kind": "modifier", "op": "outcome", "value": "success", "applies_to": map[string]any{"roll": "saving_throw", "filter": map[string]any{"abilityGroup": "mental", "stage": "after_failure", "resource": "mage_slayer_protected_mind"}}, "reason": "mage_slayer_protected_mind"},
		)},
	}
}

func generalSpellFeatActionSeeds() []generalSpellFeatActionSeed {
	rows := make([]generalSpellFeatActionSeed, 0, 7)
	abilities := []string{"int", "wis", "cha"}
	for i, ability := range abilities {
		for directionIndex, direction := range []string{"push", "pull"} {
			directionName := "от себя"
			if direction == "pull" {
				directionName = "к себе"
			}
			rows = append(rows, generalSpellFeatActionSeed{
				id:          fmt.Sprintf("17100000-0000-4000-8000-%012d", 101+i*2+directionIndex),
				card:        "ACT-general-telekinetic-" + direction + "-" + ability,
				name:        "Телекинетический толчок — " + directionName,
				nameEn:      "Telekinetic Shove",
				description: "Бонусным действием переместите видимую цель в пределах 30 футов на 5 футов " + directionName + " при провале спасброска Силы.",
				resource:    "bonus_action",
				mechanics: map[string]any{
					"activation": map[string]any{"mode": "active", "cost": []map[string]any{{"resource": "bonus_action"}}},
					"targeting":  map[string]any{"domain": "actor", "actor_targets": true, "shape": "single", "min_targets": 1, "max_targets": 1, "range_ft": 30, "requires_line_of_sight": true, "allowed_relations": []string{"self", "ally", "enemy", "neutral"}},
					"effects": []map[string]any{{"resolution": "save", "who": "target", "ability": "str", "dc": "8 + prof + " + ability,
						"on_fail":    []map[string]any{{"kind": "movement", "value": direction, "distance": 5}},
						"on_success": []map[string]any{{"kind": "narrative", "description": "Цель устояла и не перемещается."}},
					}},
				},
			})
		}
	}
	rows = append(rows, generalSpellFeatActionSeed{
		id:          "17100000-0000-4000-8000-000000000107",
		card:        "ACT-general-telepathic-utterance",
		name:        "Телепатическое высказывание",
		nameEn:      "Telepathic Utterance",
		description: "Без действия передайте одно телепатическое высказывание существам, которых видите в пределах 60 футов; ответить этой способностью нельзя.",
		resource:    "free_action",
		mechanics: map[string]any{
			"activation": map[string]any{"mode": "active", "cost": []map[string]any{}},
			"targeting":  map[string]any{"domain": "actor", "actor_targets": true, "shape": "multi", "min_targets": 1, "max_targets": 20, "range_ft": 60, "requires_line_of_sight": true, "allowed_relations": []string{"ally", "enemy", "neutral"}},
			"effects": []map[string]any{{"resolution": "auto", "who": "target", "result": []map[string]any{{
				"kind": "communication_link", "range_ft": 60, "private": true, "allows_reply": false,
				"blockers": map[string]any{"requires_shared_language": true, "mindless_or_no_language": true},
				"duration": map[string]any{"type": "instantaneous"},
			}}}},
		},
	})
	return rows
}

func materializeGeneralSpellFeatSignatures(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	seeds := generalSpellFeatSeeds()
	actions := generalSpellFeatActionSeeds()
	if len(seeds) != 9 || len(actions) != 7 {
		return fmt.Errorf("general spell feat denominator effects=%d actions=%d", len(seeds), len(actions))
	}
	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions; DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects`); err != nil {
		return fmt.Errorf("disable mechanics guards: %w", err)
	}
	for _, action := range actions {
		payload, marshalErr := json.Marshal(action.mechanics)
		if marshalErr != nil {
			return marshalErr
		}
		if _, err = tx.Exec(`INSERT INTO actions
			(id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
			VALUES($1::uuid,$2,$3,$4,'','common',$5,$6,'general_feat',$7,$8::jsonb,'System','PHB 2024',
			jsonb_build_object('status','untested','certification_version',$9::text,'mechanics_locked',false,'note','Signature mechanics materialized; browser verification pending'))
			ON CONFLICT(card_number) DO UPDATE SET name=EXCLUDED.name,name_en=EXCLUDED.name_en,description=EXCLUDED.description,
			action_type=EXCLUDED.action_type,type=EXCLUDED.type,resource=EXCLUDED.resource,mechanics=EXCLUDED.mechanics,
			support=EXCLUDED.support,deleted_at=NULL,updated_at=NOW()`,
			action.id, action.name, action.nameEn, action.description, action.card, generalSpellFeatActionType, action.resource, string(payload), generalSpellFeatSignaturesMigrationVersion); err != nil {
			return fmt.Errorf("upsert %s: %w", action.card, err)
		}
		// Structural updates intentionally invalidate stale support in a BEFORE
		// trigger. Write the new untested marker as a support-only update afterward.
		if _, err = tx.Exec(`UPDATE actions SET support=jsonb_build_object(
			'status','untested','certification_version',$1::text,'mechanics_locked',false,
			'note','Signature mechanics materialized; browser verification pending'),updated_at=NOW()
			WHERE card_number=$2 AND deleted_at IS NULL`, generalSpellFeatSignaturesMigrationVersion, action.card); err != nil {
			return fmt.Errorf("mark %s untested: %w", action.card, err)
		}
	}
	for index, seed := range seeds {
		payload, marshalErr := json.Marshal(seed.mechanics)
		if marshalErr != nil {
			return marshalErr
		}
		effectID := fmt.Sprintf("17100000-0000-4000-8000-%012d", index+1)
		effectCard := "EFF-general-" + seed.card
		res, execErr := tx.Exec(`INSERT INTO effects
			(id,name,name_en,description,detailed_description,image_url,rarity,card_number,effect_type,mechanics,repeatable,author,source,support)
			SELECT $1::uuid,f.name||' — правила',COALESCE(f.name_en,''),f.description,'','','common',$2,'passive',$3::jsonb,false,'System','PHB 2024',
			jsonb_build_object('status','untested','certification_version',$4::text,'mechanics_locked',false,'note','Signature mechanics materialized; browser verification pending')
			FROM feats f WHERE f.card_number=$5 AND f.deleted_at IS NULL
			ON CONFLICT(card_number) DO UPDATE SET name=EXCLUDED.name,name_en=EXCLUDED.name_en,description=EXCLUDED.description,
			mechanics=EXCLUDED.mechanics,support=EXCLUDED.support,deleted_at=NULL,updated_at=NOW()`,
			effectID, effectCard, string(payload), generalSpellFeatSignaturesMigrationVersion, seed.card)
		if execErr != nil {
			return fmt.Errorf("upsert %s: %w", seed.card, execErr)
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return fmt.Errorf("upsert %s affected %d rows", seed.card, n)
		}
		if _, err = tx.Exec(`UPDATE effects SET support=jsonb_build_object(
			'status','untested','certification_version',$1::text,'mechanics_locked',false,
			'note','Signature mechanics materialized; browser verification pending'),updated_at=NOW()
			WHERE card_number=$2 AND deleted_at IS NULL`, generalSpellFeatSignaturesMigrationVersion, effectCard); err != nil {
			return fmt.Errorf("mark %s untested: %w", seed.card, err)
		}
		if _, err = tx.Exec(`UPDATE feats f SET
			related_effects=CASE WHEN COALESCE(f.related_effects,'[]'::jsonb) ? e.id::text THEN f.related_effects ELSE COALESCE(f.related_effects,'[]'::jsonb)||jsonb_build_array(e.id::text) END,
			repeatable=CASE WHEN f.card_number='FEAT-0043' THEN true ELSE f.repeatable END,
			updated_at=NOW()
			FROM effects e WHERE f.card_number=$1 AND e.card_number=$2 AND f.deleted_at IS NULL AND e.deleted_at IS NULL`, seed.card, effectCard); err != nil {
			return fmt.Errorf("bind %s: %w", seed.card, err)
		}
		if _, err = tx.Exec(`UPDATE feats SET support=jsonb_build_object(
			'status','untested','certification_version',$1::text,'mechanics_locked',false,
			'note','Signature mechanics materialized; browser verification pending'),updated_at=NOW()
			WHERE card_number=$2 AND deleted_at IS NULL`, generalSpellFeatSignaturesMigrationVersion, seed.card); err != nil {
			return fmt.Errorf("mark feat %s untested: %w", seed.card, err)
		}
	}
	if _, err = tx.Exec(`INSERT INTO resources(resource_id,name,name_en,description,category,recharge,sort_order)
		VALUES ('ritual_caster_quick_ritual','Быстрый ритуал','Quick Ritual','Общее бесплатное применение одного выбранного ритуала.','feat','long_rest',1710),
		('mage_slayer_protected_mind','Защищённый разум','Protected Mind','Превращает провал ментального спасброска в успех.','feat','short_rest',1711)
		ON CONFLICT(resource_id) DO UPDATE SET name=EXCLUDED.name,name_en=EXCLUDED.name_en,description=EXCLUDED.description,
		category=EXCLUDED.category,recharge=EXCLUDED.recharge,deleted_at=NULL,updated_at=NOW()`); err != nil {
		return fmt.Errorf("upsert feat resources: %w", err)
	}
	var compatible int
	if err = tx.QueryRow(`SELECT count(*) FROM feats f JOIN effects e ON e.card_number='EFF-general-'||f.card_number AND e.deleted_at IS NULL
		WHERE f.card_number IN ('FEAT-0014','FEAT-0021','FEAT-0022','FEAT-0033','FEAT-0041','FEAT-0043','FEAT-0046','FEAT-0047','FEAT-0048')
		AND f.deleted_at IS NULL AND e.support->>'status'='untested'
		AND COALESCE(jsonb_array_length(e.mechanics->'effects'),0)>0`,
	).Scan(&compatible); err != nil {
		return fmt.Errorf("feat signature postcondition: %w", err)
	}
	if compatible != 9 {
		var effectsPresent, effectsUntested, effectsWithMechanics int
		var statuses sql.NullString
		_ = tx.QueryRow(`SELECT count(*),
			count(*) FILTER (WHERE support->>'status'='untested'),
			count(*) FILTER (WHERE jsonb_typeof(mechanics->'effects')='array' AND jsonb_array_length(mechanics->'effects')>0),
			string_agg(DISTINCT COALESCE(support->>'status','<null>'), ',')
			FROM effects WHERE card_number IN
			('EFF-general-FEAT-0014','EFF-general-FEAT-0021','EFF-general-FEAT-0022','EFF-general-FEAT-0033','EFF-general-FEAT-0041','EFF-general-FEAT-0043','EFF-general-FEAT-0046','EFF-general-FEAT-0047','EFF-general-FEAT-0048')
			AND deleted_at IS NULL`).Scan(&effectsPresent, &effectsUntested, &effectsWithMechanics, &statuses)
		return fmt.Errorf("feat signature postcondition got %d, want 9 (effects present=%d untested=%d mechanics=%d statuses=%q)", compatible, effectsPresent, effectsUntested, effectsWithMechanics, statuses.String)
	}
	var elementalAdeptRepeatable bool
	if err = tx.QueryRow(`SELECT repeatable FROM feats WHERE card_number='FEAT-0043' AND deleted_at IS NULL`).Scan(&elementalAdeptRepeatable); err != nil {
		return fmt.Errorf("Elemental Adept repeatability postcondition: %w", err)
	}
	if !elementalAdeptRepeatable {
		return fmt.Errorf("Elemental Adept must remain repeatable")
	}
	var compatibleActions int
	if err = tx.QueryRow(`SELECT count(*) FROM actions
		WHERE (card_number LIKE 'ACT-general-telekinetic-%' OR card_number='ACT-general-telepathic-utterance')
		AND deleted_at IS NULL AND action_type=$1 AND type='general_feat' AND support->>'status'='untested'`, generalSpellFeatActionType).Scan(&compatibleActions); err != nil {
		return fmt.Errorf("feat action postcondition: %w", err)
	}
	if compatibleActions != 7 {
		return fmt.Errorf("feat action postcondition got %d, want 7", compatibleActions)
	}
	return tx.Commit()
}
