package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestRetiredCharacterInventoriesRejectReadsAndWrites(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&Inventory{}, &InventoryItem{}, &GroupMember{}); err != nil {
		t.Fatal(err)
	}
	controller := NewInventoryController(f.db)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		owner := f.owner.ID
		if c.GetHeader("X-Test-Owner") == "peer" {
			owner = f.other.ID
		}
		c.Set("user_id", owner)
		c.Next()
	})
	router.GET("/inventories", controller.GetInventories)
	router.GET("/inventories/:id", controller.GetInventory)
	router.POST("/inventories", controller.CreateInventory)
	router.POST("/inventories/:id/items", controller.AddItemToInventory)
	router.PUT("/inventories/:id/items/:itemId", controller.UpdateInventoryItem)
	router.DELETE("/inventories/:id/items/:itemId", controller.RemoveItemFromInventory)
	router.PUT("/inventories/items/:itemId/equip", controller.EquipItem)
	request := func(method, path, body, actor string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Test-Owner", actor)
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	personal := Inventory{ID: uuid.New(), Type: InventoryTypePersonal, UserID: &f.owner.ID, Name: "Owned standalone"}
	if err := f.db.Create(&personal).Error; err != nil {
		t.Fatal(err)
	}
	for _, kind := range []InventoryType{"character", "unrecognized"} {
		inventory := Inventory{ID: uuid.New(), Type: kind, UserID: &f.owner.ID, Name: "Retired storage canary"}
		if err := f.db.Create(&inventory).Error; err != nil {
			t.Fatal(err)
		}
		item := InventoryItem{ID: uuid.New(), InventoryID: inventory.ID, CardID: uuid.New(), Quantity: 2, Notes: "Unchanged canary", IsEquipped: true}
		if err := f.db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
		if err := f.db.First(&item, item.ID).Error; err != nil {
			t.Fatal(err)
		}
		before, _ := json.Marshal(item)
		for _, actor := range []string{"owner", "peer"} {
			for _, operation := range []struct{ method, path, body string }{
				{"GET", "/inventories/" + inventory.ID.String(), ""},
				{"POST", "/inventories/" + inventory.ID.String() + "/items", `{"card_id":"` + item.CardID.String() + `","quantity":1}`},
				{"PUT", "/inventories/" + inventory.ID.String() + "/items/" + item.ID.String(), `{"quantity":4}`},
				{"DELETE", "/inventories/" + inventory.ID.String() + "/items/" + item.ID.String(), ""},
				{"PUT", "/inventories/items/" + item.ID.String() + "/equip", `{"is_equipped":false}`},
			} {
				if got := request(operation.method, operation.path, operation.body, actor).Code; got != http.StatusNotFound {
					t.Fatalf("%s retired %s %s status=%d", actor, kind, operation.method, got)
				}
			}
		}
		var after InventoryItem
		if err := f.db.First(&after, item.ID).Error; err != nil {
			t.Fatal(err)
		}
		encoded, _ := json.Marshal(after)
		if string(before) != string(encoded) {
			t.Fatal("Retired inventory storage changed")
		}
		if got := request("POST", "/inventories", `{"type":"`+string(kind)+`","name":"Rejected"}`, "owner").Code; got != http.StatusBadRequest {
			t.Fatalf("retired create status=%d", got)
		}
	}
	list := request("GET", "/inventories", "", "owner")
	if list.Code != 200 {
		t.Fatalf("standalone list status=%d", list.Code)
	}
	var rows []Inventory
	if err := json.Unmarshal(list.Body.Bytes(), &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].ID != personal.ID {
		t.Fatal("Retired storage leaked into standalone inventory list")
	}
	if got := request("GET", "/inventories/"+personal.ID.String(), "", "owner").Code; got != 200 {
		t.Fatalf("owner inventory status=%d", got)
	}
	if got := request("GET", "/inventories/"+personal.ID.String(), "", "peer").Code; got != 403 {
		t.Fatalf("peer inventory status=%d", got)
	}
	if got := request("POST", "/inventories", `{"type":"personal","name":"Current standalone"}`, "owner").Code; got != 201 {
		t.Fatalf("current create status=%d", got)
	}
	group := Group{ID: uuid.New(), Name: "Current group", DMID: f.owner.ID}
	if err := f.db.Create(&group).Error; err != nil {
		t.Fatal(err)
	}
	member := GroupMember{ID: uuid.New(), GroupID: group.ID, UserID: f.owner.ID, Role: RoleDM}
	if err := f.db.Create(&member).Error; err != nil {
		t.Fatal(err)
	}
	created := request("POST", "/inventories", `{"type":"group","group_id":"`+group.ID.String()+`","name":"Group storage"}`, "owner")
	if created.Code != 201 {
		t.Fatalf("group create status=%d", created.Code)
	}
	var current Inventory
	if err := json.Unmarshal(created.Body.Bytes(), &current); err != nil {
		t.Fatal(err)
	}
	if got := request("GET", "/inventories/"+current.ID.String(), "", "owner").Code; got != 200 {
		t.Fatalf("group owner status=%d", got)
	}
	if got := request("GET", "/inventories/"+current.ID.String(), "", "peer").Code; got != 403 {
		t.Fatalf("group outsider status=%d", got)
	}
}
