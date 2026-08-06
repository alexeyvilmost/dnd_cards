package main

import (
	"errors"
	"net/http"
	"strings"
	"testing"
)

func TestCharacterV3EventRouteRejectsMalformedBatchAtomically(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	response := performCharacterV3Request(
		t,
		fixture.router,
		http.MethodPost,
		"/api/characters-v3/"+fixture.ownerCharacter.ID.String()+"/events",
		fixture.token(t, fixture.owner),
		map[string]any{"events": []any{
			map[string]any{"type": "narrative", "payload": map[string]any{"type": "narrative", "text": "must roll back"}},
			map[string]any{"type": "damage", "payload": map[string]any{"type": "healing", "amount": 3}},
		}},
	)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "events[1]") {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var count int64
	if err := fixture.db.Model(&CharacterEvent{}).
		Where("character_id = ?", fixture.ownerCharacter.ID).
		Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("malformed batch persisted %d rows, want 0", count)
	}
}

func TestCharacterV3EventRoutePersistsValidatedEngineEvents(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	response := performCharacterV3Request(
		t,
		fixture.router,
		http.MethodPost,
		"/api/characters-v3/"+fixture.ownerCharacter.ID.String()+"/events",
		fixture.token(t, fixture.owner),
		map[string]any{"events": []any{
			map[string]any{"type": "damage", "payload": map[string]any{"type": "damage", "amount": 3, "damageType": "force"}},
			map[string]any{"type": "condition_applied", "payload": map[string]any{"type": "condition_applied", "condition": "prone"}},
			map[string]any{"type": "resource_spent", "payload": map[string]any{"type": "resource_spent", "resource": "action", "amount": 1, "remaining": 0}},
		}},
	)
	if response.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var rows []CharacterEvent
	if err := fixture.db.Where("character_id = ?", fixture.ownerCharacter.ID).Order("created_at").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("persisted rows=%d, want 3", len(rows))
	}
	for _, row := range rows {
		if row.Payload["type"] != row.Type {
			t.Fatalf("persisted discriminants diverged: type=%q payload=%#v", row.Type, row.Payload)
		}
	}
}

func TestCharacterEventModelGuardRejectsInternalMalformedWrite(t *testing.T) {
	fixture := openCharacterV3AccessFixture(t)
	row := CharacterEvent{
		CharacterID: fixture.ownerCharacter.ID,
		Type:        "effect_applied",
		Payload:     JSONMap{"type": "effect_applied"},
	}
	err := fixture.db.Create(&row).Error
	var validationErr *characterEventValidationError
	if !errors.As(err, &validationErr) {
		t.Fatalf("Create error=%v, want characterEventValidationError", err)
	}
	var count int64
	if countErr := fixture.db.Model(&CharacterEvent{}).
		Where("character_id = ?", fixture.ownerCharacter.ID).
		Count(&count).Error; countErr != nil {
		t.Fatal(countErr)
	}
	if count != 0 {
		t.Fatalf("model hook allowed malformed row: count=%d", count)
	}
}

func TestEncounterApplyRejectsMalformedCharacterJournalAtomically(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*BattleLogEntry)
		want   string
	}{
		{
			name: "mismatched discriminants",
			mutate: func(entry *BattleLogEntry) {
				entry.Payload = JSONMap{"type": "healing", "amount": float64(3)}
			},
			want: "must exactly match",
		},
		{
			name: "missing outer discriminant",
			mutate: func(entry *BattleLogEntry) {
				entry.Type = ""
			},
			want: "type",
		},
		{
			name: "missing payload",
			mutate: func(entry *BattleLogEntry) {
				entry.Payload = nil
			},
			want: "payload",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := openEncounterTransactionFixture(t)
			request := encounterPatchWithJournal(fixture.characterID)
			test.mutate(&request.Log[0])
			response := fixture.apply(t, request)
			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), test.want) {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			fixture.assertInitialState(t)
		})
	}
}
