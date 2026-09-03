package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

const levelFiveSpellsMigrationVersion = "166_materialize_level_five_spells"
const expectedLevelFivePHBSpells = 115
const expectedLevelFiveRuntimeEffects = 27

// The two excluded rows are user-authored homebrew. Everything else at spell
// levels 2 and 3 is the imported PHB 2024 catalog used by the mini-MVP.
const levelFivePHBSpellPredicate = `level IN (2,3)
	AND card_number NOT IN ('SPELL-0483','SPELL-0485')`

type levelFiveSpellRow struct {
	id, cardNumber, name, nameEn, description, imageURL string
	level                                               int
	mechanics                                           map[string]any
}

type levelFiveSpellPatch struct {
	cardNumber string
	areaLabel  string
	targeting  map[string]any
	effects    []map[string]any
}

type levelFiveTargetingPatch struct {
	cardNumber string
	areaLabel  string
	targeting  map[string]any
}

func levelFiveSelfTargeting() map[string]any {
	return map[string]any{
		"domain": "actor", "actor_targets": false, "shape": "self",
		"min_targets": 0, "max_targets": 1, "range_ft": 0,
		"requires_line_of_sight": false, "allowed_relations": []string{"self"},
	}
}

func levelFiveSingleTargeting(rangeFt int, maxTargets int, relations ...string) map[string]any {
	return map[string]any{
		"domain": "actor", "actor_targets": true, "shape": "single",
		"min_targets": 1, "max_targets": maxTargets, "range_ft": rangeFt,
		"requires_line_of_sight": true, "allowed_relations": relations,
	}
}

func levelFiveSingleTargetingWithoutSight(rangeFt int, maxTargets int, relations ...string) map[string]any {
	result := levelFiveSingleTargeting(rangeFt, maxTargets, relations...)
	result["requires_line_of_sight"] = false
	return result
}

func levelFiveWorldTargeting(rangeFt int, requiresLineOfSight bool) map[string]any {
	return map[string]any{
		"domain": "world", "actor_targets": false, "shape": "single",
		"min_targets": 0, "max_targets": 0, "range_ft": rangeFt,
		"requires_line_of_sight": requiresLineOfSight, "allowed_relations": []string{},
	}
}

func levelFiveAreaTargeting(shape string, sizeFt, rangeFt int, actorTargets bool) map[string]any {
	geometry := map[string]any{"kind": shape, "size_ft": sizeFt}
	if shape == "sphere" || shape == "cylinder" || shape == "emanation" {
		geometry = map[string]any{"kind": shape, "radius_ft": sizeFt}
	}
	maximum := 0
	relations := []string{}
	if actorTargets {
		maximum = 8
		relations = []string{"self", "ally", "enemy", "neutral"}
	}
	return map[string]any{
		"domain":        map[bool]string{true: "actor", false: "world"}[actorTargets],
		"actor_targets": actorTargets, "shape": "area",
		"min_targets": map[bool]int{true: 1, false: 0}[actorTargets],
		"max_targets": maximum, "range_ft": rangeFt,
		"requires_line_of_sight": true, "allowed_relations": relations,
		"area": geometry,
	}
}

func levelFiveWorldZone(zoneType, shape string, sizeFt int, rounds int, concentration bool, tactical map[string]any) map[string]any {
	duration := map[string]any{"type": "rounds", "amount": rounds}
	if concentration {
		duration["concentration"] = true
	}
	return map[string]any{
		"kind": "world_zone", "zone_type": zoneType,
		"geometry": map[string]any{"shape": shape, "size_ft": sizeFt},
		"duration": duration, "tactical": tactical,
	}
}

func levelFiveDamage(dice, damageType string) map[string]any {
	return map[string]any{"kind": "damage", "dice": dice, "type": damageType}
}

func levelFiveHalfDamage(dice, damageType string) map[string]any {
	result := levelFiveDamage(dice, damageType)
	result["on_success"] = "half"
	return result
}

// Condition application is a catalog edge, never an inline state mutation.
// Keeping this normalization at the level-2/3 import boundary means restored
// databases and fresh installs both resolve the same COND-* effect cards.
func rewriteLevelFiveConditionReferences(value any) (any, int, error) {
	switch typed := value.(type) {
	case []any:
		result := make([]any, len(typed))
		changed := 0
		for index, item := range typed {
			rewritten, nested, err := rewriteLevelFiveConditionReferences(item)
			if err != nil {
				return nil, changed, err
			}
			result[index] = rewritten
			changed += nested
		}
		return result, changed, nil
	case []map[string]any:
		result := make([]map[string]any, len(typed))
		changed := 0
		for index, item := range typed {
			rewritten, nested, err := rewriteLevelFiveConditionReferences(item)
			if err != nil {
				return nil, changed, err
			}
			result[index] = rewritten.(map[string]any)
			changed += nested
		}
		return result, changed, nil
	case map[string]any:
		if typed["kind"] == "condition" {
			condition, _ := typed["value"].(string)
			condition = strings.TrimSpace(condition)
			if condition == "" {
				return nil, 0, fmt.Errorf("generic condition payload has no condition id")
			}
			card := condition
			if !strings.HasPrefix(card, "COND-") {
				card = "COND-" + card
			}
			result := make(map[string]any, len(typed)+1)
			for key, nested := range typed {
				if key != "kind" && key != "op" && key != "value" {
					result[key] = nested
				}
			}
			if typed["op"] == "remove" {
				result["kind"] = "remove_effect"
				result["card_number"] = card
			} else {
				result["kind"] = "grant_effect"
				result["value"] = card
			}
			return result, 1, nil
		}
		result := make(map[string]any, len(typed))
		changed := 0
		for key, nested := range typed {
			if key == "inside_condition" {
				condition, ok := nested.(string)
				condition = strings.TrimSpace(condition)
				if !ok || condition == "" {
					return nil, changed, fmt.Errorf("inside_condition has no condition id")
				}
				if !strings.HasPrefix(condition, "COND-") {
					condition = "COND-" + condition
				}
				result["inside_effect"] = map[string]any{"kind": "grant_effect", "value": condition}
				changed++
				continue
			}
			rewritten, nestedChanged, err := rewriteLevelFiveConditionReferences(nested)
			if err != nil {
				return nil, changed, err
			}
			result[key] = rewritten
			changed += nestedChanged
		}
		return result, changed, nil
	default:
		return value, 0, nil
	}
}

func levelFiveInsideCondition(cardNumber string) map[string]any {
	return map[string]any{
		"kind": "grant_effect", "value": cardNumber,
	}
}

// These are stationary tactical footprints that the combat board can execute
// today. Mobile emanations and movable summons remain descriptive rather than
// being frozen to the caster's original square.
func levelFiveSpellAreaPatches() []levelFiveSpellPatch {
	return []levelFiveSpellPatch{
		{
			cardNumber: "SPELL-0234", areaLabel: "Куб 5×5 футов",
			targeting: levelFiveAreaTargeting("cube", 5, 60, false),
			effects: []map[string]any{{"resolution": "auto", "result": []map[string]any{
				levelFiveWorldZone("cloud_of_daggers", "cube", 5, 10, true, map[string]any{
					"triggers":     []string{"created", "enter", "end_turn"},
					"auto_effects": []map[string]any{levelFiveDamage("4d4", "slashing")},
				}),
			}}},
		},
		{
			cardNumber: "SPELL-0266", areaLabel: "Сфера радиусом 20 футов",
			targeting: levelFiveAreaTargeting("sphere", 20, 150, false),
			effects: []map[string]any{{"resolution": "auto", "result": []map[string]any{
				levelFiveWorldZone("spike_growth", "sphere", 20, 100, true, map[string]any{
					"triggers": []string{"move"}, "difficult_terrain": true,
					"auto_effects": []map[string]any{levelFiveDamage("2d4", "piercing")},
				}),
			}}},
		},
		{
			cardNumber: "SPELL-0257", areaLabel: "Куб 20×20 футов",
			targeting: levelFiveAreaTargeting("cube", 20, 60, false),
			effects: []map[string]any{{"resolution": "auto", "result": []map[string]any{
				levelFiveWorldZone("web", "cube", 20, 600, true, map[string]any{
					"triggers": []string{"enter", "start_turn"}, "difficult_terrain": true,
					"lightly_obscured": true,
					"save":             map[string]any{"ability": "dex", "dc": "spell_save_dc"},
					"on_failure":       []map[string]any{{"kind": "grant_effect", "value": "COND-restrained", "area_linked": true}},
					"on_success":       []any{},
				}),
			}}},
		},
		{
			cardNumber: "SPELL-0215", areaLabel: "Цилиндр радиусом 5 футов, высотой 40 футов",
			// The board is two-dimensional, so the cylinder's exact footprint is
			// represented by its five-foot-radius circle.
			targeting: levelFiveAreaTargeting("sphere", 5, 120, false),
			effects: []map[string]any{{"resolution": "auto", "result": []map[string]any{
				levelFiveWorldZone("moonbeam", "cylinder", 5, 10, true, map[string]any{
					"triggers":   []string{"created", "enter", "end_turn"},
					"save":       map[string]any{"ability": "con", "dc": "spell_save_dc"},
					"on_failure": []map[string]any{levelFiveDamage("2d10", "radiant"), {"kind": "remove_effect", "card_number": "COND-polymorphed"}},
					"on_success": []map[string]any{levelFiveHalfDamage("2d10", "radiant")},
				}),
			}}},
		},
		{
			cardNumber: "darkness", areaLabel: "Сфера радиусом 15 футов",
			targeting: levelFiveAreaTargeting("sphere", 15, 60, false),
			effects: []map[string]any{{"resolution": "auto", "result": []map[string]any{
				levelFiveWorldZone("darkness", "sphere", 15, 100, true, map[string]any{
					"heavily_obscured": true, "inside_effect": levelFiveInsideCondition("COND-blinded"),
				}),
			}}},
		},
		{
			cardNumber: "SPELL-0301", areaLabel: "Сфера радиусом 20 футов",
			targeting: levelFiveAreaTargeting("sphere", 20, 120, false),
			effects: []map[string]any{{"resolution": "auto", "result": []map[string]any{
				levelFiveWorldZone("silence", "sphere", 20, 100, true, map[string]any{
					"inside_effect": levelFiveInsideCondition("COND-deafened"), "blocks_verbal_components": true,
					"damage_immunities": []string{"thunder"},
				}),
			}}},
		},
		{
			cardNumber: "SPELL-0276", areaLabel: "Сфера радиусом 5 футов",
			targeting: levelFiveAreaTargeting("sphere", 5, 60, false),
			effects: []map[string]any{{"resolution": "auto", "result": []map[string]any{
				levelFiveWorldZone("flaming_sphere", "sphere", 5, 10, true, map[string]any{
					"triggers":   []string{"end_turn"},
					"save":       map[string]any{"ability": "dex", "dc": "spell_save_dc"},
					"on_failure": []map[string]any{levelFiveDamage("2d6", "fire")},
					"on_success": []map[string]any{levelFiveHalfDamage("2d6", "fire")},
				}),
			}}},
		},
		{
			cardNumber: "hunger_of_hadar", areaLabel: "Сфера радиусом 20 футов",
			targeting: levelFiveAreaTargeting("sphere", 20, 150, false),
			effects: []map[string]any{{"resolution": "auto", "result": []map[string]any{
				levelFiveWorldZone("hunger_of_hadar", "sphere", 20, 10, true, map[string]any{
					"triggers": []string{"start_turn"}, "difficult_terrain": true,
					"heavily_obscured": true, "inside_effect": levelFiveInsideCondition("COND-blinded"),
					"auto_effects": []map[string]any{levelFiveDamage("2d6", "cold")},
					// Retained as data for the end-turn continuation; the current
					// board executes the no-save start-turn damage immediately.
					"end_turn_save": map[string]any{
						"ability": "dex", "dc": "spell_save_dc",
						"on_failure": []map[string]any{levelFiveDamage("2d6", "acid")},
						"on_success": []any{},
					},
				}),
			}}},
		},
		{
			cardNumber: "sleet_storm", areaLabel: "Цилиндр радиусом 20 футов, высотой 40 футов",
			targeting: levelFiveAreaTargeting("sphere", 20, 150, false),
			effects: []map[string]any{{"resolution": "auto", "result": []map[string]any{
				levelFiveWorldZone("sleet_storm", "cylinder", 20, 10, true, map[string]any{
					"triggers": []string{"enter", "start_turn"}, "difficult_terrain": true,
					"heavily_obscured": true,
					"save":             map[string]any{"ability": "dex", "dc": "spell_save_dc"},
					"on_failure":       []map[string]any{{"kind": "grant_effect", "value": "COND-prone"}},
					"on_success":       []any{},
				}),
			}}},
		},
		{
			cardNumber: "stinking_cloud", areaLabel: "Сфера радиусом 20 футов",
			targeting: levelFiveAreaTargeting("sphere", 20, 90, false),
			effects: []map[string]any{{"resolution": "auto", "result": []map[string]any{
				levelFiveWorldZone("stinking_cloud", "sphere", 20, 10, true, map[string]any{
					"triggers": []string{"start_turn"}, "heavily_obscured": true,
					"save": map[string]any{"ability": "con", "dc": "spell_save_dc"},
					"on_failure": []map[string]any{{
						"kind": "grant_effect", "value": "COND-poisoned",
						"duration": map[string]any{"type": "rounds", "amount": 1},
					}},
					"on_success": []any{},
				}),
			}}},
		},
	}
}

// Instant areas and multi-target spells still need exact geometry even though
// they don't create a persistent world-zone entity.
func levelFiveSpellTargetingPatches() []levelFiveTargetingPatch {
	return []levelFiveTargetingPatch{
		{"pass_without_trace", "Эманация 30 футов", levelFiveAreaTargeting("emanation", 30, 30, true)},
		{"SPELL-0195", "", levelFiveSingleTargeting(5, 1, "self", "ally")},
		{"SPELL-0219", "", levelFiveSingleTargeting(5, 1, "self", "ally")},
		{"SPELL-0231", "", levelFiveSingleTargeting(5, 1, "self", "ally")},
		{"SPELL-0250", "", levelFiveSingleTargeting(5, 1, "ally")},
		{"SPELL-0258", "", levelFiveSingleTargeting(5, 1, "self", "ally")},
		{"SPELL-0282", "Эманация 60 футов", levelFiveAreaTargeting("emanation", 60, 60, true)},
		{"SPELL-0289", "", levelFiveSingleTargeting(5, 1, "enemy", "neutral")},
		{"SPELL-0293", "", levelFiveSelfTargeting()},
		{"SPELL-0299", "", levelFiveSingleTargeting(5, 1, "self", "ally")},
		{"SPELL-0307", "", levelFiveSingleTargeting(30, 1, "self", "ally", "enemy", "neutral")},
		{"SPELL-0309", "", levelFiveSingleTargeting(5, 1, "self", "ally")},
		{"SPELL-0191", "Сфера радиусом 10 футов", levelFiveAreaTargeting("sphere", 10, 60, true)},
		{"SPELL-0197", "", levelFiveSingleTargeting(5, 1, "self", "ally")},
		{"SPELL-0255", "", levelFiveSingleTargeting(120, 3, "enemy", "neutral")},
		{"SPELL-0310", "Сфера радиусом 20 футов", levelFiveAreaTargeting("sphere", 20, 60, true)},
		{"beacon_of_hope", "Эманация 30 футов", levelFiveAreaTargeting("emanation", 30, 30, true)},
		{"bestow_curse", "", levelFiveSingleTargeting(5, 1, "enemy", "neutral")},
		{"elemental_weapon", "", levelFiveSingleTargeting(5, 1, "self", "ally")},
		{"fly", "", levelFiveSingleTargeting(5, 1, "self", "ally")},
		{"gaseous_form", "", levelFiveSingleTargeting(5, 1, "self", "ally")},
		{"haste", "", levelFiveSingleTargeting(30, 1, "self", "ally")},
		{"protection_from_energy", "", levelFiveSingleTargeting(5, 1, "self", "ally")},
		{"tongues", "", levelFiveSingleTargeting(5, 1, "self", "ally", "enemy", "neutral")},
		{"water_breathing", "", levelFiveSingleTargeting(30, 10, "self", "ally")},
		{"water_walk", "", levelFiveSingleTargeting(30, 10, "self", "ally")},
		{"conjure_barrage", "Конус 60 футов", levelFiveAreaTargeting("cone", 60, 60, true)},
		{"fear", "Конус 30 футов", levelFiveAreaTargeting("cone", 30, 30, true)},
		{"fireball", "Сфера радиусом 20 футов", levelFiveAreaTargeting("sphere", 20, 150, true)},
		{"hypnotic_pattern", "Куб 30×30 футов", levelFiveAreaTargeting("cube", 30, 120, true)},
		{"lightning_bolt", "Линия 100×5 футов", levelFiveAreaTargeting("line", 100, 100, true)},
		{"mass_healing_word", "", levelFiveSingleTargeting(60, 6, "self", "ally")},
		{"slow", "Куб 40×40 футов; до 6 существ", func() map[string]any {
			targeting := levelFiveAreaTargeting("cube", 40, 120, true)
			targeting["max_targets"] = 6
			return targeting
		}()},
	}
}

// Imported active spell rows without a targeting object cannot enter the
// sheet/combat compiler. These declarations cover only target selection; they
// do not pretend that narrative world/summon mechanics are fully automated.
func levelFiveMissingTargetingPatches() []levelFiveTargetingPatch {
	return []levelFiveTargetingPatch{
		{"SPELL-0168", "", levelFiveWorldTargeting(5, true)},
		{"SPELL-0169", "", levelFiveSelfTargeting()},
		{"SPELL-0172", "", levelFiveSingleTargeting(5, 1, "self", "ally", "neutral")},
		{"SPELL-0175", "", levelFiveWorldTargeting(30, true)},
		{"SPELL-0180", "", levelFiveSelfTargeting()},
		{"SPELL-0233", "", levelFiveWorldTargeting(5, true)},
		{"SPELL-0248", "", levelFiveWorldTargeting(60, true)},
		{"SPELL-0262", "", levelFiveSelfTargeting()},
		{"SPELL-0263", "", levelFiveSelfTargeting()},
		{"SPELL-0302", "", levelFiveWorldTargeting(5, true)},
		{"misty_step", "", levelFiveSelfTargeting()},
		{"animate_dead", "", levelFiveWorldTargeting(10, true)},
		{"aura_of_vitality", "Эманация 30 футов", levelFiveSelfTargeting()},
		{"blink", "", levelFiveSelfTargeting()},
		{"clairvoyance", "", levelFiveWorldTargeting(5280, false)},
		{"create_food_and_water", "", levelFiveWorldTargeting(30, true)},
		{"crusaders_mantle", "Эманация 30 футов", levelFiveSelfTargeting()},
		{"daylight", "Сфера радиусом 60 футов", levelFiveWorldTargeting(60, true)},
		{"glyph_of_warding", "Сфера радиусом 20 футов (взрывная руна)", levelFiveWorldTargeting(5, true)},
		{"leomunds_tiny_hut", "Эманация 10 футов", levelFiveSelfTargeting()},
		{"lightning_arrow", "", levelFiveSelfTargeting()},
		{"magic_circle", "Цилиндр радиусом 10 футов, высотой 20 футов", levelFiveWorldTargeting(10, true)},
		{"major_image", "Куб 20×20 футов", levelFiveWorldTargeting(120, true)},
		{"meld_into_stone", "", levelFiveSelfTargeting()},
		{"nondetection", "", levelFiveSingleTargeting(5, 1, "self", "ally", "neutral")},
		{"phantom_steed", "", levelFiveWorldTargeting(30, true)},
		{"remove_curse", "", levelFiveSingleTargeting(5, 1, "self", "ally", "enemy", "neutral")},
		{"revivify", "", levelFiveSingleTargeting(5, 1, "ally", "neutral")},
		// The compiler requires a finite distance. This board-scale upper bound
		// preserves Sending's no-line-of-sight selection without parsing the
		// localized "Unlimited" display string.
		{"sending", "", levelFiveSingleTargetingWithoutSight(2_147_483_647, 1, "self", "ally", "enemy", "neutral")},
		{"speak_with_dead", "", levelFiveWorldTargeting(10, true)},
		{"spirit_guardians", "Эманация 15 футов", levelFiveSelfTargeting()},
		{"summon_fey", "", levelFiveWorldTargeting(90, true)},
		{"summon_undead", "", levelFiveWorldTargeting(90, true)},
	}
}

func levelFiveLegacyAreaTargetingPatches() []levelFiveTargetingPatch {
	zoneOfTruth := levelFiveAreaTargeting("sphere", 15, 60, true)
	findSteed := levelFiveWorldTargeting(30, true)
	gustOfWind := levelFiveAreaTargeting("line", 60, 60, true)
	gustOfWind["requires_line_of_sight"] = false
	gustOfWind["area"].(map[string]any)["width_ft"] = 10
	return []levelFiveTargetingPatch{
		{"SPELL-0235", "Сфера радиусом 15 футов", zoneOfTruth},
		{"SPELL-0240", "", findSteed},
		{"SPELL-0268", "Линия 60×10 футов", gustOfWind},
	}
}

func levelFiveProtectionFromPoisonPatch() levelFiveSpellPatch {
	duration := map[string]any{"type": "hours", "amount": 1}
	return levelFiveSpellPatch{
		cardNumber: "SPELL-0203",
		targeting:  levelFiveSingleTargeting(5, 1, "self", "ally"),
		effects: []map[string]any{{"resolution": "auto", "who": "target", "result": []map[string]any{
			{"kind": "remove_effect", "card_number": "COND-poisoned"},
			{
				"kind": "modifier", "op": "advantage",
				"applies_to": map[string]any{"roll": "saving_throw", "filter": map[string]any{"condition": "poisoned"}},
				"duration":   duration,
			},
			{"kind": "resistance", "damage_type": "poison", "value": "resistance", "duration": duration},
		}}},
	}
}

func levelFiveWardingBondPatch() levelFiveSpellPatch {
	duration := map[string]any{"type": "hours", "amount": 1}
	return levelFiveSpellPatch{
		cardNumber: "SPELL-0250",
		targeting:  levelFiveSingleTargeting(5, 1, "ally"),
		effects: []map[string]any{{"resolution": "auto", "who": "target", "result": []map[string]any{
			{"kind": "modifier", "op": "add", "value": "+1", "applies_to": map[string]any{"roll": "ac"}, "duration": duration},
			{"kind": "modifier", "op": "add", "value": "+1", "applies_to": map[string]any{"roll": "saving_throw"}, "duration": duration},
			{"kind": "resistance", "damage_type": "all", "value": "resistance", "duration": duration},
			{"kind": "narrative", "description": "Каждый раз, когда цель получает урон, заклинатель получает такое же количество урона."},
		}}},
	}
}

func levelFiveBlindnessDeafnessPatch() levelFiveSpellPatch {
	choice := map[string]any{
		"kind": "choice", "id": "blindness_or_deafness", "count": 1,
		"context": "in_play", "prompt": "Выберите Слепоту или Глухоту",
		"options": map[string]any{"source": "explicit", "items": []map[string]any{
			{"id": "blindness", "name": "Слепота", "grants": []map[string]any{{
				"kind": "grant_effect", "value": "COND-blinded",
				"duration": map[string]any{"type": "rounds", "amount": 10},
			}}},
			{"id": "deafness", "name": "Глухота", "grants": []map[string]any{{
				"kind": "grant_effect", "value": "COND-deafened",
				"duration": map[string]any{"type": "rounds", "amount": 10},
			}}},
		}},
	}
	return levelFiveSpellPatch{
		cardNumber: "SPELL-0182",
		targeting:  levelFiveSingleTargeting(120, 1, "enemy", "neutral"),
		effects: []map[string]any{{
			"resolution": "save", "who": "target", "ability": "con", "dc": "8 + prof + spellcasting",
			"on_fail": []map[string]any{choice},
			"on_success": []map[string]any{{
				"kind": "narrative", "description": "Цель успешно проходит спасбросок Телосложения.",
			}},
		}},
	}
}

func normalizeLevelFiveSpellMechanics(mechanics map[string]any, level int) map[string]any {
	if mechanics == nil {
		mechanics = map[string]any{}
	}
	delete(mechanics, "uses")
	activation, _ := mechanics["activation"].(map[string]any)
	if activation == nil {
		activation = map[string]any{}
	}
	activation["mode"] = "active"

	var rawCosts []any
	switch value := activation["cost"].(type) {
	case []any:
		rawCosts = value
	case map[string]any:
		rawCosts = []any{value}
	}
	costs := make([]any, 0, len(rawCosts)+1)
	for _, raw := range rawCosts {
		cost, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		resource, _ := cost["resource"].(string)
		if resource == "spell_slot" || strings.HasPrefix(resource, "spell_slot_") {
			continue
		}
		costs = append(costs, cost)
	}
	costs = append(costs, map[string]any{"resource": "spell_slot", "level": level, "amount": 1})
	activation["cost"] = costs
	mechanics["activation"] = activation
	normalizeLevelFiveHalfDamageBranches(mechanics)
	rewritten, _, err := rewriteLevelFiveConditionReferences(mechanics)
	if err != nil {
		// The caller owns the catalog identity and reports it with any marshal or
		// database error. Imported JSON without an id is left for the migration's
		// fail-closed postcondition rather than being guessed here.
		return mechanics
	}
	mechanics = rewritten.(map[string]any)
	return mechanics
}

// The executor routes auto interactions to self unless the interaction says
// who:"target". Once a spell declares actor_targets:true, leaving that field
// implicit makes the target picker cosmetic: healing, buffs, and durable
// grants land on the caster. Preserve explicit routing and materialize the
// missing target route for the imported actor-target spell rows.
func normalizeLevelFiveTargetRouting(mechanics map[string]any) bool {
	targeting, _ := mechanics["targeting"].(map[string]any)
	if targeting == nil || targeting["actor_targets"] != true {
		return false
	}
	effects, _ := mechanics["effects"].([]any)
	changed := false
	for _, raw := range effects {
		interaction, ok := raw.(map[string]any)
		if !ok || interaction["resolution"] != "auto" || interaction["who"] != nil {
			continue
		}
		interaction["who"] = "target"
		changed = true
	}
	return changed
}

// Older imported rows put on_success:"half" on the failed-save damage but
// left the successful branch empty. The executor intentionally reads only the
// selected branch, so those spells dealt zero damage on a successful save.
// Copying the marked damage payload into on_success makes the existing marker
// executable without changing the failure payload or its scaling metadata.
func normalizeLevelFiveHalfDamageBranches(value any) {
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			normalizeLevelFiveHalfDamageBranches(item)
		}
	case []map[string]any:
		for _, item := range typed {
			normalizeLevelFiveHalfDamageBranches(item)
		}
	case map[string]any:
		if typed["resolution"] == "save" {
			failures, _ := typed["on_fail"].([]any)
			if failures == nil {
				if mapped, ok := typed["on_fail"].([]map[string]any); ok {
					failures = make([]any, len(mapped))
					for index := range mapped {
						failures[index] = mapped[index]
					}
				}
			}
			successes, successExists := typed["on_success"].([]any)
			if mapped, ok := typed["on_success"].([]map[string]any); ok {
				successExists = true
				successes = make([]any, len(mapped))
				for index := range mapped {
					successes[index] = mapped[index]
				}
			}
			if !successExists || len(successes) == 0 {
				var half []any
				for _, raw := range failures {
					payload, ok := raw.(map[string]any)
					if !ok || payload["kind"] != "damage" || payload["on_success"] != "half" {
						continue
					}
					clone := make(map[string]any, len(payload))
					for key, nested := range payload {
						clone[key] = nested
					}
					half = append(half, clone)
				}
				if len(half) > 0 {
					typed["on_success"] = half
				}
			}
		}
		for _, nested := range typed {
			normalizeLevelFiveHalfDamageBranches(nested)
		}
	}
}

func levelFiveDurableDuration(cardNumber string) map[string]any {
	type duration struct {
		rounds        int
		concentration bool
	}
	rows := map[string]duration{
		"pass_without_trace": {600, true}, "ray_of_enfeeblement": {10, true},
		"SPELL-0170": {4800, true}, "SPELL-0177": {10, true}, "SPELL-0184": {100, true},
		"SPELL-0195": {600, false}, "SPELL-0196": {10, true}, "SPELL-0197": {10, true},
		"SPELL-0198": {600, true}, "SPELL-0203": {600, false}, "SPELL-0209": {10, true},
		"SPELL-0210": {100, true}, "SPELL-0219": {600, false}, "SPELL-0231": {600, true},
		"SPELL-0235": {100, false}, "SPELL-0250": {600, false}, "SPELL-0258": {600, true},
		"SPELL-0279": {10, true}, "SPELL-0282": {10, true}, "SPELL-0289": {10, true},
		"SPELL-0293": {600, true}, "SPELL-0299": {4800, false}, "SPELL-0307": {10, true},
		"SPELL-0309": {600, true}, "hold_person": {10, true},
		"beacon_of_hope": {10, true}, "bestow_curse": {10, true}, "blinding_smite": {10, false},
		"blink": {10, false}, "crusaders_mantle": {10, true}, "elemental_weapon": {600, true},
		"fear": {10, true}, "feign_death": {600, false}, "fly": {100, true},
		"gaseous_form": {100, true}, "haste": {10, true}, "hypnotic_pattern": {10, true},
		"magic_circle": {600, false}, "nondetection": {4800, false},
		"protection_from_energy": {600, true}, "slow": {10, true}, "tongues": {600, false},
		"water_breathing": {14400, false}, "water_walk": {600, false},
	}
	row, ok := rows[cardNumber]
	if !ok {
		return nil
	}
	result := map[string]any{"type": "rounds", "amount": row.rounds}
	if row.concentration {
		result["concentration"] = true
	}
	return result
}

func addLevelFiveDurations(value any, duration map[string]any) {
	if duration == nil {
		return
	}
	durableKinds := map[string]bool{
		"modifier": true, "set_value": true, "resistance": true,
		"grant_proficiency": true, "grant_speed": true, "grant_sense": true,
		"condition_immunity": true, "damage_rider": true, "movement_option": true,
		"movement": true, "communication_link": true, "targeting_ward": true,
	}
	switch typed := value.(type) {
	case []any:
		for _, nested := range typed {
			addLevelFiveDurations(nested, duration)
		}
	case []map[string]any:
		for _, nested := range typed {
			addLevelFiveDurations(nested, duration)
		}
	case map[string]any:
		kind, _ := typed["kind"].(string)
		if durableKinds[kind] && typed["duration"] == nil {
			clone := make(map[string]any, len(duration))
			for key, nested := range duration {
				clone[key] = nested
			}
			typed["duration"] = clone
		}
		for _, nested := range typed {
			addLevelFiveDurations(nested, duration)
		}
	}
}

func rewriteLevelFiveDurablePayloads(value any, path string, targetContext bool, source runtimeEffectSource) (any, []materializedRuntimeEffect, bool) {
	switch typed := value.(type) {
	case []any:
		result := make([]any, len(typed))
		var effects []materializedRuntimeEffect
		changed := false
		for index, item := range typed {
			rewritten, nested, itemChanged := rewriteLevelFiveDurablePayloads(item, fmt.Sprintf("%s[%d]", path, index), targetContext, source)
			result[index] = rewritten
			effects = append(effects, nested...)
			changed = changed || itemChanged
		}
		return result, effects, changed
	case map[string]any:
		kind, _ := typed["kind"].(string)
		if kind == "world_zone" {
			return typed, nil, false
		}
		nextTarget := targetContext || typed["who"] == "target" || strings.Contains(path, "on_hit") || strings.Contains(path, "on_fail") || strings.Contains(path, "on_success")
		_, hasDuration := typed["duration"].(map[string]any)
		if nextTarget && hasDuration && kind != "" && kind != "condition" && kind != "grant_effect" {
			effect := runtimeEffectFromPayload(source, path, typed)
			if strings.HasSuffix(effect.name, " — ") {
				summary := levelFiveDurableSummary(typed)
				effect.name = source.name + " — " + summary
				if source.nameEn != "" {
					effect.nameEn = source.nameEn + " — " + summary
				}
				effect.description = summary + ". Источник: " + source.name + "."
			}
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
			rewritten, nested, itemChanged := rewriteLevelFiveDurablePayloads(typed[key], path+"."+key, nextTarget, source)
			result[key] = rewritten
			effects = append(effects, nested...)
			changed = changed || itemChanged
		}
		return result, effects, changed
	default:
		return value, nil, false
	}
}

func levelFiveDurableSummary(payload map[string]any) string {
	switch payload["kind"] {
	case "set_value":
		return "Установленное значение: " + fmt.Sprint(payload["target"])
	case "resistance":
		return "Сопротивление урону: " + fmt.Sprint(payload["damage_type"])
	case "grant_proficiency":
		return "Дарованное владение: " + fmt.Sprint(payload["prof"])
	case "grant_speed":
		return "Скорость: " + fmt.Sprint(payload["mode"])
	case "grant_sense":
		return "Чувство: " + fmt.Sprint(payload["sense"])
	case "movement":
		return "Изменение скорости"
	case "damage":
		return "Отложенный урон"
	default:
		return "Длительный эффект"
	}
}

// Effect-library mechanics use the same canonical card envelope as every
// passive effect. Keep duration at the envelope for active-effect lifecycle
// and on the payload for schema/runtime semantics.
func canonicalLevelFiveRuntimeEffectMechanics(payload map[string]any) map[string]any {
	mechanics := map[string]any{
		"activation": map[string]any{"mode": "passive"},
		"effects": []any{map[string]any{
			"resolution": "auto",
			"result":     []any{payload},
		}},
	}
	if duration, ok := payload["duration"].(map[string]any); ok {
		mechanics["duration"] = duration
	}
	return mechanics
}

func loadLevelFivePHBSpells(tx *sql.Tx) ([]levelFiveSpellRow, error) {
	rows, err := tx.Query(`SELECT id::text,card_number,name,COALESCE(name_en,''),
		COALESCE(description,''),COALESCE(image_url,''),level,COALESCE(mechanics,'{}'::jsonb)
		FROM spells WHERE deleted_at IS NULL AND ` + levelFivePHBSpellPredicate + `
		ORDER BY level,card_number,id`)
	if err != nil {
		return nil, fmt.Errorf("load level-2/3 PHB spells: %w", err)
	}
	defer rows.Close()
	var result []levelFiveSpellRow
	for rows.Next() {
		var row levelFiveSpellRow
		var raw []byte
		if err = rows.Scan(&row.id, &row.cardNumber, &row.name, &row.nameEn,
			&row.description, &row.imageURL, &row.level, &raw); err != nil {
			return nil, fmt.Errorf("scan level-2/3 PHB spell: %w", err)
		}
		if err = json.Unmarshal(raw, &row.mechanics); err != nil {
			return nil, fmt.Errorf("decode %s mechanics: %w", row.cardNumber, err)
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func updateLevelFiveSpellPatch(tx *sql.Tx, patch levelFiveSpellPatch) error {
	payload, err := json.Marshal(map[string]any{"targeting": patch.targeting, "effects": patch.effects})
	if err != nil {
		return fmt.Errorf("encode %s patch: %w", patch.cardNumber, err)
	}
	result, err := tx.Exec(`UPDATE spells SET
		mechanics=(COALESCE(mechanics,'{}'::jsonb)-'targeting'-'effects'-'uses')||$2::jsonb,
		area=NULLIF($3::text,''),
		support=jsonb_build_object('status','untested','certification_version',$4::text,
		  'mechanics_locked',false,'note','Level-5 spell mechanics materialized; browser verification pending.'),
		updated_at=NOW() WHERE card_number=$1 AND deleted_at IS NULL`,
		patch.cardNumber, string(payload), patch.areaLabel, levelFiveSpellsMigrationVersion)
	if err != nil {
		return fmt.Errorf("patch %s: %w", patch.cardNumber, err)
	}
	rows, rowsErr := result.RowsAffected()
	if rowsErr != nil || rows != 1 {
		return fmt.Errorf("patch %s affected %d rows: %w", patch.cardNumber, rows, rowsErr)
	}
	return nil
}

func updateLevelFiveTargetingPatch(tx *sql.Tx, patch levelFiveTargetingPatch) error {
	payload, err := json.Marshal(patch.targeting)
	if err != nil {
		return fmt.Errorf("encode %s targeting: %w", patch.cardNumber, err)
	}
	result, err := tx.Exec(`UPDATE spells SET
		mechanics=jsonb_set(COALESCE(mechanics,'{}'::jsonb)-'uses','{targeting}',$2::jsonb,true),
		area=NULLIF($3::text,''),
		support=jsonb_build_object('status','untested','certification_version',$4::text,
		  'mechanics_locked',false,'note','Level-5 targeting aligned with SRD 5.2.1; browser verification pending.'),
		updated_at=NOW() WHERE card_number=$1 AND deleted_at IS NULL`,
		patch.cardNumber, string(payload), patch.areaLabel, levelFiveSpellsMigrationVersion)
	if err != nil {
		return fmt.Errorf("patch %s targeting: %w", patch.cardNumber, err)
	}
	rows, rowsErr := result.RowsAffected()
	if rowsErr != nil || rows != 1 {
		return fmt.Errorf("patch %s targeting affected %d rows: %w", patch.cardNumber, rows, rowsErr)
	}
	return nil
}

func materializeLevelFiveSpellDurableEffects(tx *sql.Tx) (int, error) {
	rows, err := loadLevelFivePHBSpells(tx)
	if err != nil {
		return 0, err
	}
	materialized := 0
	for _, row := range rows {
		addLevelFiveDurations(row.mechanics, levelFiveDurableDuration(row.cardNumber))
		source := runtimeEffectSource{
			table: "spells", id: row.id, cardNumber: row.cardNumber,
			name: row.name, nameEn: row.nameEn, description: row.description,
			imageURL: row.imageURL, mechanics: row.mechanics,
		}
		rewritten, effects, changed := rewriteLevelFiveDurablePayloads(source.mechanics, "mechanics", true, source)
		if !changed {
			continue
		}
		for _, effect := range effects {
			effect.mechanics = canonicalLevelFiveRuntimeEffectMechanics(effect.mechanics)
			mechanicsJSON, marshalErr := json.Marshal(effect.mechanics)
			if marshalErr != nil {
				return materialized, fmt.Errorf("encode %s: %w", effect.cardNumber, marshalErr)
			}
			if _, err = tx.Exec(`INSERT INTO effects (
				id,name,name_en,description,detailed_description,image_url,rarity,
				card_number,effect_type,mechanics,repeatable,author,source,support
			) VALUES ($1::uuid,$2,NULLIF($3,''),$4,$5,$6,'common',$7,'spell_effect',$8::jsonb,
				false,'System','SRD 5.2.1',jsonb_build_object('status','untested',
				'certification_version',$9::text,'mechanics_locked',false,
				'note','Level-2/3 durable target effect; browser verification pending.'))
				ON CONFLICT (card_number) DO UPDATE SET deleted_at=NULL,name=EXCLUDED.name,
				name_en=EXCLUDED.name_en,description=EXCLUDED.description,
				detailed_description=EXCLUDED.detailed_description,image_url=EXCLUDED.image_url,
				effect_type=EXCLUDED.effect_type,mechanics=EXCLUDED.mechanics,
				support=EXCLUDED.support,updated_at=NOW()`, effect.id, effect.name, effect.nameEn,
				effect.description, effect.detailed, effect.imageURL, effect.cardNumber,
				string(mechanicsJSON), levelFiveSpellsMigrationVersion); err != nil {
				return materialized, fmt.Errorf("upsert %s: %w", effect.cardNumber, err)
			}
			materialized++
		}
		mechanicsJSON, marshalErr := json.Marshal(rewritten)
		if marshalErr != nil {
			return materialized, fmt.Errorf("encode rewritten %s: %w", row.cardNumber, marshalErr)
		}
		if _, err = tx.Exec(`UPDATE spells SET mechanics=$2::jsonb,
			support=jsonb_build_object('status','untested','certification_version',$3::text,
			'mechanics_locked',false,'note','Durable target effects moved to library entities; browser verification pending.'),
			updated_at=NOW() WHERE id=$1::uuid AND deleted_at IS NULL`, row.id,
			string(mechanicsJSON), levelFiveSpellsMigrationVersion); err != nil {
			return materialized, fmt.Errorf("rewrite %s durable effects: %w", row.cardNumber, err)
		}
	}
	return materialized, nil
}

// Idempotent repair for a production-shaped clone (or a retried deploy) where
// an earlier attempt already inserted direct root payloads before migration
// 166 was recorded. Fresh installs also pass through this metadata-only stamp.
func canonicalizeExistingLevelFiveRuntimeEffects(tx *sql.Tx) (int, error) {
	rows, err := tx.Query(`SELECT effect.id::text,effect.mechanics FROM effects effect
		WHERE effect.deleted_at IS NULL
		  AND effect.card_number LIKE 'EFFECT-runtime-%'
		  AND EXISTS (
		    SELECT 1 FROM spells spell
		    WHERE spell.deleted_at IS NULL AND ` + levelFivePHBSpellPredicate + `
		      AND spell.mechanics::text LIKE '%' || effect.card_number || '%'
		  )
		ORDER BY effect.card_number,effect.id`)
	if err != nil {
		return 0, fmt.Errorf("load level-2/3 runtime effects: %w", err)
	}
	type effectRow struct {
		id        string
		mechanics map[string]any
	}
	var loaded []effectRow
	for rows.Next() {
		var row effectRow
		var raw []byte
		if err = rows.Scan(&row.id, &raw); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan level-2/3 runtime effect: %w", err)
		}
		if err = json.Unmarshal(raw, &row.mechanics); err != nil {
			rows.Close()
			return 0, fmt.Errorf("decode level-2/3 runtime effect: %w", err)
		}
		loaded = append(loaded, row)
	}
	if err = rows.Close(); err != nil {
		return 0, fmt.Errorf("close level-2/3 runtime effects: %w", err)
	}
	for _, row := range loaded {
		if _, direct := row.mechanics["kind"]; direct {
			row.mechanics = canonicalLevelFiveRuntimeEffectMechanics(row.mechanics)
			encoded, marshalErr := json.Marshal(row.mechanics)
			if marshalErr != nil {
				return 0, fmt.Errorf("encode canonical runtime effect %s: %w", row.id, marshalErr)
			}
			if _, err = tx.Exec(`UPDATE effects SET mechanics=$2::jsonb,updated_at=NOW()
				WHERE id=$1::uuid AND deleted_at IS NULL`, row.id, string(encoded)); err != nil {
				return 0, fmt.Errorf("canonicalize runtime effect %s: %w", row.id, err)
			}
		}
		// The support invalidation trigger clears support in the mechanics update.
		// Restore the honest state in a separate metadata-only statement.
		if _, err = tx.Exec(`UPDATE effects SET
			support=jsonb_build_object('status','untested','certification_version',$2::text,
			  'mechanics_locked',false,'note','Level-2/3 durable target effect; browser verification pending.'),
			updated_at=NOW() WHERE id=$1::uuid AND deleted_at IS NULL`, row.id,
			levelFiveSpellsMigrationVersion); err != nil {
			return 0, fmt.Errorf("stamp runtime effect %s support: %w", row.id, err)
		}
	}
	return len(loaded), nil
}

// materializeLevelFiveSpells establishes the level-2/3 spell baseline used by
// characters through level 5. Certification remains explicitly untested until
// sheet, combat, and clarity checks have been completed in the browser.
func materializeLevelFiveSpells(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
	`); err != nil {
		return fmt.Errorf("disable certified spell/effect guards: %w", err)
	}

	spells, err := loadLevelFivePHBSpells(tx)
	if err != nil {
		return err
	}
	if len(spells) != expectedLevelFivePHBSpells {
		return fmt.Errorf("level-2/3 PHB spell denominator drifted: got %d, want %d", len(spells), expectedLevelFivePHBSpells)
	}
	for _, spell := range spells {
		mechanics := normalizeLevelFiveSpellMechanics(spell.mechanics, spell.level)
		encoded, marshalErr := json.Marshal(mechanics)
		if marshalErr != nil {
			return fmt.Errorf("encode normalized %s: %w", spell.cardNumber, marshalErr)
		}
		result, execErr := tx.Exec(`UPDATE spells SET mechanics=$3::jsonb,
			support=jsonb_build_object('status','untested','certification_version',$4::text,
			  'mechanics_locked',false,'note','Level-2/3 slot contract normalized; browser verification pending.'),
			updated_at=NOW() WHERE id=$1::uuid AND card_number=$2 AND deleted_at IS NULL`,
			spell.id, spell.cardNumber, string(encoded), levelFiveSpellsMigrationVersion)
		if execErr != nil {
			return fmt.Errorf("normalize %s: %w", spell.cardNumber, execErr)
		}
		if affected, rowsErr := result.RowsAffected(); rowsErr != nil || affected != 1 {
			return fmt.Errorf("normalize %s affected %d rows: %w", spell.cardNumber, affected, rowsErr)
		}
	}

	for _, patch := range levelFiveSpellAreaPatches() {
		if err = updateLevelFiveSpellPatch(tx, patch); err != nil {
			return err
		}
	}
	for _, patch := range levelFiveSpellTargetingPatches() {
		if err = updateLevelFiveTargetingPatch(tx, patch); err != nil {
			return err
		}
	}
	for _, patch := range levelFiveMissingTargetingPatches() {
		if err = updateLevelFiveTargetingPatch(tx, patch); err != nil {
			return err
		}
	}
	for _, patch := range levelFiveLegacyAreaTargetingPatches() {
		if err = updateLevelFiveTargetingPatch(tx, patch); err != nil {
			return err
		}
	}
	if err = updateLevelFiveSpellPatch(tx, levelFiveBlindnessDeafnessPatch()); err != nil {
		return err
	}
	if err = updateLevelFiveSpellPatch(tx, levelFiveProtectionFromPoisonPatch()); err != nil {
		return err
	}
	if err = updateLevelFiveSpellPatch(tx, levelFiveWardingBondPatch()); err != nil {
		return err
	}
	routedSpells, err := loadLevelFivePHBSpells(tx)
	if err != nil {
		return err
	}
	for _, spell := range routedSpells {
		if !normalizeLevelFiveTargetRouting(spell.mechanics) {
			continue
		}
		encoded, marshalErr := json.Marshal(spell.mechanics)
		if marshalErr != nil {
			return fmt.Errorf("encode target routing for %s: %w", spell.cardNumber, marshalErr)
		}
		if _, err = tx.Exec(`UPDATE spells SET mechanics=$2::jsonb,updated_at=NOW()
			WHERE id=$1::uuid AND deleted_at IS NULL`, spell.id, string(encoded)); err != nil {
			return fmt.Errorf("route auto effects to target for %s: %w", spell.cardNumber, err)
		}
	}

	if _, err = materializeLevelFiveSpellDurableEffects(tx); err != nil {
		return err
	}
	canonicalEffects, canonicalErr := canonicalizeExistingLevelFiveRuntimeEffects(tx)
	if canonicalErr != nil {
		return canonicalErr
	}
	if canonicalEffects != expectedLevelFiveRuntimeEffects {
		return fmt.Errorf("level-2/3 runtime effect denominator drifted: got %d, want %d",
			canonicalEffects, expectedLevelFiveRuntimeEffects)
	}

	// invalidate_content_support deliberately clears support whenever the same
	// UPDATE changes mechanics. Stamp the honest testing state afterwards in a
	// metadata-only statement so production's invalidation trigger cannot erase
	// it. Keeping this separate also makes the postcondition independent of how
	// many source rows were already normalized before this migration.
	result, err := tx.Exec(`UPDATE spells SET
		support=jsonb_build_object('status','untested','certification_version',$1::text,
		  'mechanics_locked',false,'note','Level-2/3 mechanics materialized; browser verification pending.'),
		updated_at=NOW() WHERE deleted_at IS NULL AND `+levelFivePHBSpellPredicate,
		levelFiveSpellsMigrationVersion)
	if err != nil {
		return fmt.Errorf("stamp level-2/3 spell support: %w", err)
	}
	if affected, rowsErr := result.RowsAffected(); rowsErr != nil || affected != expectedLevelFivePHBSpells {
		return fmt.Errorf("stamp level-2/3 spell support affected %d rows: %w", affected, rowsErr)
	}

	var invalid, withUses, invalidCostShape, invalidSlotCost, invalidSupport int
	if err = tx.QueryRow(`SELECT count(*),
		count(*) FILTER (WHERE mechanics ? 'uses'),
		count(*) FILTER (WHERE jsonb_typeof(mechanics->'activation'->'cost') IS DISTINCT FROM 'array'),
		count(*) FILTER (WHERE jsonb_typeof(mechanics->'activation'->'cost') = 'array' AND
		  (SELECT count(*) FROM jsonb_array_elements(mechanics->'activation'->'cost') cost
		   WHERE cost->>'resource'='spell_slot' AND (cost->>'level')::int=spells.level
		     AND COALESCE((cost->>'amount')::int,1)=1) <> 1),
		count(*) FILTER (WHERE COALESCE(support->>'status','') <> 'untested')
		FROM spells WHERE deleted_at IS NULL AND `+levelFivePHBSpellPredicate+` AND (
		mechanics ? 'uses' OR jsonb_typeof(mechanics->'activation'->'cost') IS DISTINCT FROM 'array' OR
		(jsonb_typeof(mechanics->'activation'->'cost') = 'array' AND
		 (SELECT count(*) FROM jsonb_array_elements(mechanics->'activation'->'cost') cost
		  WHERE cost->>'resource'='spell_slot' AND (cost->>'level')::int=spells.level
		    AND COALESCE((cost->>'amount')::int,1)=1) <> 1) OR
		COALESCE(support->>'status','') <> 'untested'
	)`).Scan(&invalid, &withUses, &invalidCostShape, &invalidSlotCost, &invalidSupport); err != nil {
		return fmt.Errorf("verify level-2/3 spell contracts: %w", err)
	}
	if invalid != 0 {
		return fmt.Errorf("level-2/3 spell postcondition failed for %d rows (uses=%d cost_shape=%d slot_cost=%d support=%d)",
			invalid, withUses, invalidCostShape, invalidSlotCost, invalidSupport)
	}

	var runtimeEffects, invalidRuntimeEffects int
	if err = tx.QueryRow(`SELECT count(*),count(*) FILTER (WHERE
		mechanics ? 'kind' OR NOT (mechanics ? 'effects') OR
		COALESCE(support->>'status','') <> 'untested' OR
		COALESCE(support->>'certification_version','') <> $1)
		FROM effects effect
		WHERE effect.deleted_at IS NULL
		  AND effect.card_number LIKE 'EFFECT-runtime-%'
		  AND EXISTS (
		    SELECT 1 FROM spells spell
		    WHERE spell.deleted_at IS NULL AND `+levelFivePHBSpellPredicate+`
		      AND spell.mechanics::text LIKE '%' || effect.card_number || '%'
		  )`, levelFiveSpellsMigrationVersion).Scan(&runtimeEffects, &invalidRuntimeEffects); err != nil {
		return fmt.Errorf("verify level-2/3 runtime effects: %w", err)
	}
	if runtimeEffects != expectedLevelFiveRuntimeEffects || invalidRuntimeEffects != 0 {
		return fmt.Errorf("level-2/3 runtime effect postcondition failed: total=%d want=%d invalid=%d",
			runtimeEffects, expectedLevelFiveRuntimeEffects, invalidRuntimeEffects)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
