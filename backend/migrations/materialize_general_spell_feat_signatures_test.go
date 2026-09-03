package migrations

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestGeneralSpellFeatSignatureDenominatorsAndJSON(t *testing.T) {
	if generalSpellFeatSignaturesMigrationVersion != "171_materialize_general_spell_feat_signatures" {
		t.Fatal(generalSpellFeatSignaturesMigrationVersion)
	}
	seeds := generalSpellFeatSeeds()
	if len(seeds) != 9 {
		t.Fatalf("effects=%d, want 9", len(seeds))
	}
	seen := map[string]bool{}
	for _, seed := range seeds {
		if seen[seed.card] {
			t.Fatalf("duplicate %s", seed.card)
		}
		seen[seed.card] = true
		payload, err := json.Marshal(seed.mechanics)
		if err != nil {
			t.Fatalf("%s: %v", seed.card, err)
		}
		if strings.Contains(string(payload), `"kind":"narrative"`) {
			t.Fatalf("%s signature fell back to narrative mechanics", seed.card)
		}
	}
	if len(generalSpellFeatActionSeeds()) != 7 {
		t.Fatalf("actions=%d, want 7", len(generalSpellFeatActionSeeds()))
	}
}

func TestGeneralSpellFeatActionsUseProductionCompatibleActionType(t *testing.T) {
	// The production table constraint deliberately has no feat action_type. Feat
	// actions use the same executable class_feature bucket as existing origin-feat
	// actions, while type retains the more precise general_feat classification.
	if generalSpellFeatActionType != "class_feature" {
		t.Fatalf("general feat action_type=%q, want production-compatible class_feature", generalSpellFeatActionType)
	}
}

func TestTouchedAndRitualSpellChoicesAreExact(t *testing.T) {
	byCard := map[string]map[string]any{}
	for _, seed := range generalSpellFeatSeeds() {
		byCard[seed.card] = seed.mechanics
	}
	shadow, _ := json.Marshal(byCard["FEAT-0021"])
	fey, _ := json.Marshal(byCard["FEAT-0022"])
	ritual, _ := json.Marshal(byCard["FEAT-0041"])
	for _, want := range []string{`"SPELL-0231"`, `"schools":["illusion","necromancy"]`, `"freeuse":true`} {
		if !strings.Contains(string(shadow), want) {
			t.Fatalf("Shadow Touched misses %s: %s", want, shadow)
		}
	}
	for _, want := range []string{`"misty_step"`, `"schools":["divination","enchantment"]`, `"freeuse":true`} {
		if !strings.Contains(string(fey), want) {
			t.Fatalf("Fey Touched misses %s: %s", want, fey)
		}
	}
	for _, want := range []string{`"ritual":true`, `"count_by_level":{"13":5,"17":6,"4":2,"5":3,"9":4}`, `"free_use_resource":"ritual_caster_quick_ritual"`, `"casting_override":{"free_use_resource":"ritual_caster_quick_ritual","ritual":true}`} {
		if !strings.Contains(string(ritual), want) {
			t.Fatalf("Ritual Caster misses %s: %s", want, ritual)
		}
	}
}

func TestTelekineticAndTelepathUseRuntimePrimitives(t *testing.T) {
	actions := generalSpellFeatActionSeeds()
	for index, action := range actions[:6] {
		payload, _ := json.Marshal(action.mechanics)
		if !strings.Contains(string(payload), `"resolution":"save"`) ||
			!strings.Contains(string(payload), `"ability":"str"`) ||
			!strings.Contains(string(payload), `"kind":"movement"`) {
			t.Fatalf("telekinetic action %d is inert: %s", index, payload)
		}
	}
	telepath, _ := json.Marshal(actions[6].mechanics)
	if !strings.Contains(string(telepath), `"kind":"communication_link"`) ||
		!strings.Contains(string(telepath), `"allows_reply":false`) {
		t.Fatalf("telepathic utterance is inert: %s", telepath)
	}
	var telekinetic, telepathFeat map[string]any
	for _, seed := range generalSpellFeatSeeds() {
		if seed.card == "FEAT-0046" {
			telekinetic = seed.mechanics
		}
		if seed.card == "FEAT-0047" {
			telepathFeat = seed.mechanics
		}
	}
	kinetic, _ := json.Marshal(telekinetic)
	telepathGrant, _ := json.Marshal(telepathFeat)
	for _, want := range []string{`"SPELL-0173"`, `"range_bonus_ft":30`, `"somatic":false`, `"verbal":false`} {
		if !strings.Contains(string(kinetic), want) {
			t.Fatalf("Telekinetic misses %s: %s", want, kinetic)
		}
	}
	for _, want := range []string{`"SPELL-0239"`, `"freeuse":true`, `"material":false`, `"somatic":false`, `"verbal":false`} {
		if !strings.Contains(string(telepathGrant), want) {
			t.Fatalf("Telepath misses %s: %s", want, telepathGrant)
		}
	}
}

func TestWarCasterSpellSniperElementalAdeptAndMageSlayerDeclareSignatures(t *testing.T) {
	byCard := map[string]string{}
	for _, seed := range generalSpellFeatSeeds() {
		payload, _ := json.Marshal(seed.mechanics)
		byCard[seed.card] = string(payload)
	}
	wants := map[string][]string{
		"FEAT-0014": {"war_caster_concentration", "war_caster_somatic_components", "war_caster_opportunity_spell"},
		"FEAT-0033": {"spell_sniper_range_ft", "spell_sniper_ignore_cover", "spell_sniper_ignore_adjacent_disadvantage"},
		"FEAT-0043": {"ignore_spell_damage_resistance", "elemental_adept_minimum_die"},
		"FEAT-0048": {"mage_slayer_break_concentration", "mage_slayer_protected_mind", "mage_slayer_protected_mind"},
	}
	for card, fragments := range wants {
		for _, fragment := range fragments {
			if !strings.Contains(byCard[card], fragment) {
				t.Fatalf("%s misses %s", card, fragment)
			}
		}
	}
	for _, fragment := range []string{"spell_sniper_cantrip", `"requires_attack_roll":true`, `"label":"cantrip"`} {
		if !strings.Contains(byCard["FEAT-0033"], fragment) {
			t.Fatalf("FEAT-0033 misses cantrip contract %s", fragment)
		}
	}
}
