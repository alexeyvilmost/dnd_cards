package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func mirrorTestJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func mirrorTestFixture(t *testing.T, padding int) ([]byte, map[string]any) {
	t.Helper()
	world := map[string]any{"actors": map[string]any{"hero": map[string]any{"name": "<Герой> & союзник", "pool": 2}}, "padding": strings.Repeat("я", padding)}
	state := map[string]any{"characterId": "hero", "world": world, "actionPresentation": map[string]any{"image": "authoritative"}}
	patch := map[string]any{"runtime_revision": 8, "turn_state": map[string]any{"solo_combat_v1": map[string]any{"characterId": "hero", "world": world, "actionPresentation": map[string]any{"image": "different preserved mirror"}}}}
	legacy := map[string]any{"envelope": map[string]any{"state": state, "entropy": map[string]any{"seed": "synthetic-private", "cursor": 7}}, "patch": patch, "patches": map[string]any{"hero": patch, "ally": map[string]any{"runtime_revision": 4}}, "randomValues": []any{0.3}}
	compactPatch := map[string]any{"runtime_revision": 8, "turn_state": map[string]any{"solo_combat_v1": map[string]any{"characterId": "hero", "actionPresentation": map[string]any{"image": "different preserved mirror"}}}}
	value := map[string]any{"envelope": legacy["envelope"], "patch": compactPatch, "patches": map[string]any{"ally": map[string]any{"runtime_revision": 4}}, "randomValues": legacy["randomValues"]}
	frame := map[string]any{"wireSchema": 2, "value": value, "mirrors": map[string]any{"state": []any{map[string]any{"field": "world", "sha256": workerMirrorHash(mirrorTestJSON(t, world))}}, "leader": map[string]any{"id": "hero", "sha256": workerMirrorHash(mirrorTestJSON(t, compactPatch))}}}
	return mirrorTestJSON(t, frame), legacy
}

func TestWorkerMirrorsExactRestorationAndFailClosed(t *testing.T) {
	wire, legacy := mirrorTestFixture(t, 1000)
	expanded, err := expandWorkerMirrors(wire)
	if err != nil {
		t.Fatal(err)
	}
	var actual, expected any
	_ = json.Unmarshal(expanded, &actual)
	_ = json.Unmarshal(mirrorTestJSON(t, legacy), &expected)
	if !reflect.DeepEqual(actual, expected) {
		t.Fatal("mirror restoration changed full result")
	}
	decoded, err := decodeWorkerMirrors(wire)
	if err != nil {
		t.Fatal(err)
	}
	var typed roguelikeWorkerResult
	if err = json.Unmarshal(expanded, &typed); err != nil || !reflect.DeepEqual(decoded, &typed) {
		t.Fatal("typed mirror reader differs from canonical expansion")
	}
	for _, mutate := range []func(map[string]any){
		func(f map[string]any) { f["wireSchema"] = 3 }, func(f map[string]any) { f["unexpected"] = true },
		func(f map[string]any) {
			f["mirrors"].(map[string]any)["state"].([]any)[0].(map[string]any)["sha256"] = "sha256:" + strings.Repeat("0", 64)
		},
		func(f map[string]any) {
			f["mirrors"].(map[string]any)["state"].([]any)[0].(map[string]any)["field"] = "entropy"
		},
		func(f map[string]any) {
			m := f["mirrors"].(map[string]any)
			m["state"] = append(m["state"].([]any), m["state"].([]any)[0])
		},
		func(f map[string]any) {
			f["mirrors"].(map[string]any)["leader"].(map[string]any)["id"] = "another-owner"
		},
		func(f map[string]any) {
			f["value"].(map[string]any)["patches"].(map[string]any)["hero"] = map[string]any{}
		},
	} {
		var frame map[string]any
		_ = json.Unmarshal(wire, &frame)
		mutate(frame)
		if _, err := expandWorkerMirrors(mirrorTestJSON(t, frame)); err == nil {
			t.Fatal("invalid mirror frame accepted")
		}
		if _, err := decodeWorkerMirrors(mirrorTestJSON(t, frame)); err == nil {
			t.Fatal("typed reader accepted invalid mirror")
		}
	}
	large, _ := mirrorTestFixture(t, 4_300_000)
	if _, err := expandWorkerMirrors(large); err == nil {
		t.Fatal("expanded limit bypassed")
	}
	if _, err := decodeWorkerMirrors(large); err == nil {
		t.Fatal("typed reader bypassed expanded limit")
	}
	raw := mirrorTestJSON(t, legacy)
	restored, err := expandWorkerMirrors(raw)
	if err != nil || string(raw) != string(restored) {
		t.Fatal("legacy bytes changed")
	}
}

func TestWorkerMirrorsClientNegotiationAndLegacyFallback(t *testing.T) {
	wire, legacy := mirrorTestFixture(t, 1000)
	legacyBytes := mirrorTestJSON(t, legacy)
	for _, mode := range []string{"off", "on", "old-worker"} {
		t.Run(mode, func(t *testing.T) {
			flag := "0"
			if mode != "off" {
				flag = "1"
			}
			t.Setenv("RULES_WORKER_MIRRORS_ENABLED", flag)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				expected := ""
				if flag == "1" {
					expected = workerMirrorWire
				}
				if r.Header.Get("X-Rules-Wire") != expected {
					t.Error("wrong protocol negotiation")
				}
				w.Header().Set("Content-Type", "application/json")
				if mode == "on" {
					_, _ = w.Write(wire)
				} else {
					_, _ = w.Write(legacyBytes)
				}
			}))
			defer server.Close()
			client := roguelikeWorkerClient{URL: server.URL, Token: strings.Repeat("t", 32)}
			result, err := client.call(context.Background(), "/transition", map[string]any{})
			if err != nil {
				t.Fatal(err)
			}
			var expected roguelikeWorkerResult
			_ = json.Unmarshal(legacyBytes, &expected)
			if !reflect.DeepEqual(result, &expected) {
				t.Fatal("client did not restore complete result before validation")
			}
			result.Patch["changed"] = true
			if _, exists := result.Patches["hero"]["changed"]; exists {
				t.Fatal("mirrors retain mutable aliases")
			}
		})
	}
}
