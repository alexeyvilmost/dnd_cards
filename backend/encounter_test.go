package main

import (
	"reflect"
	"testing"
)

func combatant(id string, hp int) map[string]interface{} {
	return map[string]interface{}{"actorId": id, "name": id, "hp": float64(hp), "maxHp": float64(hp)}
}

func combatantsOf(state map[string]interface{}) []map[string]interface{} {
	out := []map[string]interface{}{}
	if raw, ok := state["combatants"].([]interface{}); ok {
		for _, c := range raw {
			out = append(out, c.(map[string]interface{}))
		}
	}
	return out
}

func TestApplyOps_Add(t *testing.T) {
	st := applyOps(nil, ApplyRequest{Add: []map[string]interface{}{combatant("a", 20), combatant("b", 30)}})
	cs := combatantsOf(st)
	if len(cs) != 2 || cs[0]["actorId"] != "a" || cs[1]["actorId"] != "b" {
		t.Fatalf("add не добавил комбатантов: %+v", cs)
	}
}

func TestApplyOps_PatchMerges(t *testing.T) {
	base := map[string]interface{}{"combatants": []interface{}{combatant("a", 20)}}
	st := applyOps(base, ApplyRequest{Patches: []CombatantPatch{{ActorID: "a", Set: JSONMap{"hp": float64(12)}}}})
	c := combatantsOf(st)[0]
	if c["hp"] != float64(12) {
		t.Fatalf("hp не обновился: %v", c["hp"])
	}
	if c["maxHp"] != float64(20) || c["name"] != "a" {
		t.Fatalf("shallow-merge затёр другие поля: %+v", c)
	}
}

func TestApplyOps_PatchUnknownActorNoop(t *testing.T) {
	base := map[string]interface{}{"combatants": []interface{}{combatant("a", 20)}}
	st := applyOps(base, ApplyRequest{Patches: []CombatantPatch{{ActorID: "ghost", Set: JSONMap{"hp": float64(1)}}}})
	if combatantsOf(st)[0]["hp"] != float64(20) {
		t.Fatalf("патч неизвестного актора не должен ничего менять")
	}
}

func TestApplyOps_Remove(t *testing.T) {
	base := map[string]interface{}{"combatants": []interface{}{combatant("a", 20), combatant("b", 30)}}
	st := applyOps(base, ApplyRequest{Remove: []string{"a"}})
	cs := combatantsOf(st)
	if len(cs) != 1 || cs[0]["actorId"] != "b" {
		t.Fatalf("remove не удалил нужного: %+v", cs)
	}
}

func TestApplyOps_RoundAndTurn(t *testing.T) {
	r, ai := 3, 2
	st := applyOps(nil, ApplyRequest{Round: &r, ActiveIndex: &ai})
	if st["round"] != 3 || st["activeIndex"] != 2 {
		t.Fatalf("round/activeIndex не проставились: %+v", st)
	}
}

func TestApplyOps_Combined(t *testing.T) {
	base := map[string]interface{}{"combatants": []interface{}{combatant("a", 20), combatant("b", 30)}}
	r := 2
	st := applyOps(base, ApplyRequest{
		Patches:     []CombatantPatch{{ActorID: "b", Set: JSONMap{"hp": float64(5)}}},
		Add:         []map[string]interface{}{combatant("c", 10)},
		Remove:      []string{"a"},
		Round:       &r,
	})
	cs := combatantsOf(st)
	if len(cs) != 2 {
		t.Fatalf("ожидалось 2 комбатанта (b, c), получено %d: %+v", len(cs), cs)
	}
	if cs[0]["actorId"] != "b" || cs[0]["hp"] != float64(5) {
		t.Fatalf("b не пропатчен: %+v", cs[0])
	}
	if cs[1]["actorId"] != "c" {
		t.Fatalf("c не добавлен: %+v", cs[1])
	}
	if st["round"] != 2 {
		t.Fatalf("round не обновлён")
	}
}

func TestOpPayload_Roundtrip(t *testing.T) {
	r := 4
	m := opPayload(ApplyRequest{Round: &r, Remove: []string{"x"}, Events: []interface{}{"hit"}})
	// json-теги: round / remove / events
	if !reflect.DeepEqual(m["remove"], []interface{}{"x"}) {
		t.Fatalf("remove не сериализовался: %+v", m["remove"])
	}
	if m["round"] != float64(4) {
		t.Fatalf("round не сериализовался: %v", m["round"])
	}
	if !reflect.DeepEqual(m["events"], []interface{}{"hit"}) {
		t.Fatalf("events не сериализовались: %+v", m["events"])
	}
}
