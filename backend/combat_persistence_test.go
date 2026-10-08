package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestCombatInsertOnlyReceiptKeepsDurableReader(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&RoguelikeCommandReceipt{}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DB_COMPACT_RECEIPTS", "1")
	for _, skip := range []bool{false, true} {
		expected := JSONMap{"turn": 2, "nested": map[string]any{"effects": []any{"one", "two"}}, "text": strings.Repeat("snapshot 🐉", 20000)}
		raw, _ := json.Marshal(expected)
		r := RoguelikeCommandReceipt{RunID: uuid.New(), UserID: f.owner.ID, CommandID: uuid.New(), CommandType: "combat_intent", RequestHash: strings.Repeat("a", 64), Request: JSONMap{}, Response: expected, omitResponseReload: skip}
		if err := f.db.Create(&r).Error; err != nil {
			t.Fatal(err)
		}
		if r.ResponseVersion != 2 {
			t.Fatal("compact writer not used")
		}
		if skip && len(r.Response) != 0 {
			t.Fatal("discarded return unnecessarily decoded")
		}
		if !skip && r.Response["text"] == nil {
			t.Fatal("ordinary create return changed")
		}
		var loaded RoguelikeCommandReceipt
		if err := f.db.First(&loaded, "id=?", r.ID).Error; err != nil {
			t.Fatal(err)
		}
		got, _ := json.Marshal(loaded.Response)
		if string(got) != string(raw) {
			t.Fatal("durable exact retry bytes changed")
		}
	}
}

func TestValidatedCombatJournalIdentityMatchesOriginal(t *testing.T) {
	artifact := "sha256:" + strings.Repeat("a", 64)
	for _, entropy := range []any{map[string]any{"seed": "first 🐉", "cursor": 9}, JSONMap{"seed": "second", "cursor": 12}, map[string]any{"seed": ""}, map[string]any{"seed": 3}, nil, struct {
		Seed string `json:"seed"`
	}{"third"}} {
		for _, pin := range []any{artifact, "unknown", 3, nil} {
			envelope := JSONMap{"artifactHash": pin, "entropy": entropy, "state": map[string]any{"catalog": strings.Repeat("effect", 100000)}}
			a, ae := roguelikeCombatJournalKey(envelope)
			b, be := validatedRoguelikeCombatJournalKey(envelope)
			if a != b || (ae == nil) != (be == nil) {
				t.Fatal("journal identity changed")
			}
		}
	}
}
