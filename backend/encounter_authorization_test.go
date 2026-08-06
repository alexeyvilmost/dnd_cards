package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func encounterForPolicy(owner, member uuid.UUID) Encounter {
	return Encounter{
		ID:            uuid.New(),
		OwnerUserID:   owner,
		MemberUserIDs: Properties{owner.String(), member.String()},
	}
}

func TestRequireEncounterParticipantDeniesCrossUserAndAllowsMember(t *testing.T) {
	gin.SetMode(gin.TestMode)
	owner, member, outsider := uuid.New(), uuid.New(), uuid.New()
	enc := encounterForPolicy(owner, member)

	for _, test := range []struct {
		name       string
		userID     uuid.UUID
		allowed    bool
		wantStatus int
	}{
		{name: "owner", userID: owner, allowed: true, wantStatus: http.StatusOK},
		{name: "member", userID: member, allowed: true, wantStatus: http.StatusOK},
		{name: "cross-user", userID: outsider, allowed: false, wantStatus: http.StatusForbidden},
	} {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Set("user_id", test.userID)
			_, allowed := requireEncounterParticipant(ctx, &enc)
			if allowed != test.allowed {
				t.Fatalf("allowed=%v, want %v", allowed, test.allowed)
			}
			if !test.allowed && recorder.Code != test.wantStatus {
				t.Fatalf("status=%d, want %d", recorder.Code, test.wantStatus)
			}
		})
	}
}

func TestEncounterJoinRequiresExistingMembershipOrControlledCharacter(t *testing.T) {
	owner, member, controller, outsider := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	enc := encounterForPolicy(owner, member)
	actors := map[string]encounterActorAccess{
		"controller-character": {
			ActorID:          "controller-character",
			CharacterID:      uuid.New(),
			ControllerUserID: controller,
			IsCharacter:      true,
		},
	}
	if !encounterJoinAllowed(&enc, member, actors) {
		t.Fatal("existing member must be allowed to join idempotently")
	}
	if !encounterJoinAllowed(&enc, controller, actors) {
		t.Fatal("actual controller of a character already in the encounter must be allowed")
	}
	if encounterJoinAllowed(&enc, outsider, actors) {
		t.Fatal("unrelated authenticated user must not acquire membership from an encounter UUID")
	}
}

func TestEncounterApplyPolicyAllowsInteractionButProtectsTopologyAndIdentity(t *testing.T) {
	owner, member, otherMember, outsider := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	enc := encounterForPolicy(owner, member)
	enc.MemberUserIDs = append(enc.MemberUserIDs, otherMember.String())
	memberCharacter, targetCharacter := uuid.New(), uuid.New()
	actors := map[string]encounterActorAccess{
		"member": {
			ActorID: "member", CharacterID: memberCharacter,
			ControllerUserID: member, IsCharacter: true,
		},
		"target": {
			ActorID: "target", CharacterID: targetCharacter,
			ControllerUserID: otherMember, IsCharacter: true,
		},
		"monster": {ActorID: "monster"},
	}

	interaction := ApplyRequest{Patches: []CombatantPatch{{
		ActorID: "target",
		Set: JSONMap{
			"hp":            float64(7),
			"temp":          float64(0),
			"activeEffects": []interface{}{map[string]interface{}{"id": "prone", "name": "Опрокинут"}},
			"pendingSaves":  []interface{}{},
		},
	}}}
	if err := validateEncounterApplyPolicy(&enc, member, actors, nil, interaction); err == nil || err.Status != http.StatusForbidden {
		t.Fatalf("participant must not directly overwrite a foreign actor, got %#v", err)
	}
	if err := validateEncounterApplyPolicy(&enc, owner, actors, nil, interaction); err != nil {
		t.Fatalf("encounter owner must be able to apply an interaction to a target: %v", err)
	}
	selfInteraction := ApplyRequest{Patches: []CombatantPatch{{ActorID: "member", Set: JSONMap{"hp": float64(7)}}}}
	if err := validateEncounterApplyPolicy(&enc, member, actors, nil, selfInteraction); err != nil {
		t.Fatalf("character controller must be able to patch their own actor: %v", err)
	}
	if err := validateEncounterApplyPolicy(&enc, outsider, actors, nil, interaction); err == nil || err.Status != http.StatusForbidden {
		t.Fatalf("cross-user apply must be forbidden, got %#v", err)
	}

	identityPatch := ApplyRequest{Patches: []CombatantPatch{{ActorID: "member", Set: JSONMap{"characterId": uuid.New().String()}}}}
	if err := validateEncounterApplyPolicy(&enc, member, actors, nil, identityPatch); err == nil || err.Status != http.StatusBadRequest {
		t.Fatalf("browser must not rewrite combatant identity, got %#v", err)
	}

	if err := validateEncounterApplyPolicy(&enc, member, actors, nil, ApplyRequest{Remove: []string{"member"}}); err != nil {
		t.Fatalf("controller must be allowed to remove their own character: %v", err)
	}
	if err := validateEncounterApplyPolicy(&enc, member, actors, nil, ApplyRequest{Remove: []string{"target"}}); err == nil || err.Status != http.StatusForbidden {
		t.Fatalf("member must not remove another controller's character, got %#v", err)
	}
	if err := validateEncounterApplyPolicy(&enc, member, actors, nil, ApplyRequest{Remove: []string{"monster"}}); err == nil || err.Status != http.StatusForbidden {
		t.Fatalf("member must not remove encounter-owned creatures, got %#v", err)
	}
}

func TestEncounterApplyPolicyValidatesBoundedRuntimeShapes(t *testing.T) {
	owner, member := uuid.New(), uuid.New()
	enc := encounterForPolicy(owner, member)
	actors := map[string]encounterActorAccess{"hero": {ActorID: "hero", IsCharacter: true, ControllerUserID: member}}
	validOutcome := map[string]interface{}{"hpDelta": float64(-3), "tempDelta": float64(0), "addEffects": []interface{}{}}
	validSave := map[string]interface{}{
		"id": "save-1", "sourceName": "Mage", "actionName": "Spell", "ability": "dex", "dc": float64(13),
		"onFail": validOutcome, "onSuccess": validOutcome,
	}
	validAttack := map[string]interface{}{
		"id": "attack-1", "sourceName": "Fighter", "attackName": "Sword", "attackTotal": float64(17), "damage": float64(4),
	}
	valid := ApplyRequest{Patches: []CombatantPatch{{ActorID: "hero", Set: JSONMap{
		"hp": float64(7), "temp": float64(0),
		"activeEffects": []interface{}{map[string]interface{}{
			"id": "fx-1", "name": "Bless", "mechanics": map[string]interface{}{"kind": "modifier"},
			"ownerId": "hero", "sourceId": "cleric",
			"sourceTurnExpiry": map[string]interface{}{
				"sourceActorId": "cleric", "ownerActorId": "hero", "boundary": "end", "armed": true,
			},
		}},
		"pendingSaves": []interface{}{validSave}, "pendingAttacks": []interface{}{validAttack},
	}}}}
	if err := validateEncounterApplyPolicy(&enc, member, actors, nil, valid); err != nil {
		t.Fatalf("valid bounded runtime patch rejected: %v", err)
	}

	invalidValues := []interface{}{float64(-1), float64(1.5), float64(maxEncounterRuntimeValue + 1)}
	for _, value := range invalidValues {
		request := ApplyRequest{Patches: []CombatantPatch{{ActorID: "hero", Set: JSONMap{"hp": value}}}}
		if err := validateEncounterApplyPolicy(&enc, member, actors, nil, request); err == nil || err.Status != http.StatusBadRequest {
			t.Errorf("invalid HP %#v accepted: %#v", value, err)
		}
	}
	malformed := ApplyRequest{Patches: []CombatantPatch{{ActorID: "hero", Set: JSONMap{
		"activeEffects": []interface{}{map[string]interface{}{"id": "missing-name"}},
	}}}}
	if err := validateEncounterApplyPolicy(&enc, member, actors, nil, malformed); err == nil || err.Status != http.StatusBadRequest {
		t.Fatalf("malformed active effect accepted: %#v", err)
	}
	malformedLifecycle := ApplyRequest{Patches: []CombatantPatch{{ActorID: "hero", Set: JSONMap{
		"activeEffects": []interface{}{map[string]interface{}{
			"id": "bad-lifecycle", "name": "Bad lifecycle",
			"sourceTurnExpiry": map[string]interface{}{
				"sourceActorId": "cleric", "ownerActorId": "hero", "boundary": "middle",
			},
		}},
	}}}}
	if err := validateEncounterApplyPolicy(&enc, member, actors, nil, malformedLifecycle); err == nil || err.Status != http.StatusBadRequest {
		t.Fatalf("malformed source-turn lifecycle accepted: %#v", err)
	}
	tooMany := make([]interface{}, maxEncounterRuntimeRows+1)
	request := ApplyRequest{Patches: []CombatantPatch{{ActorID: "hero", Set: JSONMap{"pendingSaves": tooMany}}}}
	if err := validateEncounterApplyPolicy(&enc, member, actors, nil, request); err == nil || err.Status != http.StatusBadRequest {
		t.Fatalf("oversized pending array accepted: %#v", err)
	}
}

func TestEncounterApplyPolicyAllowsOnlyControllerToAddCharacter(t *testing.T) {
	owner, member, otherMember := uuid.New(), uuid.New(), uuid.New()
	enc := encounterForPolicy(owner, member)
	enc.MemberUserIDs = append(enc.MemberUserIDs, otherMember.String())
	characterID := uuid.New()
	request := ApplyRequest{Add: []map[string]interface{}{{
		"actorId": "new-character", "characterId": characterID.String(),
		"ownerUserId": otherMember.String(), // untrusted and deliberately forged
	}}}

	if err := validateEncounterApplyPolicy(&enc, member, nil, map[uuid.UUID]uuid.UUID{characterID: member}, request); err != nil {
		t.Fatalf("actual controller must be able to add their character: %v", err)
	}
	if err := validateEncounterApplyPolicy(&enc, member, nil, map[uuid.UUID]uuid.UUID{characterID: otherMember}, request); err == nil || err.Status != http.StatusForbidden {
		t.Fatalf("forged ownerUserId must not authorize a foreign character, got %#v", err)
	}

	character := CharacterV3{ID: characterID, UserID: member, Name: "Authoritative", CurrentHP: 9, MaxHP: 12, ArmorClass: 15}
	normalized := normalizeEncounterAdds(request, map[uuid.UUID]CharacterV3{characterID: character})
	added := normalized.Add[0]
	if added["ownerUserId"] != member.String() || added["name"] != "Authoritative" || added["hp"] != 9 {
		t.Fatalf("character fields were not replaced with authoritative values: %#v", added)
	}
}

func TestEncounterApplyPolicyProtectsCharacterJournal(t *testing.T) {
	owner, member := uuid.New(), uuid.New()
	enc := encounterForPolicy(owner, member)
	characterID := uuid.New()
	actors := map[string]encounterActorAccess{
		"member": {ActorID: "member", CharacterID: characterID, ControllerUserID: member, IsCharacter: true},
	}
	allowed := ApplyRequest{Log: []BattleLogEntry{{TargetCharacterID: characterID.String(), Type: "damage", Payload: JSONMap{"type": "damage"}}}}
	if err := validateEncounterApplyPolicy(&enc, member, actors, nil, allowed); err != nil {
		t.Fatalf("participant must be able to journal an interaction with an encounter character: %v", err)
	}
	foreign := ApplyRequest{Log: []BattleLogEntry{{TargetCharacterID: uuid.New().String(), Type: "damage", Payload: JSONMap{"type": "damage"}}}}
	if err := validateEncounterApplyPolicy(&enc, member, actors, nil, foreign); err == nil || err.Status != http.StatusForbidden {
		t.Fatalf("foreign character journal must be protected, got %#v", err)
	}
}

func TestEncounterRoutesRequireStrictJWTIncludingStream(t *testing.T) {
	source, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	if !regexp.MustCompile(`encounterAuth\s*:=\s*StrictAuthMiddleware\(authService\)`).MatchString(text) {
		t.Fatal("encounter strict authentication middleware is not configured")
	}
	for _, route := range []struct{ method, path string }{
		{"POST", "/encounters"},
		{"GET", "/encounters"},
		{"GET", "/encounters/:id"},
		{"DELETE", "/encounters/:id"},
		{"GET", "/encounters/:id/events"},
		{"POST", "/encounters/:id/invite"},
		{"POST", "/encounters/:id/join"},
		{"POST", "/encounters/:id/apply"},
		{"GET", "/encounters/:id/stream"},
	} {
		pattern := regexp.MustCompile(`api\.` + route.method + `\("` + regexp.QuoteMeta(route.path) + `",\s*encounterAuth,`)
		if !pattern.MatchString(text) {
			t.Errorf("%s %s must require encounterAuth", route.method, route.path)
		}
	}
}
