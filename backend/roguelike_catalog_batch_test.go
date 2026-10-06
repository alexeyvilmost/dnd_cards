package main

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestCatalogBatchWaveMatchesLegacyAndDeduplicatesSQL(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&Action{}, &Effect{}, &Variable{}); err != nil {
		t.Fatal(err)
	}
	a := Action{ID: uuid.New(), Name: "Different action A", CardNumber: "BATCH-A", ImageURL: "data:image/png;base64,local-fixture"}
	b := Action{ID: uuid.New(), Name: "Different action B", CardNumber: "BATCH-B"}
	x, y := "wave_x", "wave_y"
	effects := []Effect{{ID: uuid.New(), Name: "X", CardNumber: "BATCH-X", Type: &x}, {ID: uuid.New(), Name: "Y", CardNumber: "BATCH-Y", Type: &y}}
	for _, row := range []any{&a, &b, &effects[0], &effects[1], &Variable{VariableID: "batch-variable", Name: "Batch variable"}} {
		if err := f.db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := registerPerformanceCallbacks(f.db); err != nil {
		t.Fatal(err)
	}
	needs := []roguelikeWorkerNeed{{Kind: "entity", EntityType: "action", Reference: a.ID.String()}, {Kind: "entity", EntityType: "action", Reference: b.ID.String()},
		{Kind: "effect_type", EffectType: x}, {Kind: "effect_type", EffectType: y}, {Kind: "variables"}}
	needs = append(needs, needs...)
	legacy, batch := emptyRoguelikeFrozenCatalog(), emptyRoguelikeFrozenCatalog()
	oldTrace, newTrace := &requestPerformance{values: map[string]float64{}}, &requestPerformance{values: map[string]float64{}}
	oldDB := f.db.WithContext(context.WithValue(context.Background(), performanceContextKey{}, oldTrace))
	for _, need := range needs {
		if err := legacy.fulfill(oldDB, need); err != nil {
			t.Fatal(err)
		}
	}
	if err := batch.fulfillBatch(f.db.WithContext(context.WithValue(context.Background(), performanceContextKey{}, newTrace)), needs); err != nil {
		t.Fatal(err)
	}
	oldJSON, _ := json.Marshal(legacy)
	newJSON, _ := json.Marshal(batch)
	if string(oldJSON) != string(newJSON) {
		t.Fatal("batch changed canonical catalog bytes")
	}
	if oldTrace.snapshot()["sql_count"] != 10 || newTrace.snapshot()["sql_count"] != 3 {
		t.Fatalf("expected 10 -> 3 SQL operations, got %.0f -> %.0f", oldTrace.snapshot()["sql_count"], newTrace.snapshot()["sql_count"])
	}
	if newTrace.snapshot()["catalog_needs_count"] != 10 || newTrace.snapshot()["catalog_unique_needs_count"] != 5 {
		t.Fatal("needs metrics lost duplicate/unique distinction")
	}
	// A frozen UUID is not silently overwritten. A new preparation reads current
	// content; there is no cross-request reuse of the old row.
	if err := f.db.Model(&a).Update("name", "Changed action A").Error; err != nil {
		t.Fatal(err)
	}
	if err := batch.fulfillBatch(f.db, needs); err != nil {
		t.Fatal(err)
	}
	stillFrozen, _ := json.Marshal(batch)
	if string(stillFrozen) != string(newJSON) {
		t.Fatal("existing frozen row changed")
	}
	fresh := emptyRoguelikeFrozenCatalog()
	if err := fresh.fulfillBatch(f.db, needs); err != nil {
		t.Fatal(err)
	}
	freshJSON, _ := json.Marshal(fresh)
	if string(freshJSON) == string(newJSON) {
		t.Fatal("new preparation reused stale catalog")
	}
}

func TestCatalogBatchMissingUnknownAliasesAndEmptyCompleteness(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&Spell{}, &Effect{}, &Variable{}); err != nil {
		t.Fatal(err)
	}
	name := "  Hunter's Mark!  "
	first := Spell{ID: uuid.New(), Name: "Alias A", NameEn: &name, CardNumber: "EXACT-A"}
	if err := f.db.Create(&first).Error; err != nil {
		t.Fatal(err)
	}
	needs := []roguelikeWorkerNeed{{Kind: "entity", EntityType: "spell", Reference: "  HUNTERS_MARK  "}, {Kind: "effect_type", EffectType: "empty"}, {Kind: "variables"}}
	legacy, batch := emptyRoguelikeFrozenCatalog(), emptyRoguelikeFrozenCatalog()
	for _, need := range needs {
		if err := legacy.fulfill(f.db, need); err != nil {
			t.Fatal(err)
		}
	}
	if err := batch.fulfillBatch(f.db, needs); err != nil {
		t.Fatal(err)
	}
	oldJSON, _ := json.Marshal(legacy)
	newJSON, _ := json.Marshal(batch)
	if string(oldJSON) != string(newJSON) {
		t.Fatal("alias/empty completeness differs from legacy")
	}
	second := Spell{ID: uuid.New(), Name: "Alias B", NameEn: &name, CardNumber: "EXACT-B"}
	if err := f.db.Create(&second).Error; err != nil {
		t.Fatal(err)
	}
	ambiguous := emptyRoguelikeFrozenCatalog()
	err := ambiguous.fulfillBatch(f.db, needs)
	var rejection *roguelikeWorkerRejection
	if !errors.As(err, &rejection) || rejection.Code != "combat_catalog_ambiguous_ref" {
		t.Fatal("ambiguous spell alias accepted")
	}
	for _, ref := range []string{second.ID.String(), second.CardNumber} {
		exact := emptyRoguelikeFrozenCatalog()
		if err := exact.fulfillBatch(f.db, []roguelikeWorkerNeed{{Kind: "entity", EntityType: "spell", Reference: ref}}); err != nil || len(exact.Entities["spell"]) != 1 || exact.Entities["spell"][0]["id"] != second.ID.String() {
			t.Fatal("exact reference lost to alias")
		}
	}
	if err := f.db.Delete(&second).Error; err != nil {
		t.Fatal(err)
	}
	visible := emptyRoguelikeFrozenCatalog()
	if err := visible.fulfillBatch(f.db, needs); err != nil || len(visible.Entities["spell"]) != 1 || visible.Entities["spell"][0]["id"] != first.ID.String() {
		t.Fatal("batch alias lookup included a soft-deleted entity")
	}
	missing := emptyRoguelikeFrozenCatalog()
	if err := missing.fulfillBatch(f.db, []roguelikeWorkerNeed{{Kind: "entity", EntityType: "spell", Reference: "absent"}}); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("missing entity silently accepted")
	}
	blank := emptyRoguelikeFrozenCatalog()
	if err := blank.fulfillBatch(f.db, []roguelikeWorkerNeed{{Kind: "entity", EntityType: "spell", Reference: "  "}}); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("blank alias must be missing, not an alias of unnamed spells")
	}
	for _, need := range []roguelikeWorkerNeed{{Kind: "unknown"}, {Kind: "entity", EntityType: "unknown", Reference: "id"}, {Kind: "entity", EntityType: "spell"}} {
		unknown := emptyRoguelikeFrozenCatalog()
		if err := unknown.fulfillBatch(f.db, []roguelikeWorkerNeed{need}); err == nil {
			t.Fatal("unknown dependency silently accepted")
		}
	}
}

func TestCatalogWaveDedupPreservesRowsAndFreshness(t *testing.T) {
	t.Setenv("RULES_CATALOG_BATCH_ENABLED", "0")
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&Action{}, &Effect{}, &Variable{}); err != nil {
		t.Fatal(err)
	}
	a := Action{ID: uuid.New(), Name: "Distinct A", CardNumber: "WAVE-A"}
	b := Action{ID: uuid.New(), Name: "Distinct B", CardNumber: "WAVE-B"}
	x, y := "wave_x", "wave_y"
	e1 := Effect{ID: uuid.New(), Name: "Effect X", CardNumber: "WAVE-X", Type: &x}
	e2 := Effect{ID: uuid.New(), Name: "Effect Y", CardNumber: "WAVE-Y", Type: &y}
	v := Variable{VariableID: "catalog-wave", Name: "First value"}
	for _, row := range []any{&a, &b, &e1, &e2, &v} {
		if err := f.db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := registerPerformanceCallbacks(f.db); err != nil {
		t.Fatal(err)
	}
	needs := []roguelikeWorkerNeed{{Kind: "entity", EntityType: "action", Reference: a.ID.String()}, {Kind: "entity", EntityType: "action", Reference: b.CardNumber}, {Kind: "effect_type", EffectType: x}, {Kind: "effect_type", EffectType: y}, {Kind: "variables"}}
	needs = append(needs, needs...)
	reference, actual := emptyRoguelikeFrozenCatalog(), emptyRoguelikeFrozenCatalog()
	trace := &requestPerformance{values: map[string]float64{}}
	tx := f.db.WithContext(context.WithValue(context.Background(), performanceContextKey{}, trace))
	for _, need := range needs {
		if err := reference.fulfill(f.db, need); err != nil {
			t.Fatal(err)
		}
	}
	if err := actual.fulfillWave(tx, needs); err != nil {
		t.Fatal(err)
	}
	expected, _ := json.Marshal(reference)
	saved, _ := json.Marshal(actual)
	if string(expected) != string(saved) {
		t.Fatal("wave changed canonical catalog bytes")
	}
	if trace.snapshot()["sql_count"] != 5 {
		t.Fatalf("duplicate needs still read SQL: %.0f", trace.snapshot()["sql_count"])
	}
	if err := f.db.Model(&v).Update("name", "Second value").Error; err != nil {
		t.Fatal(err)
	}
	if err := actual.fulfillWave(tx, needs); err != nil {
		t.Fatal(err)
	}
	if trace.snapshot()["sql_count"] != 10 || actual.Variables[0].Name != "Second value" {
		t.Fatal("deduplication escaped its wave and reused old variables")
	}
	if err := f.db.Model(&a).Update("name", "Changed A").Error; err != nil {
		t.Fatal(err)
	}
	fresh := emptyRoguelikeFrozenCatalog()
	if err := fresh.fulfillWave(f.db, needs); err != nil {
		t.Fatal(err)
	}
	freshBytes, _ := json.Marshal(fresh)
	if string(freshBytes) == string(saved) {
		t.Fatal("new preparation reused old entities")
	}
}
func TestCatalogWaveDedupPreservesAliasAndRefusals(t *testing.T) {
	t.Setenv("RULES_CATALOG_BATCH_ENABLED", "0")
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&Spell{}, &Effect{}, &Variable{}); err != nil {
		t.Fatal(err)
	}
	alias := "Hunter's Mark!"
	a := Spell{ID: uuid.New(), Name: "Alias A", NameEn: &alias, CardNumber: "WAVE-ALIAS-A"}
	b := Spell{ID: uuid.New(), Name: "Alias B", NameEn: &alias, CardNumber: "WAVE-ALIAS-B"}
	if err := f.db.Create(&a).Error; err != nil {
		t.Fatal(err)
	}
	need := roguelikeWorkerNeed{Kind: "entity", EntityType: "spell", Reference: "hunters_mark"}
	actual := emptyRoguelikeFrozenCatalog()
	if err := actual.fulfillWave(f.db, []roguelikeWorkerNeed{need, need}); err != nil || len(actual.Entities["spell"]) != 1 {
		t.Fatal("canonical alias lost")
	}
	if err := f.db.Create(&b).Error; err != nil {
		t.Fatal(err)
	}
	ambiguous := emptyRoguelikeFrozenCatalog()
	err := ambiguous.fulfillWave(f.db, []roguelikeWorkerNeed{need, need})
	var rejection *roguelikeWorkerRejection
	if !errors.As(err, &rejection) || rejection.Code != "combat_catalog_ambiguous_ref" {
		t.Fatal("ambiguous alias accepted")
	}
	for _, bad := range []roguelikeWorkerNeed{{Kind: "unknown"}, {Kind: "entity", EntityType: "unknown", Reference: "id"}, {Kind: "entity", EntityType: "spell"}, {Kind: "entity", EntityType: "spell", Reference: "absent"}} {
		old, new := emptyRoguelikeFrozenCatalog(), emptyRoguelikeFrozenCatalog()
		expected := old.fulfill(f.db, bad)
		got := new.fulfillWave(f.db, []roguelikeWorkerNeed{bad, bad})
		if expected == nil || got == nil || expected.Error() != got.Error() {
			t.Fatal("canonical refusal changed")
		}
	}
}
