package main

import (
	"strings"
	"testing"
)

func validMonsterRequest() MonsterUpsertRequest {
	abilities := JSONMap{"str": 8, "dex": 15, "con": 10, "int": 10, "wis": 8, "cha": 8}
	actions := Properties{"b1000000-0000-4000-8000-000000000001"}
	return MonsterUpsertRequest{
		Slug: " Goblin-Warrior ", Name: "  Гоблин  ",
		Abilities: &abilities, ActionIDs: &actions,
	}
}

func TestNormalizeMonsterRequestBuildsReusableDefaults(t *testing.T) {
	req := validMonsterRequest()
	normalizeMonsterRequest(&req)
	if req.Slug != "goblin-warrior" || req.Name != "Гоблин" {
		t.Fatalf("identity was not normalized: %#v", req)
	}
	if req.Size != "medium" || req.Speed != 30 || req.ArmorClass != 10 || req.MaxHP != 1 {
		t.Fatalf("stat block defaults are incomplete: %#v", req)
	}
	if req.AI == nil || (*req.AI)["strategy"] != "melee_chase" {
		t.Fatalf("default controller policy is missing: %#v", req.AI)
	}
	if issue := monsterRequestIssue(req); issue != "" {
		t.Fatalf("valid normalized monster rejected: %s", issue)
	}
}

func TestMonsterRequestRejectsIncompleteStatsAndOpaqueReferences(t *testing.T) {
	req := validMonsterRequest()
	delete(*req.Abilities, "wis")
	normalizeMonsterRequest(&req)
	if issue := monsterRequestIssue(req); !strings.Contains(issue, "wis") {
		t.Fatalf("missing ability should be named, got %q", issue)
	}

	req = validMonsterRequest()
	bad := Properties{"SCIMITAR-BY-NAME"}
	req.ActionIDs = &bad
	normalizeMonsterRequest(&req)
	if issue := monsterRequestIssue(req); !strings.Contains(issue, "UUID") {
		t.Fatalf("non-durable reference accepted, got %q", issue)
	}

	req = validMonsterRequest()
	duplicate := Properties{
		"b1000000-0000-4000-8000-000000000001",
		"b1000000-0000-4000-8000-000000000001",
	}
	req.ActionIDs = &duplicate
	normalizeMonsterRequest(&req)
	if issue := monsterRequestIssue(req); !strings.Contains(issue, "повторяться") {
		t.Fatalf("duplicate reference accepted, got %q", issue)
	}
}
