package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestCharacterV3AdministratorMatchesAccountCapability(t *testing.T) {
	allowlistedID, regularID := uuid.New(), uuid.New()
	t.Setenv("CONTENT_ADMIN_USER_IDS", allowlistedID.String())

	newContext := func(userID uuid.UUID, databaseAdmin bool) *gin.Context {
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		ctx.Set("user_id", userID)
		ctx.Set("is_admin", databaseAdmin)
		return ctx
	}

	if !isCharacterV3Administrator(newContext(allowlistedID, false)) {
		t.Fatal("account capability administrator from the server allowlist must access direct character links")
	}
	if !isCharacterV3Administrator(newContext(uuid.New(), true)) {
		t.Fatal("persistent database administrators must retain direct character access")
	}
	if isCharacterV3Administrator(newContext(regularID, false)) {
		t.Fatal("ordinary users outside the administrator allowlist must not access foreign characters")
	}
}

func TestCharacterV3ContentAdministratorCanOpenAnyCharacterByDirectLink(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	t.Setenv("CONTENT_ADMIN_USER_IDS", "")
	fixture := openCharacterV3AccessFixture(t)

	// This user is recognized as an administrator by the account UI's
	// server-side content-admin capability, but does not have users.is_admin.
	t.Setenv("CONTENT_ADMIN_USER_IDS", fixture.owner.ID.String())
	adminToken := fixture.token(t, fixture.owner)
	path := "/api/characters-v3/" + fixture.otherCharacter.ID.String()
	response := performCharacterV3Request(t, fixture.router, http.MethodGet, path, adminToken, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("content administrator direct read: got %d: %s", response.Code, response.Body.String())
	}

	var character CharacterV3
	if err := json.Unmarshal(response.Body.Bytes(), &character); err != nil {
		t.Fatal(err)
	}
	if character.ID != fixture.otherCharacter.ID || character.AccessMode != characterV3AccessOwner {
		t.Fatalf("content administrator must receive the editable direct-link character: %#v", character)
	}
}

func TestCharacterV3AdministratorCanEquipAndRemoveArmorAndShieldByDirectLink(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	t.Setenv("CONTENT_ADMIN_USER_IDS", "")
	fixture := openCharacterV3AccessFixture(t)
	if err := fixture.db.AutoMigrate(&Card{}, &EntityTag{}, &EntityTagAssignment{}); err != nil {
		t.Fatal(err)
	}
	installOwnedItemAccess(t, fixture.db)

	armor, shield := ownedTestCard(t, fixture.db, false), ownedTestCard(t, fixture.db, false)
	inventory := InventoryItemRows{{CardID: armor.ID.String(), Qty: 1}, {CardID: shield.ID.String(), Qty: 1}}
	if err := fixture.db.Model(&CharacterV3{}).Where("id = ?", fixture.otherCharacter.ID).Updates(map[string]any{
		"equipment": JSONMap{}, "inventory_items": inventory,
	}).Error; err != nil {
		t.Fatal(err)
	}

	adminToken := fixture.token(t, fixture.administrator)
	path := "/api/characters-v3/" + fixture.otherCharacter.ID.String()
	read := performCharacterV3Request(t, fixture.router, http.MethodGet, path, adminToken, nil)
	if read.Code != http.StatusOK {
		t.Fatalf("administrator direct read: got %d: %s", read.Code, read.Body.String())
	}
	var readCharacter CharacterV3
	if err := json.Unmarshal(read.Body.Bytes(), &readCharacter); err != nil {
		t.Fatal(err)
	}
	if readCharacter.ID != fixture.otherCharacter.ID || readCharacter.AccessMode != characterV3AccessOwner {
		t.Fatalf("administrator must receive the editable direct-link character: %#v", readCharacter)
	}

	equip := CharacterRuntimeCommandRequest{
		CommandID: uuid.NewString(), RulesetRef: testRuntimeCommandRuleset(),
		Participants: []CharacterRuntimeCommandParticipant{{
			CharacterID: fixture.otherCharacter.ID.String(), ExpectedRuntimeRevision: 0,
			Patch: CharacterRuntimeCommandPatch{
				Equipment:      &JSONMap{"body": armor.ID.String(), "off_hand": shield.ID.String()},
				InventoryItems: &InventoryItemRows{},
			},
		}},
	}
	response := performCharacterV3Request(t, fixture.router, http.MethodPost,
		"/api/characters-v3/runtime-commands", adminToken, equip)
	if response.Code != http.StatusOK {
		t.Fatalf("administrator equip: got %d: %s", response.Code, response.Body.String())
	}

	remove := CharacterRuntimeCommandRequest{
		CommandID: uuid.NewString(), RulesetRef: testRuntimeCommandRuleset(),
		Participants: []CharacterRuntimeCommandParticipant{{
			CharacterID: fixture.otherCharacter.ID.String(), ExpectedRuntimeRevision: 1,
			Patch: CharacterRuntimeCommandPatch{
				Equipment: &JSONMap{}, InventoryItems: &inventory,
			},
		}},
	}
	response = performCharacterV3Request(t, fixture.router, http.MethodPost,
		"/api/characters-v3/runtime-commands", adminToken, remove)
	if response.Code != http.StatusOK {
		t.Fatalf("administrator remove armor and shield: got %d: %s", response.Code, response.Body.String())
	}

	var saved CharacterV3
	if err := fixture.db.First(&saved, "id = ?", fixture.otherCharacter.ID).Error; err != nil {
		t.Fatal(err)
	}
	if saved.Equipment == nil || len(*saved.Equipment) != 0 || saved.InventoryItems == nil || len(*saved.InventoryItems) != 2 {
		t.Fatalf("administrator item transfer did not persist: equipment=%#v inventory=%#v", saved.Equipment, saved.InventoryItems)
	}
}
