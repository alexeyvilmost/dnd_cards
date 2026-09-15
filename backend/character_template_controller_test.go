package main

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestCharacterTemplateCopyResetsOwnershipAndCombat(t *testing.T) {
	owner := uuid.New()
	source := testCharacterV3(owner, "Source")
	encounter := uuid.New()
	source.CurrentEncounterID = &encounter
	source.GroupID = &encounter
	source.CurrentHP = 1
	source.RuntimeRevision = 9
	source.MaxResources = &JSONMap{"action": float64(1)}
	source.Resources = &JSONMap{"action": float64(0)}
	source.TurnState = &JSONMap{"temporary": true}
	snapshot, err := templateSnapshot(source)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"id", "user_id", "user", "group_id", "current_encounter_id", "runtime_revision", "access_mode"} {
		if _, ok := snapshot[key]; ok {
			t.Fatal(key)
		}
	}
	copied, err := characterFromTemplate(CharacterTemplate{Character: snapshot}, uuid.New(), "New name")
	if err != nil {
		t.Fatal(err)
	}
	if copied.UserID == owner || copied.ID == source.ID || copied.Name != "New name" || copied.CurrentHP != copied.MaxHP || copied.RuntimeRevision != 0 || copied.CurrentEncounterID != nil || copied.GroupID != nil || copied.TurnState != nil {
		t.Fatal("copy leaked state")
	}
	if (*copied.Resources)["action"] != float64(1) {
		t.Fatal("spent resource leaked")
	}
}

func TestCharacterTemplateRoutesAuthorizationAndCopies(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	f := openCharacterV3AccessFixture(t)
	t.Setenv("CONTENT_ADMIN_USER_IDS", f.owner.ID.String())
	if err := f.db.AutoMigrate(&CharacterTemplate{}); err != nil {
		t.Fatal(err)
	}
	registerCharacterTemplateRoutes(f.router.Group("/api"), f.auth, f.db)
	adminToken, playerToken := f.token(t, f.owner), f.token(t, f.other)
	request := func(method, path, token string, body any, status int) []byte {
		t.Helper()
		r := performCharacterV3Request(t, f.router, method, path, token, body)
		if r.Code != status {
			t.Fatalf("%s %s: %d want %d: %s", method, path, r.Code, status, r.Body.String())
		}
		return r.Body.Bytes()
	}
	root := "/api/character-templates"
	body := map[string]any{"name": "Preset", "source_character_id": f.ownerCharacter.ID}
	request(http.MethodGet, root, "", nil, 401)
	request(http.MethodPost, root, playerToken, body, 403)
	request(http.MethodPost, root, adminToken, map[string]any{"name": "Stolen", "source_character_id": f.otherCharacter.ID}, 404)
	var template CharacterTemplate
	if err := json.Unmarshal(request(http.MethodPost, root, adminToken, body, 201), &template); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		token  string
		manage bool
	}{{adminToken, true}, {playerToken, false}} {
		var result struct {
			CanManage bool                `json:"can_manage"`
			Templates []CharacterTemplate `json:"templates"`
		}
		if err := json.Unmarshal(request(http.MethodGet, root, test.token, nil, 200), &result); err != nil {
			t.Fatal(err)
		}
		if result.CanManage != test.manage || len(result.Templates) != 1 {
			t.Fatal("incorrect catalog permissions")
		}
	}
	path := root + "/" + template.ID.String()
	request(http.MethodPut, path, playerToken, map[string]any{"name": "Hijack", "version": 1}, 403)
	request(http.MethodPut, path, adminToken, map[string]any{"name": "Edited", "version": 1}, 200)
	request(http.MethodPut, path, adminToken, map[string]any{"name": "Stale", "version": 1}, 409)
	var copy CharacterV3
	raw := request(http.MethodPost, path+"/copies", playerToken, map[string]any{"name": " My hero ", "user_id": f.owner.ID, "id": f.ownerCharacter.ID}, 201)
	if err := json.Unmarshal(raw, &copy); err != nil {
		t.Fatal(err)
	}
	if copy.UserID != f.other.ID || copy.ID == f.ownerCharacter.ID || copy.Name != "My hero" || copy.AccessMode != "owner" {
		t.Fatal("ownership override")
	}
	request(http.MethodPost, path+"/copies", playerToken, map[string]any{"name": " "}, 400)
	var unchanged CharacterTemplate
	f.db.First(&unchanged, "id = ?", template.ID)
	if unchanged.Name != "Edited" || unchanged.Version != 2 {
		t.Fatal("copy mutated catalog")
	}
	t.Setenv("CONTENT_ADMIN_USER_IDS", "")
	registerCharacterTemplateRoutes(f.router.Group("/closed/api"), f.auth, f.db)
	request(http.MethodPost, "/closed"+root, adminToken, body, 503)
}
