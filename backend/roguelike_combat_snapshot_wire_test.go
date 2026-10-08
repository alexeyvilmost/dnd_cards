package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestCombatSnapshotDeltaNegotiatesExactSameFrameAndPreservesDifferences(t *testing.T) {
	for _, text := range []string{strings.Repeat("first ", 100), strings.Repeat("другая сущность 🐉 ", 80)} {
		id := uuid.New()
		state := JSONMap{"actionPresentation": map[string]any{"name": "state", "description": text}, "log": []any{1, 2, 3, 4, 5, 6, 7, 8, 9}}
		snapshot := map[string]any{"actionPresentation": map[string]any{"name": "sheet", "description": text}, "log": []any{2, 3, 4, 5, 6, 7, 8, 9, 10}, "privateSheetField": nil}
		turn := JSONMap{"solo_combat_v1": snapshot}
		character := &CharacterV3{ID: id, TurnState: &turn}
		run := &RoguelikeRun{ID: uuid.New(), UserID: uuid.New(), CharacterID: id, Character: character, Characters: []*CharacterV3{character}, CombatState: state}
		original, _ := json.Marshal(run)
		for _, negotiation := range []string{"", combatFrameWire, combatDeltaWire, combatSnapshotDeltaWire} {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodGet, "/commands", nil)
			c.Request.Header.Set("X-Combat-Wire", negotiation)
			writeCombatRunResponse(c, run)
			if w.Code != 200 {
				t.Fatal("wire response failed")
			}
			var frame combatFrameResponse
			if err := json.Unmarshal(w.Body.Bytes(), &frame); err != nil {
				t.Fatal(err)
			}
			if negotiation != combatSnapshotDeltaWire {
				if frame.SnapshotDelta != nil {
					t.Fatal("older client received a snapshot delta")
				}
				continue
			}
			if frame.WireSchema != combatSnapshotDeltaWire || frame.SnapshotDelta == nil || frame.SnapshotDelta.BaseCommandID != combatSnapshotBase || len(frame.SnapshotDelta.References) != 1 || len(frame.SnapshotDelta.ArrayPrefixes) != 1 {
				t.Fatal("same-frame references or history window missing")
			}
			if err := restoreWorkerStateDelta(map[string]any(frame.Snapshot), map[string]any(frame.Run.CombatState), workerStateDeltaMetadata{References: frame.SnapshotDelta.References, Prefixes: frame.SnapshotDelta.ArrayPrefixes}); err != nil {
				t.Fatal(err)
			}
			var expected any
			raw, _ := json.Marshal(snapshot)
			json.Unmarshal(raw, &expected)
			if !reflect.DeepEqual(map[string]any(frame.Snapshot), expected) {
				t.Fatal("reconstructed snapshot differs")
			}
			if len(w.Body.Bytes()) >= len(original) {
				t.Fatal("large repeated descriptions were not compacted")
			}
		}
		after, _ := json.Marshal(run)
		if !bytes.Equal(original, after) {
			t.Fatal("wire compaction mutated the canonical accepted run")
		}
	}
}
