package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const combatAreasMigrationVersion = "152_materialize_combat_areas"

type areaLibraryEffect struct {
	id, cardNumber, name string
	mechanics            map[string]any
}

func modifierEffect(op, value string, filter map[string]any, duration map[string]any) map[string]any {
	result := map[string]any{
		"kind": "modifier", "applies_to": map[string]any{"roll": "ability_check", "filter": filter},
		"op": op, "consume": "next", "duration": duration,
	}
	if value != "" {
		result["value"] = value
	}
	return result
}

func areaLibraryEffects() []areaLibraryEffect {
	manual := map[string]any{"type": "manual"}
	return []areaLibraryEffect{
		{"15200000-0000-4000-8000-000000000001", "EFFECT-item-crowbar-check", "Ломик — преимущество Силы", modifierEffect("advantage", "", map[string]any{"ability": "str"}, manual)},
		{"15200000-0000-4000-8000-000000000002", "EFFECT-item-ram-check", "Портативный таран — +4 к Силе", modifierEffect("add", "+4", map[string]any{"ability": "str"}, manual)},
		{"15200000-0000-4000-8000-000000000003", "EFFECT-item-magnifier-check", "Увеличительное стекло — преимущество Расследования", modifierEffect("advantage", "", map[string]any{"skill": "investigation"}, manual)},
		{"15200000-0000-4000-8000-000000000004", "EFFECT-item-map-check", "Карта — +5 к Выживанию", modifierEffect("add", "+5", map[string]any{"skill": "survival"}, manual)},
		{"15200000-0000-4000-8000-000000000005", "EFFECT-item-perfume-check", "Духи — преимущество Убеждения", modifierEffect("advantage", "", map[string]any{"skill": "persuasion"}, manual)},
		{"15200000-0000-4000-8000-000000000006", "EFFECT-item-pole-check", "Шест — преимущество Атлетики", modifierEffect("advantage", "", map[string]any{"skill": "athletics"}, manual)},
		{"15200000-0000-4000-8000-000000000007", "EFFECT-item-caltrops-speed", "Колючки — скорость 0", map[string]any{
			"kind": "modifier", "applies_to": map[string]any{"roll": "speed"}, "op": "set", "value": "0",
			"duration": map[string]any{"type": "until_start_of_next_turn"},
		}},
		{"15200000-0000-4000-8000-000000000008", "EFFECT-item-hunting-trap-speed", "Охотничий капкан — скорость 0", map[string]any{
			"kind": "modifier", "applies_to": map[string]any{"roll": "speed"}, "op": "set", "value": "0",
			"duration": map[string]any{"type": "manual"},
		}},
	}
}

func worldAreaTargeting(shape string, size, rangeFt int) map[string]any {
	geometry := map[string]any{"kind": shape, "size_ft": size}
	if shape == "sphere" {
		geometry = map[string]any{"kind": shape, "radius_ft": size}
	}
	return map[string]any{
		"shape": "area", "domain": "world", "actor_targets": false,
		"min_targets": 0, "max_targets": 0, "range_ft": rangeFt,
		"requires_line_of_sight": true, "allowed_relations": []string{}, "area": geometry,
	}
}

func persistentSpellArea(zoneType, shape string, size int, duration map[string]any, tactical map[string]any) map[string]any {
	return map[string]any{
		"kind": "world_zone", "zone_type": zoneType,
		"geometry": map[string]any{"shape": shape, "size_ft": size},
		"duration": duration, "tactical": tactical,
	}
}

func updateAreaSpell(tx *sql.Tx, cardNumber, areaLabel string, effects []map[string]any, targeting map[string]any) error {
	mechanicsJSON, err := json.Marshal(map[string]any{"effects": effects, "targeting": targeting})
	if err != nil {
		return err
	}
	result, err := tx.Exec(`
		UPDATE spells SET area=$4, mechanics=(COALESCE(mechanics,'{}'::jsonb)
		  - 'effects' - 'targeting') || $2::jsonb,
		  support=jsonb_build_object('status','untested','certification_version',$3::text,
		    'mechanics_locked',false,'note','Область перенесена в событийную модель поля; требуется браузерная перепроверка.'),
		  updated_at=NOW()
		WHERE card_number=$1 AND deleted_at IS NULL
	`, cardNumber, string(mechanicsJSON), combatAreasMigrationVersion, areaLabel)
	if err != nil {
		return fmt.Errorf("update area spell %s: %w", cardNumber, err)
	}
	rows, err := result.RowsAffected()
	if err != nil || rows != 1 {
		return fmt.Errorf("update area spell %s affected %d rows: %w", cardNumber, rows, err)
	}
	return nil
}

func addAlarmAreaNotice(value any) any {
	switch current := value.(type) {
	case []any:
		for index, child := range current {
			current[index] = addAlarmAreaNotice(child)
		}
	case map[string]any:
		if current["kind"] == "world_zone" && current["zone_type"] == "alarm" {
			current["tactical"] = map[string]any{
				"triggers": []string{"enter"},
				"notice":   "Тревога сработала",
			}
		}
		for key, child := range current {
			current[key] = addAlarmAreaNotice(child)
		}
	}
	return value
}

func updateAlarmArea(tx *sql.Tx) error {
	var raw []byte
	if err := tx.QueryRow(`SELECT mechanics FROM spells WHERE card_number='SPELL-0288' AND deleted_at IS NULL`).Scan(&raw); err != nil {
		return fmt.Errorf("load alarm mechanics: %w", err)
	}
	var mechanics map[string]any
	if err := json.Unmarshal(raw, &mechanics); err != nil {
		return fmt.Errorf("decode alarm mechanics: %w", err)
	}
	addAlarmAreaNotice(mechanics)
	encoded, err := json.Marshal(mechanics)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE spells SET mechanics=$1::jsonb,
	  support=jsonb_build_object('status','untested','certification_version',$2::text,
	  'mechanics_locked',false,'note','Событие входа в область тревоги; требуется браузерная перепроверка.'),
	  updated_at=NOW() WHERE card_number='SPELL-0288' AND deleted_at IS NULL`, string(encoded), combatAreasMigrationVersion)
	return err
}

func materializeCombatAreas(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_cards_certified_mechanics ON cards;
		DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
	`); err != nil {
		return fmt.Errorf("disable certified mechanics guards: %w", err)
	}

	for _, effect := range areaLibraryEffects() {
		raw, marshalErr := json.Marshal(effect.mechanics)
		if marshalErr != nil {
			return marshalErr
		}
		if _, err = tx.Exec(`
			INSERT INTO effects (id,name,description,detailed_description,image_url,rarity,
			  card_number,effect_type,mechanics,repeatable,author,source,support)
			VALUES ($1::uuid,$2::text,$2::text,$2::text,'','common',$3::text,'item_effect',$4::jsonb,false,
			  'System','PHB 2024',jsonb_build_object('status','untested',
			  'certification_version',$5::text,'mechanics_locked',false,
			  'note','Материализован эффект предмета; требуется браузерная перепроверка.'))
			ON CONFLICT (card_number) DO UPDATE SET deleted_at=NULL,name=EXCLUDED.name,
			  description=EXCLUDED.description,detailed_description=EXCLUDED.detailed_description,
			  effect_type=EXCLUDED.effect_type,mechanics=EXCLUDED.mechanics,support=EXCLUDED.support,
			  updated_at=NOW()
		`, effect.id, effect.name, effect.cardNumber, string(raw), combatAreasMigrationVersion); err != nil {
			return fmt.Errorf("materialize %s: %w", effect.cardNumber, err)
		}
	}

	// Reapply the now library-backed utility actions and persistent area declarations.
	for _, row := range utilityItems2024() {
		if row.CardNumber != "CARD-0799" && row.CardNumber != "CARD-0790" &&
			row.CardNumber != "CARD-0411" && row.CardNumber != "CARD-0723" &&
			row.CardNumber != "CARD-0407" && row.CardNumber != "CARD-0819" &&
			row.CardNumber != "CARD-0822" && row.CardNumber != "CARD-0389" &&
			row.CardNumber != "CARD-0696" && row.CardNumber != "CARD-0831" {
			continue
		}
		raw, marshalErr := json.Marshal(row.Mechanics)
		if marshalErr != nil {
			return marshalErr
		}
		result, execErr := tx.Exec(`UPDATE cards SET mechanics=$2::jsonb,
		  support=jsonb_build_object('status','untested','certification_version',$3::text,
		  'mechanics_locked',false,'note','Библиотечный эффект или событийная область; требуется браузерная перепроверка.'),
		  updated_at=NOW() WHERE card_number=$1 AND deleted_at IS NULL`, row.CardNumber, string(raw), combatAreasMigrationVersion)
		if execErr != nil {
			return fmt.Errorf("update %s: %w", row.CardNumber, execErr)
		}
		if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
			return fmt.Errorf("update %s affected %d rows: %w", row.CardNumber, rows, rowsErr)
		}
	}

	grease := persistentSpellArea("grease", "cube", 10, map[string]any{"type": "rounds", "amount": 10}, map[string]any{
		"triggers": []string{"created", "enter", "end_turn"}, "difficult_terrain": true,
		"save":       map[string]any{"ability": "dex", "dc": "spell_save_dc"},
		"on_failure": []map[string]any{{"kind": "condition", "value": "prone", "op": "apply"}}, "on_success": []any{},
	})
	if err = updateAreaSpell(tx, "SPELL-0292", "Квадрат 10×10 футов", []map[string]any{{"resolution": "auto", "result": []map[string]any{grease}}}, worldAreaTargeting("cube", 10, 60)); err != nil {
		return err
	}
	fog := persistentSpellArea("fog_cloud", "sphere", 20, map[string]any{"type": "rounds", "amount": 600, "concentration": true}, map[string]any{
		"heavily_obscured": true, "inside_condition": "blinded",
	})
	fog["dispersed_by_strong_wind"] = true
	if err = updateAreaSpell(tx, "SPELL-0303", "Сфера радиусом 20 футов", []map[string]any{{"resolution": "auto", "result": []map[string]any{fog}}}, worldAreaTargeting("sphere", 20, 120)); err != nil {
		return err
	}
	entangle := persistentSpellArea("entangle", "cube", 20, map[string]any{"type": "rounds", "amount": 10, "concentration": true}, map[string]any{
		"triggers": []string{"created"}, "difficult_terrain": true,
		"save":       map[string]any{"ability": "str", "dc": "spell_save_dc"},
		"on_failure": []map[string]any{{"kind": "condition", "value": "restrained", "op": "apply", "area_linked": true}}, "on_success": []any{},
	})
	if err = updateAreaSpell(tx, "SPELL-0246", "Квадрат 20×20 футов", []map[string]any{{"resolution": "auto", "result": []map[string]any{entangle}}}, worldAreaTargeting("cube", 20, 90)); err != nil {
		return err
	}
	if err = updateAlarmArea(tx); err != nil {
		return err
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
