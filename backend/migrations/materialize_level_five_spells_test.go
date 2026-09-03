package migrations

import (
	"reflect"
	"testing"
)

func mapValue(t *testing.T, value any) map[string]any {
	t.Helper()
	result, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("got %T, want map[string]any", value)
	}
	return result
}

func mapSliceValue(t *testing.T, value any) []map[string]any {
	t.Helper()
	switch typed := value.(type) {
	case []map[string]any:
		return typed
	case []any:
		result := make([]map[string]any, len(typed))
		for index, item := range typed {
			result[index] = mapValue(t, item)
		}
		return result
	default:
		t.Fatalf("got %T, want map slice", value)
		return nil
	}
}

func patchByCard(t *testing.T, card string) levelFiveSpellPatch {
	t.Helper()
	for _, patch := range levelFiveSpellAreaPatches() {
		if patch.cardNumber == card {
			return patch
		}
	}
	t.Fatalf("missing spell patch %s", card)
	return levelFiveSpellPatch{}
}

func tacticalOfPatch(t *testing.T, card string) map[string]any {
	t.Helper()
	patch := patchByCard(t, card)
	result := mapSliceValue(t, patch.effects[0]["result"])
	if len(result) != 1 || result[0]["kind"] != "world_zone" {
		t.Fatalf("%s must emit exactly one world_zone, got %#v", card, result)
	}
	return mapValue(t, result[0]["tactical"])
}

func TestNormalizeLevelFiveSpellMechanicsKeepsAccessAndExactSlotCost(t *testing.T) {
	classes := []any{"CLASS-bard", "CLASS-wizard"}
	mechanics := map[string]any{
		"activation": map[string]any{"mode": "active", "cost": []any{
			map[string]any{"resource": "action"},
			map[string]any{"resource": "spell_slot_2", "amount": 1},
			map[string]any{"resource": "spell_slot", "level": 1, "amount": 2},
		}},
		"spell_class_list_ids": classes,
		"uses":                 map[string]any{"count": 1, "per": "long_rest"},
	}
	got := normalizeLevelFiveSpellMechanics(mechanics, 3)
	if _, exists := got["uses"]; exists {
		t.Fatal("leveled spell retained an erroneous per-rest uses pool")
	}
	if !reflect.DeepEqual(got["spell_class_list_ids"], classes) {
		t.Fatalf("spell access changed: %#v", got["spell_class_list_ids"])
	}
	activation := mapValue(t, got["activation"])
	costs := mapSliceValue(t, activation["cost"])
	if len(costs) != 2 || costs[0]["resource"] != "action" {
		t.Fatalf("non-slot activation cost was not preserved: %#v", costs)
	}
	if costs[1]["resource"] != "spell_slot" || costs[1]["level"] != 3 || costs[1]["amount"] != 1 {
		t.Fatalf("slot cost is not exact: %#v", costs[1])
	}
}

func TestNormalizeLevelFiveSpellMechanicsMakesHalfDamageExecutable(t *testing.T) {
	mechanics := map[string]any{
		"effects": []any{map[string]any{
			"resolution": "save", "ability": "dex",
			"on_fail": []any{
				map[string]any{"kind": "damage", "dice": "8d6", "type": "fire", "on_success": "half"},
				map[string]any{"kind": "narrative", "description": "objects ignite"},
			},
			"on_success": []any{},
		}},
	}
	got := normalizeLevelFiveSpellMechanics(mechanics, 3)
	effects := got["effects"].([]any)
	successes := effects[0].(map[string]any)["on_success"].([]any)
	if len(successes) != 1 {
		t.Fatalf("got %d successful-save payloads, want 1", len(successes))
	}
	damage := mapValue(t, successes[0])
	if damage["dice"] != "8d6" || damage["type"] != "fire" || damage["on_success"] != "half" {
		t.Fatalf("half-damage payload drifted: %#v", damage)
	}
}

func TestNormalizeLevelFiveTargetRoutingMakesActorPickerAuthoritative(t *testing.T) {
	mechanics := map[string]any{
		"targeting": map[string]any{"actor_targets": true},
		"effects": []any{
			map[string]any{"resolution": "auto", "result": []any{map[string]any{"kind": "healing", "dice": "2d4"}}},
			map[string]any{"resolution": "auto", "who": "self", "result": []any{map[string]any{"kind": "narrative"}}},
			map[string]any{"resolution": "save", "on_fail": []any{map[string]any{"kind": "condition"}}},
		},
	}
	if !normalizeLevelFiveTargetRouting(mechanics) {
		t.Fatal("actor-target auto interaction was not normalized")
	}
	effects := mapSliceValue(t, mechanics["effects"])
	if effects[0]["who"] != "target" {
		t.Fatalf("target picker remains cosmetic: %#v", effects[0])
	}
	if effects[1]["who"] != "self" {
		t.Fatalf("explicit self routing was overwritten: %#v", effects[1])
	}
	if _, exists := effects[2]["who"]; exists {
		t.Fatalf("save interaction routing was needlessly rewritten: %#v", effects[2])
	}
	if normalizeLevelFiveTargetRouting(mechanics) {
		t.Fatal("target routing normalization is not idempotent")
	}
}

func TestLevelFiveAreaPatchDenominatorAndIdentity(t *testing.T) {
	patches := levelFiveSpellAreaPatches()
	if len(patches) != 10 {
		t.Fatalf("got %d persistent area patches, want 10", len(patches))
	}
	want := []string{
		"SPELL-0234", "SPELL-0266", "SPELL-0257", "SPELL-0215", "darkness",
		"SPELL-0301", "SPELL-0276", "hunger_of_hadar", "sleet_storm", "stinking_cloud",
	}
	seen := map[string]bool{}
	for _, patch := range patches {
		if seen[patch.cardNumber] {
			t.Fatalf("duplicate patch %s", patch.cardNumber)
		}
		seen[patch.cardNumber] = true
		targeting := patch.targeting
		if targeting["domain"] != "world" || targeting["actor_targets"] != false || targeting["shape"] != "area" {
			t.Fatalf("%s is not a world-zone target: %#v", patch.cardNumber, targeting)
		}
	}
	for _, card := range want {
		if !seen[card] {
			t.Fatalf("missing persistent area patch %s", card)
		}
	}
}

func TestCloudOfDaggersAndSpikeGrowthUseNoSaveAutomaticDamage(t *testing.T) {
	cloud := tacticalOfPatch(t, "SPELL-0234")
	if _, exists := cloud["save"]; exists {
		t.Fatal("Cloud of Daggers must not invent a saving throw")
	}
	if !reflect.DeepEqual(cloud["triggers"], []string{"created", "enter", "end_turn"}) {
		t.Fatalf("Cloud of Daggers triggers drifted: %#v", cloud["triggers"])
	}
	cloudDamage := mapSliceValue(t, cloud["auto_effects"])
	if len(cloudDamage) != 1 || cloudDamage[0]["dice"] != "4d4" || cloudDamage[0]["type"] != "slashing" {
		t.Fatalf("Cloud of Daggers damage drifted: %#v", cloudDamage)
	}

	spikes := tacticalOfPatch(t, "SPELL-0266")
	if _, exists := spikes["save"]; exists {
		t.Fatal("Spike Growth must not invent a saving throw")
	}
	if !reflect.DeepEqual(spikes["triggers"], []string{"move"}) || spikes["difficult_terrain"] != true {
		t.Fatalf("Spike Growth movement contract drifted: %#v", spikes)
	}
	spikeDamage := mapSliceValue(t, spikes["auto_effects"])
	if len(spikeDamage) != 1 || spikeDamage[0]["dice"] != "2d4" || spikeDamage[0]["type"] != "piercing" {
		t.Fatalf("Spike Growth damage drifted: %#v", spikeDamage)
	}
}

func TestWebMoonbeamAndFlamingSphereSaveTriggers(t *testing.T) {
	web := tacticalOfPatch(t, "SPELL-0257")
	if !reflect.DeepEqual(web["triggers"], []string{"enter", "start_turn"}) || web["difficult_terrain"] != true {
		t.Fatalf("Web timing/terrain drifted: %#v", web)
	}
	webSave := mapValue(t, web["save"])
	webFailure := mapSliceValue(t, web["on_failure"])
	if webSave["ability"] != "dex" || len(webFailure) != 1 || webFailure[0]["kind"] != "grant_effect" || webFailure[0]["value"] != "COND-restrained" || webFailure[0]["area_linked"] != true {
		t.Fatalf("Web save/effect drifted: save=%#v failure=%#v", webSave, webFailure)
	}

	moonbeam := tacticalOfPatch(t, "SPELL-0215")
	if !reflect.DeepEqual(moonbeam["triggers"], []string{"created", "enter", "end_turn"}) {
		t.Fatalf("Moonbeam timing drifted: %#v", moonbeam)
	}
	if mapValue(t, moonbeam["save"])["ability"] != "con" {
		t.Fatalf("Moonbeam save drifted: %#v", moonbeam["save"])
	}
	moonDamage := mapSliceValue(t, moonbeam["on_failure"])
	moonSuccess := mapSliceValue(t, moonbeam["on_success"])
	if moonDamage[0]["dice"] != "2d10" || moonDamage[1]["kind"] != "remove_effect" || moonDamage[1]["card_number"] != "COND-polymorphed" || moonSuccess[0]["on_success"] != "half" {
		t.Fatalf("Moonbeam damage split drifted: %#v / %#v", moonDamage, moonSuccess)
	}

	flame := tacticalOfPatch(t, "SPELL-0276")
	if !reflect.DeepEqual(flame["triggers"], []string{"end_turn"}) || mapValue(t, flame["save"])["ability"] != "dex" {
		t.Fatalf("Flaming Sphere timing/save drifted: %#v", flame)
	}
}

func TestDarknessSilenceAndThirdLevelHazardsAreDataOwned(t *testing.T) {
	darkness := tacticalOfPatch(t, "darkness")
	darknessEffect := mapValue(t, darkness["inside_effect"])
	if darkness["heavily_obscured"] != true || darknessEffect["kind"] != "grant_effect" || darknessEffect["value"] != "COND-blinded" {
		t.Fatalf("Darkness visibility contract drifted: %#v", darkness)
	}
	silence := tacticalOfPatch(t, "SPELL-0301")
	silenceEffect := mapValue(t, silence["inside_effect"])
	if silenceEffect["kind"] != "grant_effect" || silenceEffect["value"] != "COND-deafened" || silence["blocks_verbal_components"] != true {
		t.Fatalf("Silence contract drifted: %#v", silence)
	}
	if !reflect.DeepEqual(silence["damage_immunities"], []string{"thunder"}) {
		t.Fatalf("Silence thunder immunity drifted: %#v", silence)
	}

	hadar := tacticalOfPatch(t, "hunger_of_hadar")
	hadarEffect := mapValue(t, hadar["inside_effect"])
	if hadarEffect["kind"] != "grant_effect" || hadarEffect["value"] != "COND-blinded" || hadar["heavily_obscured"] != true || hadar["difficult_terrain"] != true {
		t.Fatalf("Hunger of Hadar area contract drifted: %#v", hadar)
	}
	cold := mapSliceValue(t, hadar["auto_effects"])
	if cold[0]["dice"] != "2d6" || cold[0]["type"] != "cold" {
		t.Fatalf("Hunger of Hadar start-turn damage drifted: %#v", cold)
	}
	endSave := mapValue(t, hadar["end_turn_save"])
	if endSave["ability"] != "dex" || mapSliceValue(t, endSave["on_failure"])[0]["type"] != "acid" {
		t.Fatalf("Hunger of Hadar end-turn save drifted: %#v", endSave)
	}

	sleet := tacticalOfPatch(t, "sleet_storm")
	if sleet["heavily_obscured"] != true || sleet["difficult_terrain"] != true || mapValue(t, sleet["save"])["ability"] != "dex" {
		t.Fatalf("Sleet Storm contract drifted: %#v", sleet)
	}
	stink := tacticalOfPatch(t, "stinking_cloud")
	if stink["heavily_obscured"] != true || mapValue(t, stink["save"])["ability"] != "con" {
		t.Fatalf("Stinking Cloud contract drifted: %#v", stink)
	}
}

func TestBlindnessDeafnessIsAChoiceAndNeverStuns(t *testing.T) {
	patch := levelFiveBlindnessDeafnessPatch()
	if patch.cardNumber != "SPELL-0182" || len(patch.effects) != 1 {
		t.Fatalf("unexpected Blindness/Deafness patch: %#v", patch)
	}
	save := patch.effects[0]
	if save["resolution"] != "save" || save["who"] != "target" || save["ability"] != "con" {
		t.Fatalf("missing top-level Constitution save: %#v", save)
	}
	failures := mapSliceValue(t, save["on_fail"])
	if len(failures) != 1 {
		t.Fatalf("got %d failed-save payloads, want one runtime choice", len(failures))
	}
	choice := failures[0]
	if choice["kind"] != "choice" || choice["id"] != "blindness_or_deafness" {
		t.Fatalf("missing runtime choice: %#v", choice)
	}
	if _, exists := choice["resolution"]; exists {
		t.Fatalf("nested runtime choice must be a payload, not an interaction: %#v", choice)
	}
	options := mapSliceValue(t, mapValue(t, choice["options"])["items"])
	if len(options) != 2 {
		t.Fatalf("got %d options, want 2", len(options))
	}
	want := []string{"COND-blinded", "COND-deafened"}
	for index, option := range options {
		grants := mapSliceValue(t, option["grants"])
		if len(grants) != 1 || grants[0]["kind"] != "grant_effect" || grants[0]["value"] != want[index] {
			t.Fatalf("option %d applies %#v, want %s", index, grants, want[index])
		}
		if grants[0]["value"] == "COND-stunned" {
			t.Fatal("Blindness/Deafness retained the legacy Stunned bug")
		}
	}
}

func TestLevelFiveSelfTargetingCompilesWithPositiveActorMaximum(t *testing.T) {
	targeting := levelFiveSelfTargeting()
	if targeting["shape"] != "self" || targeting["actor_targets"] != false || targeting["max_targets"] != 1 {
		t.Fatalf("self targeting violates the frontend actor-target compiler contract: %#v", targeting)
	}
}

func TestProtectionFromPoisonRemovesConditionAndGrantsDurableRules(t *testing.T) {
	patch := levelFiveProtectionFromPoisonPatch()
	result := mapSliceValue(t, patch.effects[0]["result"])
	if len(result) != 3 || result[0]["kind"] != "remove_effect" || result[0]["card_number"] != "COND-poisoned" {
		t.Fatalf("Protection from Poison must remove Poisoned first: %#v", result)
	}
	if result[1]["kind"] != "modifier" || result[1]["op"] != "advantage" || result[1]["duration"] == nil {
		t.Fatalf("Protection from Poison save advantage drifted: %#v", result[1])
	}
	if result[2]["kind"] != "resistance" || result[2]["damage_type"] != "poison" || result[2]["duration"] == nil {
		t.Fatalf("Protection from Poison resistance drifted: %#v", result[2])
	}
}

func TestWardingBondUsesPlusOneSavingThrowsInsteadOfProficiency(t *testing.T) {
	patch := levelFiveWardingBondPatch()
	result := mapSliceValue(t, patch.effects[0]["result"])
	if len(result) != 4 {
		t.Fatalf("got %d Warding Bond payloads, want 4", len(result))
	}
	for _, payload := range result {
		if payload["kind"] == "grant_proficiency" {
			t.Fatalf("Warding Bond must not grant saving-throw proficiency: %#v", payload)
		}
	}
	save := result[1]
	if save["kind"] != "modifier" || save["op"] != "add" || save["value"] != "+1" || mapValue(t, save["applies_to"])["roll"] != "saving_throw" {
		t.Fatalf("Warding Bond saving-throw bonus drifted: %#v", save)
	}
	if result[2]["kind"] != "resistance" || result[2]["damage_type"] != "all" {
		t.Fatalf("Warding Bond resistance drifted: %#v", result[2])
	}
}

func TestLevelFiveDurableRewriterCreatesLibraryGrantAndSkipsWorldZones(t *testing.T) {
	source := runtimeEffectSource{
		table: "spells", id: "00000000-0000-4000-8000-000000000001",
		cardNumber: "pass_without_trace", name: "Бесследное передвижение",
		mechanics: map[string]any{},
	}
	payload := map[string]any{
		"effects": []any{map[string]any{
			"resolution": "auto", "result": []any{
				map[string]any{
					"kind": "modifier", "op": "add", "value": "+10",
					"applies_to": map[string]any{"roll": "ability_check"},
					"duration":   map[string]any{"type": "rounds", "amount": 600},
				},
				map[string]any{
					"kind": "world_zone", "zone_type": "test",
					"duration": map[string]any{"type": "rounds", "amount": 10},
				},
			},
		}},
	}
	rewritten, effects, changed := rewriteLevelFiveDurablePayloads(payload, "mechanics", true, source)
	if !changed || len(effects) != 1 {
		t.Fatalf("got changed=%v effects=%d, want one library effect", changed, len(effects))
	}
	root := mapValue(t, rewritten)
	wrappers := root["effects"].([]any)
	result := wrappers[0].(map[string]any)["result"].([]any)
	if mapValue(t, result[0])["kind"] != "grant_effect" {
		t.Fatalf("durable modifier was not rewritten: %#v", result[0])
	}
	if mapValue(t, result[1])["kind"] != "world_zone" {
		t.Fatalf("world zone was incorrectly hidden behind grant_effect: %#v", result[1])
	}
	if effects[0].name == "Бесследное передвижение — " || effects[0].description == ". Источник: Бесследное передвижение." {
		t.Fatalf("materialized effect lacks a useful hover-card summary: %#v", effects[0])
	}
}

func TestCanonicalLevelFiveRuntimeEffectMechanicsUsesPassiveEnvelope(t *testing.T) {
	duration := map[string]any{"type": "rounds", "amount": 10}
	payload := map[string]any{
		"kind": "modifier", "op": "add", "value": "+2",
		"applies_to": map[string]any{"roll": "ac"}, "duration": duration,
	}
	mechanics := canonicalLevelFiveRuntimeEffectMechanics(payload)
	activation := mapValue(t, mechanics["activation"])
	if activation["mode"] != "passive" {
		t.Fatalf("runtime effect is not a passive canonical card: %#v", mechanics)
	}
	effects := mapSliceValue(t, mechanics["effects"])
	results := mapSliceValue(t, effects[0]["result"])
	if effects[0]["resolution"] != "auto" || len(results) != 1 || !reflect.DeepEqual(results[0], payload) {
		t.Fatalf("runtime payload is not schema-visible: %#v", mechanics)
	}
	if !reflect.DeepEqual(mechanics["duration"], duration) {
		t.Fatalf("runtime lifecycle duration was not retained at the envelope: %#v", mechanics)
	}
}

func TestLevelFiveTargetingPatchesCoverKnownDescriptionMismatches(t *testing.T) {
	patches := levelFiveSpellTargetingPatches()
	if len(patches) != 33 {
		t.Fatalf("got %d targeting patches, want 33", len(patches))
	}
	seen := map[string]map[string]any{}
	for _, patch := range patches {
		seen[patch.cardNumber] = patch.targeting
	}
	if seen["SPELL-0197"]["shape"] != "single" || seen["SPELL-0197"]["max_targets"] != 1 {
		t.Fatalf("Dragon's Breath must target its recipient, not its later cone: %#v", seen["SPELL-0197"])
	}
	if mapValue(t, seen["fireball"]["area"])["radius_ft"] != 20 || seen["fireball"]["range_ft"] != 150 {
		t.Fatalf("Fireball geometry drifted: %#v", seen["fireball"])
	}
	if seen["mass_healing_word"]["max_targets"] != 6 {
		t.Fatalf("Mass Healing Word target cap drifted: %#v", seen["mass_healing_word"])
	}
	if seen["slow"]["max_targets"] != 6 {
		t.Fatalf("Slow target cap drifted: %#v", seen["slow"])
	}
}

func TestLevelFiveMissingTargetingPatchesCoverExactAuditDenominator(t *testing.T) {
	patches := levelFiveMissingTargetingPatches()
	if len(patches) != 33 {
		t.Fatalf("got %d missing-target patches, want 33", len(patches))
	}
	want := []string{
		"SPELL-0168", "SPELL-0169", "SPELL-0172", "SPELL-0175", "SPELL-0180",
		"SPELL-0233", "SPELL-0248", "SPELL-0262", "SPELL-0263", "SPELL-0302",
		"misty_step", "animate_dead", "aura_of_vitality", "blink", "clairvoyance",
		"create_food_and_water", "crusaders_mantle", "daylight", "glyph_of_warding",
		"leomunds_tiny_hut", "lightning_arrow", "magic_circle", "major_image",
		"meld_into_stone", "nondetection", "phantom_steed", "remove_curse", "revivify",
		"sending", "speak_with_dead", "spirit_guardians", "summon_fey", "summon_undead",
	}
	seen := map[string]bool{}
	for _, patch := range patches {
		if seen[patch.cardNumber] {
			t.Fatalf("duplicate missing-target patch %s", patch.cardNumber)
		}
		seen[patch.cardNumber] = true
		for _, key := range []string{"shape", "domain", "actor_targets", "min_targets", "max_targets", "range_ft", "requires_line_of_sight", "allowed_relations"} {
			if _, exists := patch.targeting[key]; !exists {
				t.Fatalf("%s missing canonical key %s: %#v", patch.cardNumber, key, patch.targeting)
			}
		}
	}
	for _, card := range want {
		if !seen[card] {
			t.Fatalf("missing audited card %s", card)
		}
	}
}

func TestLevelFiveLegacyAreaTargetingPatchesCompileDataShape(t *testing.T) {
	patches := levelFiveLegacyAreaTargetingPatches()
	if len(patches) != 3 {
		t.Fatalf("got %d legacy-area patches, want 3", len(patches))
	}
	seen := map[string]map[string]any{}
	for _, patch := range patches {
		seen[patch.cardNumber] = patch.targeting
	}
	zone := mapValue(t, seen["SPELL-0235"]["area"])
	if zone["kind"] != "sphere" || zone["radius_ft"] != 15 {
		t.Fatalf("Zone of Truth is not a canonical 15-foot sphere: %#v", seen["SPELL-0235"])
	}
	steed := seen["SPELL-0240"]
	if steed["domain"] != "world" || steed["actor_targets"] != false || steed["shape"] != "single" || steed["max_targets"] != 0 {
		t.Fatalf("Find Steed is not an explicit zero-actor world point: %#v", steed)
	}
	gust := mapValue(t, seen["SPELL-0268"]["area"])
	if gust["kind"] != "line" || gust["size_ft"] != 60 || gust["width_ft"] != 10 {
		t.Fatalf("Gust of Wind is not a canonical 60-by-10-foot line: %#v", seen["SPELL-0268"])
	}
}
