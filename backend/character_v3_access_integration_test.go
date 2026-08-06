package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

const characterV3AccessTestSecret = "character-v3-access-test-secret-at-least-32-bytes"

type characterV3AccessFixture struct {
	db              *gorm.DB
	router          *gin.Engine
	auth            *AuthService
	owner           User
	other           User
	public          User
	ownerCharacter  CharacterV3
	deleteCharacter CharacterV3
	otherCharacter  CharacterV3
	publicCharacter CharacterV3
}

func characterV3SchemaDSN(dsn, schema string) (string, error) {
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		parsed, err := url.Parse(dsn)
		if err != nil {
			return "", err
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		return parsed.String(), nil
	}
	return strings.TrimSpace(dsn) + " search_path=" + schema, nil
}

func openCharacterV3AccessFixture(t *testing.T) characterV3AccessFixture {
	t.Helper()
	dsn := os.Getenv("CANONICAL_RUNTIME_TEST_DSN")
	if dsn == "" {
		t.Skip("CANONICAL_RUNTIME_TEST_DSN is not set")
	}
	quiet := &gorm.Config{
		DisableForeignKeyConstraintWhenMigrating: true,
		Logger:                                   logger.Default.LogMode(logger.Silent),
	}
	admin, err := gorm.Open(postgres.Open(dsn), quiet)
	if err != nil {
		t.Fatal(err)
	}
	schema := "character_v3_access_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err = admin.Exec(fmt.Sprintf("CREATE SCHEMA %s", schema)).Error; err != nil {
		t.Fatal(err)
	}
	isolatedDSN, err := characterV3SchemaDSN(dsn, schema)
	if err != nil {
		t.Fatal(err)
	}
	db, err := gorm.Open(postgres.Open(isolatedDSN), quiet)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = admin.Exec(fmt.Sprintf("DROP SCHEMA IF EXISTS %s CASCADE", schema)).Error
		if sqlDB, dbErr := db.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
		if sqlDB, dbErr := admin.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})
	if err = db.AutoMigrate(
		&User{}, &Group{}, &CharacterV3{}, &CharacterEvent{}, &CharacterRuntimeCommandRecord{},
	); err != nil {
		t.Fatal(err)
	}

	fixture := characterV3AccessFixture{db: db}
	fixture.owner = User{
		ID: uuid.New(), Username: "owner", Email: "owner@example.test",
		PasswordHash: "disabled", DisplayName: "Owner",
	}
	fixture.other = User{
		ID: uuid.New(), Username: "other", Email: "other@example.test",
		PasswordHash: "disabled", DisplayName: "Other",
	}
	fixture.public = User{
		ID: uuid.New(), Username: legacyPublicUsername, Email: "public@local",
		PasswordHash: "disabled", DisplayName: "Public",
	}
	for _, user := range []*User{&fixture.owner, &fixture.other, &fixture.public} {
		if err = db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
	}
	fixture.ownerCharacter = testCharacterV3(fixture.owner.ID, "Owner hero")
	fixture.deleteCharacter = testCharacterV3(fixture.owner.ID, "Owner delete")
	fixture.otherCharacter = testCharacterV3(fixture.other.ID, "Private other hero")
	fixture.publicCharacter = testCharacterV3(fixture.public.ID, "Legacy public hero")
	for _, character := range []*CharacterV3{
		&fixture.ownerCharacter,
		&fixture.deleteCharacter,
		&fixture.otherCharacter,
		&fixture.publicCharacter,
	} {
		if err = db.Create(character).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err = db.Create(&CharacterEvent{
		CharacterID: fixture.publicCharacter.ID,
		Type:        "narrative",
		Payload:     JSONMap{"type": "narrative", "text": "Legacy public journal entry"},
	}).Error; err != nil {
		t.Fatal(err)
	}

	fixture.auth = NewAuthService(db)
	fixture.router = characterV3Router(fixture.auth, NewCharacterV3Controller(db))
	return fixture
}

func testCharacterV3(userID uuid.UUID, name string) CharacterV3 {
	character := CharacterV3{ID: uuid.New(), UserID: userID, Name: name, CurrentHP: 10, MaxHP: 10}
	applyCharacterV3Defaults(&character)
	return character
}

func characterV3Router(auth *AuthService, controller *CharacterV3Controller) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	api := router.Group("/api")
	registerCharacterV3Routes(api, auth, controller)
	return router
}

func (fixture characterV3AccessFixture) token(t *testing.T, user User) string {
	t.Helper()
	token, err := fixture.auth.generateJWTToken(user)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func performCharacterV3Request(
	t *testing.T,
	router http.Handler,
	method string,
	path string,
	token string,
	body any,
) *httptest.ResponseRecorder {
	t.Helper()
	var encoded []byte
	var err error
	if body != nil {
		encoded, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	request := httptest.NewRequest(method, path, bytes.NewReader(encoded))
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func TestCharacterV3RoutesRequireStrictJWT(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	router := characterV3Router(&AuthService{}, nil)
	id := uuid.NewString()
	for _, route := range []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/characters-v3"},
		{http.MethodGet, "/api/characters-v3"},
		{http.MethodPost, "/api/characters-v3/runtime-commands"},
		{http.MethodGet, "/api/characters-v3/" + id},
		{http.MethodPut, "/api/characters-v3/" + id},
		{http.MethodDelete, "/api/characters-v3/" + id},
		{http.MethodGet, "/api/characters-v3/" + id + "/events"},
		{http.MethodPost, "/api/characters-v3/" + id + "/events"},
		{http.MethodPatch, "/api/characters-v3/" + id + "/runtime"},
	} {
		response := performCharacterV3Request(t, router, route.method, route.path, "", nil)
		if response.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: want 401, got %d: %s", route.method, route.path, response.Code, response.Body.String())
		}
	}
}

func TestCharacterV3OwnerAndLegacyPublicAccessPolicy(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	ownerToken := fixture.token(t, fixture.owner)

	created := performCharacterV3Request(t, fixture.router, http.MethodPost, "/api/characters-v3", ownerToken, map[string]any{
		"name":            "Authenticated creation",
		"equipment":       map[string]any{"main_hand": "card-sword"},
		"inventory_items": []any{map[string]any{"card_id": "card-rope", "qty": 2}},
		"resources":       map[string]any{"spell_slot_1": 1},
		"max_resources":   map[string]any{"spell_slot_1": 2},
		"active_effects": []any{map[string]any{
			"id": "effect-test", "name": "Test", "mechanics": map[string]any{}, "source": "test",
		}},
		"turn_state": map[string]any{"temp_hp": 3},
		"currency":   map[string]any{"gp": 12},
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("owner create: got %d: %s", created.Code, created.Body.String())
	}
	var createdCharacter CharacterV3
	if err := json.Unmarshal(created.Body.Bytes(), &createdCharacter); err != nil {
		t.Fatal(err)
	}
	if createdCharacter.UserID != fixture.owner.ID {
		t.Fatalf("created character owner=%s, want authenticated user %s", createdCharacter.UserID, fixture.owner.ID)
	}
	if createdCharacter.AccessMode != characterV3AccessOwner {
		t.Fatalf("created access_mode=%q, want owner", createdCharacter.AccessMode)
	}
	if createdCharacter.Equipment == nil || (*createdCharacter.Equipment)["main_hand"] != "card-sword" ||
		createdCharacter.InventoryItems == nil || len(*createdCharacter.InventoryItems) != 1 ||
		createdCharacter.Resources == nil || (*createdCharacter.Resources)["spell_slot_1"] != float64(1) ||
		createdCharacter.ActiveEffects == nil || len(*createdCharacter.ActiveEffects) != 1 ||
		createdCharacter.TurnState == nil || (*createdCharacter.TurnState)["temp_hp"] != float64(3) ||
		createdCharacter.Currency == nil || (*createdCharacter.Currency)["gp"] != float64(12) {
		t.Fatalf("initial runtime was not returned by atomic create: %#v", createdCharacter)
	}

	list := performCharacterV3Request(t, fixture.router, http.MethodGet, "/api/characters-v3", ownerToken, nil)
	if list.Code != http.StatusOK {
		t.Fatalf("owner list: got %d: %s", list.Code, list.Body.String())
	}
	var listed []CharacterV3
	if err := json.Unmarshal(list.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	listedIDs := make(map[uuid.UUID]bool, len(listed))
	for _, character := range listed {
		listedIDs[character.ID] = true
		wantMode := characterV3AccessOwner
		if character.ID == fixture.publicCharacter.ID {
			wantMode = characterV3AccessLegacyPublicReadonly
		}
		if character.AccessMode != wantMode {
			t.Errorf("listed character %s access_mode=%q, want %q", character.ID, character.AccessMode, wantMode)
		}
	}
	for _, expected := range []uuid.UUID{
		fixture.ownerCharacter.ID, fixture.deleteCharacter.ID,
		fixture.publicCharacter.ID, createdCharacter.ID,
	} {
		if !listedIDs[expected] {
			t.Errorf("owner/public character %s missing from authenticated list", expected)
		}
	}
	if listedIDs[fixture.otherCharacter.ID] {
		t.Error("another user's private character leaked into list")
	}

	for name, testCase := range map[string]struct {
		path string
		want int
		mode string
	}{
		"owner read": {
			path: "/api/characters-v3/" + fixture.ownerCharacter.ID.String(), want: http.StatusOK,
			mode: characterV3AccessOwner,
		},
		"public read": {
			path: "/api/characters-v3/" + fixture.publicCharacter.ID.String(), want: http.StatusOK,
			mode: characterV3AccessLegacyPublicReadonly,
		},
		"other private read": {
			path: "/api/characters-v3/" + fixture.otherCharacter.ID.String(), want: http.StatusForbidden,
		},
		"owner event read": {
			path: "/api/characters-v3/" + fixture.ownerCharacter.ID.String() + "/events", want: http.StatusOK,
		},
		"public event read": {
			path: "/api/characters-v3/" + fixture.publicCharacter.ID.String() + "/events", want: http.StatusOK,
		},
		"other event read": {
			path: "/api/characters-v3/" + fixture.otherCharacter.ID.String() + "/events", want: http.StatusForbidden,
		},
	} {
		t.Run(name, func(t *testing.T) {
			response := performCharacterV3Request(t, fixture.router, http.MethodGet, testCase.path, ownerToken, nil)
			if response.Code != testCase.want {
				t.Fatalf("want %d, got %d: %s", testCase.want, response.Code, response.Body.String())
			}
			if testCase.mode != "" {
				var responseCharacter CharacterV3
				if err := json.Unmarshal(response.Body.Bytes(), &responseCharacter); err != nil {
					t.Fatal(err)
				}
				if responseCharacter.AccessMode != testCase.mode {
					t.Fatalf("access_mode=%q, want %q", responseCharacter.AccessMode, testCase.mode)
				}
			}
		})
	}

	publicToken := fixture.token(t, fixture.public)
	publicCreate := performCharacterV3Request(
		t, fixture.router, http.MethodPost, "/api/characters-v3", publicToken,
		map[string]any{"name": "Must not become public"},
	)
	if publicCreate.Code != http.StatusForbidden {
		t.Fatalf("legacy public identity create: want 403, got %d: %s", publicCreate.Code, publicCreate.Body.String())
	}
	publicSelfMutation := performCharacterV3Request(
		t, fixture.router, http.MethodPatch,
		"/api/characters-v3/"+fixture.publicCharacter.ID.String()+"/runtime",
		publicToken, map[string]any{"current_hp": 1},
	)
	if publicSelfMutation.Code != http.StatusForbidden {
		t.Fatalf("legacy public identity runtime mutation: want 403, got %d: %s", publicSelfMutation.Code, publicSelfMutation.Body.String())
	}

	ownerUpdate := performCharacterV3Request(
		t, fixture.router, http.MethodPut,
		"/api/characters-v3/"+fixture.ownerCharacter.ID.String(), ownerToken,
		map[string]any{"name": "Owner updated", "level": 1},
	)
	if ownerUpdate.Code != http.StatusOK {
		t.Fatalf("owner update: got %d: %s", ownerUpdate.Code, ownerUpdate.Body.String())
	}
	ownerRuntime := performCharacterV3Request(
		t, fixture.router, http.MethodPatch,
		"/api/characters-v3/"+fixture.ownerCharacter.ID.String()+"/runtime", ownerToken,
		map[string]any{"current_hp": 7},
	)
	if ownerRuntime.Code != http.StatusOK {
		t.Fatalf("owner runtime: got %d: %s", ownerRuntime.Code, ownerRuntime.Body.String())
	}
	ownerEvent := performCharacterV3Request(
		t, fixture.router, http.MethodPost,
		"/api/characters-v3/"+fixture.ownerCharacter.ID.String()+"/events", ownerToken,
		map[string]any{"events": []any{map[string]any{
			"type": "narrative", "payload": map[string]any{"type": "narrative", "text": "Owner journal test"},
		}}},
	)
	if ownerEvent.Code != http.StatusCreated {
		t.Fatalf("owner event: got %d: %s", ownerEvent.Code, ownerEvent.Body.String())
	}
	ownerDelete := performCharacterV3Request(
		t, fixture.router, http.MethodDelete,
		"/api/characters-v3/"+fixture.deleteCharacter.ID.String(), ownerToken, nil,
	)
	if ownerDelete.Code != http.StatusOK {
		t.Fatalf("owner delete: got %d: %s", ownerDelete.Code, ownerDelete.Body.String())
	}

	for _, target := range []struct {
		name string
		id   uuid.UUID
	}{
		{name: "legacy public", id: fixture.publicCharacter.ID},
		{name: "other private", id: fixture.otherCharacter.ID},
	} {
		t.Run(target.name+" is read-only", func(t *testing.T) {
			base := "/api/characters-v3/" + target.id.String()
			for _, mutation := range []struct {
				method string
				path   string
				body   any
			}{
				{http.MethodPut, base, map[string]any{"name": "forbidden"}},
				{http.MethodDelete, base, nil},
				{http.MethodPatch, base + "/runtime", map[string]any{"current_hp": 1}},
				{http.MethodPost, base + "/events", map[string]any{"events": []any{map[string]any{
					"type": "forbidden", "payload": map[string]any{"ok": false},
				}}}},
			} {
				response := performCharacterV3Request(
					t, fixture.router, mutation.method, mutation.path, ownerToken, mutation.body,
				)
				if response.Code != http.StatusForbidden {
					t.Errorf("%s %s: want 403, got %d: %s", mutation.method, mutation.path, response.Code, response.Body.String())
				}
			}
		})
	}

	var publicAfter CharacterV3
	if err := fixture.db.First(&publicAfter, "id = ?", fixture.publicCharacter.ID).Error; err != nil {
		t.Fatal(err)
	}
	if publicAfter.CurrentHP != fixture.publicCharacter.CurrentHP || publicAfter.Name != fixture.publicCharacter.Name {
		t.Fatalf("legacy public character changed: %#v", publicAfter)
	}
	var publicEventCount int64
	if err := fixture.db.Model(&CharacterEvent{}).
		Where("character_id = ?", fixture.publicCharacter.ID).Count(&publicEventCount).Error; err != nil {
		t.Fatal(err)
	}
	if publicEventCount != 1 {
		t.Fatalf("legacy public journal changed: count=%d, want 1", publicEventCount)
	}
}

func TestCharacterV3AtomicCreateFailureLeavesNoPartialRow(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	if err := fixture.db.Exec(`
		CREATE FUNCTION reject_atomic_character_create() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF NEW.name = 'Rejected atomic create' THEN
				RAISE EXCEPTION 'forced atomic create failure';
			END IF;
			RETURN NEW;
		END;
		$$;
		CREATE TRIGGER reject_atomic_character_create
		BEFORE INSERT ON characters_v3
		FOR EACH ROW EXECUTE FUNCTION reject_atomic_character_create();
	`).Error; err != nil {
		t.Fatal(err)
	}

	response := performCharacterV3Request(
		t, fixture.router, http.MethodPost, "/api/characters-v3",
		fixture.token(t, fixture.owner), map[string]any{
			"name":      "Rejected atomic create",
			"equipment": map[string]any{"main_hand": "card-sword"},
			"resources": map[string]any{"spell_slot_1": 1},
		},
	)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d: %s", response.Code, response.Body.String())
	}
	var count int64
	if err := fixture.db.Model(&CharacterV3{}).
		Where("name = ?", "Rejected atomic create").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("failed atomic create left %d partial rows", count)
	}
}

func TestCharacterV3LinkedRuntimeIsEncounterOwnedButOtherEditsPersist(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	encounterID := uuid.New()
	originalEffects := ActiveEffectRows{{ID: "encounter-effect", Name: "Encounter effect"}}
	originalTurnState := JSONMap{"temp_hp": float64(6), "death_saves": map[string]any{"failures": float64(1)}}
	if err := fixture.db.Model(&CharacterV3{}).
		Where("id = ?", fixture.ownerCharacter.ID).
		Updates(map[string]any{
			"current_encounter_id": encounterID,
			"current_hp":           8,
			"active_effects":       &originalEffects,
			"turn_state":           &originalTurnState,
		}).Error; err != nil {
		t.Fatal(err)
	}

	token := fixture.token(t, fixture.owner)
	update := performCharacterV3Request(
		t, fixture.router, http.MethodPut,
		"/api/characters-v3/"+fixture.ownerCharacter.ID.String(), token,
		map[string]any{"name": "Edited while linked", "level": 1, "current_hp": 1},
	)
	if update.Code != http.StatusOK {
		t.Fatalf("linked PUT: got %d: %s", update.Code, update.Body.String())
	}

	patch := performCharacterV3Request(
		t, fixture.router, http.MethodPatch,
		"/api/characters-v3/"+fixture.ownerCharacter.ID.String()+"/runtime", token,
		map[string]any{
			"current_hp":     2,
			"active_effects": []any{map[string]any{"id": "direct-overwrite", "name": "Wrong"}},
			"resources":      map[string]any{"action": 0},
			"turn_state": map[string]any{
				"temp_hp": float64(1), "death_saves": map[string]any{"failures": float64(2)}, "attuned_ids": []any{"item-a"},
			},
		},
	)
	if patch.Code != http.StatusOK {
		t.Fatalf("linked runtime PATCH: got %d: %s", patch.Code, patch.Body.String())
	}

	var stored CharacterV3
	if err := fixture.db.First(&stored, "id = ?", fixture.ownerCharacter.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Name != "Edited while linked" || stored.CurrentHP != 8 {
		t.Fatalf("ordinary edit/current HP mismatch: name=%q hp=%d", stored.Name, stored.CurrentHP)
	}
	if stored.ActiveEffects == nil || len(*stored.ActiveEffects) != 1 || (*stored.ActiveEffects)[0].ID != "encounter-effect" {
		t.Fatalf("direct PATCH overwrote encounter effects: %#v", stored.ActiveEffects)
	}
	if stored.TurnState == nil || (*stored.TurnState)["temp_hp"] != float64(6) {
		t.Fatalf("direct PATCH overwrote encounter temp HP: %#v", stored.TurnState)
	}
	if _, ok := (*stored.TurnState)["attuned_ids"]; !ok {
		t.Fatalf("unrelated turn_state edit was lost: %#v", stored.TurnState)
	}
	if stored.Resources == nil || (*stored.Resources)["action"] != float64(0) {
		t.Fatalf("unrelated resource edit was lost: %#v", stored.Resources)
	}

	deleteResponse := performCharacterV3Request(
		t, fixture.router, http.MethodDelete,
		"/api/characters-v3/"+fixture.ownerCharacter.ID.String(), token, nil,
	)
	if deleteResponse.Code != http.StatusConflict || !strings.Contains(deleteResponse.Body.String(), "уберите персонажа") {
		t.Fatalf("linked DELETE: got %d: %s", deleteResponse.Code, deleteResponse.Body.String())
	}
	if err := fixture.db.First(&CharacterV3{}, "id = ?", fixture.ownerCharacter.ID).Error; err != nil {
		t.Fatalf("linked character was deleted: %v", err)
	}
}

func TestCharacterV3DeleteSerializesWithEncounterLinkWrite(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	token := fixture.token(t, fixture.owner)

	linkTransaction := fixture.db.Begin()
	if linkTransaction.Error != nil {
		t.Fatal(linkTransaction.Error)
	}
	defer linkTransaction.Rollback()
	var locked CharacterV3
	if err := linkTransaction.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", fixture.ownerCharacter.ID).First(&locked).Error; err != nil {
		t.Fatal(err)
	}

	responseChannel := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		request := httptest.NewRequest(
			http.MethodDelete,
			"/api/characters-v3/"+fixture.ownerCharacter.ID.String(),
			nil,
		)
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		fixture.router.ServeHTTP(response, request)
		responseChannel <- response
	}()

	select {
	case response := <-responseChannel:
		t.Fatalf("DELETE bypassed the character row lock: %d %s", response.Code, response.Body.String())
	case <-time.After(75 * time.Millisecond):
	}
	encounterID := uuid.New()
	if err := linkTransaction.Model(&CharacterV3{}).
		Where("id = ?", fixture.ownerCharacter.ID).
		Update("current_encounter_id", encounterID).Error; err != nil {
		t.Fatal(err)
	}
	if err := linkTransaction.Commit().Error; err != nil {
		t.Fatal(err)
	}

	select {
	case response := <-responseChannel:
		if response.Code != http.StatusConflict {
			t.Fatalf("DELETE after concurrent link: got %d: %s", response.Code, response.Body.String())
		}
	case <-time.After(3 * time.Second):
		t.Fatal("DELETE remained blocked after encounter link committed")
	}
	if err := fixture.db.First(&CharacterV3{}, "id = ?", fixture.ownerCharacter.ID).Error; err != nil {
		t.Fatalf("concurrently linked character was deleted: %v", err)
	}
}
