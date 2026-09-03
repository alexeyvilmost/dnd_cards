package migrations

import (
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestLevelFiveProgressionOwnsExactPHBClassAndSubclassDenominators(t *testing.T) {
	if len(levelFiveBaseClassCards) != 12 {
		t.Fatalf("expected 12 base classes, got %d", len(levelFiveBaseClassCards))
	}
	if len(levelFiveSubclassCards) != 48 {
		t.Fatalf("expected 48 PHB subclasses, got %d", len(levelFiveSubclassCards))
	}
	assertUniqueStrings(t, "base class", levelFiveBaseClassCards)
	assertUniqueStrings(t, "subclass", levelFiveSubclassCards)
	for _, card := range levelFiveSubclassCards {
		if strings.Contains(strings.ToLower(card), "pugilist") {
			t.Fatalf("custom Pugilist subclass leaked into PHB scope: %s", card)
		}
	}

	parents := map[string]int{}
	for _, card := range levelFiveSubclassCards {
		prefix := strings.SplitN(card, "_", 2)[0]
		parents[prefix]++
	}
	for _, prefix := range []string{
		"barbarian", "bard", "cleric", "druid", "fighter", "monk",
		"paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard",
	} {
		if parents[prefix] != 4 {
			t.Errorf("%s subclass denominator = %d, want 4", prefix, parents[prefix])
		}
	}
}

func TestLevelFiveActionsAreExecutableAndNeverApplyInlineConditions(t *testing.T) {
	if len(levelFiveActions) != 22 {
		t.Fatalf("expected 22 curated base/species actions, got %d", len(levelFiveActions))
	}
	for _, action := range levelFiveActions {
		var mechanics struct {
			Activation struct {
				Mode string `json:"mode"`
				Cost []struct {
					Resource string `json:"resource"`
				} `json:"cost"`
			} `json:"activation"`
			Targeting struct {
				Domain       string `json:"domain"`
				ActorTargets *bool  `json:"actor_targets"`
			} `json:"targeting"`
		}
		if err := json.Unmarshal([]byte(action.mechanics), &mechanics); err != nil {
			t.Fatalf("%s mechanics is invalid JSON: %v", action.card, err)
		}
		if mechanics.Activation.Mode == "" || mechanics.Activation.Cost == nil {
			t.Errorf("%s lacks explicit activation/cost", action.card)
		}
		if mechanics.Targeting.Domain == "" {
			t.Errorf("%s lacks explicit targeting", action.card)
		}
		if mechanics.Targeting.Domain == "actor" && mechanics.Targeting.ActorTargets == nil {
			t.Errorf("%s actor targeting lacks actor_targets", action.card)
		}
		if strings.Contains(action.mechanics, `"kind":"condition"`) {
			t.Errorf("%s applies a generic inline condition", action.card)
		}
	}
	joined := strings.Join(func() []string {
		out := make([]string, 0, len(levelFiveActions))
		for _, action := range levelFiveActions {
			out = append(out, action.mechanics)
		}
		return out
	}(), "\n")
	for _, ref := range []string{`"value":"COND-stunned"`, `"value":"COND-poisoned"`, `"value":"COND-prone"`} {
		if !strings.Contains(joined, ref) {
			t.Errorf("missing library condition reference %s", ref)
		}
	}
	for _, card := range []string{
		"ACT-bard-font-slot-1", "ACT-bard-font-slot-2", "ACT-bard-font-slot-3",
		"ACT-font-create-slot-2", "ACT-font-create-slot-3", "ACT-font-convert-slot-2", "ACT-font-convert-slot-3",
	} {
		found := false
		for _, action := range levelFiveActions {
			found = found || action.card == card
		}
		if !found {
			t.Errorf("missing level-five slot conversion action %s", card)
		}
	}
}

func TestLevelFiveEffectsAreDataDrivenAndExtraAttackHasExactOwners(t *testing.T) {
	for _, effect := range levelFiveEffects {
		var mechanics map[string]any
		if err := json.Unmarshal([]byte(effect.mechanics), &mechanics); err != nil {
			t.Fatalf("%s mechanics is invalid JSON: %v", effect.card, err)
		}
		if strings.Contains(effect.mechanics, `"kind":"condition"`) {
			t.Errorf("%s applies a generic inline condition", effect.card)
		}
	}

	owners := map[string]bool{}
	for _, binding := range levelFiveProgressionBindings {
		for _, effect := range binding.effects {
			if effect == "EFF-extra-attack" {
				if binding.level != 5 {
					t.Errorf("Extra Attack bound at level %d for %s", binding.level, binding.ownerCard)
				}
				owners[binding.ownerCard] = true
			}
		}
	}
	want := []string{"CLASS-barbarian", "CLASS-warrior", "CLASS-monk", "CLASS-paladin", "CLASS-ranger"}
	if len(owners) != len(want) {
		t.Fatalf("Extra Attack owners=%v, want %v", owners, want)
	}
	for _, card := range want {
		if !owners[card] {
			t.Errorf("%s lacks Extra Attack at level 5", card)
		}
	}
	for _, card := range []string{"CLASS-bard", "CLASS-cleric", "CLASS-druid", "CLASS-rogue", "CLASS-sorcerer", "CLASS-warlock", "CLASS-wizard"} {
		if owners[card] {
			t.Errorf("%s incorrectly gains Extra Attack at level 5", card)
		}
	}
}

func TestLevelFiveSpeciesSpellGrantsHaveBothGatedUnlocks(t *testing.T) {
	if len(levelFiveSpeciesSpellGrants) != 6 {
		t.Fatalf("expected six Elf/Tiefling lineage progressions, got %d", len(levelFiveSpeciesSpellGrants))
	}
	owners := make([]string, 0, len(levelFiveSpeciesSpellGrants))
	for _, grant := range levelFiveSpeciesSpellGrants {
		owners = append(owners, grant.ownerCard)
		if grant.levelThreeSpell == "" || grant.levelFiveSpell == "" || grant.levelThreeSpell == grant.levelFiveSpell && grant.ownerCard != "sub-infernal" {
			t.Errorf("invalid gated species spell pair for %s: %q / %q", grant.ownerCard, grant.levelThreeSpell, grant.levelFiveSpell)
		}
	}
	assertUniqueStrings(t, "species progression owner", owners)
	if len(levelFiveElfLineageEffectCards) != 3 {
		t.Fatalf("expected the three Elf lineage effects to defer spellcasting ability, got %d", len(levelFiveElfLineageEffectCards))
	}
	assertUniqueStrings(t, "Elf lineage effect", levelFiveElfLineageEffectCards)
	for _, card := range []string{"RE-sub-drow", "RE-sub-high_elf", "RE-sub-wood_elf"} {
		if !levelFiveContainsString(levelFiveElfLineageEffectCards, card) {
			t.Errorf("missing Elf lineage ability-choice repair for %s", card)
		}
	}
	bindings := map[string]bool{}
	for _, binding := range levelFiveProgressionBindings {
		bindings[binding.ownerCard] = true
	}
	if !bindings["RACE-0011"] {
		t.Fatal("Goliath Large Form must be a level-five race progression binding")
	}
}

func TestLevelFiveSubclassSpellAndActiveProjectionDenominators(t *testing.T) {
	if len(levelFiveSubclassSpellGrants) != 19 {
		t.Fatalf("expected 19 subclass spell tables with level-five rows, got %d", len(levelFiveSubclassSpellGrants))
	}
	seen := map[string]bool{}
	for _, table := range levelFiveSubclassSpellGrants {
		if len(table.spells) == 0 {
			t.Errorf("%s has an empty level-five spell row", table.effectCard)
		}
		for _, spell := range table.spells {
			key := table.effectCard + "\x00" + spell
			if seen[key] {
				t.Errorf("duplicate subclass spell grant %s / %s", table.effectCard, spell)
			}
			seen[key] = true
		}
	}

	if len(levelFiveActiveSubclassTargets) != 23 {
		t.Fatalf("expected 23 safely projectable active subclass features, got %d", len(levelFiveActiveSubclassTargets))
	}
	active := make([]string, 0, len(levelFiveActiveSubclassTargets))
	for _, projection := range levelFiveActiveSubclassTargets {
		active = append(active, projection.effectCard)
		var targeting struct {
			Domain       string `json:"domain"`
			ActorTargets *bool  `json:"actor_targets"`
		}
		if err := json.Unmarshal([]byte(projection.targeting), &targeting); err != nil {
			t.Fatalf("%s targeting is invalid JSON: %v", projection.effectCard, err)
		}
		if targeting.Domain == "" || targeting.ActorTargets == nil {
			t.Errorf("%s targeting does not explicitly declare domain/actor_targets", projection.effectCard)
		}
	}
	assertUniqueStrings(t, "active subclass feature", active)
	for _, triggered := range []string{"EFFECT-0012", "EFFECT-0023", "EFFECT-0036", "EFFECT-0243"} {
		if levelFiveContainsString(active, triggered) {
			t.Errorf("triggered feature %s must not be projected as a freely callable action", triggered)
		}
	}
}

func TestLevelFiveProgressionPostgresClone(t *testing.T) {
	dsn := os.Getenv("LEVEL_FIVE_CLONE_DSN")
	if dsn == "" {
		t.Skip("LEVEL_FIVE_CLONE_DSN is not set")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = materializeLevelFiveProgression(db); err != nil {
		t.Fatal(err)
	}
	assertDBCount := func(label, query string, want int) {
		t.Helper()
		var got int
		if queryErr := db.QueryRow(query).Scan(&got); queryErr != nil {
			t.Fatalf("%s query: %v", label, queryErr)
		}
		if got != want {
			t.Fatalf("%s = %d, want %d", label, got, want)
		}
	}
	assertDBCount("base classes marked untested", `SELECT count(*) FROM classes
		WHERE card_number=ANY(ARRAY['CLASS-barbarian','CLASS-bard','CLASS-cleric','CLASS-druid','CLASS-warrior','CLASS-monk','CLASS-paladin','CLASS-ranger','CLASS-rogue','CLASS-sorcerer','CLASS-warlock','CLASS-wizard'])
		AND support->>'certification_version'='167_materialize_level_five_progression'`, 12)
	assertDBCount("subclasses marked untested", `SELECT count(*) FROM classes
		WHERE is_subclass AND card_number<>'SUB-pugilist-sweet-science'
		AND support->>'certification_version'='167_materialize_level_five_progression'`, 48)
	assertDBCount("Extra Attack owners", `SELECT count(*) FROM classes c JOIN effects e
		ON c.level_progression#>'{5,effects}' ? e.id::text
		WHERE e.card_number='EFF-extra-attack'
		AND c.card_number=ANY(ARRAY['CLASS-barbarian','CLASS-warrior','CLASS-monk','CLASS-paladin','CLASS-ranger'])`, 5)
	assertDBCount("level-four feat owners", `SELECT count(*) FROM classes c JOIN effects e
		ON c.level_progression#>'{4,effects}' ? e.id::text WHERE e.card_number='pf_1'
		AND c.card_number=ANY(ARRAY['CLASS-barbarian','CLASS-bard','CLASS-cleric','CLASS-druid','CLASS-warrior','CLASS-monk','CLASS-paladin','CLASS-ranger','CLASS-rogue','CLASS-sorcerer','CLASS-warlock','CLASS-wizard'])`, 12)
	assertDBCount("projected active subclass actions", `SELECT count(*) FROM actions
		WHERE card_number LIKE 'ACT-subclass-EFFECT-%' AND mechanics#>>'{activation,mode}'='active'`, 23)
	assertDBCount("hard-coded Elf lineage spell abilities", `SELECT count(*) FROM effects e
		CROSS JOIN LATERAL jsonb_array_elements(e.mechanics#>'{effects,0,result}') item
		WHERE e.card_number=ANY(ARRAY['RE-sub-drow','RE-sub-high_elf','RE-sub-wood_elf'])
		AND item->>'kind'='grant_spell' AND item ? 'ability'`, 0)
	assertDBCount("Dragonborn flight owner", `SELECT count(*) FROM effects
		WHERE card_number='RE-dragonborn-4' AND mechanics::text LIKE '%ACT-dragonborn-draconic-flight%'`, 1)
	assertDBCount("Goliath Large Form owner", `SELECT count(*) FROM races r JOIN effects e
		ON r.level_progression#>'{5,effects}' ? e.id::text
		WHERE r.card_number='RACE-0011' AND e.card_number='EFF-goliath-large-form'`, 1)
}

func assertUniqueStrings(t *testing.T, label string, values []string) {
	t.Helper()
	seen := map[string]bool{}
	for _, value := range values {
		if value == "" {
			t.Errorf("%s contains an empty identifier", label)
		}
		if seen[value] {
			t.Errorf("duplicate %s identifier %s", label, value)
		}
		seen[value] = true
	}
}

func levelFiveContainsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}
