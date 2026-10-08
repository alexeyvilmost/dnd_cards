package main

import (
	"net/http"
	"reflect"
	"sort"

	"github.com/gin-gonic/gin"
)

const combatFrameWire = "combat-frame-v1"

type combatFrameResponse struct {
	WireSchema  string        `json:"wire_schema"`
	Run         *RoguelikeRun `json:"run"`
	LeaderIndex *int          `json:"leader_index,omitempty"`
	Snapshot    JSONMap       `json:"snapshot"`
	Mirrors     []string      `json:"snapshot_mirrors"`
}

func sameCombatWireValue(a, b any) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	x, y := reflect.ValueOf(a), reflect.ValueOf(b)
	if x.Type() != y.Type() {
		return false
	}
	switch x.Kind() {
	case reflect.Map, reflect.Slice:
		return x.UnsafePointer() == y.UnsafePointer()
	case reflect.Bool, reflect.String, reflect.Int, reflect.Int64, reflect.Float64:
		return x.Interface() == y.Interface()
	}
	return false
}

// Only reference values which are already the same immutable object. Missing
// fields and presentation differences remain verbatim in the one-frame wire.
func compactCombatFrame(run *RoguelikeRun) combatFrameResponse {
	copy := cloneCachedCombatRun(run)
	frame := combatFrameResponse{WireSchema: combatFrameWire, Run: copy, Mirrors: []string{}}
	if len(copy.Characters) > 0 {
		for i, c := range copy.Characters {
			if c.ID == copy.CharacterID {
				frame.LeaderIndex = &i
				copy.Character = nil
				break
			}
		}
	}
	leader := copy.Character
	if frame.LeaderIndex != nil {
		leader = copy.Characters[*frame.LeaderIndex]
	}
	if leader == nil || leader.TurnState == nil {
		return frame
	}
	snapshot, ok := (*leader.TurnState)["solo_combat_v1"].(map[string]any)
	if !ok {
		if m, yes := (*leader.TurnState)["solo_combat_v1"].(JSONMap); yes {
			snapshot = map[string]any(m)
			ok = true
		}
	}
	if !ok || copy.CombatState == nil {
		return frame
	}
	turn := JSONMap{}
	for key, value := range *leader.TurnState {
		if key != "solo_combat_v1" {
			turn[key] = value
		}
	}
	leader.TurnState = &turn
	frame.Snapshot = JSONMap{}
	for key, value := range snapshot {
		source, exists := copy.CombatState[key]
		if exists && sameCombatWireValue(value, source) {
			frame.Mirrors = append(frame.Mirrors, key)
		} else {
			frame.Snapshot[key] = value
		}
	}
	sort.Strings(frame.Mirrors)
	return frame
}
func writeCombatRunResponse(c *gin.Context, run *RoguelikeRun) {
	if c.GetHeader("X-Combat-Wire") == combatFrameWire {
		c.JSON(http.StatusOK, compactCombatFrame(run))
		return
	}
	c.JSON(http.StatusOK, gin.H{"run": run})
}
