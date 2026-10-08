package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	fastjson "github.com/goccy/go-json"
)

const workerDeltaWire = "mirrors-v3"

type workerStateDeltaMetadata struct {
	BaseHash   string              `json:"baseHash"`
	References [][]string          `json:"references"`
	Prefixes   []combatArrayPrefix `json:"arrayPrefixes"`
}
type workerStateDeltaFrame struct {
	Schema  int                      `json:"wireSchema"`
	Value   json.RawMessage          `json:"value"`
	Delta   workerStateDeltaMetadata `json:"stateDelta"`
	Mirrors struct {
		State   []string `json:"state"`
		Leader  *string  `json:"leader,omitempty"`
		Partial []struct {
			Field string                   `json:"field"`
			Delta workerStateDeltaMetadata `json:"delta"`
		} `json:"partial"`
	} `json:"mirrors"`
}

func restoreWorkerStateDelta(target, base map[string]any, delta workerStateDeltaMetadata) error {
	if target == nil || base == nil || delta.References == nil || delta.Prefixes == nil || len(delta.References) > 1024 || len(delta.Prefixes) > 128 {
		return fmt.Errorf("invalid worker state delta")
	}
	parent := func(root map[string]any, path []string) (map[string]any, string, error) {
		if len(path) == 0 || len(path) > 8 {
			return nil, "", fmt.Errorf("invalid worker state path")
		}
		for _, key := range path {
			if key == "__proto__" || key == "constructor" || key == "prototype" {
				return nil, "", fmt.Errorf("unsafe worker state path")
			}
		}
		for _, key := range path[:len(path)-1] {
			var ok bool
			root, ok = root[key].(map[string]any)
			if !ok || root == nil {
				return nil, "", fmt.Errorf("missing worker state parent")
			}
		}
		return root, path[len(path)-1], nil
	}
	seen := [][]string{}
	claim := func(path []string) error {
		for _, old := range seen {
			equal := true
			for i := 0; i < min(len(path), len(old)); i++ {
				if path[i] != old[i] {
					equal = false
					break
				}
			}
			if equal {
				return fmt.Errorf("overlapping worker state paths")
			}
		}
		seen = append(seen, path)
		return nil
	}
	for _, path := range delta.References {
		from, key, err := parent(base, path)
		if err != nil {
			return err
		}
		to, _, err := parent(target, path)
		if err != nil {
			return err
		}
		if err = claim(path); err != nil {
			return err
		}
		value, found := from[key]
		_, occupied := to[key]
		if !found || occupied {
			return fmt.Errorf("invalid worker state reference")
		}
		to[key] = value
	}
	for _, row := range delta.Prefixes {
		from, key, err := parent(base, row.Path)
		if err != nil {
			return err
		}
		to, _, err := parent(target, row.Path)
		if err != nil {
			return err
		}
		if err = claim(row.Path); err != nil {
			return err
		}
		old, ok := from[key].([]any)
		tail, tailOK := to[key].([]any)
		if !ok || !tailOK || row.Offset < 0 || row.Length < 0 || row.Offset > len(old) || row.Length > len(old)-row.Offset || row.Length > 100000-len(tail) {
			return fmt.Errorf("invalid worker state prefix")
		}
		restored := make([]any, 0, row.Length+len(tail))
		restored = append(restored, old[row.Offset:row.Offset+row.Length]...)
		to[key] = append(restored, tail...)
	}
	return nil
}

// Transport binds changes to the exact private acknowledged frame. The caller
// binds baseHash to its exact private acknowledged frame. New maps are parsed
// privately; borrowed base subtrees are immutable, as in the existing cache.
func decodeWorkerStateDelta(payload []byte, base JSONMap, baseHash string) (*roguelikeWorkerResult, error) {
	var discriminator struct {
		Schema int `json:"wireSchema"`
	}
	if fastjson.Unmarshal(payload, &discriminator) != nil {
		return nil, fmt.Errorf("invalid worker JSON")
	}
	if discriminator.Schema != 3 {
		return decodeWorkerMirrors(payload)
	}
	var frame workerStateDeltaFrame
	decoder := fastjson.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&frame) != nil || !roguelikeSnapshotHash.MatchString(baseHash) || base == nil || frame.Delta.BaseHash != baseHash || frame.Mirrors.State == nil || len(frame.Mirrors.State) > 10 {
		return nil, fmt.Errorf("invalid worker state base")
	}
	var result roguelikeWorkerResult
	if fastjson.Unmarshal(frame.Value, &result) != nil {
		return nil, fmt.Errorf("invalid worker delta value")
	}
	if result.Trace["beforeHash"] != baseHash || result.Envelope["artifactHash"] != base["artifactHash"] {
		return nil, fmt.Errorf("worker delta identity mismatch")
	}
	state, ok := result.Envelope["state"].(map[string]any)
	previous, baseOK := combatWireMap(base["state"])
	if !ok || !baseOK {
		return nil, fmt.Errorf("invalid worker delta state")
	}
	if err := restoreWorkerStateDelta(state, previous, frame.Delta); err != nil {
		return nil, err
	}
	afterHash, ok := result.Trace["afterHash"].(string)
	if !ok || !roguelikeSnapshotHash.MatchString(afterHash) {
		return nil, fmt.Errorf("invalid worker after hash")
	}
	canonical, err := workerCatalogJSONDecoded(map[string]any(result.Envelope), 16<<20)
	if err != nil || canonicalSHA256(canonical) != afterHash || len(frame.Value)+3*len(canonical) > 16<<20 {
		return nil, fmt.Errorf("worker reconstructed state integrity failed")
	}
	turn, ok := result.Patch["turn_state"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid worker snapshot")
	}
	snapshot, ok := turn["solo_combat_v1"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid worker snapshot")
	}
	allowed := map[string]bool{"world": true, "catalogActions": true, "actionPresentation": true, "actorPresentation": true, "log": true, "battleMap": true, "tokens": true, "combatAreas": true, "resourceBindings": true, "resourceBindingsByActor": true}
	seen := map[string]bool{}
	for _, key := range frame.Mirrors.State {
		value, found := state[key]
		_, occupied := snapshot[key]
		if !allowed[key] || seen[key] || !found || occupied {
			return nil, fmt.Errorf("invalid worker delta mirror")
		}
		seen[key] = true
		snapshot[key] = value
	}
	if frame.Mirrors.Partial == nil || len(frame.Mirrors.Partial) > 10 {
		return nil, fmt.Errorf("invalid partial worker mirrors")
	}
	totalKeys := 0
	for _, row := range frame.Mirrors.Partial {
		if !allowed[row.Field] || seen[row.Field] || row.Delta.BaseHash != afterHash {
			return nil, fmt.Errorf("invalid partial worker field")
		}
		seen[row.Field] = true
		source, sourceOK := state[row.Field].(map[string]any)
		target, targetOK := snapshot[row.Field].(map[string]any)
		if !sourceOK || !targetOK {
			return nil, fmt.Errorf("invalid partial worker object")
		}
		totalKeys += len(row.Delta.References) + len(row.Delta.Prefixes)
		if totalKeys > 4096 {
			return nil, fmt.Errorf("excessive partial worker references")
		}
		if err := restoreWorkerStateDelta(target, source, row.Delta); err != nil {
			return nil, err
		}
	}
	if frame.Mirrors.Leader != nil {
		id, ok := state["characterId"].(string)
		_, occupied := result.Patches[id]
		if !ok || id == "" || id != *frame.Mirrors.Leader || occupied || result.Patches == nil {
			return nil, fmt.Errorf("invalid worker delta leader")
		}
		copy := JSONMap{}
		for key, value := range result.Patch {
			copy[key] = value
		}
		result.Patches[id] = copy
	}
	return &result, nil
}
