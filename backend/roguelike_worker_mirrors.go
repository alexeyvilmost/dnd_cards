package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

const workerMirrorWire = "mirrors-v2"

type workerStateMirror struct {
	Field string `json:"field"`
	Hash  string `json:"sha256"`
}
type workerLeaderMirror struct {
	ID   string `json:"id"`
	Hash string `json:"sha256"`
}
type workerMirrorFrame struct {
	Schema  int             `json:"wireSchema"`
	Value   json.RawMessage `json:"value"`
	Mirrors struct {
		State  []workerStateMirror `json:"state"`
		Leader *workerLeaderMirror `json:"leader,omitempty"`
	} `json:"mirrors"`
}

func workerMirrorHash(raw json.RawMessage) string {
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}
func workerMirrorObject(raw json.RawMessage) (map[string]json.RawMessage, error) {
	var result map[string]json.RawMessage
	if json.Unmarshal(raw, &result) != nil || result == nil {
		return nil, fmt.Errorf("invalid worker mirror object")
	}
	return result, nil
}

// Expand only same-frame, exact content references. There is no external cache
// or previous-client base revision. Existing validators and atomic persistence
// always receive the complete legacy result. No rule/artifact bytes change.
func expandWorkerMirrors(payload []byte) ([]byte, error) {
	root, err := workerMirrorObject(payload)
	if err != nil {
		return nil, err
	}
	if _, exists := root["wireSchema"]; !exists {
		return payload, nil
	}
	var frame workerMirrorFrame
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&frame) != nil || frame.Schema != 2 || frame.Mirrors.State == nil || len(frame.Mirrors.State) > 10 {
		return nil, fmt.Errorf("invalid worker mirror frame")
	}
	value, err := workerMirrorObject(frame.Value)
	if err != nil {
		return nil, err
	}
	envelope, err := workerMirrorObject(value["envelope"])
	if err != nil {
		return nil, err
	}
	state, err := workerMirrorObject(envelope["state"])
	if err != nil {
		return nil, err
	}
	patch, err := workerMirrorObject(value["patch"])
	if err != nil {
		return nil, err
	}
	turn, err := workerMirrorObject(patch["turn_state"])
	if err != nil {
		return nil, err
	}
	snapshot, err := workerMirrorObject(turn["solo_combat_v1"])
	if err != nil {
		return nil, err
	}
	var patches map[string]json.RawMessage
	if leader := frame.Mirrors.Leader; leader != nil {
		var id string
		if json.Unmarshal(state["characterId"], &id) != nil || id == "" || id != leader.ID || workerMirrorHash(value["patch"]) != leader.Hash {
			return nil, fmt.Errorf("invalid worker leader mirror")
		}
		patches, err = workerMirrorObject(value["patches"])
		if err != nil {
			return nil, err
		}
		if _, exists := patches[id]; exists {
			return nil, fmt.Errorf("worker leader mirror overwrites existing value")
		}
	}
	allowed := map[string]bool{"world": true, "catalogActions": true, "actionPresentation": true, "actorPresentation": true, "log": true, "battleMap": true, "tokens": true, "combatAreas": true, "resourceBindings": true, "resourceBindingsByActor": true}
	seen := map[string]bool{}
	expanded := len(frame.Value)
	for _, mirror := range frame.Mirrors.State {
		source, exists := state[mirror.Field]
		_, targetExists := snapshot[mirror.Field]
		if !allowed[mirror.Field] || seen[mirror.Field] || !exists || targetExists || workerMirrorHash(source) != mirror.Hash {
			return nil, fmt.Errorf("invalid worker state mirror")
		}
		seen[mirror.Field] = true
		expanded += len(source)
		if expanded > 16<<20 {
			return nil, fmt.Errorf("expanded worker response too large")
		}
		snapshot[mirror.Field] = source
	}
	turn["solo_combat_v1"], err = json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	patch["turn_state"], err = json.Marshal(turn)
	if err != nil {
		return nil, err
	}
	value["patch"], err = json.Marshal(patch)
	if err != nil {
		return nil, err
	}
	if leader := frame.Mirrors.Leader; leader != nil {
		expanded += len(value["patch"])
		if expanded > 16<<20 {
			return nil, fmt.Errorf("expanded worker response too large")
		}
		patches[leader.ID] = value["patch"]
		value["patches"], err = json.Marshal(patches)
		if err != nil {
			return nil, err
		}
	}
	result, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	if len(result) > 16<<20 {
		return nil, fmt.Errorf("expanded worker response too large")
	}
	return result, nil
}
