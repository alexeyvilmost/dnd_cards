package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const levelFiveSpellIntegrityVersion = "186_repair_level_five_spell_integrity"

type levelFiveSpellIntegrityEffect struct {
	id, cardNumber, name, description string
	mechanics                         map[string]any
}

func levelFiveMultipleTargeting(rangeFt, maxTargets int, relations ...string) map[string]any {
	targeting := levelFiveSingleTargeting(rangeFt, maxTargets, relations...)
	targeting["shape"] = "multi"
	return targeting
}

func levelFiveBoundedAreaTargeting(
	shape string,
	sizeFt, rangeFt, maxTargets int,
	relations ...string,
) map[string]any {
	targeting := levelFiveAreaTargeting(shape, sizeFt, rangeFt, true)
	targeting["max_targets"] = maxTargets
	targeting["allowed_relations"] = relations
	return targeting
}

// The level-5 import intentionally accepted legacy target declarations so the
// catalog remained readable during the expansion. These rows now cross the
// strict sheet/combat boundary, so target legality and tactical geometry must
// be explicit data rather than localized-text inference. World-only entries
// also stop misleadingly dealing their deferred area/summon damage at cast.
func levelFiveSpellTargetingIntegrityRepairs() []levelFiveTargetingPatch {
	plantGrowth := levelFiveAreaTargeting("sphere", 100, 150, false)
	windWall := levelFiveAreaTargeting("line", 50, 120, true)
	windWall["area"].(map[string]any)["width_ft"] = 5

	return []levelFiveTargetingPatch{
		{"SPELL-0170", "", levelFiveSingleTargeting(30, 1, "ally", "enemy", "neutral")},
		{"SPELL-0176", "", levelFiveWorldTargeting(5, true)},
		{"SPELL-0177", "", levelFiveSingleTargeting(60, 1, "enemy", "neutral")},
		{"SPELL-0178", "", levelFiveWorldTargeting(90, true)},
		{"SPELL-0184", "", levelFiveSelfTargeting()},
		{"SPELL-0196", "", levelFiveSingleTargeting(60, 1, "enemy", "neutral")},
		{"SPELL-0198", "", levelFiveSingleTargeting(5, 1, "ally", "neutral")},
		{"SPELL-0200", "", levelFiveWorldTargeting(5, true)},
		{"SPELL-0208", "", levelFiveSingleTargeting(90, 1, "enemy", "neutral")},
		{"SPELL-0209", "", levelFiveSingleTargeting(120, 1, "enemy", "neutral")},
		{"SPELL-0210", "", levelFiveSingleTargeting(60, 1, "self", "ally", "enemy", "neutral")},
		{"ray_of_enfeeblement", "", levelFiveSingleTargeting(60, 1, "enemy", "neutral")},
		{"SPELL-0221", "", levelFiveSingleTargeting(5, 1, "self", "ally", "neutral")},
		{"SPELL-0225", "", levelFiveSelfTargeting()},
		{"SPELL-0227", "", levelFiveMultipleTargeting(30, 5, "self", "ally")},
		{"SPELL-0239", "", levelFiveSelfTargeting()},
		{"SPELL-0249", "", levelFiveSelfTargeting()},
		{"SPELL-0261", "", levelFiveMultipleTargeting(30, 3, "self", "ally")},
		{"SPELL-0264", "", levelFiveSelfTargeting()},
		{"SPELL-0271", "", levelFiveSingleTargeting(30, 1, "ally", "neutral")},
		{"SPELL-0273", "", levelFiveSingleTargeting(120, 1, "enemy", "neutral")},
		{"SPELL-0278", "", levelFiveSelfTargeting()},
		{"SPELL-0279", "", levelFiveSingleTargeting(60, 1, "enemy", "neutral")},
		{"hold_person", "", levelFiveSingleTargeting(60, 1, "enemy", "neutral")},
		{"counterspell", "", levelFiveSingleTargeting(60, 1, "enemy", "neutral")},
		{"blinding_smite", "", levelFiveSingleTargeting(5, 1, "enemy", "neutral")},
		{"conjure_animals", "", levelFiveWorldTargeting(60, true)},
		{"call_lightning", "Сфера радиусом 5 футов", levelFiveBoundedAreaTargeting(
			"sphere", 5, 120, 8, "self", "ally", "enemy", "neutral",
		)},
		{"vampiric_touch", "", levelFiveSingleTargeting(5, 1, "enemy", "neutral")},
		{"feign_death", "", levelFiveSingleTargeting(5, 1, "self", "ally", "neutral")},
		{"speak_with_plants", "Эманация 30 футов", levelFiveSelfTargeting()},
		{"dispel_magic", "", levelFiveSingleTargeting(120, 1, "self", "ally", "enemy", "neutral")},
		{"plant_growth", "Сфера радиусом 100 футов", plantGrowth},
		{"wind_wall", "Линия 50×5 футов", windWall},
		{"slow", "Куб 40×40 футов; до 6 существ", levelFiveBoundedAreaTargeting(
			"cube", 40, 120, 6, "self", "ally", "enemy", "neutral",
		)},
	}
}

func levelFiveSpellIntegrityEffects() []levelFiveSpellIntegrityEffect {
	passive := func(duration map[string]any, result ...map[string]any) map[string]any {
		return map[string]any{
			"activation": map[string]any{"mode": "passive"},
			"duration":   duration,
			"effects": []map[string]any{{
				"resolution": "auto", "result": result,
			}},
		}
	}
	return []levelFiveSpellIntegrityEffect{
		{
			id: "18600000-0000-4000-8000-000000000001", cardNumber: "EFFECT-zone-of-truth-bound",
			name:        "Связан Областью истины",
			description: "Вы не можете намеренно произнести ложь, находясь под действием Области истины.",
			mechanics: passive(map[string]any{"type": "rounds", "amount": 100}, map[string]any{
				"kind": "narrative", "description": "Существо не может намеренно произнести ложь.",
			}),
		},
		{
			id: "18600000-0000-4000-8000-000000000002", cardNumber: "EFFECT-calm-emotions-indifferent",
			name:        "Безразличие (Умиротворение)",
			description: "Вы безразличны к существам, к которым были враждебны; эффект заканчивается, если вас атакуют или вам причиняют вред.",
			mechanics: passive(map[string]any{"type": "rounds", "amount": 10, "concentration": true}, map[string]any{
				"kind": "narrative", "description": "Враждебное существо становится безразличным до окончания эффекта или пока ему не причинят вред.",
			}),
		},
		{
			id: "18600000-0000-4000-8000-000000000003", cardNumber: "EFFECT-stinking-cloud-retching",
			name:        "Кашель (Зловонное облако)",
			description: "До конца текущего хода вы не можете совершать Действия и Бонусные действия.",
			mechanics: passive(map[string]any{"type": "rounds", "amount": 1},
				map[string]any{"kind": "modifier", "op": "deny", "applies_to": map[string]any{"roll": "action"}},
				map[string]any{"kind": "modifier", "op": "deny", "applies_to": map[string]any{"roll": "bonus_action"}},
			),
		},
		{
			id: "18600000-0000-4000-8000-000000000004", cardNumber: "EFFECT-feign-death-stasis",
			name:        "Смертный покой (Притворная смерть)",
			description: "Скорость 0 и иммунитет к состоянию Отравленный. Сопротивление всему урону кроме психического разрешается вручную.",
			mechanics: passive(map[string]any{"type": "rounds", "amount": 600},
				map[string]any{"kind": "modifier", "op": "set", "value": "0", "applies_to": map[string]any{"roll": "speed"}},
				map[string]any{"kind": "condition_immunity", "condition": "poisoned", "duration": map[string]any{"type": "rounds", "amount": 600}},
				map[string]any{"kind": "narrative", "description": "Сопротивление всему урону кроме психического применяется вручную."},
			),
		},
		{
			id: "18600000-0000-4000-8000-000000000005", cardNumber: "EFFECT-hypnotic-pattern-stupor",
			name:        "Оцепенение (Гипнотический узор)",
			description: "Ваша Скорость равна 0, пока длится оцепенение Гипнотического узора.",
			mechanics: passive(map[string]any{"type": "rounds", "amount": 10, "concentration": true}, map[string]any{
				"kind": "modifier", "op": "set", "value": "0", "applies_to": map[string]any{"roll": "speed"},
			}),
		},
	}
}

// These imported rows applied the inverse or an unrelated standard
// condition. Keep partial/narrative rules visible, but never mutate combat
// state with a false condition merely to make the spell appear automated.
func levelFiveSpellMechanicsIntegrityRepairs() []levelFiveSpellPatch {
	choice := func(id, prompt string, options ...map[string]any) map[string]any {
		return map[string]any{
			"kind": "choice", "context": "in_play", "id": id,
			"prompt": prompt, "count": 1,
			"options": map[string]any{"source": "explicit", "items": options},
		}
	}
	return []levelFiveSpellPatch{
		{
			cardNumber: "SPELL-0221",
			effects: []map[string]any{{"resolution": "auto", "who": "target", "result": []map[string]any{
				choice("lesser_restoration_condition", "Какое состояние окончить?",
					map[string]any{"id": "blinded", "name": "Ослеплённый", "grants": []map[string]any{{"kind": "remove_effect", "card_number": "COND-blinded"}}},
					map[string]any{"id": "deafened", "name": "Оглохший", "grants": []map[string]any{{"kind": "remove_effect", "card_number": "COND-deafened"}}},
					map[string]any{"id": "paralyzed", "name": "Парализованный", "grants": []map[string]any{{"kind": "remove_effect", "card_number": "COND-paralyzed"}}},
					map[string]any{"id": "poisoned", "name": "Отравленный", "grants": []map[string]any{{"kind": "remove_effect", "card_number": "COND-poisoned"}}},
				),
			}}},
		},
		{
			cardNumber: "SPELL-0235",
			effects: []map[string]any{{
				"resolution": "save", "who": "target", "ability": "cha", "dc": "8 + prof + spellcasting",
				"on_fail": []map[string]any{{
					"kind": "grant_effect", "value": "EFFECT-zone-of-truth-bound",
					"duration": map[string]any{"type": "rounds", "amount": 100},
				}},
				"on_success": []map[string]any{{"kind": "narrative", "description": "Существо сопротивляется Области истины."}},
			}},
		},
		{
			cardNumber: "SPELL-0310",
			effects: []map[string]any{{
				"resolution": "save", "who": "target", "ability": "cha", "dc": "8 + prof + spellcasting",
				"on_fail": []map[string]any{
					choice("calm_emotions_mode", "Как Умиротворение влияет на цель?",
						map[string]any{"id": "suppress", "name": "Подавить Очарование и Испуг", "grants": []map[string]any{
							{"kind": "remove_effect", "card_number": "COND-charmed"},
							{"kind": "remove_effect", "card_number": "COND-frightened"},
						}},
						map[string]any{"id": "indifferent", "name": "Сделать безразличным", "grants": []map[string]any{{
							"kind": "grant_effect", "value": "EFFECT-calm-emotions-indifferent",
							"duration": map[string]any{"type": "rounds", "amount": 10, "concentration": true},
						}}},
					),
				},
				"on_success": []map[string]any{{"kind": "narrative", "description": "Существо сопротивляется Умиротворению."}},
			}},
		},
		{
			cardNumber: "stinking_cloud", areaLabel: "Сфера радиусом 20 футов",
			targeting: levelFiveAreaTargeting("sphere", 20, 90, false),
			effects: []map[string]any{{"resolution": "auto", "result": []map[string]any{
				levelFiveWorldZone("stinking_cloud", "sphere", 20, 10, true, map[string]any{
					"triggers": []string{"start_turn"}, "heavily_obscured": true,
					"save": map[string]any{"ability": "con", "dc": "spell_save_dc"},
					"on_failure": []map[string]any{
						{"kind": "grant_effect", "value": "COND-poisoned", "duration": map[string]any{"type": "rounds", "amount": 1}},
						{"kind": "grant_effect", "value": "EFFECT-stinking-cloud-retching", "duration": map[string]any{"type": "rounds", "amount": 1}},
					},
					"on_success": []any{},
				}),
			}}},
		},
		{
			cardNumber: "SPELL-0196",
			effects: []map[string]any{{
				"resolution": "attack_roll", "attack_kind": "spell_melee", "ability": "spellcasting", "vs": "ac",
				"on_hit": []map[string]any{{
					"kind": "damage", "dice": "1d8 + spellcasting", "type": "force",
					"scaling": map[string]any{"per": "spell_slot_above", "dice": "1d8"},
				}},
			}},
		},
		{
			cardNumber: "SPELL-0307",
			effects: []map[string]any{{"resolution": "auto", "who": "target", "result": []map[string]any{{
				"kind":        "narrative",
				"description": "Выберите Увеличение или Уменьшение. Изменение размера и связанные модификаторы требуют ручного разрешения; автоматический урон при сотворении не наносится.",
			}}}},
		},
		{
			cardNumber: "spirit_guardians",
			effects: []map[string]any{{"resolution": "auto", "result": []map[string]any{{
				"kind":        "narrative",
				"description": "Подвижная 15-футовая Эманация следует за заклинателем. Автоматизация перемещения Эманации, исключённых целей, снижения Скорости и повторных спасбросков ещё не поддерживается; сотворение не наносит урон заклинателю.",
			}}}},
		},
		{
			cardNumber: "feign_death",
			effects: []map[string]any{{"resolution": "auto", "who": "target", "result": []map[string]any{
				{"kind": "grant_effect", "value": "COND-blinded", "duration": map[string]any{"type": "rounds", "amount": 600}},
				{"kind": "grant_effect", "value": "COND-incapacitated", "duration": map[string]any{"type": "rounds", "amount": 600}},
				{"kind": "grant_effect", "value": "EFFECT-feign-death-stasis", "duration": map[string]any{"type": "rounds", "amount": 600}},
			}}},
		},
		{
			cardNumber: "hypnotic_pattern",
			effects: []map[string]any{{
				"resolution": "save", "who": "target", "ability": "wis", "dc": "8 + prof + spellcasting",
				"on_fail": []map[string]any{
					{"kind": "grant_effect", "value": "COND-charmed", "duration": map[string]any{"type": "rounds", "amount": 10, "concentration": true}},
					{"kind": "grant_effect", "value": "COND-incapacitated", "duration": map[string]any{"type": "rounds", "amount": 10, "concentration": true}},
					{"kind": "grant_effect", "value": "EFFECT-hypnotic-pattern-stupor", "duration": map[string]any{"type": "rounds", "amount": 10, "concentration": true}},
					{"kind": "narrative", "description": "Оцепенение заканчивается раньше, если цель получает урон или другое существо действием выводит её из оцепенения."},
				},
				"on_success": []any{},
			}},
		},
		{
			cardNumber: "fear",
			effects: []map[string]any{{
				"resolution": "save", "who": "target", "ability": "wis", "dc": "8 + prof + spellcasting",
				"on_fail": []map[string]any{
					{"kind": "grant_effect", "value": "COND-frightened", "duration": map[string]any{"type": "rounds", "amount": 10, "concentration": true}},
					{"kind": "narrative", "description": "Цель роняет удерживаемые предметы и должна совершать Рывок прочь; повторный спасбросок вне линии обзора разрешается вручную."},
				},
				"on_success": []any{},
			}},
		},
	}
}

func repairLevelFiveSpellIntegrity(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
	`); err != nil {
		return fmt.Errorf("unlock level-2/3 spell targeting repairs: %w", err)
	}

	for _, repair := range levelFiveSpellTargetingIntegrityRepairs() {
		var raw []byte
		if queryErr := tx.QueryRow(`SELECT mechanics FROM spells
			WHERE card_number=$1 AND deleted_at IS NULL`, repair.cardNumber).Scan(&raw); queryErr != nil {
			return fmt.Errorf("load mechanics for %s: %w", repair.cardNumber, queryErr)
		}
		mechanics := map[string]any{}
		if len(raw) > 0 {
			if decodeErr := json.Unmarshal(raw, &mechanics); decodeErr != nil {
				return fmt.Errorf("decode mechanics for %s: %w", repair.cardNumber, decodeErr)
			}
		}
		mechanics["targeting"] = repair.targeting
		normalizeLevelFiveTargetRouting(mechanics)
		encoded, marshalErr := json.Marshal(mechanics)
		if marshalErr != nil {
			return fmt.Errorf("encode targeting repair %s: %w", repair.cardNumber, marshalErr)
		}
		result, execErr := tx.Exec(`UPDATE spells SET
			mechanics=$2::jsonb,
			area=CASE WHEN $3::text='' THEN area ELSE $3::text END,
			updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL`, repair.cardNumber, string(encoded), repair.areaLabel)
		if execErr != nil {
			return fmt.Errorf("repair targeting for %s: %w", repair.cardNumber, execErr)
		}
		if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
			return fmt.Errorf("repair targeting for %s affected %d rows: %w", repair.cardNumber, rows, rowsErr)
		}
	}
	for _, repair := range levelFiveSpellMechanicsIntegrityRepairs() {
		encoded, marshalErr := json.Marshal(repair.effects)
		if marshalErr != nil {
			return fmt.Errorf("encode mechanics integrity repair %s: %w", repair.cardNumber, marshalErr)
		}
		result, execErr := tx.Exec(`UPDATE spells SET
			mechanics=jsonb_set(COALESCE(mechanics,'{}'::jsonb),'{effects}',$2::jsonb,true),
			area=CASE WHEN $3::text='' THEN area ELSE $3::text END,
			updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL`, repair.cardNumber, string(encoded), repair.areaLabel)
		if execErr != nil {
			return fmt.Errorf("repair mechanics for %s: %w", repair.cardNumber, execErr)
		}
		if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
			return fmt.Errorf("repair mechanics for %s affected %d rows: %w", repair.cardNumber, rows, rowsErr)
		}
		if repair.targeting != nil {
			targeting, targetErr := json.Marshal(repair.targeting)
			if targetErr != nil {
				return fmt.Errorf("encode mechanics targeting %s: %w", repair.cardNumber, targetErr)
			}
			if _, execErr = tx.Exec(`UPDATE spells SET mechanics=jsonb_set(
				mechanics,'{targeting}',$2::jsonb,true) WHERE card_number=$1 AND deleted_at IS NULL`,
				repair.cardNumber, string(targeting)); execErr != nil {
				return fmt.Errorf("repair mechanics targeting for %s: %w", repair.cardNumber, execErr)
			}
		}
	}

	for _, effect := range levelFiveSpellIntegrityEffects() {
		encoded, marshalErr := json.Marshal(effect.mechanics)
		if marshalErr != nil {
			return fmt.Errorf("encode spell integrity effect %s: %w", effect.cardNumber, marshalErr)
		}
		if _, execErr := tx.Exec(`INSERT INTO effects (
			id,name,description,detailed_description,rarity,card_number,effect_type,
			mechanics,repeatable,author,source,support
		) VALUES ($1::uuid,$2,$3,$3,'common',$4,'spell_effect',$5::jsonb,false,
			'System','SRD 5.2.1',jsonb_build_object(
				'status','untested','certification_version',$6::text,
				'mechanics_locked',false,'note','Level-2/3 spell effect; browser verification pending.'))
			ON CONFLICT (card_number) DO UPDATE SET deleted_at=NULL,name=EXCLUDED.name,
			description=EXCLUDED.description,detailed_description=EXCLUDED.detailed_description,
			effect_type=EXCLUDED.effect_type,mechanics=EXCLUDED.mechanics,
			support=EXCLUDED.support,updated_at=NOW()`, effect.id, effect.name,
			effect.description, effect.cardNumber, string(encoded), levelFiveSpellIntegrityVersion); execErr != nil {
			return fmt.Errorf("upsert spell integrity effect %s: %w", effect.cardNumber, execErr)
		}
	}

	// The invalidation trigger clears support whenever mechanics changes. Stamp
	// the honest state afterwards in a metadata-only statement.
	cards := make([]string, 0, len(levelFiveSpellTargetingIntegrityRepairs())+len(levelFiveSpellMechanicsIntegrityRepairs()))
	seenCards := map[string]bool{}
	for _, repair := range levelFiveSpellTargetingIntegrityRepairs() {
		if !seenCards[repair.cardNumber] {
			cards = append(cards, repair.cardNumber)
			seenCards[repair.cardNumber] = true
		}
	}
	for _, repair := range levelFiveSpellMechanicsIntegrityRepairs() {
		if !seenCards[repair.cardNumber] {
			cards = append(cards, repair.cardNumber)
			seenCards[repair.cardNumber] = true
		}
	}
	result, err := tx.Exec(`UPDATE spells SET
		support=jsonb_build_object(
			'status','untested','certification_version',$2::text,
			'mechanics_locked',false,
			'note','Strict targeting and tactical geometry repaired; browser verification pending.'),
		updated_at=NOW()
		WHERE card_number=ANY($1::text[]) AND deleted_at IS NULL`, cards, levelFiveSpellIntegrityVersion)
	if err != nil {
		return fmt.Errorf("stamp level-2/3 spell targeting support: %w", err)
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != int64(len(cards)) {
		return fmt.Errorf("stamp level-2/3 spell targeting support affected %d rows: %w", rows, rowsErr)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
