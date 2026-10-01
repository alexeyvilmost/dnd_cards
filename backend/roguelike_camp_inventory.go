package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"math"
	"os"
	"strconv"
)

// A compatibility sheet equipment commit may reconcile a stale or item-owned
// capacity. Its allowed resource maps must equal the ordinary canonical
// assembler's saved or requested placement projection, never a browser grant.
func validateRoguelikeCampEquipmentResources(ctx context.Context, tx *gorm.DB, character CharacterV3, patch CharacterRuntimeCommandPatch) error {
	if patch.MaxResources == nil || roguelikeJSONEqual(patch.MaxResources, character.MaxResources) {
		return validateRoguelikeCampAction(character, patch)
	}
	if patch.Currency != nil && !roguelikeJSONEqual(patch.Currency, character.Currency) {
		return validateRoguelikeCampAction(character, patch)
	}
	equipment, inventory := character.Equipment, character.InventoryItems
	if patch.Equipment != nil {
		equipment = patch.Equipment
	}
	if patch.InventoryItems != nil {
		inventory = patch.InventoryItems
	}
	if roguelikeJSONEqual(equipment, character.Equipment) && roguelikeJSONEqual(inventory, character.InventoryItems) {
		return validateRoguelikeCampAction(character, patch)
	}
	before, e1 := roguelikeItemOwnership(character.Equipment, character.InventoryItems)
	after, e2 := roguelikeItemOwnership(equipment, inventory)
	if e1 != nil || e2 != nil || !roguelikeJSONEqual(before, after) {
		return roguelikeMutationError("roguelike_item_ownership_changed", "Экипировка не может изменять количество предметов забега", character.ID)
	}
	candidateEquipment, candidateInventory := cloneJSONMapValue(equipment), InventoryItemRows{}
	if inventory != nil {
		candidateInventory = append(candidateInventory, (*inventory)...)
	}
	client := roguelikeWorkerClient{URL: os.Getenv("RULES_WORKER_URL"), Token: os.Getenv("RULES_WORKER_TOKEN")}
	result, err := executeRoguelikeCampInventoryWorker(ctx, tx, client, &character, map[string]any{"placement": map[string]any{"equipment": candidateEquipment, "inventoryItems": candidateInventory}})
	if err != nil {
		return err
	}
	matched := false
	for _, expected := range []JSONMap{result.PreviousPatch, result.Patch} {
		if expected != nil && patch.Resources != nil && roguelikeJSONEqual(patch.MaxResources, expected["max_resources"]) && roguelikeJSONEqual(patch.Resources, expected["resources"]) {
			matched = true
		}
	}
	if !matched {
		return roguelikeMutationError("roguelike_camp_action_forbidden", "Изменение ресурсов не соответствует механике экипировки", character.ID)
	}
	validated := patch
	validated.MaxResources = nil
	validated.Resources = nil
	return validateRoguelikeCampAction(character, validated)
}

func executeRoguelikeCampInventoryWorker(ctx context.Context, tx *gorm.DB, client roguelikeWorkerClient, character *CharacterV3, mutation map[string]any) (*roguelikeWorkerResult, error) {
	catalog := emptyRoguelikeFrozenCatalog()
	var basics []Action
	if err := tx.Where("type = ?", "basic").Order("id").Find(&basics).Error; err != nil {
		return nil, err
	}
	ids := []string{}
	for _, action := range basics {
		ids = append(ids, action.ID.String())
		if err := catalog.add("action", action); err != nil {
			return nil, err
		}
	}
	// AccessMode is response-only and is absent on rows loaded by a write lock.
	// Every caller has already established owned writable access; propagate that
	// server decision to the shared sheet assembler instead of rejecting a
	// freshly loaded owner as read-only.
	owned := *character
	owned.AccessMode = characterV3AccessOwner
	input := map[string]any{"character": &owned, "catalog": &catalog, "basicActionIds": ids}
	for key, value := range mutation {
		input[key] = value
	}
	for attempt := 0; attempt < 32; attempt++ {
		result, err := client.call(ctx, "/camp-inventory", map[string]any{"input": input})
		if err != nil {
			return nil, err
		}
		if result.Status != "needs_content" {
			return result, nil
		}
		previous, _ := json.Marshal(catalog)
		for _, need := range result.Needs {
			if err = catalog.fulfill(tx, need); err != nil {
				return nil, err
			}
		}
		next, _ := json.Marshal(catalog)
		if string(previous) == string(next) {
			return nil, fmt.Errorf("camp inventory catalog resolution made no progress")
		}
	}
	return nil, fmt.Errorf("camp inventory catalog dependency budget exceeded")
}

// Catalog prices belong to cards. Shop overrides and purchasing discounts
// never change the value of a player's owned copy. Round only the whole sale,
// so two items printed at one copper return one copper rather than zero.
func roguelikeSaleCopper(card Card, quantity int) (int, error) {
	if quantity < 1 || quantity > 10000 {
		return 0, roguelikeError(400, "invalid_quantity", "Неверное количество предметов")
	}
	if card.Price == nil {
		return 0, roguelikeError(409, "sale_price_missing", "У предмета не указана стоимость: его нельзя продать")
	}
	rate := 100.0
	if card.PriceCurrency != nil {
		switch *card.PriceCurrency {
		case "", "gold":
		case "silver":
			rate = 10
		case "copper":
			rate = 1
		case "electrum":
			rate = 50
		case "platinum":
			rate = 1000
		default:
			return 0, roguelikeError(409, "sale_price_invalid", "Стоимость предмета задана в неизвестной валюте")
		}
	}
	value := *card.Price * rate * float64(quantity) / 2
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1000000000000 {
		return 0, roguelikeError(409, "sale_price_invalid", "Стоимость предмета некорректна")
	}
	return int(math.Floor(value + 1e-8)), nil
}

func sellRoguelikeItem(ctx context.Context, tx *gorm.DB, client roguelikeWorkerClient, run *RoguelikeRun, request RoguelikeCommandRequest) error {
	actor := run.Character
	if raw := roguelikePayloadString(request, "actor_id"); raw != "" {
		actor = nil
		for _, member := range roguelikeCharacters(run) {
			if member.ID.String() == raw {
				actor = member
			}
		}
	}
	if actor == nil {
		return roguelikeError(403, "foreign_party_member", "Персонаж не состоит в группе")
	}
	// Solo run DTO loading preloads its hero without a character row lock.
	// Refresh that row before projecting so a concurrent sheet save cannot be
	// overwritten by a sale derived from an older inventory snapshot.
	var locked CharacterV3
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", actor.ID, run.UserID).First(&locked).Error; err != nil {
		return err
	}
	*actor = locked
	next, amount, err := projectOwnedItemSale(ctx, tx, client, actor, request.Payload)
	if err != nil {
		return err
	}
	wallet, err := saleWalletCopper(run.Character)
	if err != nil {
		return err
	}
	wallet += run.Gold*100 - characterGold(run.Character)*100 + amount
	if wallet < 0 || wallet > 1000000000000 {
		return roguelikeError(409, "wallet_limit", "Слишком большая сумма продажи")
	}
	*actor = *next
	setCurrencyCopper(run.Character, wallet)
	run.Gold = wallet / 100
	if actor.ID != run.CharacterID {
		run.Character.RuntimeRevision++
	}
	return nil
}

// The persisted sheet permits fractional GP. Convert the whole wallet before
// normalization, preserving e.g. 2.5 GP as 250 CP rather than truncating coins.
func saleWalletCopper(character *CharacterV3) (int, error) {
	total := 0.0
	for key, rate := range map[string]float64{"gold": 100, "silver": 10, "copper": 1, "electrum": 50, "platinum": 1000} {
		if character.Currency == nil {
			continue
		}
		value := (*character.Currency)[key]
		if value == nil {
			continue
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			return 0, err
		}
		amount, err := strconv.ParseFloat(string(encoded), 64)
		if err != nil || math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 {
			return 0, roguelikeError(409, "wallet_invalid", "Кошелёк содержит некорректную сумму")
		}
		total += amount * rate
	}
	if total > 1000000000000 || math.Abs(total-math.Round(total)) > 1e-7 {
		return 0, roguelikeError(409, "wallet_invalid", "Кошелёк должен быть выражен целым числом медных монет")
	}
	return int(math.Round(total)), nil
}

// Both kinds of merchant use the same physical inventory projection and
// catalog price. Only the owning wallet differs for a solo sheet and a party.
func projectOwnedItemSale(ctx context.Context, tx *gorm.DB, client roguelikeWorkerClient, actor *CharacterV3, payload JSONMap) (*CharacterV3, int, error) {
	request := RoguelikeCommandRequest{Payload: payload}
	cardID, err := uuid.Parse(roguelikePayloadString(request, "card_id"))
	if err != nil {
		return nil, 0, roguelikeError(400, "invalid_item", "Выберите предмет")
	}
	quantity, valid := resourceCapacityNumber(request.Payload["quantity"])
	if !valid || quantity < 1 || quantity > 10000 {
		return nil, 0, roguelikeError(400, "invalid_quantity", "Неверное количество предметов")
	}
	owned, err := roguelikeItemOwnership(actor.Equipment, actor.InventoryItems)
	if err != nil {
		return nil, 0, err
	}
	if owned[cardID.String()] < quantity {
		return nil, 0, roguelikeError(409, "item_unavailable", "Предмета нет в указанном количестве")
	}
	if actor.InventoryItems != nil {
		for _, row := range *actor.InventoryItems {
			if row.ContainerID == cardID.String() {
				return nil, 0, roguelikeError(409, "container_not_empty", "Сначала освободите контейнер")
			}
		}
	}
	if roguelikePartyBoundItem(cloneJSONMapValue(actor.TurnState), cardID.String()) {
		return nil, 0, roguelikeError(409, "item_bound", "Сначала прекратите связь с предметом")
	}
	if deployedSaleItem(cloneJSONMapValue(actor.TurnState), cardID.String()) {
		return nil, 0, roguelikeError(409, "item_deployed", "Сначала верните размещённый предмет в инвентарь")
	}
	var card Card
	if err = tx.Where("id = ?", cardID).First(&card).Error; err != nil {
		return nil, 0, roguelikeError(404, "item_not_found", "Предмет не найден")
	}
	amount, err := roguelikeSaleCopper(card, quantity)
	if err != nil {
		return nil, 0, err
	}
	result, err := executeRoguelikeCampInventoryWorker(ctx, tx, client, actor, map[string]any{"sale": map[string]any{"cardId": cardID.String(), "quantity": quantity}})
	if err != nil {
		return nil, 0, err
	}
	var next CharacterV3
	raw, err := json.Marshal(actor)
	if err != nil {
		return nil, 0, err
	}
	if err = json.Unmarshal(raw, &next); err != nil {
		return nil, 0, err
	}
	if err = applyTrustedRoguelikePatch(&next, result.Patch); err != nil {
		return nil, 0, err
	}
	after, err := roguelikeItemOwnership(next.Equipment, next.InventoryItems)
	if err != nil {
		return nil, 0, err
	}
	expected := map[string]int{}
	for id, count := range owned {
		if id == cardID.String() {
			count -= quantity
		}
		if count > 0 {
			expected[id] = count
		}
	}
	if !roguelikeJSONEqual(after, expected) || next.CurrentHP != actor.CurrentHP || result.GoldSpent != 0 || result.ElapsedSeconds != 0 {
		return nil, 0, fmt.Errorf("invalid camp sale projection")
	}
	return &next, amount, nil
}

func deployedSaleItem(value any, cardID string) bool {
	switch v := value.(type) {
	case JSONMap:
		return deployedSaleItem(map[string]any(v), cardID)
	case map[string]any:
		if v["itemCardId"] == cardID && (v["deployedToActorId"] != nil || v["unattended"] == true && v["ownerActorId"] != nil) {
			return true
		}
		for _, child := range v {
			if deployedSaleItem(child, cardID) {
				return true
			}
		}
	case []any:
		for _, child := range v {
			if deployedSaleItem(child, cardID) {
				return true
			}
		}
	}
	return false
}
