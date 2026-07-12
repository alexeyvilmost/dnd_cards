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

func charCombatant(actorID, charID string, hp int) map[string]interface{} {
	m := combatant(actorID, hp)
	m["characterId"] = charID
	return m
}

func TestCharacterIDsInState(t *testing.T) {
	state := map[string]interface{}{"combatants": []interface{}{
		charCombatant("a1", "char-1", 20),
		combatant("m1", 15), // монстр без characterId
		charCombatant("a2", "char-2", 30),
	}}
	ids := characterIDsInState(state)
	if len(ids) != 2 || !ids["char-1"] || !ids["char-2"] {
		t.Fatalf("ожидались char-1 и char-2, получено: %+v", ids)
	}
	if ids["m1"] {
		t.Fatalf("монстр без characterId не должен попадать в множество")
	}
}

func TestCharacterIDsInState_Empty(t *testing.T) {
	if len(characterIDsInState(nil)) != 0 {
		t.Fatalf("nil-состояние должно давать пустое множество")
	}
	if len(characterIDsInState(map[string]interface{}{})) != 0 {
		t.Fatalf("состояние без combatants должно давать пустое множество")
	}
}

// Диф before/after (логика Apply: added = after-before, removed = before-after)
// на примере добавления и удаления персонажа-комбатанта.
func TestCharacterLinkDiff(t *testing.T) {
	base := map[string]interface{}{"combatants": []interface{}{charCombatant("a1", "char-1", 20)}}
	before := characterIDsInState(base)

	// добавляем персонажа char-2
	added := applyOps(base, ApplyRequest{Add: []map[string]interface{}{charCombatant("a2", "char-2", 30)}})
	after := characterIDsInState(added)
	if before["char-2"] || !after["char-2"] {
		t.Fatalf("char-2 должен быть новым (added): before=%v after=%v", before, after)
	}

	// удаляем персонажа char-1 по actorId
	removedState := applyOps(added, ApplyRequest{Remove: []string{"a1"}})
	afterRemove := characterIDsInState(removedState)
	if !after["char-1"] || afterRemove["char-1"] {
		t.Fatalf("char-1 должен исчезнуть (removed): after=%v afterRemove=%v", after, afterRemove)
	}
}

func TestOpPayload_Log(t *testing.T) {
	// Структурированный журнал (Log) должен попасть в payload события боя (общий журнал + основа
	// журналов персонажей на сервере).
	m := opPayload(ApplyRequest{Log: []BattleLogEntry{{
		Message:           "Тест нанёс урон 6 (яд) по ПУ",
		TargetCharacterID: "char-pu",
		Type:              "damage",
		Payload:           JSONMap{"type": "damage", "amount": float64(6), "damageType": "poison", "source": "Тест"},
	}}})
	raw, ok := m["log"].([]interface{})
	if !ok || len(raw) != 1 {
		t.Fatalf("log не сериализовался в payload: %+v", m["log"])
	}
	entry := raw[0].(map[string]interface{})
	if entry["message"] != "Тест нанёс урон 6 (яд) по ПУ" || entry["targetCharacterId"] != "char-pu" {
		t.Fatalf("поля log потеряны: %+v", entry)
	}
	pl := entry["payload"].(map[string]interface{})
	if pl["type"] != "damage" || pl["source"] != "Тест" {
		t.Fatalf("EngineEvent payload потерян: %+v", pl)
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
