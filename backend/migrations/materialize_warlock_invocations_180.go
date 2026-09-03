package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const warlockInvocationsLevelFiveVersion = "180_materialize_warlock_invocations_level_five"

type warlockInvocation180 struct {
	Card, Name, NameEN string
	Level              int
	Mechanics          string
	Limitation         string
}

var warlockInvocationRows180 = []warlockInvocation180{
	{"EFF-invoc-ascendant-step", "Восходящий шаг", "Ascendant Step", 5, grantInvocationSpell180("SPELL-0210", true, "self"), ""},
	{"EFF-invoc-eldritch-smite", "Мистическая кара", "Eldritch Smite", 5, `{"activation":{"mode":"triggered","optional":true,"cost":[{"resource":"pact_magic_slot","amount":1}],"trigger":{"event":"hit","timing":"after","source_weapon_qualifier":"pact_weapon"}},"uses":{"count":1,"per":"turn"},"effects":[{"resolution":"auto","result":[{"kind":"damage","dice":"1d8","type":"force","scaling":{"per":"spell_slot_above","dice":"1d8"}},{"kind":"grant_effect","value":"COND-prone","filter":{"size_max":"huge"},"duration":{"type":"manual"}}]}]}`, ""},
	{"EFF-invoc-eldritch-spear", "Мистическое копьё", "Eldritch Spear", 2, `{"activation":{"mode":"passive"},"effects":[{"id":"eldritch_spear_cantrip","kind":"choice","count":1,"resolution":"on_acquire","options":{"source":"spell","filter":{"levels":[0],"classes":["колдун"],"requires_damage":true,"minimum_range_ft":10}},"grant":{"kind":"modifier","op":"add","value":"30 * class_level:warlock","applies_to":{"spell_range":true}}}]}`, ""},
	{"EFF-invoc-gaze-two-minds", "Взгляд двух разумов", "Gaze of Two Minds", 5, `{"activation":{"mode":"active","cost":[{"resource":"bonus_action"}]},"targeting":{"domain":"actor","shape":"single","range_ft":5,"min_targets":1,"max_targets":1,"requires_willing":true,"allowed_relations":["ally"]},"primitive":{"type":"shared_senses","maintain_cost":"bonus_action","cast_origin_max_distance_ft":60,"duration":{"type":"until_end_of_next_turn"}}}`, "Shared-senses camera and alternate spell-origin need board consumer"},
	{"EFF-invoc-gift-depths", "Дар глубин", "Gift of the Depths", 5, `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"movement_mode","mode":"swim","speed":"self_speed"},{"kind":"breathing_mode","mode":"underwater"},{"kind":"grant_spell","value":"water_breathing","freeuse":{"count":1,"per":"long_rest"}}]}]}`, ""},
	{"EFF-invoc-investment-chain", "Вложение хозяина цепи", "Investment of the Chain Master", 5, `{"activation":{"mode":"passive"},"primitive":{"type":"pact_familiar_investment","movement_choice":["fly","swim"],"speed_ft":40,"command_cost":"bonus_action","damage_type_choices":["necrotic","radiant"],"save_dc":"spell_save_dc","resistance_reaction":true,"requires":"EFF-pact-chain"}}`, "Requires companion actor/runtime"},
	{"EFF-invoc-lessons-first-ones", "Уроки первых", "Lessons of the First Ones", 2, `{"activation":{"mode":"passive"},"effects":[{"id":"lessons_first_ones_origin_feat","kind":"choice","count":1,"repeatable":true,"resolution":"on_acquire","options":{"source":"feat","categories":["origin"]},"grant":{"kind":"grant_feat"}}]}`, ""},
	{"EFF-invoc-master-myriad-forms", "Мастер бесчисленных обликов", "Master of Myriad Forms", 5, grantInvocationSpell180("SPELL-0293", true, "self"), ""},
	{"EFF-invoc-misty-visions", "Туманные видения", "Misty Visions", 2, grantInvocationSpell180("SPELL-0161", true, "normal"), "Illusion placement remains limited by board illusion support"},
	{"EFF-invoc-one-with-shadows", "Слияние с тенями", "One with Shadows", 5, `{"requirements":[{"type":"environment","light":["dim","darkness"]}],"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"grant_spell","value":"SPELL-0231","casting_override":{"remove_cost_resources":["spell_slot"],"targeting":{"shape":"self","domain":"actor","range_ft":0,"allowed_relations":["self"]}}}]}]}`, "Requires board light-state consumer"},
	{"EFF-invoc-otherworldly-leap", "Потусторонний прыжок", "Otherworldly Leap", 2, grantInvocationSpell180("SPELL-0274", true, "self"), ""},
	{"EFF-invoc-repelling-blast", "Отбрасывающий залп", "Repelling Blast", 2, `{"activation":{"mode":"triggered","optional":true,"trigger":{"event":"spell_attack_hit","timing":"after"}},"effects":[{"id":"repelling_blast_cantrip","kind":"choice","count":1,"repeatable":true,"resolution":"on_acquire","options":{"source":"spell","filter":{"levels":[0],"classes":["колдун"],"requires_attack_roll":true,"requires_damage":true}},"grant":{"kind":"modifier","op":"push","value":10,"unit":"ft","filter":{"size_max":"large"}}}]}`, ""},
	{"EFF-invoc-thirsting-blade", "Жаждущий клинок", "Thirsting Blade", 5, `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"variable","id":"attacks_per_attack_action","op":"set","value":2,"filter":{"weapon_qualifier":"pact_weapon"}}]}],"requirements":[{"type":"effect","value":"EFF-pact-blade"}]}`, ""},
}

func grantInvocationSpell180(spell string, free bool, target string) string {
	override := map[string]any{"remove_cost_resources": []string{"spell_slot"}}
	if target == "self" {
		override["targeting"] = map[string]any{"shape": "self", "domain": "actor", "range_ft": 0, "allowed_relations": []string{"self"}}
	}
	result := map[string]any{"kind": "grant_spell", "value": spell, "casting_override": override}
	b, _ := json.Marshal(map[string]any{"activation": map[string]any{"mode": "passive"}, "effects": []any{map[string]any{"resolution": "auto", "result": []any{result}}}})
	_ = free
	return string(b)
}

func materializeWarlockInvocationsLevelFive180(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects`); err != nil {
		return err
	}
	for i, row := range warlockInvocationRows180 {
		id := fmt.Sprintf("18000000-0000-4000-8000-%012d", i+1)
		if _, err = tx.Exec(`INSERT INTO effects(id,name,name_en,description,card_number,effect_type,mechanics,source,support,updated_at) VALUES($1::uuid,$2::text,$3::text,$2::text,$4::text,'passive',$5::jsonb,'SRD 5.2.1',jsonb_build_object('status','untested','certification_version',$6::text,'mechanics_locked',false,'note',$7::text),NOW()) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,name_en=EXCLUDED.name_en,description=EXCLUDED.description,card_number=EXCLUDED.card_number,effect_type=EXCLUDED.effect_type,mechanics=EXCLUDED.mechanics,source=EXCLUDED.source,updated_at=NOW()`, id, row.Name, row.NameEN, row.Card, row.Mechanics, warlockInvocationsLevelFiveVersion, row.Limitation); err != nil {
			return fmt.Errorf("upsert %s: %w", row.Card, err)
		}
	}
	items := make([]map[string]any, 0, 22)
	for _, base := range []struct {
		card, name string
		level      int
	}{
		{"EFF-invoc-armor_of_shadows", "Доспех теней", 1}, {"EFF-invoc-eldritch_mind", "Мистический разум", 1}, {"EFF-pact-blade", "Клинок", 1}, {"EFF-pact-chain", "Цепь", 1}, {"EFF-pact-tome", "Гримуар", 1},
		{"EFF-invoc-agonizing_blast", "Мучительный залп", 2}, {"EFF-invoc-devils_sight", "Зрение исчадия", 2}, {"EFF-invoc-fiendish_vigor", "Бодрость исчадия", 2}, {"EFF-invoc-mask_of_many_faces", "Маска многих лиц", 2},
	} {
		items = append(items, map[string]any{"id": base.card, "value": base.card, "name": base.name, "minimum_class_level": base.level})
	}
	seen := map[string]bool{}
	for _, it := range items {
		seen[fmt.Sprint(it["value"])] = true
	}
	for _, row := range warlockInvocationRows180 {
		if !seen[row.Card] {
			items = append(items, map[string]any{"id": row.Card, "value": row.Card, "name": row.Name, "minimum_class_level": row.Level})
		}
	}
	itemsJSON, _ := json.Marshal(items)
	if _, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(jsonb_set(mechanics,'{effects,0,count_by_level}','{"1":1,"2":3,"5":5}'::jsonb,true),'{effects,0,options,items}',$1::jsonb,true),updated_at=NOW() WHERE card_number='EFF-eldritch-invocations'`, string(itemsJSON)); err != nil {
		return err
	}
	if _, err = tx.Exec(`UPDATE effects SET support=jsonb_build_object('status','untested','certification_version',$1::text,'mechanics_locked',false,'note',CASE WHEN card_number IN ('EFF-invoc-gaze-two-minds','EFF-invoc-investment-chain','EFF-invoc-one-with-shadows','EFF-invoc-misty-visions') THEN 'Structured declaration present; board or companion consumer remains required' ELSE 'Executable declaration requires retained-character browser verification' END),updated_at=NOW() WHERE card_number='EFF-eldritch-invocations' OR card_number LIKE 'EFF-invoc-%'`, warlockInvocationsLevelFiveVersion); err != nil {
		return err
	}
	var count int
	if err = tx.QueryRow(`SELECT jsonb_array_length(mechanics#>'{effects,0,options,items}') FROM effects WHERE card_number='EFF-eldritch-invocations'`).Scan(&count); err != nil || count != 22 {
		return fmt.Errorf("invocation denominator=%d want 22: %v", count, err)
	}
	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return err
	}
	return tx.Commit()
}
