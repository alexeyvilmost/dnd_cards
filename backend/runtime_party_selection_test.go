package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestRuntimePartySelectionPreservesNullZeroAndCanonicalSave(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	one := f.ownerCharacter
	two := one
	two.ID = uuid.New()
	two.Name = "second runtime entity"
	if err := f.db.Create(&two).Error; err != nil {
		t.Fatal(err)
	}
	run := &RoguelikeRun{CharacterID: one.ID, Character: &one, Characters: []*CharacterV3{&one, &two}}
	columns := map[uuid.UUID][]string{}
	patches := []JSONMap{{"current_hp": 0, "runtime_revision": one.RuntimeRevision + 1, "resources": map[string]any{"other": 0}, "equipment": nil}, {"current_hp": 1, "runtime_revision": two.RuntimeRevision + 1, "inventory_items": []any{}, "active_effects": []any{}}}
	for i, c := range run.Characters {
		if err := applyTrustedRoguelikePatch(c, patches[i]); err != nil {
			t.Fatal(err)
		}
		columns[c.ID] = []string{"currency", "updated_at"}
		for key := range patches[i] {
			columns[c.ID] = append(columns[c.ID], key)
		}
	}
	if err := f.db.Transaction(func(tx *gorm.DB) error { return saveRoguelikeParty(tx, run, columns) }); err != nil {
		t.Fatal(err)
	}
	for _, c := range run.Characters {
		var loaded CharacterV3
		if err := f.db.First(&loaded, "id=?", c.ID).Error; err != nil {
			t.Fatal(err)
		}
		c.UpdatedAt = loaded.UpdatedAt
		c.CreatedAt = loaded.CreatedAt
		a, _ := json.Marshal(c)
		b, _ := json.Marshal(loaded)
		if string(a) != string(b) {
			t.Fatal("selective runtime save differs from canonical DTO")
		}
		sql := f.db.Session(&gorm.Session{DryRun: true}).Omit("User", "Group").Select(columns[c.ID]).Save(c).Statement.SQL.String()
		if strings.Contains(sql, "rule_state") || strings.Contains(sql, "resolved_choices") || !strings.Contains(sql, "runtime_revision") {
			t.Fatal("static sheet data still written or runtime token omitted")
		}
	}
	if saveRoguelikeParty(f.db, run, map[uuid.UUID][]string{}) == nil {
		t.Fatal("missing selected member accepted")
	}
	one.Name = "ordinary full save remains canonical"
	if err := saveRoguelikeParty(f.db, run); err != nil {
		t.Fatal(err)
	}
	var loaded CharacterV3
	if err := f.db.First(&loaded, "id=?", one.ID).Error; err != nil || loaded.Name != one.Name {
		t.Fatal("ordinary writer changed")
	}
}
