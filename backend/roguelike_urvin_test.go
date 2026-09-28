package main

import (
	"dnd-cards-backend/roguelikecontent"
	"encoding/json"
	"reflect"
	"testing"
)

func testUrvinRules(t *testing.T) UrvinDefinition {
	t.Helper()
	var d UrvinDefinition
	if err := json.Unmarshal(roguelikecontent.UrvinDefinition, &d); err != nil {
		t.Fatal(err)
	}
	return d
}
func TestUrvinRouteIsStableReachableAndEndsAtBoss(t *testing.T) {
	d := testUrvinRules(t)
	for _, seed := range []string{"a", "b", "third", "party-six"} {
		nodes := generateUrvinRoute(seed, d)
		if !reflect.DeepEqual(nodes, generateUrvinRoute(seed, d)) {
			t.Fatal("nondeterministic route")
		}
		index := map[string]UrvinNode{}
		for _, n := range nodes {
			index[n.ID] = n
		}
		bosses := 0
		for _, n := range nodes {
			if n.Kind == "boss" {
				bosses++
				if n.Row != d.Rows-1 || len(n.Next) != 0 {
					t.Fatal("non-final boss")
				}
				continue
			}
			if len(n.Next) == 0 {
				t.Fatal("dead end")
			}
			for _, next := range n.Next {
				if index[next].Row != n.Row+1 {
					t.Fatal("backward or skipping edge")
				}
			}
		}
		if bosses != 1 {
			t.Fatal("missing unique boss")
		}
	}
}
func TestUrvinCommandsCannotBypassRouteAndRest(t *testing.T) {
	d := testUrvinRules(t)
	run := RoguelikeRun{Mode: urvinMode}
	j := UrvinJourney{Version: 1, Nodes: generateUrvinRoute("a", d)}
	saveUrvinJourney(&run, j)
	for _, cmd := range []string{"start_encounter", "victory", "buy", "buy_cart", "long_rest", "short_rest"} {
		if urvinCommandAllowed(&run, cmd) == nil {
			t.Fatalf("allowed %s before room", cmd)
		}
	}
	j.Nodes[0].Kind = "shop"
	j.CurrentNode = j.Nodes[0].ID
	saveUrvinJourney(&run, j)
	if err := urvinCommandAllowed(&run, "buy_cart"); err != nil {
		t.Fatal(err)
	}
	finishUrvinRoom(&run)
	if urvinCommandAllowed(&run, "buy_cart") == nil {
		t.Fatal("closed shop")
	}
	run.Mode = "classic"
	if err := urvinCommandAllowed(&run, "start_encounter"); err != nil {
		t.Fatal("classic changed")
	}
}
func TestUrvinAllExperienceUsesAuraOperation(t *testing.T) {
	d := testUrvinRules(t)
	run := RoguelikeRun{Mode: urvinMode}
	j := UrvinJourney{Version: 1, Aura: d.Auras[4], AuraActive: true}
	saveUrvinJourney(&run, j)
	if urvinXPMultiplier(&run) != 2 {
		t.Fatal("solo multiplier")
	}
	j.Aura.ID = "another-entity"
	j.Aura.Mechanics = JSONMap{"journey": JSONMap{"operations": []JSONMap{{"kind": "experience_multiplier", "value": 3}}}}
	saveUrvinJourney(&run, j)
	if urvinXPMultiplier(&run) != 3 {
		t.Fatal("operation is hardcoded")
	}
	j.AuraActive = false
	saveUrvinJourney(&run, j)
	if urvinXPMultiplier(&run) != 1 {
		t.Fatal("spent aura active")
	}
}

func TestUrvinPendingCheckLocksOtherMutationPaths(t *testing.T) {
	run := RoguelikeRun{Mode: urvinMode}
	j := UrvinJourney{Version: 1, Event: &UrvinEventProgress{Pending: JSONMap{"phase": "influence"}}}
	saveUrvinJourney(&run, j)
	for _, cmd := range []string{"camp_action", "claim_stash", "confirm_level_up", "transfer_item", "enter_room", "event_choice", "event_roll", "retry", "initialize_combat"} {
		if urvinCommandAllowed(&run, cmd) == nil {
			t.Fatalf("allowed %s during held check", cmd)
		}
	}
	for _, cmd := range []string{"event_resolve", "event_continue"} {
		if err := urvinCommandAllowed(&run, cmd); err != nil {
			t.Fatal(err)
		}
	}
}
