package migrations

import (
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestLevelFiveSpellTargetingIntegrityRepairsAreStrictAndComplete(t *testing.T) {
	repairs := levelFiveSpellTargetingIntegrityRepairs()
	if len(repairs) != 35 {
		t.Fatalf("got %d repairs, want 35", len(repairs))
	}
	seen := map[string]bool{}
	for _, repair := range repairs {
		if seen[repair.cardNumber] {
			t.Fatalf("duplicate targeting repair %s", repair.cardNumber)
		}
		seen[repair.cardNumber] = true
		for _, key := range []string{
			"shape", "domain", "actor_targets", "min_targets", "max_targets",
			"range_ft", "requires_line_of_sight", "allowed_relations",
		} {
			if _, exists := repair.targeting[key]; !exists {
				t.Errorf("%s missing strict key %s: %#v", repair.cardNumber, key, repair.targeting)
			}
		}
		if repair.targeting["shape"] == "area" {
			area, ok := repair.targeting["area"].(map[string]any)
			if !ok || area["kind"] == nil || (area["size_ft"] == nil && area["radius_ft"] == nil) {
				t.Errorf("%s lacks explicit area geometry: %#v", repair.cardNumber, repair.targeting)
			}
		}
	}
	for _, card := range []string{
		"SPELL-0170", "SPELL-0176", "SPELL-0177", "SPELL-0178", "SPELL-0184",
		"SPELL-0196", "SPELL-0198", "SPELL-0200", "SPELL-0208", "SPELL-0209",
		"SPELL-0210", "ray_of_enfeeblement", "SPELL-0221", "SPELL-0225", "SPELL-0227",
		"SPELL-0239", "SPELL-0249", "SPELL-0261", "SPELL-0264", "SPELL-0271",
		"SPELL-0273", "SPELL-0278", "SPELL-0279", "hold_person", "counterspell",
		"blinding_smite", "conjure_animals", "call_lightning", "vampiric_touch",
		"feign_death", "speak_with_plants", "dispel_magic", "plant_growth", "wind_wall", "slow",
	} {
		if !seen[card] {
			t.Errorf("missing audited targeting repair %s", card)
		}
	}
}

func TestLevelFiveSpellTargetingIntegrityExactHighRiskContracts(t *testing.T) {
	byCard := map[string]levelFiveTargetingPatch{}
	for _, repair := range levelFiveSpellTargetingIntegrityRepairs() {
		byCard[repair.cardNumber] = repair
	}
	if got := byCard["slow"].targeting["max_targets"]; got != 6 {
		t.Fatalf("Slow max targets = %v, want 6", got)
	}
	if got := byCard["conjure_animals"].targeting["domain"]; got != "world" {
		t.Fatalf("Conjure Animals domain = %v, want world", got)
	}
	if got := byCard["SPELL-0200"].targeting["actor_targets"]; got != false {
		t.Fatalf("Cordon of Arrows actor_targets = %v, want false", got)
	}
	callArea := byCard["call_lightning"].targeting["area"].(map[string]any)
	if callArea["kind"] != "sphere" || callArea["radius_ft"] != 5 {
		t.Fatalf("Call Lightning strike geometry drifted: %#v", callArea)
	}
	windArea := byCard["wind_wall"].targeting["area"].(map[string]any)
	if windArea["kind"] != "line" || windArea["size_ft"] != 50 || windArea["width_ft"] != 5 {
		t.Fatalf("Wind Wall geometry drifted: %#v", windArea)
	}
	encoded, err := json.Marshal(byCard["plant_growth"].targeting)
	if err != nil || len(encoded) == 0 {
		t.Fatalf("Plant Growth targeting is not JSON-safe: %v", err)
	}
}

func TestLevelFiveSpellMechanicsIntegrityRemovesFalseConditions(t *testing.T) {
	byCard := map[string]levelFiveSpellPatch{}
	for _, repair := range levelFiveSpellMechanicsIntegrityRepairs() {
		byCard[repair.cardNumber] = repair
	}
	if len(byCard) != 10 {
		t.Fatalf("got %d mechanics repairs, want 10", len(byCard))
	}
	encoded := func(card string) string {
		value, err := json.Marshal(byCard[card].effects)
		if err != nil {
			t.Fatal(err)
		}
		return string(value)
	}
	lesser := encoded("SPELL-0221")
	for _, condition := range []string{"COND-blinded", "COND-deafened", "COND-paralyzed", "COND-poisoned"} {
		if !containsAll(lesser, `"kind":"remove_effect"`, condition) {
			t.Errorf("Lesser Restoration does not remove %s: %s", condition, lesser)
		}
	}
	if containsAll(lesser, `"kind":"grant_effect"`, "COND-") {
		t.Fatalf("Lesser Restoration still grants a harmful condition: %s", lesser)
	}
	zone := encoded("SPELL-0235")
	if !containsAll(zone, `"kind":"grant_effect"`, "EFFECT-zone-of-truth-bound") ||
		containsAll(zone, `"kind":"grant_effect"`, "COND-charmed") {
		t.Fatalf("Zone of Truth retains false Charmed semantics: %s", zone)
	}
	calm := encoded("SPELL-0310")
	if !containsAll(calm, `"kind":"remove_effect"`, "COND-charmed", "COND-frightened", "EFFECT-calm-emotions-indifferent") {
		t.Fatalf("Calm Emotions does not model suppression/indifference choices: %s", calm)
	}
	stinking := encoded("stinking_cloud")
	if !containsAll(stinking, "COND-poisoned", "EFFECT-stinking-cloud-retching") {
		t.Fatalf("Stinking Cloud lacks Poisoned plus its action-denial effect: %s", stinking)
	}

	spiritual := encoded("SPELL-0196")
	if !containsAll(spiritual, `"dice":"1d8 + spellcasting"`) || strings.Contains(spiritual, "grant_effect") {
		t.Errorf("Spiritual Weapon still buffs its target or lacks spellcasting damage: %s", spiritual)
	}
	for _, card := range []string{"SPELL-0307", "spirit_guardians"} {
		if mechanics := encoded(card); strings.Contains(mechanics, `"kind":"damage"`) {
			t.Errorf("%s still deals its imported phantom cast-time damage: %s", card, mechanics)
		}
	}
	feign := encoded("feign_death")
	if !containsAll(feign, "COND-blinded", "COND-incapacitated", "EFFECT-feign-death-stasis", `"amount":600`) {
		t.Errorf("Feign Death lacks bounded data-driven effects: %s", feign)
	}
	hypnotic := encoded("hypnotic_pattern")
	if !containsAll(hypnotic, "COND-charmed", "COND-incapacitated", "EFFECT-hypnotic-pattern-stupor", `"concentration":true`) {
		t.Errorf("Hypnotic Pattern lacks its complete concentration-linked state: %s", hypnotic)
	}
	fear := encoded("fear")
	if !containsAll(fear, "COND-frightened", `"amount":10`, `"concentration":true`) {
		t.Errorf("Fear is not concentration-linked and bounded: %s", fear)
	}

	effects := levelFiveSpellIntegrityEffects()
	if len(effects) != 5 {
		t.Fatalf("got %d spell effect cards, want 5", len(effects))
	}
	for _, effect := range effects {
		if effect.id == "" || effect.cardNumber == "" || effect.name == "" || effect.description == "" {
			t.Errorf("incomplete data-driven spell effect: %#v", effect)
		}
		if effect.cardNumber == "EFFECT-stinking-cloud-retching" {
			mechanics, err := json.Marshal(effect.mechanics)
			if err != nil || !containsAll(string(mechanics), `"op":"deny"`, `"roll":"action"`, `"roll":"bonus_action"`) {
				t.Errorf("Stinking Cloud retching does not deny action and bonus action: %s (%v)", mechanics, err)
			}
		}
	}
}

func containsAll(value string, fragments ...string) bool {
	for _, fragment := range fragments {
		if !strings.Contains(value, fragment) {
			return false
		}
	}
	return true
}

func TestLevelFiveSpellTargetingIntegrityProductionClone(t *testing.T) {
	dsn := os.Getenv("LEVEL_FIVE_SPELL_TARGETING_CLONE_DSN")
	if dsn == "" {
		t.Skip("LEVEL_FIVE_SPELL_TARGETING_CLONE_DSN is not configured")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = repairLevelFiveSpellIntegrity(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}
	var repaired, invalid, untested int
	if err = db.QueryRow(`SELECT count(*),count(*) FILTER (WHERE NOT (
		mechanics->'targeting' ?& ARRAY[
			'shape','domain','actor_targets','min_targets','max_targets',
			'range_ft','requires_line_of_sight','allowed_relations'
		])),count(*) FILTER (WHERE support->>'status'='untested')
		FROM spells WHERE card_number=ANY($1::text[]) AND deleted_at IS NULL`, func() []string {
		cards := make([]string, 0, len(levelFiveSpellTargetingIntegrityRepairs()))
		for _, repair := range levelFiveSpellTargetingIntegrityRepairs() {
			cards = append(cards, repair.cardNumber)
		}
		return cards
	}()).Scan(&repaired, &invalid, &untested); err != nil {
		t.Fatal(err)
	}
	if repaired != 35 || invalid != 0 || untested != 35 {
		t.Fatalf("targeted=%d invalid=%d untested=%d, want 35/0/35", repaired, invalid, untested)
	}
	var strict, effects, falseConditions int
	if err = db.QueryRow(`SELECT
		count(*) FILTER (WHERE mechanics->'targeting' ?& ARRAY[
			'shape','domain','actor_targets','min_targets','max_targets',
			'range_ft','requires_line_of_sight','allowed_relations'
		]),
		(SELECT count(*) FROM effects WHERE card_number=ANY(ARRAY[
			'EFFECT-zone-of-truth-bound','EFFECT-calm-emotions-indifferent',
			'EFFECT-stinking-cloud-retching','EFFECT-feign-death-stasis',
			'EFFECT-hypnotic-pattern-stupor']) AND deleted_at IS NULL),
		count(*) FILTER (WHERE
			(card_number='SPELL-0221' AND mechanics::text LIKE '%"kind": "grant_effect"%COND-%') OR
			(card_number='SPELL-0235' AND mechanics::text LIKE '%COND-charmed%'))
		FROM spells WHERE deleted_at IS NULL AND level IN (2,3)
		AND card_number NOT IN ('SPELL-0483','SPELL-0485')`).Scan(&strict, &effects, &falseConditions); err != nil {
		t.Fatal(err)
	}
	if strict != expectedLevelFivePHBSpells || effects != 5 || falseConditions != 0 {
		t.Fatalf("strict=%d effects=%d false_conditions=%d, want %d/5/0",
			strict, effects, falseConditions, expectedLevelFivePHBSpells)
	}
}
