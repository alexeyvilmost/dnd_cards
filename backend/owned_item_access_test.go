package main

import (
	"dnd-cards-backend/itemsource"
	"dnd-cards-backend/migrations"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func installOwnedItemAccess(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&RoguelikeRun{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err = migrations.AddOwnedItemGrants265(sqlDB); err != nil {
		t.Fatal(err)
	}
}

func ownedTestCard(t *testing.T, db *gorm.DB, visible bool) Card {
	t.Helper()
	source := "Hidden source"
	if visible {
		source = itemsource.PlayersHandbook
	}
	mechanics := JSONMap{"test_marker": "canonical mechanics"}
	card := Card{ID: uuid.New(), CardNumber: uuid.NewString(), Name: "Saved item", Description: "Canonical description", Rarity: Rarity("legendary"), Source: &source, Mechanics: &mechanics}
	if err := db.Create(&card).Error; err != nil {
		t.Fatal(err)
	}
	return card
}

func TestOwnedItemGrantsReadBoundary(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	t.Setenv("CONTENT_ADMIN_USER_IDS", "")
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&Card{}, &EntityTag{}, &EntityTagAssignment{}); err != nil {
		t.Fatal(err)
	}
	first, second, foreign, forged, visible := ownedTestCard(t, f.db, false), ownedTestCard(t, f.db, false), ownedTestCard(t, f.db, false), ownedTestCard(t, f.db, false), ownedTestCard(t, f.db, true)
	for _, entry := range []struct {
		id        uuid.UUID
		equipment JSONMap
		rows      InventoryItemRows
	}{
		{f.ownerCharacter.ID, JSONMap{"main_hand": first.ID.String()}, InventoryItemRows{{CardID: second.ID.String(), Qty: 2}}},
		{f.otherCharacter.ID, JSONMap{"body": foreign.ID.String()}, nil},
	} {
		if err := f.db.Model(&CharacterV3{}).Where("id=?", entry.id).Updates(map[string]any{"equipment": entry.equipment, "inventory_items": entry.rows}).Error; err != nil {
			t.Fatal(err)
		}
	}
	installOwnedItemAccess(t, f.db)
	// Simulate a legacy/forged JSON row AFTER the one-time migration snapshot.
	if err := f.db.Model(&CharacterV3{}).Where("id=?", f.ownerCharacter.ID).Update("inventory_items", InventoryItemRows{{CardID: forged.ID.String(), Qty: 1}}).Error; err != nil {
		t.Fatal(err)
	}
	controller := &CardController{db: f.db}
	router := gin.New()
	api := router.Group("/api")
	api.GET("/cards", OptionalAuthMiddleware(f.auth), controller.GetCards)
	api.GET("/cards/:id", OptionalAuthMiddleware(f.auth), controller.GetCard)
	api.GET("/cards/:id/battle-stats", OptionalAuthMiddleware(f.auth), controller.GetCardBattleStats)
	api.POST("/cards/battle-stats", OptionalAuthMiddleware(f.auth), controller.GetBatchCardBattleStats)
	registerOwnedItemRoutes(api, f.auth, f.db)
	token := f.token(t, f.owner)
	for _, tc := range []struct {
		token string
		id    uuid.UUID
		want  int
	}{
		{token, first.ID, 200}, {token, second.ID, 200}, {token, foreign.ID, 404}, {token, forged.ID, 404}, {token, visible.ID, 200},
		{"", first.ID, 404}, {f.token(t, f.other), first.ID, 404}, {f.token(t, f.public), first.ID, 404},
	} {
		for _, suffix := range []string{"", "/battle-stats"} {
			r := performCharacterV3Request(t, router, "GET", "/api/cards/"+tc.id.String()+suffix+"?owned=true&character_id="+f.ownerCharacter.ID.String(), tc.token, nil)
			if r.Code != tc.want {
				t.Fatalf("detail %s: %d != %d %s", suffix, r.Code, tc.want, r.Body.String())
			}
		}
	}
	for _, token := range []string{"", token, f.token(t, f.other)} {
		r := performCharacterV3Request(t, router, "GET", "/api/cards?include_owned=true&fields=list", token, nil)
		var page struct {
			Total int
			Cards []CardResponse
		}
		if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &page) != nil || page.Total != 1 || page.Cards[0].ID != visible.ID {
			t.Fatalf("public list widened: %s", r.Body.String())
		}
	}
	for _, tc := range []struct {
		token string
		want  int
	}{{"", 401}, {"forged-token", 401}, {token, 200}} {
		r := performCharacterV3Request(t, router, "GET", "/api/my-item-catalog?fields=list&limit=1", tc.token, nil)
		if r.Code != tc.want {
			t.Fatalf("personal auth: %d %s", r.Code, r.Body.String())
		}
		if tc.want == 200 {
			var page struct {
				Total int
				Cards []CardResponse
			}
			if json.Unmarshal(r.Body.Bytes(), &page) != nil || page.Total != 2 || len(page.Cards) != 1 || page.Cards[0].Mechanics != nil {
				t.Fatalf("personal list: %s", r.Body.String())
			}
			if r.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal("private catalog cached")
			}
		}
	}
	r := performCharacterV3Request(t, router, "GET", "/api/my-item-catalog", token, nil)
	var page struct{ Cards []CardResponse }
	if json.Unmarshal(r.Body.Bytes(), &page) != nil || len(page.Cards) != 2 || page.Cards[0].Mechanics == nil {
		t.Fatalf("canonical projection lost: %s", r.Body.String())
	}
	r = performCharacterV3Request(t, router, "POST", "/api/cards/battle-stats", token, map[string]any{"card_ids": []uuid.UUID{first.ID, second.ID, foreign.ID, forged.ID}})
	var batch struct{ Count int }
	if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &batch) != nil || batch.Count != 2 {
		t.Fatalf("batch: %s", r.Body.String())
	}
	// A character transfer does not transfer the original user's grants.
	if err := f.db.Model(&CharacterV3{}).Where("id=?", f.ownerCharacter.ID).Update("user_id", f.other.ID).Error; err != nil {
		t.Fatal(err)
	}
	for _, userID := range []uuid.UUID{f.owner.ID, f.other.ID} {
		var count int64
		if err := ownedItemQuery(f.db, userID).Where("cards.id=?", first.ID).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("transferred grant: %d %v", count, err)
		}
	}
}

func TestOwnedItemTrustedRunStatusesAndShapes(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&Card{}, &EntityTag{}, &EntityTagAssignment{}); err != nil {
		t.Fatal(err)
	}
	installOwnedItemAccess(t, f.db)
	items := make([]Card, 7)
	for i := range items {
		items[i] = ownedTestCard(t, f.db, false)
	}
	member := testCharacterV3(f.owner.ID, "Run companion")
	member.CharacterType = "dungeon_crawl"
	member.InventoryItems = &InventoryItemRows{{CardID: items[1].ID.String(), Qty: 1}}
	leader := testCharacterV3(f.owner.ID, "Run leader")
	leader.CharacterType = "dungeon_crawl"
	leader.Equipment = &JSONMap{"main_hand": items[0].ID.String(), "forged": items[6].ID.String()}
	for _, ch := range []*CharacterV3{&leader, &member} {
		if err := f.db.Create(ch).Error; err != nil {
			t.Fatal(err)
		}
	}
	run := RoguelikeRun{ID: uuid.New(), UserID: f.owner.ID, SourceCharacterID: f.ownerCharacter.ID, CharacterID: leader.ID, Status: "active", Phase: "camp",
		Party:     JSONMap{"members": []any{map[string]any{"character_id": leader.ID.String()}, map[string]any{"character_id": member.ID.String()}}},
		Encounter: JSONMap{}, Checkpoint: JSONMap{}, Shop: JSONMap{"offers": []any{map[string]any{"card_id": items[2].ID.String()}}, "staples": []any{map[string]any{"card_id": items[3].ID.String()}}},
		LastReward: JSONMap{"items": []any{map[string]any{"card_id": items[4].ID.String()}}, "item": map[string]any{"card_id": items[5].ID.String()}}}
	if err := f.db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	check := func(userID uuid.UUID, want int64) {
		t.Helper()
		var count int64
		if err := ownedItemQuery(f.db, userID).Count(&count).Error; err != nil || count != want {
			t.Fatalf("run access %s: %d != %d %v", run.Status, count, want, err)
		}
	}
	for _, status := range []string{"active", "victory", "defeat", "abandoned", "unknown", ""} {
		run.Status = status
		if err := f.db.Model(&run).Update("status", status).Error; err != nil {
			t.Fatal(err)
		}
		want := int64(0)
		if status == "active" || status == "victory" || status == "defeat" {
			want = 6
		}
		check(f.owner.ID, want)
		check(f.other.ID, 0)
	}
	if err := f.db.Model(&run).Updates(map[string]any{"status": "active", "party": JSONMap{}, "shop": JSONMap{}, "last_reward": JSONMap{}}).Error; err != nil {
		t.Fatal(err)
	}
	check(f.owner.ID, 1) // Legacy single-character run.
	if err := f.db.Model(&run).Update("party", JSONMap{"members": "malformed"}).Error; err != nil {
		t.Fatal(err)
	}
	check(f.owner.ID, 0)
	if err := f.db.Model(&run).Update("party", JSONMap{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.db.Model(&leader).Update("character_type", "free").Error; err != nil {
		t.Fatal(err)
	}
	check(f.owner.ID, 0) // A free inventory is not trusted even if a run mentions it.
}

func TestOwnedItemOrdinaryWriteBoundary(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&Card{}, &EntityTag{}, &EntityTagAssignment{}); err != nil {
		t.Fatal(err)
	}
	first, second, hidden := ownedTestCard(t, f.db, true), ownedTestCard(t, f.db, true), ownedTestCard(t, f.db, false)
	installOwnedItemAccess(t, f.db)
	token := f.token(t, f.owner)
	path := "/api/characters-v3/" + f.ownerCharacter.ID.String() + "/runtime"
	for _, tc := range []struct {
		rows InventoryItemRows
		want int
	}{
		{InventoryItemRows{{CardID: first.ID.String(), Qty: 1}, {CardID: hidden.ID.String(), Qty: 1}}, 403},
		{InventoryItemRows{{CardID: first.ID.String(), Qty: 1}, {CardID: second.ID.String(), Qty: 2}}, 200},
	} {
		r := performCharacterV3Request(t, f.router, "PATCH", path, token, map[string]any{"inventory_items": tc.rows, "owned_item_grants": []string{hidden.ID.String()}})
		if r.Code != tc.want {
			t.Fatalf("write: %d != %d %s", r.Code, tc.want, r.Body.String())
		}
		var count int64
		if err := f.db.Table("owned_item_grants").Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		want := int64(0)
		if tc.want == 200 {
			want = 2
		}
		if count != want {
			t.Fatalf("partial or forged grants committed: %d", count)
		}
	}
	// A catalog policy change cannot strand already saved item mechanics.
	if err := f.db.Model(&Card{}).Where("id IN ?", []uuid.UUID{first.ID, second.ID}).Update("source", "Now hidden").Error; err != nil {
		t.Fatal(err)
	}
	r := performCharacterV3Request(t, f.router, "PATCH", path, token, map[string]any{"equipment": map[string]any{"main_hand": first.ID.String()}})
	if r.Code != 200 {
		t.Fatalf("existing grant lost: %s", r.Body.String())
	}
	// Do not copy a grandfathered item into a different ordinary character.
	r = performCharacterV3Request(t, f.router, "PATCH", "/api/characters-v3/"+f.deleteCharacter.ID.String()+"/runtime", token, map[string]any{"inventory_items": InventoryItemRows{{CardID: first.ID.String(), Qty: 1}}})
	if r.Code != 403 {
		t.Fatalf("grant copied: %d %s", r.Code, r.Body.String())
	}
	// Runtime commands only consume inventory; ordinary creation still guards it.
	r = performCharacterV3Request(t, f.router, "POST", "/api/characters-v3", token, map[string]any{"name": "forged creation", "inventory_items": InventoryItemRows{{CardID: hidden.ID.String(), Qty: 1}}})
	if r.Code != 403 {
		t.Fatalf("creation: %d %s", r.Code, r.Body.String())
	}
}

func TestOwnedItemRunPatchCannotMint(t *testing.T) {
	first, second := uuid.NewString(), uuid.NewString()
	character := CharacterV3{ID: uuid.New(), InventoryItems: &InventoryItemRows{{CardID: first, Qty: 2}, {CardID: second, Qty: 1}}}
	for i, tc := range []struct {
		rows   InventoryItemRows
		reject bool
	}{
		{InventoryItemRows{{CardID: first, Qty: 1}, {CardID: second, Qty: 1}}, false},
		{InventoryItemRows{{CardID: first, Qty: 3}}, true}, {InventoryItemRows{{CardID: second, Qty: 2}}, true},
		{InventoryItemRows{{CardID: uuid.NewString(), Qty: 1}}, true},
	} {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			if err := validateRunItemPatch(character, PatchCharacterRuntimeRequest{InventoryItems: &tc.rows}); (err != nil) != tc.reject {
				t.Fatalf("%v", err)
			}
		})
	}
}

func TestOwnedItemAdminActorCanGrantOwnHiddenItems(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	f := openCharacterV3AccessFixture(t)
	t.Setenv("CONTENT_ADMIN_USER_IDS", f.owner.ID.String())
	if err := f.db.AutoMigrate(&Card{}, &EntityTag{}, &EntityTagAssignment{}); err != nil {
		t.Fatal(err)
	}
	first, second, third := ownedTestCard(t, f.db, false), ownedTestCard(t, f.db, false), ownedTestCard(t, f.db, false)
	installOwnedItemAccess(t, f.db)
	adminToken, playerToken := f.token(t, f.owner), f.token(t, f.other)
	for _, tc := range []struct {
		token string
		ch    uuid.UUID
		want  int
	}{
		{playerToken, f.otherCharacter.ID, 403}, {playerToken, f.ownerCharacter.ID, 403}, {adminToken, f.ownerCharacter.ID, 200},
	} {
		r := performCharacterV3Request(t, f.router, "PATCH", "/api/characters-v3/"+tc.ch.String()+"/runtime", tc.token,
			map[string]any{"inventory_items": InventoryItemRows{{CardID: first.ID.String(), Qty: 1}}, "admin": true, "user_id": f.owner.ID})
		if r.Code != tc.want {
			t.Fatalf("admin actor write: %d != %d %s", r.Code, tc.want, r.Body.String())
		}
	}
	r := performCharacterV3Request(t, f.router, "POST", "/api/characters-v3", adminToken, map[string]any{"name": "admin hidden item", "equipment": JSONMap{"body": second.ID.String()}})
	if r.Code != 201 {
		t.Fatalf("admin creation: %d %s", r.Code, r.Body.String())
	}
	var count int64
	if err := f.db.Table("owned_item_grants").Where("reason='admin'").Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("admin grants: %d %v", count, err)
	}
	// A saved owner ID never substitutes for the caller's current admin authority.
	t.Setenv("CONTENT_ADMIN_USER_IDS", "")
	r = performCharacterV3Request(t, f.router, "PATCH", "/api/characters-v3/"+f.ownerCharacter.ID.String()+"/runtime", adminToken, map[string]any{"equipment": JSONMap{"body": third.ID.String()}})
	if r.Code != 403 {
		t.Fatalf("revoked admin minted grant: %d %s", r.Code, r.Body.String())
	}
	if err := ownedItemQuery(f.db, f.owner.ID).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("saved admin grants lost: %d %v", count, err)
	}
}

func TestOwnedItemTemplateCopyUsesActorPolicyAndRollsBack(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	f := openCharacterV3AccessFixture(t)
	t.Setenv("CONTENT_ADMIN_USER_IDS", f.owner.ID.String())
	if err := f.db.AutoMigrate(&Card{}, &EntityTag{}, &EntityTagAssignment{}, &CharacterTemplate{}); err != nil {
		t.Fatal(err)
	}
	installOwnedItemAccess(t, f.db)
	hidden := ownedTestCard(t, f.db, false)
	source := testCharacterV3(f.owner.ID, "template source")
	source.InventoryItems = &InventoryItemRows{{CardID: hidden.ID.String(), Qty: 1}}
	snapshot, err := templateSnapshot(source)
	if err != nil {
		t.Fatal(err)
	}
	template := CharacterTemplate{ID: uuid.New(), Name: "Hidden item template", Version: 1, Character: snapshot}
	if err := f.db.Create(&template).Error; err != nil {
		t.Fatal(err)
	}
	registerCharacterTemplateRoutes(f.router.Group("/api"), f.auth, f.db)
	var before int64
	if err := f.db.Model(&CharacterV3{}).Count(&before).Error; err != nil {
		t.Fatal(err)
	}
	path := "/api/character-templates/" + template.ID.String() + "/copies"
	r := performCharacterV3Request(t, f.router, "POST", path, f.token(t, f.other), map[string]any{"name": "player copy", "admin": true})
	if r.Code != 403 {
		t.Fatalf("template player: %d %s", r.Code, r.Body.String())
	}
	var after int64
	if err := f.db.Model(&CharacterV3{}).Count(&after).Error; err != nil || after != before {
		t.Fatalf("partial template character: %d %v", after, err)
	}
	r = performCharacterV3Request(t, f.router, "POST", path, f.token(t, f.owner), map[string]any{"name": "admin copy"})
	if r.Code != 201 {
		t.Fatalf("template admin: %d %s", r.Code, r.Body.String())
	}
}
