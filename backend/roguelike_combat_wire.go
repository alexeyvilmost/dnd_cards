package main

import (
	"net/http"
	"reflect"
	"sort"

	"github.com/gin-gonic/gin"
	fastjson "github.com/goccy/go-json"
)

const combatFrameWire = "combat-frame-v1"
const combatDeltaWire = "combat-frame-v2"

type combatArrayPrefix struct {
	Path   []string `json:"path"`
	Length int      `json:"length"`
	Offset int      `json:"offset,omitempty"`
}
type combatStateDelta struct {
	BaseCommandID string              `json:"base_command_id"`
	References    [][]string          `json:"references"`
	ArrayPrefixes []combatArrayPrefix `json:"array_prefixes"`
}

type combatFrameResponse struct {
	WireSchema  string            `json:"wire_schema"`
	Run         *RoguelikeRun     `json:"run"`
	LeaderIndex *int              `json:"leader_index,omitempty"`
	Snapshot    JSONMap           `json:"snapshot"`
	Mirrors     []string          `json:"snapshot_mirrors"`
	StateDelta  *combatStateDelta `json:"state_delta,omitempty"`
}

func combatWireMap(value any) (map[string]any, bool) {
	switch value := value.(type) {
	case map[string]any:
		return value, true
	case JSONMap:
		return map[string]any(value), true
	default:
		return nil, false
	}
}

// Transport references prove complete equality against an exact acknowledged
// command. No field is assumed immutable and no mechanics are omitted from the
// reconstructed DTO. Arrays can share an unchanged prefix (e.g. combat history).
func compactCombatState(next, before JSONMap, delta *combatStateDelta) JSONMap {
	var compact func(map[string]any, map[string]any, []string) map[string]any
	compact = func(next, before map[string]any, parent []string) map[string]any {
		result := map[string]any{}
		for key, value := range next {
			old, exists := before[key]
			path := append(append([]string{}, parent...), key)
			if !exists || len(path) > 8 || key == "__proto__" || key == "constructor" || key == "prototype" {
				result[key] = value
				continue
			}
			m, mapValue := combatWireMap(value)
			array, arrayValue := value.([]any)
			if len(delta.References) < 1024 && ((mapValue && len(m) >= 4) || (arrayValue && len(array) >= 4)) && reflect.DeepEqual(value, old) {
				delta.References = append(delta.References, path)
				continue
			}
			if previous, ok := old.([]any); arrayValue && ok && len(previous) >= 8 && len(delta.ArrayPrefixes) < 128 {
				matched := false
				for offset := 0; offset <= 64 && offset <= len(previous)-8; offset++ {
					length := min(len(previous)-offset, len(array))
					if length >= 8 && reflect.DeepEqual(previous[offset:offset+length], array[:length]) {
						delta.ArrayPrefixes = append(delta.ArrayPrefixes, combatArrayPrefix{Path: path, Length: length, Offset: offset})
						result[key] = array[length:]
						matched = true
						break
					}
				}
				if matched {
					continue
				}
			}
			if previous, ok := combatWireMap(old); mapValue && ok {
				result[key] = compact(m, previous, path)
			} else {
				result[key] = value
			}
		}
		return result
	}
	return JSONMap(compact(map[string]any(next), map[string]any(before), nil))
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
	if c.GetHeader("X-Combat-Wire") == combatFrameWire || c.GetHeader("X-Combat-Wire") == combatDeltaWire {
		// This transport retains encoding/json's schema and escaping. Use the
		// existing optimized encoder only for transient combat responses; saved
		// journals and receipts keep their canonical persistence serializer.
		frame := compactCombatFrame(run)
		if c.GetHeader("X-Combat-Wire") == combatDeltaWire {
			frame.WireSchema = combatDeltaWire
			if baseValue, ok := c.Get("combat_wire_base_run"); ok {
				base, valid := baseValue.(*RoguelikeRun)
				baseID := c.GetString("combat_wire_base_command_id")
				if valid && baseID != "" && c.GetHeader("X-Combat-Base") == baseID && base.ID == run.ID && base.UserID == run.UserID && base.CombatState != nil && run.CombatState != nil {
					done := performanceSince(c.Request.Context(), "combat_wire_delta_ms")
					delta := &combatStateDelta{BaseCommandID: baseID, References: [][]string{}, ArrayPrefixes: []combatArrayPrefix{}}
					frame.Run.CombatState = compactCombatState(run.CombatState, base.CombatState, delta)
					if len(delta.References) > 0 || len(delta.ArrayPrefixes) > 0 {
						frame.StateDelta = delta
					}
					done()
				}
			}
		}
		payload, err := fastjson.Marshal(frame)
		if err != nil {
			writeRoguelikeError(c, err)
			return
		}
		c.Data(http.StatusOK, "application/json; charset=utf-8", payload)
		return
	}
	c.JSON(http.StatusOK, gin.H{"run": run})
}
