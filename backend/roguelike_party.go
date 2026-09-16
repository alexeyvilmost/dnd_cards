package main

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Identity only: HP, inventory and resources remain in the canonical sheets.
type roguelikePartyMember struct {
	CharacterID       uuid.UUID `json:"character_id"`
	SourceCharacterID uuid.UUID `json:"source_character_id"`
}

func roguelikePartyMembers(run *RoguelikeRun) []roguelikePartyMember {
	var party struct {
		Members []roguelikePartyMember `json:"members"`
	}
	if len(run.Party) > 0 {
		if err := decodeJSONMap(run.Party, &party); err != nil || len(party.Members) == 0 {
			return nil // A malformed non-legacy party must never silently become solo.
		}
	}
	if len(party.Members) == 0 {
		return []roguelikePartyMember{{run.CharacterID, run.SourceCharacterID}}
	}
	return party.Members
}
func roguelikePartySize(run *RoguelikeRun) int { return len(roguelikePartyMembers(run)) }
func roguelikeHasCharacter(run *RoguelikeRun, id uuid.UUID) bool {
	for _, m := range roguelikePartyMembers(run) {
		if m.CharacterID == id {
			return true
		}
	}
	return false
}
func roguelikeCharacters(run *RoguelikeRun) []*CharacterV3 {
	if len(run.Characters) > 0 {
		return run.Characters
	}
	if run.Character != nil {
		return []*CharacterV3{run.Character}
	}
	return nil
}
func loadRoguelikeParty(tx *gorm.DB, run *RoguelikeRun, lock bool) error {
	members := roguelikePartyMembers(run)
	if len(members) < 1 || len(members) > 6 || members[0].CharacterID != run.CharacterID {
		return fmt.Errorf("invalid party identity")
	}
	ids := []uuid.UUID{}
	seen := map[uuid.UUID]bool{}
	for _, m := range members {
		if m.CharacterID == uuid.Nil || seen[m.CharacterID] {
			return fmt.Errorf("invalid party member")
		}
		seen[m.CharacterID] = true
		ids = append(ids, m.CharacterID)
	}
	var rows []*CharacterV3
	q := tx.Where("id IN ? AND user_id = ?", ids, run.UserID).Order("id")
	if lock {
		q = q.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := q.Find(&rows).Error; err != nil {
		return err
	}
	if len(rows) != len(ids) {
		return fmt.Errorf("party sheet missing")
	}
	byID := map[uuid.UUID]*CharacterV3{}
	for _, c := range rows {
		c.AccessMode = characterV3AccessOwner
		byID[c.ID] = c
	}
	run.Characters = nil
	for _, id := range ids {
		run.Characters = append(run.Characters, byID[id])
	}
	run.Character = byID[run.CharacterID]
	return nil
}
func saveRoguelikeParty(tx *gorm.DB, run *RoguelikeRun) error {
	for _, c := range roguelikeCharacters(run) {
		if err := tx.Omit("User", "Group").Save(c).Error; err != nil {
			return err
		}
	}
	return nil
}
func validatePartySources(ids []uuid.UUID) error {
	if len(ids) < 1 || len(ids) > 6 {
		return roguelikeError(http.StatusBadRequest, "invalid_party_size", "В группе должно быть от 1 до 6 персонажей")
	}
	seen := map[uuid.UUID]bool{}
	for _, id := range ids {
		if id == uuid.Nil || seen[id] {
			return roguelikeError(http.StatusBadRequest, "duplicate_party_member", "Участники группы должны быть разными персонажами")
		}
		seen[id] = true
	}
	return nil
}
func createRoguelikeParty(tx *gorm.DB, userID uuid.UUID, ids []uuid.UUID) (*RoguelikeRun, error) {
	if err := validatePartySources(ids); err != nil {
		return nil, err
	}
	sorted := append([]uuid.UUID{}, ids...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].String() < sorted[j].String() })
	sources := map[uuid.UUID]CharacterV3{}
	for _, id := range sorted {
		var c CharacterV3
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", id, userID).First(&c).Error; err != nil {
			return nil, roguelikeError(http.StatusNotFound, "source_not_found", "Персонаж недоступен")
		}
		if err := validateRoguelikeSource(tx, &c, userID); err != nil {
			return nil, err
		}
		sources[id] = c
	}
	var active []RoguelikeRun
	if err := tx.Where("user_id = ? AND status = ?", userID, RoguelikeStatusActive).Find(&active).Error; err != nil {
		return nil, err
	}
	for _, r := range active {
		for _, m := range roguelikePartyMembers(&r) {
			if _, ok := sources[m.SourceCharacterID]; ok {
				return nil, roguelikeError(http.StatusConflict, "active_run_exists", "У одного из персонажей уже есть активный забег")
			}
		}
	}
	seed, err := newRoguelikeSeed()
	if err != nil {
		return nil, err
	}
	potion, err := roguelikeCardByNumber(tx, roguelikeHealingPotionCard)
	if err != nil {
		return nil, err
	}
	run := &RoguelikeRun{ID: uuid.New(), UserID: userID, SourceCharacterID: ids[0], Status: RoguelikeStatusActive, Phase: RoguelikePhaseCamp, Supplies: len(ids), Attempt: 1, LastLongRestHour: -24, RunSeed: seed, Encounter: JSONMap{}, Shop: JSONMap{}, Checkpoint: JSONMap{}, LastReward: JSONMap{}}
	members := []roguelikePartyMember{}
	partyMoney := 0
	for _, id := range ids {
		source := sources[id]
		clone := source
		clone.ID = uuid.New()
		clone.GroupID = nil
		clone.Group = nil
		clone.User = User{}
		clone.Name = strings.TrimSpace(source.Name) + " · Забег"
		clone.CharacterType = "dungeon_crawl"
		clone.CreatedAt = time.Time{}
		clone.UpdatedAt = time.Time{}
		if err = resetRoguelikeCloneRuntime(&clone); err != nil {
			return nil, err
		}
		addInventoryItem(&clone, potion.ID.String(), 1)
		if err = validateRoguelikeCurrentWeight(tx, &clone); err != nil {
			return nil, err
		}
		// Consolidate every denomination into the shared purse, without loss.
		partyMoney += currencyCopper(&source)
		setCurrencyCopper(&clone, 0)
		run.Characters = append(run.Characters, &clone)
		members = append(members, roguelikePartyMember{clone.ID, id})
	}
	run.Character = run.Characters[0]
	run.CharacterID = run.Character.ID
	run.Gold = partyMoney / 100
	setCurrencyCopper(run.Character, partyMoney)
	run.Party, err = mapFromJSON(map[string]any{"members": members})
	if err != nil {
		return nil, err
	}
	for _, c := range run.Characters {
		if err = tx.Omit("User", "Group").Create(c).Error; err != nil {
			return nil, err
		}
		c.AccessMode = characterV3AccessOwner
	}
	run.Shop, err = generateRoguelikeShop(tx, run, 1, nil)
	if err != nil {
		return nil, err
	}
	run.Checkpoint, err = roguelikeCheckpoint(run, run.Character)
	if err != nil {
		return nil, err
	}
	if err = tx.Omit("Character").Create(run).Error; err != nil {
		return nil, err
	}
	return run, nil
}

// Transfer an unequipped, unattuned inventory stack; never mint another copy.
func transferRoguelikeItem(tx *gorm.DB, run *RoguelikeRun, request RoguelikeCommandRequest) error {
	if run.Status != RoguelikeStatusActive || run.Phase != RoguelikePhaseCamp {
		return roguelikeError(409, "camp_required", "Передача доступна только в лагере")
	}
	fromID, err := uuid.Parse(roguelikePayloadString(request, "from_character_id"))
	if err != nil {
		return roguelikeError(400, "invalid_member", "Выберите отправителя")
	}
	toID, err := uuid.Parse(roguelikePayloadString(request, "to_character_id"))
	if err != nil || toID == fromID {
		return roguelikeError(400, "invalid_member", "Выберите другого участника")
	}
	var from, to *CharacterV3
	for _, c := range roguelikeCharacters(run) {
		if c.ID == fromID {
			from = c
		}
		if c.ID == toID {
			to = c
		}
	}
	if from == nil || to == nil {
		return roguelikeError(403, "foreign_party_member", "Оба персонажа должны быть участниками забега")
	}
	cardID := roguelikePayloadString(request, "card_id")
	quantity, ok := numberFromJSON(request.Payload["quantity"])
	if !ok || quantity < 1 || quantity > 10000 {
		return roguelikeError(400, "invalid_quantity", "Неверное количество предметов")
	}
	var card Card
	if err = tx.Where("id = ?", cardID).First(&card).Error; err != nil {
		return roguelikeError(404, "item_not_found", "Предмет не найден")
	}
	attuned, err := roguelikeAttunedIDs(from.TurnState)
	if err != nil {
		return err
	}
	for _, id := range attuned {
		if id == cardID {
			return roguelikeError(409, "item_attuned", "Сначала прекратите настройку на предмет")
		}
	}
	// Bound weapons/objects retain identity and ownership; do not transfer their card proxy.
	turn := cloneJSONMapValue(from.TurnState)
	raw, _ := mapFromJSON(turn)
	if roguelikePartyBoundItem(raw, cardID) {
		return roguelikeError(409, "item_bound", "Сначала прекратите связь с предметом")
	}
	if from.InventoryItems == nil {
		return roguelikeError(409, "item_unavailable", "Предмет отсутствует в рюкзаке")
	}
	rows := append(InventoryItemRows{}, (*from.InventoryItems)...)
	index := -1
	for i, row := range rows {
		if row.ContainerID == cardID {
			return roguelikeError(409, "container_not_empty", "Сначала освободите контейнер")
		}
		if row.CardID == cardID && row.ContainerID == "" && row.Qty >= quantity {
			index = i
		}
	}
	if index < 0 {
		return roguelikeError(409, "item_unavailable", "Сначала уберите предмет в рюкзак и проверьте количество")
	}
	if err = validateRoguelikeAdditionalWeight(tx, to, &card, quantity); err != nil {
		return err
	}
	rows[index].Qty -= quantity
	if rows[index].Qty == 0 {
		rows = append(rows[:index], rows[index+1:]...)
	}
	from.InventoryItems = &rows
	addInventoryItem(to, cardID, quantity)
	from.RuntimeRevision++
	to.RuntimeRevision++
	return nil
}
func roguelikePartyBoundItem(value any, cardID string) bool {
	switch v := value.(type) {
	case JSONMap:
		return roguelikePartyBoundItem(map[string]any(v), cardID)
	case map[string]any:
		if v["itemCardId"] == cardID && v["weaponBondActorId"] != nil {
			return true
		}
		for _, child := range v {
			if roguelikePartyBoundItem(child, cardID) {
				return true
			}
		}
	case []any:
		for _, child := range v {
			if roguelikePartyBoundItem(child, cardID) {
				return true
			}
		}
	}
	return false
}
