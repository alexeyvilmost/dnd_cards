package main

import (
	"encoding/json"
	"net/url"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestRuntimeCardCatalogMatchesDetailsAndRechecksRights(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	t.Setenv("CONTENT_ADMIN_USER_IDS", "")
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&Card{}, &EntityTag{}, &EntityTagAssignment{}); err != nil {
		t.Fatal(err)
	}
	private, public := ownedTestCard(t, f.db, false), ownedTestCard(t, f.db, true)
	if err := f.db.Model(&CharacterV3{}).Where("id=?", f.ownerCharacter.ID).Update("inventory_items", InventoryItemRows{{CardID: private.ID.String(), Qty: 1}}).Error; err != nil {
		t.Fatal(err)
	}
	installOwnedItemAccess(t, f.db)
	controller := &CardController{db: f.db}
	router := gin.New()
	router.GET("/api/cards/runtime/resolve", OptionalAuthMiddleware(f.auth), controller.ResolveRuntimeCards)
	token := f.token(t, f.owner)
	request := "/api/cards/runtime/resolve?ids=" + private.ID.String() + "," + public.ID.String() + "," + private.ID.String()
	r := performCharacterV3Request(t, router, "GET", request, token, nil)
	var result struct {
		Cards []CardResponse `json:"cards"`
	}
	if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &result) != nil {
		t.Fatalf("batch failed %d", r.Code)
	}
	// Compare via JSON because PostgreSQL timestamp precision differs from the
	// original create object. The expected rows are read back from this same DB.
	var expected []CardResponse
	for _, id := range []uuid.UUID{private.ID, public.ID} {
		var row Card
		if err := f.db.First(&row, "id=?", id).Error; err != nil {
			t.Fatal(err)
		}
		expected = append(expected, row.ToCardResponse())
	}
	a, _ := json.Marshal(result.Cards)
	b, _ := json.Marshal(expected)
	if !reflect.DeepEqual(a, b) || len(result.Cards) != 2 {
		t.Fatal("bulk read differs from canonical detail projection")
	}
	if r.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal("private response may be cached")
	}
	for _, identity := range []string{"", f.token(t, f.other)} {
		if got := performCharacterV3Request(t, router, "GET", request, identity, nil); got.Code != 404 || strings.Contains(got.Body.String(), private.Name) {
			t.Fatal("foreign partial data disclosed")
		}
	}
	if err := f.db.Exec("DELETE FROM owned_item_grants WHERE user_id=?", f.owner.ID).Error; err != nil {
		t.Fatal(err)
	}
	if got := performCharacterV3Request(t, router, "GET", request, token, nil); got.Code != 404 {
		t.Fatal("same-session rights revocation was not read fresh")
	}
	for _, query := range []string{"", "?ids=", "?ids=invalid", "?ids=" + uuid.Nil.String(), "?ids=" + public.ID.String() + "&ids=" + private.ID.String(), "?ids=" + url.QueryEscape(strings.TrimSuffix(strings.Repeat(public.ID.String()+",", 129), ","))} {
		if got := performCharacterV3Request(t, router, "GET", "/api/cards/runtime/resolve"+query, token, nil); got.Code != 400 {
			t.Fatalf("invalid request accepted: %d", got.Code)
		}
	}
}
