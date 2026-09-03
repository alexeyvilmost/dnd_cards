package migrations

import (
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func assertNoGenericConditionPayload(t *testing.T, label string, mechanics any) {
	t.Helper()
	references := map[string]bool{}
	if err := auditLevelFiveStrictConditionMechanics(mechanics, label, references); err != nil {
		t.Fatal(err)
	}
}

func TestLevelFiveConditionReferenceRewriteIsRecursiveAndExact(t *testing.T) {
	input := map[string]any{
		"effects": []any{map[string]any{
			"resolution": "save",
			"on_fail": []any{
				map[string]any{"kind": "condition", "value": "restrained", "op": "apply", "duration": map[string]any{"type": "rounds", "amount": 10}},
				map[string]any{"kind": "condition", "value": "polymorphed", "op": "remove"},
			},
		}},
		"tactical": map[string]any{"inside_condition": "blinded"},
	}
	rewritten, changed, err := rewriteLevelFiveConditionReferences(input)
	if err != nil {
		t.Fatal(err)
	}
	if changed != 3 {
		t.Fatalf("rewrote %d condition paths, want 3", changed)
	}
	encoded, _ := json.Marshal(rewritten)
	for _, want := range []string{
		`"kind":"grant_effect","value":"COND-restrained"`,
		`"card_number":"COND-polymorphed","kind":"remove_effect"`,
		`"inside_effect":{"kind":"grant_effect","value":"COND-blinded"}`,
		`"duration":{"amount":10,"type":"rounds"}`,
	} {
		if !strings.Contains(string(encoded), want) {
			t.Errorf("strict rewrite misses %s: %s", want, encoded)
		}
	}
	assertNoGenericConditionPayload(t, "rewritten", rewritten)
	second, secondChanged, err := rewriteLevelFiveConditionReferences(rewritten)
	if err != nil || secondChanged != 0 {
		t.Fatalf("strict rewrite is not idempotent: changed=%d err=%v", secondChanged, err)
	}
	secondJSON, _ := json.Marshal(second)
	if string(encoded) != string(secondJSON) {
		t.Fatalf("second rewrite changed bytes: %s / %s", encoded, secondJSON)
	}
}

func TestLevelThreeToFiveDeclarationsNeverApplyGenericConditions(t *testing.T) {
	// Exact source declaration denominator across the new level-3/5 and general
	// feat migrations. Projected subclass mechanics are audited as database rows
	// by the migration/clone test because their source is the production catalog.
	if len(levelThreeCoreActions) != 4 || len(levelThreeCoreEffects) != 6 ||
		len(levelFiveActions) != 22 || len(levelFiveEffects) != 18 ||
		len(generalFeatActions) != 7 || len(generalFeatSignatures) != 33 ||
		len(generalSpellFeatSeeds()) != 9 || len(generalSpellFeatActionSeeds()) != 7 {
		t.Fatalf("strict-condition source denominator drifted: l3=%d/%d l5=%d/%d feats=%d/%d spell-feats=%d/%d",
			len(levelThreeCoreActions), len(levelThreeCoreEffects), len(levelFiveActions), len(levelFiveEffects),
			len(generalFeatActions), len(generalFeatSignatures), len(generalSpellFeatSeeds()), len(generalSpellFeatActionSeeds()))
	}
	checked := 0
	decode := func(label, raw string) {
		t.Helper()
		var mechanics any
		if err := json.Unmarshal([]byte(raw), &mechanics); err != nil {
			t.Fatalf("%s: %v", label, err)
		}
		assertNoGenericConditionPayload(t, label, mechanics)
		checked++
	}
	for _, row := range levelThreeCoreActions {
		decode(row.card, row.mechanics)
	}
	for _, row := range levelThreeCoreEffects {
		decode(row.card, row.mechanics)
	}
	for _, row := range levelFiveActions {
		decode(row.card, row.mechanics)
	}
	for _, row := range levelFiveEffects {
		decode(row.card, row.mechanics)
	}
	for _, row := range generalFeatActions {
		decode(row.card, row.mechanics)
	}
	for _, row := range generalFeatSignatures {
		decode(row.card, row.mechanics)
	}
	for _, row := range generalSpellFeatSeeds() {
		assertNoGenericConditionPayload(t, row.card, row.mechanics)
		checked++
	}
	for _, row := range generalSpellFeatActionSeeds() {
		assertNoGenericConditionPayload(t, row.card, row.mechanics)
		checked++
	}
	for _, row := range []struct{ label, mechanics string }{
		{"stunning strike", stunningStrikeHardenedMechanics},
		{"cunning strike", cunningStrikeHardenedMechanics(`{"resolution":"auto","result":[]}`, false)},
		{"cunning withdraw", cunningStrikeHardenedMechanics(`{"resolution":"auto","result":[]}`, true)},
		{"uncanny dodge", uncannyDodgeHardenedMechanics},
	} {
		decode(row.label, row.mechanics)
	}
	for _, patch := range levelFiveSpellAreaPatches() {
		assertNoGenericConditionPayload(t, patch.cardNumber, patch.effects)
		checked++
	}
	for _, patch := range []levelFiveSpellPatch{
		levelFiveBlindnessDeafnessPatch(), levelFiveProtectionFromPoisonPatch(),
	} {
		assertNoGenericConditionPayload(t, patch.cardNumber, patch.effects)
		checked++
	}
	if checked != 122 {
		t.Fatalf("audited %d source mechanics documents, want 122", checked)
	}
}

func TestRepairLevelFiveStrictConditionsProductionClone(t *testing.T) {
	dsn := os.Getenv("LEVEL_FIVE_STRICT_CONDITIONS_CLONE_DSN")
	if dsn == "" {
		t.Skip("LEVEL_FIVE_STRICT_CONDITIONS_CLONE_DSN is not configured")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = db.Ping(); err != nil {
		t.Fatal(err)
	}
	for run := 0; run < 2; run++ {
		if err = repairLevelFiveStrictConditions(db); err != nil {
			t.Fatalf("strict-condition migration run %d: %v", run+1, err)
		}
	}
	var generic int
	if err = db.QueryRow(`SELECT count(*) FROM (
		SELECT mechanics FROM spells WHERE deleted_at IS NULL AND `+levelFivePHBSpellPredicate+`
		UNION ALL SELECT mechanics FROM actions WHERE deleted_at IS NULL AND card_number LIKE 'ACT-subclass-EFFECT-%'
		UNION ALL SELECT mechanics FROM effects WHERE deleted_at IS NULL AND card_number=ANY($1::text[])
	) scoped WHERE jsonb_path_exists(mechanics, '$.** ? (@.kind == "condition")')
	   OR mechanics::text LIKE '%inside_condition%'`, func() []string {
		cards := make([]string, 0, len(levelFiveActiveSubclassTargets))
		for _, row := range levelFiveActiveSubclassTargets {
			cards = append(cards, row.effectCard)
		}
		return cards
	}()).Scan(&generic); err != nil {
		t.Fatal(err)
	}
	if generic != 0 {
		t.Fatalf("production clone retains %d generic/bare condition rows", generic)
	}
}
