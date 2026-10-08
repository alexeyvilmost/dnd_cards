package main

import (
	"encoding/json"
	"math"
	"math/rand"
	"reflect"
	"testing"
)

func TestCombatWireJSONEqualityMatchesDeepEqual(t *testing.T) {
	shared := map[string]any{"nan": math.NaN()}
	cycleA, cycleB := map[string]any{}, map[string]any{}
	cycleA["self"], cycleB["self"] = cycleA, cycleB
	pairs := [][2]any{
		{nil, nil}, {nil, map[string]any(nil)}, {[]any(nil), []any{}},
		{map[string]any(nil), map[string]any{}}, {JSONMap{"a": 1}, map[string]any{"a": 1}},
		{[]any{1}, []any{float64(1)}}, {shared, shared},
		{[]any{math.NaN()}, []any{math.NaN()}}, {cycleA, cycleB},
		{map[string]any{"x": nil}, map[string]any{"y": nil}},
		{map[string]any{"dragon": "🐉 <&>"}, map[string]any{"dragon": "🐉 <&>"}},
		{[]byte{1, 2}, []byte{1, 2}}, {struct{ Value int }{2}, struct{ Value int }{3}},
	}
	nanArray := []any{math.NaN()}
	pairs = append(pairs, [2]any{nanArray, nanArray})
	random := rand.New(rand.NewSource(23))
	var value func(int) any
	value = func(depth int) any {
		if depth == 0 {
			return []any{nil, false, true, float64(random.Intn(100)), "текст 🐉"}[random.Intn(5)]
		}
		if random.Intn(2) == 0 {
			array := make([]any, random.Intn(6))
			for i := range array {
				array[i] = value(depth - 1)
			}
			return array
		}
		object := map[string]any{}
		for i := 0; i < random.Intn(6); i++ {
			object[string(rune('a'+i))] = value(depth - 1)
		}
		return object
	}
	for i := 0; i < 2000; i++ {
		a := value(5)
		encoded, err := json.Marshal(a)
		if err != nil {
			t.Fatal(err)
		}
		var cloned any
		if err := json.Unmarshal(encoded, &cloned); err != nil {
			t.Fatal(err)
		}
		pairs = append(pairs, [2]any{a, cloned}, [2]any{a, value(5)})
	}
	for i, pair := range pairs {
		for _, pair := range [][2]any{pair, {pair[1], pair[0]}} {
			if actual, expected := equalCombatWireJSON(pair[0], pair[1], 0), reflect.DeepEqual(pair[0], pair[1]); actual != expected {
				t.Fatalf("comparison %d differs: actual %v, expected %v", i, actual, expected)
			}
		}
	}
}

func BenchmarkCombatWireJSONEquality(b *testing.B) {
	object := map[string]any{}
	for i := 0; i < 500; i++ {
		object[string(rune(i+32))] = map[string]any{"name": "item 🐉", "effects": []any{map[string]any{"kind": "modifier", "value": float64(i)}}}
	}
	encoded, _ := json.Marshal(object)
	var clone any
	_ = json.Unmarshal(encoded, &clone)
	for _, name := range []string{"reflect", "json"} {
		b.Run(name, func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				var equal bool
				if name == "reflect" {
					equal = reflect.DeepEqual(object, clone)
				} else {
					equal = equalCombatWireJSON(object, clone, 0)
				}
				if !equal {
					b.Fatal("fixture differs")
				}
			}
		})
	}
}
