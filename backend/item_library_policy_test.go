package main

import (
	"dnd-cards-backend/itemsource"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestItemLibraryRarities(t *testing.T) {
	for _, tc := range []struct {
		query string
		want  []string
	}{
		{"", []string{}}, {"rarity=rare", []string{"rare"}},
		{"rarity=rare,common&rarity=rare&rarities=epic,legendary", []string{"rare", "common", "epic", "legendary"}},
		{"rarities[]=very_rare&rarity[]=%20relic%20&rarity=", []string{"relic", "very_rare"}},
	} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("GET", "/api/cards?"+tc.query, nil)
		if got := itemLibraryRarities(c); !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("%s: %v != %v", tc.query, got, tc.want)
		}
	}
}

func TestItemLibraryVisibilityAllReadPaths(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	f := openCharacterV3AccessFixture(t)
	t.Setenv("CONTENT_ADMIN_USER_IDS", f.owner.ID.String())
	if err := f.db.AutoMigrate(&Card{}, &EntityTag{}, &EntityTagAssignment{}); err != nil {
		t.Fatal(err)
	}
	installOwnedItemAccess(t, f.db)
	grant := EntityTag{ID: itemsource.AvailableForPlayersTagID, Name: "Renamed player availability"}
	lookalike := EntityTag{ID: uuid.NewString(), Name: "Available for Players"}
	pool := EntityTag{ID: uuid.NewString(), Name: "test pool"}
	for _, tag := range []EntityTag{grant, lookalike, pool} {
		if err := f.db.Create(&tag).Error; err != nil {
			t.Fatal(err)
		}
	}
	var visibleIDs, hiddenIDs []uuid.UUID
	for i, tc := range []struct {
		source, rarity, tag string
		visible             bool
	}{
		{"Player's Handbook", "common", "", true}, {"Player's Handbook", "legendary", "", true},
		{"Bag Of Holding", "common", "", true}, {"Bag Of Holding", "uncommon", "", true}, {"Bag Of Holding", "rare", "", true},
		{"Bag Of Holding", "epic", grant.ID, true}, {"Bag Of Holding", "legendary", grant.ID, true},
		{"Bag Of Holding", "very_rare", "", false}, {"Bag Of Holding", "artifact", "", false}, {"Bag Of Holding", "relic", "", false},
		{"Bag Of Holding", "custom", "", false}, {"Bag Of Holding", "epic", lookalike.ID, false},
		{"Bag Of Holding", "custom", grant.ID, false}, {"Bag Of Holding", "unknown", grant.ID, false},
		{"Bag Of Holding", "very_rare", grant.ID, true}, {"Bag Of Holding", "artifact", grant.ID, true}, {"Bag Of Holding", "relic", grant.ID, true},
		{"Other source", "common", grant.ID, false}, {"Other source", "legendary", grant.ID, false}, {"", "common", "", false},
	} {
		id := uuid.New()
		card := Card{ID: id, Name: fmt.Sprintf("Policy %02d", i), CardNumber: fmt.Sprintf("POLICY-%02d", i), Description: "test", Source: &tc.source, Rarity: Rarity(tc.rarity)}
		if err := f.db.Create(&card).Error; err != nil {
			t.Fatal(err)
		}
		if tc.tag != "" {
			if err := f.db.Create(&EntityTagAssignment{"card", id.String(), tc.tag}).Error; err != nil {
				t.Fatal(err)
			}
		}
		if err := f.db.Create(&EntityTagAssignment{"card", id.String(), pool.ID}).Error; err != nil {
			t.Fatal(err)
		}
		if tc.visible {
			visibleIDs = append(visibleIDs, id)
		} else {
			hiddenIDs = append(hiddenIDs, id)
		}
	}
	controller := &CardController{db: f.db}
	router := gin.New()
	api := router.Group("/api")
	api.GET("/cards", OptionalAuthMiddleware(f.auth), controller.GetCards)
	api.GET("/cards/:id", OptionalAuthMiddleware(f.auth), controller.GetCard)
	api.GET("/cards/:id/battle-stats", OptionalAuthMiddleware(f.auth), controller.GetCardBattleStats)
	api.POST("/cards/battle-stats", OptionalAuthMiddleware(f.auth), controller.GetBatchCardBattleStats)
	api.POST("/cards/export", AuthMiddleware(f.auth), controller.ExportCards)
	registerEntityTagRoutes(api, f.auth, f.db)
	adminToken, playerToken := f.token(t, f.owner), f.token(t, f.other)
	for _, token := range []string{"", playerToken, adminToken} {
		want := len(visibleIDs)
		if token == adminToken {
			want += len(hiddenIDs)
		}
		for _, suffix := range []string{"", "&fields=list", "&fields=runtime&admin=true&include_hidden=true&source=Other+source", "&tag=" + pool.ID} {
			r := performCharacterV3Request(t, router, "GET", "/api/cards?limit=1&search=Policy"+suffix, token, nil)
			var page struct {
				Total int
				Cards []CardResponse
			}
			if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &page) != nil || page.Total != want || len(page.Cards) != 1 {
				t.Fatalf("list %s: %d %s", suffix, r.Code, r.Body.String())
			}
			if r.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal("identity-dependent catalog may be shared by caches")
			}
		}
		for _, id := range append(append([]uuid.UUID{}, visibleIDs...), hiddenIDs...) {
			expected := 200
			for _, hidden := range hiddenIDs {
				if id == hidden && token != adminToken {
					expected = 404
				}
			}
			for _, path := range []string{"/api/cards/" + id.String(), "/api/cards/" + id.String() + "/battle-stats", "/api/entity-tags/card/" + id.String()} {
				r := performCharacterV3Request(t, router, "GET", path+"?fields=runtime&include_hidden=true", token, nil)
				if r.Code != expected {
					t.Fatalf("%s: %d != %d: %s", path, r.Code, expected, r.Body.String())
				}
			}
		}
		ids := append(append([]uuid.UUID{}, visibleIDs...), hiddenIDs...)
		for _, path := range []string{"/api/cards/export", "/api/cards/battle-stats"} {
			r := performCharacterV3Request(t, router, "POST", path, token, map[string]any{"card_ids": ids})
			var batch struct {
				Cards []CardResponse
				Items []map[string]any
			}
			if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &batch) != nil || len(batch.Cards)+len(batch.Items) != want {
				t.Fatalf("batch: %d %s", r.Code, r.Body.String())
			}
		}
		for _, suffix := range []string{"", "?type=card"} {
			r := performCharacterV3Request(t, router, "GET", "/api/entity-tag-members/"+pool.ID+suffix, token, nil)
			var members struct{ IDs []string }
			if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &members) != nil || len(members.IDs) != want {
				t.Fatalf("members: %d %s", r.Code, r.Body.String())
			}
		}
	}
	for _, query := range []string{"rarity=common,rare", "rarity=common&rarity=rare", "rarities=common,rare", "rarity=common&rarities=rare"} {
		r := performCharacterV3Request(t, router, "GET", "/api/cards?"+query, playerToken, nil)
		var page struct{ Total int }
		if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &page) != nil || page.Total != 3 {
			t.Fatalf("rarities %s: %s", query, r.Body.String())
		}
	}
	// Missing or malformed admin configuration must never widen the read scope.
	t.Setenv("CONTENT_ADMIN_USER_IDS", f.owner.ID.String()+",invalid")
	r := performCharacterV3Request(t, router, "GET", "/api/cards/"+hiddenIDs[0].String(), adminToken, nil)
	if r.Code != 404 {
		t.Fatalf("invalid admin config: %d", r.Code)
	}
	// Runtime DB reads remain canonical and independent of the library scope.
	var saved Card
	if err := f.db.First(&saved, "id = ?", hiddenIDs[0]).Error; err != nil {
		t.Fatal(err)
	}
}
