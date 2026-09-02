package migrations

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

const miniMVPRuntimeEffectsMigrationVersion = "144_materialize_mini_mvp_runtime_effects"
const expectedMiniMVPRuntimeEffects = 63

type runtimeEffectSource struct {
	table       string
	id          string
	cardNumber  string
	name        string
	nameEn      string
	description string
	imageURL    string
	mechanics   map[string]any
}

type materializedRuntimeEffect struct {
	id          string
	cardNumber  string
	name        string
	nameEn      string
	description string
	detailed    string
	imageURL    string
	mechanics   map[string]any
	effectType  string
	sourceTable string
	sourceID    string
	path        string
}

// materializeMiniMVPRuntimeEffects turns every durable target-side runtime
// primitive in species/class actions, cantrips and first-level spells into a
// real effects-catalog row. The executable primitive stays byte-for-byte the
// same inside that row; the source now grants it by stable catalog reference.
func materializeMiniMVPRuntimeEffects(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
		DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells;
	`); err != nil {
		return fmt.Errorf("disable certified mechanics guards: %w", err)
	}

	sources, err := loadMiniMVPRuntimeEffectSources(tx)
	if err != nil {
		return err
	}
	materialized := make([]materializedRuntimeEffect, 0, expectedMiniMVPRuntimeEffects)
	for index := range sources {
		rewritten, effects, changed := rewriteDurableTargetPayloads(
			sources[index].mechanics,
			"mechanics",
			false,
			sources[index],
		)
		if !changed {
			continue
		}
		sources[index].mechanics = rewritten.(map[string]any)
		materialized = append(materialized, effects...)
	}
	if len(materialized) != expectedMiniMVPRuntimeEffects {
		return fmt.Errorf("mini-MVP durable target payload preimage drifted: got %d, want %d", len(materialized), expectedMiniMVPRuntimeEffects)
	}

	for _, effect := range materialized {
		mechanicsJSON, marshalErr := json.Marshal(effect.mechanics)
		if marshalErr != nil {
			return fmt.Errorf("encode %s mechanics: %w", effect.cardNumber, marshalErr)
		}
		if _, err = tx.Exec(`
			INSERT INTO effects (
				id,name,name_en,description,detailed_description,image_url,rarity,
				card_number,effect_type,mechanics,repeatable,author,source,support
			) VALUES (
				$1::uuid,$2,NULLIF($3,''),$4,$5,$6,'common',$7,$8,$9::jsonb,
				false,'System','PHB 2024',
				jsonb_build_object('status','untested','certification_version',$10::text,
				  'mechanics_locked',false,'note','Материализован длительный runtime-эффект; требуется браузерная перепроверка.')
			)
			ON CONFLICT (card_number) DO UPDATE SET
				deleted_at=NULL,name=EXCLUDED.name,name_en=EXCLUDED.name_en,
				description=EXCLUDED.description,detailed_description=EXCLUDED.detailed_description,
				image_url=EXCLUDED.image_url,effect_type=EXCLUDED.effect_type,
				mechanics=EXCLUDED.mechanics,repeatable=false,support=EXCLUDED.support,updated_at=NOW()
		`, effect.id, effect.name, effect.nameEn, effect.description, effect.detailed,
			effect.imageURL, effect.cardNumber, effect.effectType, string(mechanicsJSON), miniMVPRuntimeEffectsMigrationVersion); err != nil {
			return fmt.Errorf("materialize %s: %w", effect.cardNumber, err)
		}
	}

	for _, source := range sources {
		if !sourceHasMaterializedEffect(materialized, source.table, source.id) {
			continue
		}
		mechanicsJSON, marshalErr := json.Marshal(source.mechanics)
		if marshalErr != nil {
			return fmt.Errorf("encode rewritten %s: %w", source.cardNumber, marshalErr)
		}
		query := fmt.Sprintf(`UPDATE %s SET mechanics=$2::jsonb,
			support=jsonb_build_object('status','untested','certification_version',$3::text,
			  'mechanics_locked',false,'note','Длительные эффекты вынесены в библиотеку; требуется браузерная перепроверка.'),
			updated_at=NOW() WHERE id=$1::uuid AND deleted_at IS NULL`, source.table)
		result, execErr := tx.Exec(query, source.id, string(mechanicsJSON), miniMVPRuntimeEffectsMigrationVersion)
		if execErr != nil {
			return fmt.Errorf("rewrite %s: %w", source.cardNumber, execErr)
		}
		rows, rowsErr := result.RowsAffected()
		if rowsErr != nil || rows != 1 {
			return fmt.Errorf("rewrite %s affected %d rows: %w", source.cardNumber, rows, rowsErr)
		}
	}

	var exact int
	if err = tx.QueryRow(`SELECT count(*) FROM effects
		WHERE deleted_at IS NULL AND support->>'certification_version'=$1`,
		miniMVPRuntimeEffectsMigrationVersion).Scan(&exact); err != nil {
		return fmt.Errorf("verify materialized runtime effects: %w", err)
	}
	if exact != expectedMiniMVPRuntimeEffects {
		return fmt.Errorf("runtime effect postcondition failed: got %d, want %d", exact, expectedMiniMVPRuntimeEffects)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}

func loadMiniMVPRuntimeEffectSources(tx *sql.Tx) ([]runtimeEffectSource, error) {
	queries := []struct {
		table string
		sql   string
	}{
		{"actions", `SELECT id::text,card_number,name,COALESCE(name_en,''),COALESCE(description,''),COALESCE(image_url,''),COALESCE(mechanics,'{}'::jsonb)
			FROM actions WHERE deleted_at IS NULL ORDER BY card_number,id`},
		{"spells", `SELECT id::text,card_number,name,COALESCE(name_en,''),COALESCE(description,''),COALESCE(image_url,''),COALESCE(mechanics,'{}'::jsonb)
			FROM spells WHERE deleted_at IS NULL AND level <= 1 ORDER BY card_number,id`},
	}
	var result []runtimeEffectSource
	for _, query := range queries {
		rows, err := tx.Query(query.sql)
		if err != nil {
			return nil, fmt.Errorf("load %s runtime sources: %w", query.table, err)
		}
		for rows.Next() {
			var source runtimeEffectSource
			var raw []byte
			source.table = query.table
			if err = rows.Scan(&source.id, &source.cardNumber, &source.name, &source.nameEn,
				&source.description, &source.imageURL, &raw); err != nil {
				rows.Close()
				return nil, fmt.Errorf("scan %s runtime source: %w", query.table, err)
			}
			if err = json.Unmarshal(raw, &source.mechanics); err != nil {
				rows.Close()
				return nil, fmt.Errorf("decode %s mechanics: %w", source.cardNumber, err)
			}
			result = append(result, source)
		}
		if err = rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("iterate %s runtime sources: %w", query.table, err)
		}
		rows.Close()
	}
	return result, nil
}

func rewriteDurableTargetPayloads(value any, path string, targetContext bool, source runtimeEffectSource) (any, []materializedRuntimeEffect, bool) {
	switch typed := value.(type) {
	case []any:
		result := make([]any, len(typed))
		var effects []materializedRuntimeEffect
		changed := false
		for index, item := range typed {
			rewritten, nested, itemChanged := rewriteDurableTargetPayloads(item, fmt.Sprintf("%s[%d]", path, index), targetContext, source)
			result[index] = rewritten
			effects = append(effects, nested...)
			changed = changed || itemChanged
		}
		return result, effects, changed
	case map[string]any:
		nextTarget := targetContext || typed["who"] == "target" || strings.Contains(path, "on_hit") || strings.Contains(path, "on_fail") || strings.Contains(path, "on_success")
		kind, _ := typed["kind"].(string)
		_, hasDuration := typed["duration"].(map[string]any)
		if nextTarget && hasDuration && kind != "" && kind != "condition" && kind != "grant_effect" {
			effect := runtimeEffectFromPayload(source, path, typed)
			return map[string]any{"kind": "grant_effect", "value": effect.cardNumber}, []materializedRuntimeEffect{effect}, true
		}
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		result := make(map[string]any, len(typed))
		var effects []materializedRuntimeEffect
		changed := false
		for _, key := range keys {
			rewritten, nested, itemChanged := rewriteDurableTargetPayloads(typed[key], path+"."+key, nextTarget, source)
			result[key] = rewritten
			effects = append(effects, nested...)
			changed = changed || itemChanged
		}
		return result, effects, changed
	default:
		return value, nil, false
	}
}

func runtimeEffectFromPayload(source runtimeEffectSource, path string, mechanics map[string]any) materializedRuntimeEffect {
	sum := sha256.Sum256([]byte(source.table + "\x00" + source.cardNumber + "\x00" + path))
	uuidBytes := append([]byte(nil), sum[:16]...)
	uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x50
	uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80
	hexID := hex.EncodeToString(uuidBytes)
	id := fmt.Sprintf("%s-%s-%s-%s-%s", hexID[:8], hexID[8:12], hexID[12:16], hexID[16:20], hexID[20:])
	cardNumber := "EFFECT-runtime-" + hex.EncodeToString(sum[:10])
	summary := runtimeEffectSummary(mechanics)
	name := source.name + " — " + summary
	nameEn := strings.TrimSpace(source.nameEn)
	if nameEn != "" {
		nameEn += " — " + summary
	}
	return materializedRuntimeEffect{
		id: id, cardNumber: cardNumber, name: name, nameEn: nameEn,
		description: summary + ". Источник: " + source.name + ".",
		detailed:    source.description, imageURL: source.imageURL, mechanics: mechanics,
		effectType:  map[bool]string{true: "species_ability", false: "spell_effect"}[source.table == "actions"],
		sourceTable: source.table, sourceID: source.id, path: path,
	}
}

func runtimeEffectSummary(mechanics map[string]any) string {
	kind, _ := mechanics["kind"].(string)
	applies, _ := mechanics["applies_to"].(map[string]any)
	filter, _ := applies["filter"].(map[string]any)
	roll, _ := applies["roll"].(string)
	op, _ := mechanics["op"].(string)
	if roll == "speed" {
		return "Скорость снижена на 10 футов"
	}
	if roll == "healing" && op == "deny" {
		return "Нельзя восстанавливать хиты"
	}
	rollNames := map[string]string{"attack": "броски атаки", "saving_throw": "спасброски", "ability_check": "проверки характеристик"}
	if label := rollNames[roll]; label != "" {
		suffix := ""
		if ability, _ := filter["ability"].(string); ability != "" {
			suffix = " (" + map[string]string{"str": "Сила", "dex": "Ловкость", "con": "Телосложение", "int": "Интеллект", "wis": "Мудрость", "cha": "Харизма"}[ability] + ")"
		}
		if skill, _ := filter["skill"].(string); skill != "" {
			suffix = " (" + strings.ReplaceAll(skill, "_", " ") + ")"
		}
		switch op {
		case "advantage":
			return "Преимущество: " + label + suffix
		case "disadvantage":
			return "Помеха: " + label + suffix
		case "bonus_die":
			faces := fmt.Sprint(mechanics["faces"])
			if fmt.Sprint(mechanics["sign"]) == "-1" {
				return "−1к" + faces + ": " + label + suffix
			}
			return "+1к" + faces + ": " + label + suffix
		}
	}
	return map[string]string{
		"communication_link": "Магическая связь",
		"triggered_effect":   "Доступен особый срабатывающий эффект",
		"condition_immunity": "Иммунитет к состоянию",
		"damage_rider":       "Дополнительный урон при попадании",
		"fall_protection":    "Защита от падения",
		"movement_option":    "Особый способ перемещения",
		"targeting_ward":     "Защита от выбора целью",
	}[kind]
}

func sourceHasMaterializedEffect(effects []materializedRuntimeEffect, table, id string) bool {
	for _, effect := range effects {
		if effect.sourceTable == table && effect.sourceID == id {
			return true
		}
	}
	return false
}
