package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"dnd-cards-backend/itemsource"
	"dnd-cards-backend/migrations"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestEntityReferencesHTTPMetadataPreviewPersistenceAndPrivacy(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	f := openCharacterV3AccessFixture(t)
	t.Setenv("CONTENT_ADMIN_USER_IDS", f.other.ID.String())
	if err := f.db.AutoMigrate(&Card{}, &Action{}, &Effect{}, &Class{}, &Race{}, &Spell{}, &EntityTag{}, &EntityTagAssignment{}, &ContentChoiceRecommendation{}); err != nil {
		t.Fatal(err)
	}
	// Match the historical migration from legacy array columns to JSONB.
	if err := f.db.Exec(`ALTER TABLE actions ALTER COLUMN related_cards TYPE jsonb USING to_jsonb(related_cards), ALTER COLUMN related_actions TYPE jsonb USING to_jsonb(related_actions), ALTER COLUMN properties TYPE jsonb USING to_jsonb(properties)`).Error; err != nil {
		t.Fatal(err)
	}
	sqlDB, err := f.db.DB()
	if err != nil {
		t.Fatal(err)
	}
	for _, migration := range migrations.GetAllMigrations() {
		if migration.Version == "281_entity_references" {
			if err := migration.Up(sqlDB); err != nil {
				t.Fatal(err)
			}
		}
	}
	effect, otherEffect := uuid.New(), uuid.New()
	for i, id := range []uuid.UUID{effect, otherEffect} {
		row := Effect{ID: id, Name: []string{"Granted", "Hidden grant"}[i], CardNumber: id.String(), Author: f.owner.ID.String(), Description: "test", Rarity: RarityCommon, EffectType: EffectType("passive")}
		if err := f.db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	publicCard, privateCard := uuid.New(), uuid.New()
	for i, id := range []uuid.UUID{publicCard, privateCard} {
		source := []string{itemsource.PlayersHandbook, "unpublished"}[i]
		refs := Properties{[]uuid.UUID{effect, otherEffect}[i].String()}
		row := Card{ID: id, Name: []string{"Visible card", "Secret card"}[i], CardNumber: id.String(), Author: f.owner.ID.String(), Description: "test", Rarity: RarityCommon, Source: &source, RelatedEffects: &refs}
		if err := f.db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	classID, raceID, actionID := uuid.New(), uuid.New(), uuid.New()
	for _, row := range []any{
		&Class{ID: classID, Name: "Test class", CardNumber: classID.String(), Description: "test", Author: f.owner.ID.String(), LevelProgression: &JSONMap{"3": map[string]any{"effects": []string{effect.String()}}, "5": map[string]any{"effects": []string{effect.String()}}}},
		&Race{ID: raceID, Name: "Other race", CardNumber: raceID.String(), Description: "test", Author: f.owner.ID.String(), LevelProgression: &JSONMap{"2": map[string]any{"effects": []string{effect.String()}}}},
		&Action{ID: actionID, Name: "Test action", CardNumber: actionID.String(), Description: "test", Author: f.owner.ID.String(), Rarity: RarityCommon, ActionType: ActionType("attack"), Mechanics: &JSONMap{"result": []any{map[string]any{"kind": "grant_effect", "value": effect.String()}}}, RelatedCards: &Properties{privateCard.String()}},
	} {
		if err := f.db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	api := router.Group("/api")
	api.Use(EntityReferenceResponseMiddleware(f.db))
	registerEntityReferenceRoutes(api, f.auth, f.db)
	ec, ac := NewEffectController(f.db), NewActionController(f.db)
	api.GET("/effects", OptionalAuthMiddleware(f.auth), ec.GetEffects)
	api.GET("/effects/:id", OptionalAuthMiddleware(f.auth), ec.GetEffect)
	api.PUT("/actions/:id", ContentEntityMutation(f.auth, f.db, "actions", false), ac.UpdateAction)
	api.GET("/actions/:id", OptionalAuthMiddleware(f.auth), ac.GetAction)
	get := func(path, token string) map[string]any {
		t.Helper()
		response := performCharacterV3Request(t, router, "GET", path, token, nil)
		if response.Code != 200 {
			t.Fatalf("GET %s: %d %s", path, response.Code, response.Body.String())
		}
		if !strings.Contains(response.Header().Get("Cache-Control"), "private") || !strings.Contains(strings.Join(response.Header().Values("Vary"), ","), "Authorization") {
			t.Fatalf("user-dependent catalog response can be cached publicly: %+v", response.Header())
		}
		var body map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body
	}
	owner, admin := f.token(t, f.owner), f.token(t, f.other)
	body := get("/api/effects/"+effect.String(), owner)
	if len(body["referenced_by"].([]any)) != 5 {
		t.Fatalf("levels and different origins missing: %+v", body["referenced_by"])
	}
	for _, raw := range body["referenced_by"].([]any) {
		ref := raw.(map[string]any)
		if (ref["entity_type"] == "class" || ref["entity_type"] == "race") && ref["level"] == nil {
			t.Fatal("source level omitted")
		}
	}
	if refs := get("/api/entity-references/action/"+actionID.String(), owner)["references"].([]any); len(refs) != 1 {
		t.Fatalf("hidden target leaked: %+v", refs)
	}
	if refs := get("/api/entity-references/action/"+actionID.String(), admin)["references"].([]any); len(refs) != 2 {
		t.Fatalf("admin lost target: %+v", refs)
	}
	if refs := get("/api/entity-references/effect/"+otherEffect.String(), owner)["referenced_by"].([]any); len(refs) != 0 {
		t.Fatalf("hidden source leaked: %+v", refs)
	}
	if refs := get("/api/entity-references/effect/"+otherEffect.String(), admin)["referenced_by"].([]any); len(refs) != 1 {
		t.Fatalf("admin lost source: %+v", refs)
	}
	if got := performCharacterV3Request(t, router, "GET", "/api/entity-references/card/"+privateCard.String(), owner, nil); got.Code != 404 {
		t.Fatalf("private lookup: %d %s", got.Code, got.Body.String())
	}
	if list := get("/api/effects?reference_state=unlinked", owner); list["total"] != float64(1) {
		t.Fatalf("public unlinked filter: %+v", list)
	}
	if list := get("/api/effects?reference_type=class", admin); list["total"] != float64(1) {
		t.Fatalf("class filter: %+v", list)
	}
	preview := map[string]any{"entity": map[string]any{"id": actionID.String(), "description": "[[effect:" + otherEffect.String() + "]]", "mechanics": map[string]any{"result": []any{map[string]any{"kind": "grant_effect", "value": otherEffect.String()}}}, "references": []any{map[string]any{"entity_id": effect.String()}}}}
	response := performCharacterV3Request(t, router, "POST", "/api/entity-references/action/preview", owner, preview)
	if response.Code != 200 || !strings.Contains(response.Body.String(), otherEffect.String()) || strings.Contains(response.Body.String(), effect.String()) {
		t.Fatalf("draft preview: %d %s", response.Code, response.Body.String())
	}
	adminPreview := performCharacterV3Request(t, router, "POST", "/api/entity-references/action/preview", admin, preview)
	if adminPreview.Code != 200 || !strings.Contains(adminPreview.Body.String(), privateCard.String()) || !strings.Contains(adminPreview.Body.String(), otherEffect.String()) || strings.Contains(adminPreview.Body.String(), effect.String()) {
		t.Fatalf("partial preview lost an omitted saved mechanic or retained replaced mechanics: %d %s", adminPreview.Code, adminPreview.Body.String())
	}
	if refs := get("/api/entity-references/action/"+actionID.String(), owner)["references"].([]any); refs[0].(map[string]any)["entity_id"] != effect.String() {
		t.Fatal("preview wrote the index")
	}
	for _, check := range []struct {
		token  string
		status int
	}{{"", 401}, {f.token(t, f.public), 403}, {owner, 200}, {admin, 200}} {
		response := performCharacterV3Request(t, router, "POST", "/api/entity-references/action/"+actionID.String()+"/refresh", check.token, nil)
		if response.Code != check.status {
			t.Fatalf("refresh permission: %d %s wanted %d", response.Code, response.Body.String(), check.status)
		}
	}
	response = performCharacterV3Request(t, router, http.MethodPut, "/api/actions/"+actionID.String(), owner, map[string]any{"mechanics": map[string]any{"result": []any{}}, "related_cards": []string{}, "referenced_by": []any{"forged"}})
	if response.Code != 200 {
		t.Fatalf("ordinary CRUD: %d %s", response.Code, response.Body.String())
	}
	var updated map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if len(updated["references"].([]any)) != 0 {
		t.Fatalf("write response had stale edges: %s", response.Body.String())
	}
	if refs := get("/api/entity-references/effect/"+effect.String(), owner)["referenced_by"].([]any); len(refs) != 4 {
		t.Fatalf("inverse removal was not persisted: %+v", refs)
	}
	// API decoration must never spread into canonical model/certificate JSON.
	var model Action
	if err := f.db.First(&model, "id=?", actionID).Error; err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(model)
	if strings.Contains(string(encoded), "referenced_by") {
		t.Fatal("derived metadata contaminated domain serialization")
	}
	// URLs and preview edge resolution must agree about display aliases:
	// ambiguous aliases fail, while an exact stable card number wins.
	for i, nameEn := range []string{"Test's Bright Spell", "Tests Bright Spell"} {
		id := uuid.New()
		number := id.String()
		if i == 1 {
			number = "SPELL-alias-second"
		}
		row := Spell{ID: id, Name: nameEn, NameEn: &nameEn, CardNumber: number, Description: "alias test", Author: f.owner.ID.String()}
		if err := f.db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if response := performCharacterV3Request(t, router, "GET", "/api/entity-references/spell/tests_bright_spell", owner, nil); response.Code != 404 {
		t.Fatalf("ambiguous URL selected a spell: %d %s", response.Code, response.Body.String())
	}
	stable := Spell{ID: uuid.New(), Name: "Stable identity", CardNumber: "tests_bright_spell", Description: "alias test", Author: f.owner.ID.String(), Mechanics: &JSONMap{"result": []any{map[string]any{"kind": "grant_effect", "value": otherEffect.String()}}}}
	if err := f.db.Create(&stable).Error; err != nil {
		t.Fatal(err)
	}
	aliasRefs := get("/api/entity-references/spell/tests_bright_spell", owner)["references"].([]any)
	if len(aliasRefs) != 1 || aliasRefs[0].(map[string]any)["entity_id"] != otherEffect.String() {
		t.Fatalf("URL resolver ignored stable identity precedence: %+v", aliasRefs)
	}
}
