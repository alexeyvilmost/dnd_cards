package main

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestPrintedItemSaleCopper(t *testing.T) {
	for _, row := range []struct {
		price          float64
		currency       string
		quantity, want int
	}{{2.5, "silver", 1, 12}, {2.5, "silver", 2, 25}, {1, "copper", 1, 0}, {1, "copper", 2, 1}, {3, "electrum", 1, 75}, {1.25, "platinum", 1, 625}} {
		price, currency := row.price, row.currency
		got, err := roguelikeSaleCopper(Card{Price: &price, PriceCurrency: &currency}, row.quantity)
		if err != nil || got != row.want {
			t.Fatalf("%+v: %d %v", row, got, err)
		}
	}
	for _, row := range []struct {
		price    *float64
		currency string
		quantity int
	}{{nil, "gold", 1}, {saleTestPrice(-1), "gold", 1}, {saleTestPrice(math.Inf(1)), "gold", 1}, {saleTestPrice(1), "unknown", 1}, {saleTestPrice(1), "gold", 0}} {
		if _, err := roguelikeSaleCopper(Card{Price: row.price, PriceCurrency: &row.currency}, row.quantity); err == nil {
			t.Fatal("invalid sale price accepted")
		}
	}
}
func saleTestPrice(n float64) *float64 { return &n }

func TestSaleWalletPreservesFractionalCurrency(t *testing.T) {
	for _, row := range []struct {
		wallet JSONMap
		want   int
	}{{JSONMap{"gold": 2.5, "silver": 1.2, "copper": 3}, 265}, {JSONMap{"electrum": 0.5, "platinum": 1.25}, 1275}} {
		got, err := saleWalletCopper(&CharacterV3{Currency: &row.wallet})
		if err != nil || got != row.want {
			t.Fatalf("wallet %d %v", got, err)
		}
	}
	for _, wallet := range []JSONMap{{"gold": -1}, {"gold": 0.005}, {"gold": 1e20}, {"gold": "bad"}} {
		if _, err := saleWalletCopper(&CharacterV3{Currency: &wallet}); err == nil {
			t.Fatal("invalid wallet accepted")
		}
	}
}

type saleFixture struct {
	fixture characterV3AccessFixture
	cards   []Card
	run     RoguelikeRun
	calls   *int
}

func openSaleFixture(t *testing.T, inRun bool) saleFixture {
	t.Helper()
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&RoguelikeRun{}, &RoguelikeCommandReceipt{}, &Card{}, &Action{}); err != nil {
		t.Fatal(err)
	}
	currency := "silver"
	cards := []Card{{ID: uuid.New(), Name: "Grant item A", CardNumber: "QA-sale-a", Price: saleTestPrice(2.5), PriceCurrency: &currency}, {ID: uuid.New(), Name: "Grant item B", CardNumber: "QA-sale-b", Price: saleTestPrice(6), PriceCurrency: &currency}}
	for i := range cards {
		if err := f.db.Create(&cards[i]).Error; err != nil {
			t.Fatal(err)
		}
	}
	hero := f.ownerCharacter
	hero.RuntimeRevision = 7
	hero.InventoryItems = &InventoryItemRows{{CardID: cards[0].ID.String(), Qty: 2}}
	hero.Equipment = &JSONMap{"main_hand": cards[1].ID.String(), "off_hand": cards[1].ID.String()}
	hero.Resources = &JSONMap{"pool_a": 1, "pool_b": 2, "class_pool": 0}
	hero.MaxResources = &JSONMap{"pool_a": 3, "pool_b": 5, "class_pool": 1}
	hero.TurnState = &JSONMap{"attuned_ids": []any{cards[1].ID.String()}}
	setCurrencyCopper(&hero, 1009)
	if inRun {
		hero.CharacterType = "dungeon_crawl"
	}
	if err := f.db.Omit("User", "Group").Save(&hero).Error; err != nil {
		t.Fatal(err)
	}
	f.ownerCharacter = hero
	run := RoguelikeRun{ID: uuid.New(), UserID: f.owner.ID, SourceCharacterID: hero.ID, CharacterID: hero.ID, Status: "active", Phase: "camp", Revision: 1, Gold: 10, RunSeed: "private-fixture", Encounter: JSONMap{}, Shop: JSONMap{}, Checkpoint: JSONMap{}, LastReward: JSONMap{}}
	if inRun {
		if err := f.db.Create(&run).Error; err != nil {
			t.Fatal(err)
		}
		registerRoguelikeRoutes(f.router.Group("/api"), f.auth, NewRoguelikeController(f.db))
	}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body struct {
			Input struct {
				Character CharacterV3 `json:"character"`
				Sale      struct {
					CardID   string `json:"cardId"`
					Quantity int    `json:"quantity"`
				} `json:"sale"`
				Placement *struct {
					Equipment JSONMap           `json:"equipment"`
					Inventory InventoryItemRows `json:"inventoryItems"`
				} `json:"placement"`
			} `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if r.URL.Path != "/camp-inventory" || r.Header.Get("Authorization") != "Bearer "+strings.Repeat("i", 32) {
			t.Error("wrong worker routing")
		}
		ch := body.Input.Character
		if ch.AccessMode != characterV3AccessOwner {
			t.Error("locked owned actor must carry server-authorized owner metadata")
		}
		before := JSONMap{"resources": cloneJSONMapValue(ch.Resources), "max_resources": cloneJSONMapValue(ch.MaxResources)}
		resources, maxima := cloneJSONMapValue(ch.Resources), cloneJSONMapValue(ch.MaxResources)
		equipment := cloneJSONMapValue(ch.Equipment)
		rows := InventoryItemRows{}
		if ch.InventoryItems != nil {
			rows = append(rows, (*ch.InventoryItems)...)
		}
		if body.Input.Placement != nil {
			equipment = body.Input.Placement.Equipment
			rows = body.Input.Placement.Inventory
			resources["pool_b"] = 0
			maxima["pool_b"] = 0
		} else {
			remaining := body.Input.Sale.Quantity
			next := InventoryItemRows{}
			for _, row := range rows {
				if row.CardID == body.Input.Sale.CardID {
					n := min(row.Qty, remaining)
					row.Qty -= n
					remaining -= n
				}
				if row.Qty > 0 {
					next = append(next, row)
				}
			}
			rows = next
			if remaining > 0 {
				for slot, id := range equipment {
					if id == body.Input.Sale.CardID {
						equipment[slot] = nil
					}
				}
			}
			owned, _ := roguelikeItemOwnership(&equipment, &rows)
			if owned[body.Input.Sale.CardID] == 0 {
				for i, card := range cards {
					if card.ID.String() == body.Input.Sale.CardID {
						key := []string{"pool_a", "pool_b"}[i]
						resources[key] = 0
						maxima[key] = 0
					}
				}
			}
		}
		patch := JSONMap{"current_hp": ch.CurrentHP, "runtime_revision": ch.RuntimeRevision + 1, "resources": resources, "max_resources": maxima, "equipment": equipment, "inventory_items": rows}
		json.NewEncoder(w).Encode(JSONMap{"status": "ready", "patch": patch, "previousPatch": before})
	}))
	t.Cleanup(server.Close)
	t.Setenv("RULES_WORKER_URL", server.URL)
	t.Setenv("RULES_WORKER_TOKEN", strings.Repeat("i", 32))
	return saleFixture{fixture: f, cards: cards, run: run, calls: &calls}
}

func TestRunItemSaleAtomicRefundReplayAndRejection(t *testing.T) {
	s := openSaleFixture(t, true)
	f := s.fixture
	token := f.token(t, f.owner)
	path := "/api/roguelike/runs/" + s.run.ID.String() + "/commands"
	command := RoguelikeCommandRequest{CommandID: uuid.New(), ExpectedRevision: 1, Type: "sell", Payload: JSONMap{"actor_id": f.ownerCharacter.ID.String(), "card_id": s.cards[0].ID.String(), "quantity": 2, "price": 999999}}
	first := performCharacterV3Request(t, f.router, "POST", path, token, command)
	if first.Code != 200 {
		t.Fatalf("sale: %d %s", first.Code, first.Body)
	}
	again := performCharacterV3Request(t, f.router, "POST", path, token, command)
	if again.Code != 200 || again.Body.String() != first.Body.String() || *s.calls != 1 {
		t.Fatal("sale retry changed receipt or reran worker")
	}
	var hero CharacterV3
	f.db.First(&hero, "id = ?", f.ownerCharacter.ID)
	if hero.RuntimeRevision != 8 || currencyCopper(&hero) != 1034 || len(*hero.InventoryItems) != 0 || (*hero.Resources)["class_pool"] != float64(0) {
		t.Fatal("sale did not commit exact price/resources once")
	}
	var receipts int64
	f.db.Model(&RoguelikeCommandReceipt{}).Count(&receipts)
	if receipts != 1 {
		t.Fatal("duplicate receipt")
	}
	rejected := command
	rejected.CommandID = uuid.New()
	rejected.ExpectedRevision = 2
	rejected.Payload = JSONMap{"actor_id": f.otherCharacter.ID.String(), "card_id": s.cards[1].ID.String(), "quantity": 1}
	if r := performCharacterV3Request(t, f.router, "POST", path, token, rejected); r.Code != 403 {
		t.Fatalf("foreign actor: %d %s", r.Code, r.Body)
	}
	rejected.Payload = JSONMap{"card_id": s.cards[1].ID.String(), "quantity": 1.5}
	if r := performCharacterV3Request(t, f.router, "POST", path, token, rejected); r.Code != 400 {
		t.Fatal("fractional quantity accepted")
	}
	rejected.Payload = JSONMap{"card_id": s.cards[1].ID.String(), "quantity": 1}
	rejected.ExpectedRevision = 1
	if r := performCharacterV3Request(t, f.router, "POST", path, token, rejected); r.Code != 409 {
		t.Fatal("stale revision accepted")
	}
	if r := performCharacterV3Request(t, f.router, "POST", path, f.token(t, f.other), command); r.Code != 404 {
		t.Fatal("foreign owner sale accepted")
	}
	f.db.Model(&RoguelikeRun{}).Where("id = ?", s.run.ID).Update("phase", "combat")
	rejected.ExpectedRevision = 2
	if r := performCharacterV3Request(t, f.router, "POST", path, token, rejected); r.Code != 409 {
		t.Fatal("combat sale accepted")
	}
	if *s.calls != 1 {
		t.Fatal("rejected sales reached worker")
	}
}

func TestOrdinaryItemSaleAuthoritativeReplayAndCombatGuard(t *testing.T) {
	s := openSaleFixture(t, false)
	f := s.fixture
	token := f.token(t, f.owner)
	path := "/api/characters-v3/" + f.ownerCharacter.ID.String() + "/item-sales"
	command := CharacterItemSaleRequest{CommandID: uuid.NewString(), ExpectedRuntimeRevision: 7, CardID: s.cards[1].ID.String(), Quantity: 1}
	first := performCharacterV3Request(t, f.router, "POST", path, token, command)
	if first.Code != 200 {
		t.Fatalf("sale: %d %s", first.Code, first.Body)
	}
	again := performCharacterV3Request(t, f.router, "POST", path, token, command)
	if again.Code != 200 || *s.calls != 1 {
		t.Fatal("ordinary sale reran worker")
	}
	var hero CharacterV3
	f.db.First(&hero, "id = ?", f.ownerCharacter.ID)
	if currencyCopper(&hero) != 1039 || hero.RuntimeRevision != 8 || (*hero.Equipment)["main_hand"] != nil || (*hero.MaxResources)["pool_b"] != float64(0) {
		t.Fatal("equipped sale failed")
	}
	command.CommandID = uuid.NewString()
	command.ExpectedRuntimeRevision = 8
	command.CardID = s.cards[0].ID.String()
	for _, turn := range []JSONMap{{"solo_combat_v1": map[string]any{"outcome": "active"}}, {"canonical_pending_combat_v1": map[string]any{"world": map[string]any{"pendingResolution": map[string]any{"id": "roll"}}}}} {
		f.db.Model(&CharacterV3{}).Where("id = ?", hero.ID).Update("turn_state", turn)
		if r := performCharacterV3Request(t, f.router, "POST", path, token, command); r.Code != 409 {
			t.Fatalf("active continuation sale: %d %s", r.Code, r.Body)
		}
	}
	if r := performCharacterV3Request(t, f.router, "POST", path, f.token(t, f.other), command); r.Code != 403 {
		t.Fatal("foreign owner sale accepted")
	}
	if *s.calls != 1 {
		t.Fatal("blocked ordinary sale reached worker")
	}
}

func TestCampEquipmentCapacityUsesCanonicalProjection(t *testing.T) {
	s := openSaleFixture(t, true)
	f := s.fixture
	hero := f.ownerCharacter
	equipment := JSONMap{"main_hand": nil, "off_hand": nil}
	rows := append(append(InventoryItemRows{}, (*hero.InventoryItems)...), InventoryItemRow{CardID: s.cards[1].ID.String(), Qty: 1})
	resources, maxima := cloneJSONMapValue(hero.Resources), cloneJSONMapValue(hero.MaxResources)
	resources["pool_b"] = 0
	maxima["pool_b"] = 0
	patch := CharacterRuntimeCommandPatch{Equipment: &equipment, InventoryItems: &rows, Resources: &resources, MaxResources: &maxima}
	if err := validateRoguelikeCampEquipmentResources(context.Background(), f.db, hero, patch); err != nil {
		t.Fatal(err)
	}
	maxima["class_pool"] = 99
	if err := validateRoguelikeCampEquipmentResources(context.Background(), f.db, hero, patch); err == nil {
		t.Fatal("forged maximum accepted")
	}
	maxima["class_pool"] = 1
	resources["class_pool"] = 1
	if err := validateRoguelikeCampEquipmentResources(context.Background(), f.db, hero, patch); err == nil {
		t.Fatal("restoration smuggled through item capacity change")
	}
	resources["class_pool"] = 0
	money := JSONMap{"gold": 999}
	patch.Currency = &money
	if err := validateRoguelikeCampEquipmentResources(context.Background(), f.db, hero, patch); err == nil {
		t.Fatal("money smuggled through item capacity change")
	}
}

func TestConcurrentRunSaleReturnsOneExactReceipt(t *testing.T) {
	s := openSaleFixture(t, true)
	f := s.fixture
	token := f.token(t, f.owner)
	path := "/api/roguelike/runs/" + s.run.ID.String() + "/commands"
	command := RoguelikeCommandRequest{CommandID: uuid.New(), ExpectedRevision: 1, Type: "sell", Payload: JSONMap{"card_id": s.cards[0].ID.String(), "quantity": 2}}
	responses := make([]*httptest.ResponseRecorder, 2)
	var wait sync.WaitGroup
	wait.Add(2)
	for i := range responses {
		go func(i int) {
			defer wait.Done()
			responses[i] = performCharacterV3Request(t, f.router, "POST", path, token, command)
		}(i)
	}
	wait.Wait()
	if responses[0].Code != 200 || responses[1].Code != 200 || responses[0].Body.String() != responses[1].Body.String() || *s.calls != 1 {
		t.Fatal("concurrent identical command failed exact receipt replay")
	}
}

func TestSaleRejectsUnpricedBoundDeployedAndNonemptyContainer(t *testing.T) {
	s := openSaleFixture(t, false)
	f := s.fixture
	hero := f.ownerCharacter
	path := "/api/characters-v3/" + hero.ID.String() + "/item-sales"
	token := f.token(t, f.owner)
	command := CharacterItemSaleRequest{CommandID: uuid.NewString(), ExpectedRuntimeRevision: 7, CardID: s.cards[0].ID.String(), Quantity: 1}
	for _, turn := range []JSONMap{{"world": map[string]any{"objects": []any{map[string]any{"itemCardId": command.CardID, "weaponBondActorId": hero.ID.String()}}}}, {"world": map[string]any{"objects": []any{map[string]any{"itemCardId": command.CardID, "deployedToActorId": hero.ID.String()}}}}} {
		f.db.Model(&CharacterV3{}).Where("id = ?", hero.ID).Update("turn_state", turn)
		if res := performCharacterV3Request(t, f.router, "POST", path, token, command); res.Code != 409 {
			t.Fatalf("item restriction accepted: %d", res.Code)
		}
	}
	f.db.Model(&CharacterV3{}).Where("id = ?", hero.ID).Update("turn_state", JSONMap{})
	rows := append(append(InventoryItemRows{}, (*hero.InventoryItems)...), InventoryItemRow{CardID: s.cards[1].ID.String(), Qty: 1, ContainerID: command.CardID})
	f.db.Model(&CharacterV3{}).Where("id = ?", hero.ID).Update("inventory_items", rows)
	if res := performCharacterV3Request(t, f.router, "POST", path, token, command); res.Code != 409 {
		t.Fatal("nonempty container sold")
	}
	f.db.Model(&CharacterV3{}).Where("id = ?", hero.ID).Update("inventory_items", hero.InventoryItems)
	f.db.Model(&Card{}).Where("id = ?", s.cards[0].ID).Update("price", nil)
	if res := performCharacterV3Request(t, f.router, "POST", path, token, command); res.Code != 409 {
		t.Fatal("unpriced item sold")
	}
	if *s.calls != 0 {
		t.Fatal("invalid physical sale reached worker")
	}
}
