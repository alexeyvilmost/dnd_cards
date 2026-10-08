package main

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func syntheticWorkerDelta(t *testing.T, hero string) (JSONMap, string, map[string]any, *roguelikeWorkerResult) {
	t.Helper()
	artifact := "sha256:" + strings.Repeat("a", 64)
	world := map[string]any{"actors": map[string]any{hero: map[string]any{"size": "large", "hp": float64(23)}}}
	history := []any{"old", "kept", "new"}
	presentation := map[string]any{"ability": map[string]any{"id": "ability-" + hero, "label": "Действие", "imageUrl": "synthetic-image", "cost": float64(1)}}
	before := JSONMap{"artifactHash": artifact, "state": map[string]any{"characterId": hero, "world": world, "log": []any{"old", "kept"}, "actionPresentation": presentation, "runtimeRevision": float64(1)}}
	after := JSONMap{"artifactHash": artifact, "state": map[string]any{"characterId": hero, "world": world, "log": history, "actionPresentation": presentation, "runtimeRevision": float64(2)}}
	beforeHash, err := workerCatalogHashDecoded(map[string]any(before))
	if err != nil {
		t.Fatal(err)
	}
	afterHash, err := workerCatalogHashDecoded(map[string]any(after))
	if err != nil {
		t.Fatal(err)
	}
	patch := JSONMap{"runtime_revision": float64(2), "turn_state": map[string]any{"choice": "preserved", "solo_combat_v1": map[string]any{"world": world, "log": history, "actionPresentation": map[string]any{"ability": presentation["ability"], "different": "snapshot-only"}}}}
	expected := &roguelikeWorkerResult{Envelope: after, Patch: patch, Patches: map[string]JSONMap{hero: patch}, Trace: JSONMap{"beforeHash": beforeHash, "afterHash": afterHash}, RandomValues: []float64{0.125, 0.875}}
	wire := map[string]any{"wireSchema": 3, "value": map[string]any{"envelope": map[string]any{"artifactHash": artifact, "state": map[string]any{"characterId": hero, "log": []any{"new"}, "runtimeRevision": float64(2)}}, "patch": map[string]any{"runtime_revision": float64(2), "turn_state": map[string]any{"choice": "preserved", "solo_combat_v1": map[string]any{"actionPresentation": map[string]any{"different": "snapshot-only"}}}}, "patches": map[string]any{}, "trace": expected.Trace, "randomValues": expected.RandomValues}, "stateDelta": map[string]any{"baseHash": beforeHash, "references": [][]string{{"world"}, {"actionPresentation"}}, "arrayPrefixes": []any{map[string]any{"path": []string{"log"}, "length": 2, "offset": 0}}}, "mirrors": map[string]any{"state": []string{"world", "log"}, "leader": hero, "partial": []any{map[string]any{"field": "actionPresentation", "delta": map[string]any{"baseHash": afterHash, "references": [][]string{{"ability"}}, "arrayPrefixes": []any{}}}}}}
	return before, beforeHash, wire, expected
}

func TestWorkerStateDeltaRestoresCompleteResponseAndPrivateBase(t *testing.T) {
	for _, hero := range []string{"first-synthetic-hero", "second-synthetic-hero"} {
		base, hash, wire, expected := syntheticWorkerDelta(t, hero)
		original, _ := json.Marshal(base)
		raw, _ := json.Marshal(wire)
		actual, err := decodeWorkerStateDelta(raw, base, hash)
		if err != nil || !reflect.DeepEqual(actual, expected) {
			t.Fatalf("Complete response differs: %v", err)
		}
		unchanged, _ := json.Marshal(base)
		if string(unchanged) != string(original) {
			t.Fatal("Private acknowledged base changed")
		}
		legacy, _ := json.Marshal(expected)
		fallback, err := decodeWorkerStateDelta(legacy, nil, "")
		if err != nil || !reflect.DeepEqual(fallback, expected) {
			t.Fatalf("Legacy worker fallback differs: %v", err)
		}
	}
}

func TestWorkerStateDeltaRejectsInvalidMetadataAndIntegrity(t *testing.T) {
	mutations := []func(map[string]any){
		func(w map[string]any) { w["unexpected"] = true },
		func(w map[string]any) {
			w["stateDelta"].(map[string]any)["baseHash"] = "sha256:" + strings.Repeat("b", 64)
		},
		func(w map[string]any) {
			w["value"].(map[string]any)["trace"].(JSONMap)["afterHash"] = "sha256:" + strings.Repeat("b", 64)
		},
		func(w map[string]any) {
			w["stateDelta"].(map[string]any)["references"] = [][]string{{"world"}, {"world"}}
		},
		func(w map[string]any) { w["stateDelta"].(map[string]any)["references"] = [][]string{{"__proto__"}} },
		func(w map[string]any) {
			w["stateDelta"].(map[string]any)["arrayPrefixes"].([]any)[0].(map[string]any)["length"] = 999999
		},
		func(w map[string]any) { w["mirrors"].(map[string]any)["state"] = []string{"entropy"} },
		func(w map[string]any) {
			w["mirrors"].(map[string]any)["partial"].([]any)[0].(map[string]any)["delta"].(map[string]any)["references"] = [][]string{{"missing"}}
		},
		func(w map[string]any) { w["mirrors"].(map[string]any)["leader"] = "another-owner" },
	}
	for _, mutate := range mutations {
		base, hash, wire, _ := syntheticWorkerDelta(t, "synthetic-hero")
		mutate(wire)
		raw, _ := json.Marshal(wire)
		if _, err := decodeWorkerStateDelta(raw, base, hash); err == nil {
			t.Fatal("Invalid metadata accepted")
		}
	}
}

func TestWorkerDecodedCanonicalRetainsHistoricalOrderingAndBounds(t *testing.T) {
	input, err := decodeUniqueJSON([]byte(`{"10":"ten","2":"two","01":"text","4294967295":"non-index","4294967294":"index","a":"<&>\n🐉","\ue000":1,"😀":2}`))
	if err != nil {
		t.Fatal(err)
	}
	expected := `{"2":"two","10":"ten","4294967294":"index","01":"text","4294967295":"non-index","a":"<&>\n🐉","😀":2,"` + "\ue000" + `":1}`
	raw, err := workerCatalogJSONDecoded(input)
	if err != nil || string(raw) != expected {
		t.Fatal("Historical JavaScript enumeration changed")
	}
	for _, value := range []any{strings.Repeat("x", 200), map[string]any{"a": strings.Repeat("x", 200)}, []any{strings.Repeat("x", 200)}} {
		if _, err := workerCatalogJSONDecoded(value, 100); err == nil {
			t.Fatal("Canonical output limit bypassed")
		}
	}
}
