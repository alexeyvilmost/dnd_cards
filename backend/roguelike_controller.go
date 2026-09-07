package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	roguelikeHealingPotionCard = "CARD-0839"
	roguelikeGreaterPotionCard = "CARD-0840"
	roguelikeArrowCard         = "CARD-0728"
	roguelikeBoltCard          = "CARD-0749"
)

type RoguelikeController struct{ db *gorm.DB }

func NewRoguelikeController(db *gorm.DB) *RoguelikeController {
	return &RoguelikeController{db: db}
}

type roguelikeHTTPError struct {
	Status  int
	Code    string
	Message string
}

func (e *roguelikeHTTPError) Error() string { return e.Message }

func roguelikeError(status int, code, message string) error {
	return &roguelikeHTTPError{Status: status, Code: code, Message: message}
}

func roguelikeCommandRequestHash(request RoguelikeCommandRequest) (string, error) {
	raw, err := json.Marshal(request)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", sha256.Sum256(raw)), nil
}

type RoguelikeOffer struct {
	ID         string `json:"id"`
	CardID     string `json:"card_id"`
	CardNumber string `json:"card_number"`
	Name       string `json:"name"`
	Price      int    `json:"price"`
	Quantity   int    `json:"quantity"`
	Pinned     bool   `json:"pinned"`
	Sold       bool   `json:"sold"`
}

type RoguelikeShop struct {
	Generation    int              `json:"generation"`
	PinnedOfferID string           `json:"pinned_offer_id,omitempty"`
	Offers        []RoguelikeOffer `json:"offers"`
	Staples       []RoguelikeOffer `json:"staples"`
}

func mapFromJSON(value any) (JSONMap, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	result := JSONMap{}
	if err = json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func decodeJSONMap(value JSONMap, target any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, target)
}

func numberFromJSON(value any) (int, bool) {
	switch number := value.(type) {
	case int:
		return number, true
	case int64:
		return int(number), true
	case float64:
		return int(number), number == float64(int(number))
	case json.Number:
		parsed, err := number.Int64()
		return int(parsed), err == nil
	default:
		return 0, false
	}
}

func newRoguelikeSeed() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func ownedRoguelikeRun(tx *gorm.DB, id, userID uuid.UUID, lock bool) (*RoguelikeRun, error) {
	query := tx.Preload("Character").Where("id = ? AND user_id = ?", id, userID)
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var run RoguelikeRun
	if err := query.First(&run).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, roguelikeError(http.StatusNotFound, "run_not_found", "забег не найден")
		}
		return nil, err
	}
	if run.Character != nil {
		run.Character.AccessMode = characterV3AccessOwner
	}
	return &run, nil
}

func roguelikeRunResponse(run *RoguelikeRun) (JSONMap, error) {
	return mapFromJSON(map[string]any{"run": run})
}

func writeRoguelikeError(c *gin.Context, err error) {
	var domain *roguelikeHTTPError
	if errors.As(err, &domain) {
		c.JSON(domain.Status, gin.H{"error": domain.Message, "code": domain.Code})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка состояния забега"})
}

func validateRoguelikeSource(tx *gorm.DB, source *CharacterV3, userID uuid.UUID) error {
	if source.UserID != userID {
		return roguelikeError(http.StatusForbidden, "source_forbidden", "персонаж принадлежит другому пользователю")
	}
	if source.CharacterType == "dungeon_crawl" {
		return roguelikeError(http.StatusBadRequest, "source_is_run_character", "нельзя начать забег с персонажа другого забега")
	}
	if source.Level != 1 || source.ClassID == nil {
		return roguelikeError(http.StatusBadRequest, "fighter_level_required", "для старта нужен воин 1 уровня")
	}
	var class Class
	if err := tx.Where("id = ? AND card_number = ?", *source.ClassID, "CLASS-warrior").First(&class).Error; err != nil {
		return roguelikeError(http.StatusBadRequest, "fighter_required", "в первой версии доступен только воин")
	}
	if source.ClassLevels != nil {
		if len(*source.ClassLevels) != 1 {
			return roguelikeError(http.StatusBadRequest, "pure_fighter_required", "мультикласс для этого режима недоступен")
		}
		level, ok := numberFromJSON((*source.ClassLevels)[source.ClassID.String()])
		if !ok || level != 1 {
			return roguelikeError(http.StatusBadRequest, "fighter_level_required", "для старта нужен воин 1 уровня")
		}
	}
	return nil
}

func addInventoryItem(character *CharacterV3, cardID string, quantity int) {
	rows := InventoryItemRows{}
	if character.InventoryItems != nil {
		rows = append(rows, (*character.InventoryItems)...)
	}
	for index := range rows {
		if rows[index].CardID == cardID && rows[index].ContainerID == "" {
			rows[index].Qty += quantity
			character.InventoryItems = &rows
			return
		}
	}
	rows = append(rows, InventoryItemRow{CardID: cardID, Qty: quantity})
	character.InventoryItems = &rows
}

func setCharacterGold(character *CharacterV3, gold int) {
	currency := cloneJSONMapValue(character.Currency)
	currency["gold"] = gold
	character.Currency = &currency
}

func characterGold(character *CharacterV3) int {
	if character.Currency == nil {
		return 0
	}
	value, _ := numberFromJSON((*character.Currency)["gold"])
	if value < 0 {
		return 0
	}
	return value
}

func roguelikeCardByNumber(tx *gorm.DB, cardNumber string) (*Card, error) {
	var card Card
	if err := tx.Where("card_number = ?", cardNumber).First(&card).Error; err != nil {
		return nil, fmt.Errorf("load roguelike card %s: %w", cardNumber, err)
	}
	return &card, nil
}

func roguelikeStaples(tx *gorm.DB) ([]RoguelikeOffer, error) {
	definitions := []struct {
		Key, CardNumber, Name string
		Price, Quantity       int
	}{
		{"staple:healing-potion", roguelikeHealingPotionCard, "Малое зелье лечения", 50, 1},
		{"staple:arrows", roguelikeArrowCard, "20 стрел", 1, 20},
		{"staple:bolts", roguelikeBoltCard, "20 арбалетных болтов", 1, 20},
	}
	result := []RoguelikeOffer{{ID: "staple:supplies", Name: "Комплект лагерных припасов", Price: 20, Quantity: 1}}
	for _, definition := range definitions {
		card, err := roguelikeCardByNumber(tx, definition.CardNumber)
		if err != nil {
			return nil, err
		}
		result = append(result, RoguelikeOffer{
			ID: definition.Key, CardID: card.ID.String(), CardNumber: card.CardNumber,
			Name: definition.Name, Price: definition.Price, Quantity: definition.Quantity,
		})
	}
	return result, nil
}

func generateRoguelikeShop(tx *gorm.DB, run *RoguelikeRun, level int, preserve *RoguelikeOffer) (JSONMap, error) {
	entries := make([]roguelikeShopManifestEntry, 0, len(roguelikeShopManifest))
	numbers := make([]string, 0, len(roguelikeShopManifest))
	byNumber := map[string]roguelikeShopManifestEntry{}
	for _, entry := range roguelikeShopManifest {
		if entry.MinLevel <= level {
			entries = append(entries, entry)
			numbers = append(numbers, entry.CardNumber)
			byNumber[entry.CardNumber] = entry
		}
	}
	var cards []Card
	if err := tx.Where("card_number IN ?", numbers).Find(&cards).Error; err != nil {
		return nil, err
	}
	cardByNumber := map[string]Card{}
	for _, card := range cards {
		cardByNumber[card.CardNumber] = card
	}
	available := make([]roguelikeShopManifestEntry, 0, len(entries))
	for _, entry := range entries {
		if _, exists := cardByNumber[entry.CardNumber]; exists {
			available = append(available, entry)
		}
	}
	if len(available) < 5 {
		return nil, fmt.Errorf("roguelike shop has only %d available manifest cards", len(available))
	}
	current := RoguelikeShop{}
	_ = decodeJSONMap(run.Shop, &current)
	generation := current.Generation + 1
	ordered := roguelikeWeightedOrder(run.RunSeed, "shop", generation*1009+run.EncountersWon, available)
	offers := make([]RoguelikeOffer, 0, 5)
	selected := make([]roguelikeShopManifestEntry, 0, 5)
	pinnedCard := ""
	shop := RoguelikeShop{Generation: generation}
	if preserve != nil && !preserve.Sold {
		copy := *preserve
		copy.Pinned = true
		offers = append(offers, copy)
		shop.PinnedOfferID = copy.ID
		pinnedCard = copy.CardNumber
	}
	selectedCards := map[string]bool{pinnedCard: pinnedCard != ""}
	hasKind := map[string]bool{}
	if entry, ok := byNumber[pinnedCard]; ok {
		hasKind[entry.Kind] = true
	}
	// Keep both an immediately usable consumable and an equippable alternative
	// on the five-slot shelf whenever both pools are available.
	for _, requiredKind := range []string{"consumable", "equipment"} {
		if hasKind[requiredKind] {
			continue
		}
		for _, entry := range ordered {
			if entry.Kind == requiredKind && !selectedCards[entry.CardNumber] {
				selected = append(selected, entry)
				selectedCards[entry.CardNumber] = true
				hasKind[requiredKind] = true
				break
			}
		}
	}
	for _, entry := range ordered {
		if len(offers)+len(selected) == 5 {
			break
		}
		if selectedCards[entry.CardNumber] {
			continue
		}
		selected = append(selected, entry)
		selectedCards[entry.CardNumber] = true
	}
	for _, entry := range selected {
		card := cardByNumber[entry.CardNumber]
		offerID := uuid.NewSHA1(uuid.NameSpaceOID, []byte(fmt.Sprintf("%s:shop:%d:%s", run.ID, generation, entry.CardNumber)))
		offers = append(offers, RoguelikeOffer{
			ID: offerID.String(), CardID: card.ID.String(), CardNumber: card.CardNumber,
			Name: card.Name, Price: byNumber[entry.CardNumber].Price, Quantity: 1,
		})
	}
	staples, err := roguelikeStaples(tx)
	if err != nil {
		return nil, err
	}
	shop.Offers = offers
	shop.Staples = staples
	return mapFromJSON(shop)
}

func roguelikeCheckpoint(run *RoguelikeRun, character *CharacterV3) (JSONMap, error) {
	characterCopy := *character
	characterCopy.User = User{}
	characterCopy.Group = nil
	characterCopy.AccessMode = ""
	characterMap, err := mapFromJSON(characterCopy)
	if err != nil {
		return nil, err
	}
	return mapFromJSON(map[string]any{
		"experience": run.Experience, "gold": run.Gold, "supplies": run.Supplies,
		"encounters_won": run.EncountersWon, "game_clock_hours": run.GameClockHours,
		"last_long_rest_hour": run.LastLongRestHour, "paid_refresh_count": run.PaidRefreshCount,
		"pending_level": run.PendingLevel,
		"shop":          run.Shop, "character": characterMap,
	})
}

func saveRoguelikeRun(tx *gorm.DB, run *RoguelikeRun) error {
	return tx.Model(&RoguelikeRun{}).Where("id = ?", run.ID).Updates(map[string]any{
		"status": run.Status, "phase": run.Phase, "revision": run.Revision,
		"experience": run.Experience, "gold": run.Gold, "supplies": run.Supplies,
		"encounters_won": run.EncountersWon, "attempt": run.Attempt,
		"game_clock_hours": run.GameClockHours, "last_long_rest_hour": run.LastLongRestHour,
		"paid_refresh_count": run.PaidRefreshCount, "pending_level": run.PendingLevel,
		"encounter": run.Encounter,
		"shop":      run.Shop, "checkpoint": run.Checkpoint, "last_reward": run.LastReward,
		"updated_at": time.Now().UTC(),
	}).Error
}

func (rc *RoguelikeController) Create(c *gin.Context) {
	userID, ok := requireCharacterV3UserID(c)
	if !ok {
		return
	}
	var request CreateRoguelikeRunRequest
	if err := c.ShouldBindJSON(&request); err != nil || request.SourceCharacterID == uuid.Nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "выберите персонажа для забега", "code": "source_required"})
		return
	}
	var created *RoguelikeRun
	err := rc.db.Transaction(func(tx *gorm.DB) error {
		var source CharacterV3
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&source, "id = ?", request.SourceCharacterID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return roguelikeError(http.StatusNotFound, "source_not_found", "персонаж не найден")
			}
			return err
		}
		if err := validateRoguelikeSource(tx, &source, userID); err != nil {
			return err
		}
		var activeCount int64
		if err := tx.Model(&RoguelikeRun{}).Where("source_character_id = ? AND status = ?", source.ID, RoguelikeStatusActive).Count(&activeCount).Error; err != nil {
			return err
		}
		if activeCount > 0 {
			return roguelikeError(http.StatusConflict, "active_run_exists", "у этого персонажа уже есть активный забег")
		}
		seed, err := newRoguelikeSeed()
		if err != nil {
			return err
		}
		clone := source
		clone.ID = uuid.New()
		clone.GroupID = nil
		clone.Group = nil
		clone.User = User{}
		clone.Name = strings.TrimSpace(source.Name) + " · Забег"
		clone.CharacterType = "dungeon_crawl"
		clone.CurrentEncounterID = nil
		clone.RuntimeRevision = 0
		clone.CreatedAt = time.Time{}
		clone.UpdatedAt = time.Time{}
		potion, err := roguelikeCardByNumber(tx, roguelikeHealingPotionCard)
		if err != nil {
			return err
		}
		addInventoryItem(&clone, potion.ID.String(), 1)
		if err = tx.Omit("User", "Group").Create(&clone).Error; err != nil {
			return err
		}
		run := &RoguelikeRun{
			ID: uuid.New(), UserID: userID, SourceCharacterID: source.ID, CharacterID: clone.ID,
			Status: RoguelikeStatusActive, Phase: RoguelikePhaseCamp, Supplies: 1,
			Gold: characterGold(&source), Attempt: 1, LastLongRestHour: -24, RunSeed: seed,
			Encounter: JSONMap{}, Shop: JSONMap{}, Checkpoint: JSONMap{}, LastReward: JSONMap{},
		}
		setCharacterGold(&clone, run.Gold)
		if err = tx.Model(&CharacterV3{}).Where("id = ?", clone.ID).Update("currency", clone.Currency).Error; err != nil {
			return err
		}
		run.Shop, err = generateRoguelikeShop(tx, run, 1, nil)
		if err != nil {
			return err
		}
		run.Checkpoint, err = roguelikeCheckpoint(run, &clone)
		if err != nil {
			return err
		}
		if err = tx.Omit("Character").Create(run).Error; err != nil {
			return err
		}
		run.Character = &clone
		run.Character.AccessMode = characterV3AccessOwner
		created = run
		return nil
	})
	if err != nil {
		writeRoguelikeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"run": created})
}

func (rc *RoguelikeController) List(c *gin.Context) {
	userID, ok := requireCharacterV3UserID(c)
	if !ok {
		return
	}
	var runs []RoguelikeRun
	if err := rc.db.Preload("Character").Where("user_id = ?", userID).Order("updated_at DESC").Limit(50).Find(&runs).Error; err != nil {
		writeRoguelikeError(c, err)
		return
	}
	for index := range runs {
		if runs[index].Character != nil {
			runs[index].Character.AccessMode = characterV3AccessOwner
		}
	}
	c.JSON(http.StatusOK, gin.H{"runs": runs})
}

func (rc *RoguelikeController) Get(c *gin.Context) {
	userID, ok := requireCharacterV3UserID(c)
	if !ok {
		return
	}
	runID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID забега"})
		return
	}
	run, err := ownedRoguelikeRun(rc.db, runID, userID, false)
	if err != nil {
		writeRoguelikeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"run": run})
}

func roguelikeEncounterCandidates(level, budget, encountersWon int, available map[string]Monster) []struct {
	Entry    roguelikeMonsterEntry
	Monster  Monster
	Quantity int
} {
	result := []struct {
		Entry    roguelikeMonsterEntry
		Monster  Monster
		Quantity int
	}{}
	for _, entry := range roguelikeMonsterPool {
		monster, exists := available[entry.Slug]
		if !exists || entry.MinLevel > level || entry.GeneratorWeight <= 0 {
			continue
		}
		quantity := (budget + entry.XP/2) / entry.XP
		if quantity < 1 {
			quantity = 1
		}
		if quantity > entry.MaxCount {
			quantity = entry.MaxCount
		}
		bodyLimit := 3
		if level <= 2 {
			bodyLimit = 2
		}
		if level == 1 && encountersWon < 2 {
			bodyLimit = 1
		}
		if quantity > bodyLimit {
			quantity = bodyLimit
		}
		total := quantity * entry.XP
		if total*2 < budget || total > budget+budget/2 {
			continue
		}
		result = append(result, struct {
			Entry    roguelikeMonsterEntry
			Monster  Monster
			Quantity int
		}{entry, monster, quantity})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Entry.Slug < result[j].Entry.Slug })
	return result
}

func startRoguelikeEncounter(tx *gorm.DB, run *RoguelikeRun) error {
	if run.Status != RoguelikeStatusActive || run.Phase != RoguelikePhaseCamp {
		return roguelikeError(http.StatusConflict, "camp_required", "новую встречу можно начать только из лагеря")
	}
	if run.PendingLevel != 0 {
		return roguelikeError(http.StatusConflict, "level_up_pending", "сначала подтвердите начатое повышение уровня")
	}
	level := roguelikeLevelForXP(run.Experience)
	if run.Experience >= roguelikeVictoryXP {
		return roguelikeError(http.StatusConflict, "victory_ready", "цель забега достигнута — завершите его кнопкой «Победа!»")
	}
	if run.Character == nil || run.Character.Level != level {
		return roguelikeError(http.StatusConflict, "level_up_required", "сначала повысьте уровень воина")
	}
	difficulty, budget := roguelikeEncounterBudget(level, run.Experience)
	slugs := make([]string, 0, len(roguelikeMonsterPool))
	for _, entry := range roguelikeMonsterPool {
		if entry.GeneratorWeight > 0 {
			slugs = append(slugs, entry.Slug)
		}
	}
	var monsters []Monster
	if err := tx.Where("slug IN ?", slugs).Find(&monsters).Error; err != nil {
		return err
	}
	available := map[string]Monster{}
	for _, monster := range monsters {
		available[monster.Slug] = monster
	}
	candidates := roguelikeEncounterCandidates(level, budget, run.EncountersWon, available)
	if len(candidates) == 0 {
		return roguelikeError(http.StatusConflict, "encounter_pool_unavailable", "для этого этапа нет проверенного состава встречи")
	}
	index := roguelikeDeterministicInt(run.RunSeed, "encounter", run.EncountersWon+1, len(candidates))
	selected := candidates[index]
	encounter, err := mapFromJSON(map[string]any{
		"number": run.EncountersWon + 1, "difficulty": difficulty, "budget_xp": budget,
		"monster_id": selected.Monster.ID, "monster_slug": selected.Monster.Slug,
		"monster_name": selected.Monster.Name, "quantity": selected.Quantity,
		"xp_each": selected.Entry.XP, "xp_total": selected.Entry.XP * selected.Quantity,
	})
	if err != nil {
		return err
	}
	run.Encounter = encounter
	run.LastReward = JSONMap{}
	run.Phase = RoguelikePhaseCombat
	return nil
}

func combatOutcome(character *CharacterV3) string {
	if character == nil || character.TurnState == nil {
		return ""
	}
	raw, exists := (*character.TurnState)[SOLO_COMBAT_KEY]
	if !exists {
		return ""
	}
	combat, ok := raw.(map[string]any)
	if !ok {
		if typed, typedOK := raw.(JSONMap); typedOK {
			combat = typed
		} else {
			return ""
		}
	}
	outcome, _ := combat["outcome"].(string)
	return outcome
}

const SOLO_COMBAT_KEY = "solo_combat_v1"

func clearCharacterSoloCombat(character *CharacterV3) {
	turnState := cloneJSONMapValue(character.TurnState)
	delete(turnState, SOLO_COMBAT_KEY)
	character.TurnState = &turnState
	character.RuntimeRevision++
}

func encounterNumber(run *RoguelikeRun, key string) (int, error) {
	value, ok := numberFromJSON(run.Encounter[key])
	if !ok {
		return 0, fmt.Errorf("bad encounter %s", key)
	}
	return value, nil
}

func grantRoguelikeLootByKind(
	tx *gorm.DB,
	run *RoguelikeRun,
	character *CharacterV3,
	level int,
	kind string,
	stream string,
	cursor int,
	excluded map[string]bool,
) (*Card, error) {
	eligible := []roguelikeShopManifestEntry{}
	for _, entry := range roguelikeShopManifest {
		if entry.MinLevel <= level && entry.Kind == kind && !excluded[entry.CardNumber] {
			eligible = append(eligible, entry)
		}
	}
	ordered := roguelikeWeightedOrder(run.RunSeed, stream, cursor, eligible)
	for _, entry := range ordered {
		card, err := roguelikeCardByNumber(tx, entry.CardNumber)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		addInventoryItem(character, card.ID.String(), 1)
		excluded[entry.CardNumber] = true
		return card, nil
	}
	return nil, nil
}

func appendRoguelikeLoot(
	tx *gorm.DB,
	run *RoguelikeRun,
	character *CharacterV3,
	encounterNo int,
	guaranteeMilestoneItem bool,
) ([]*Card, error) {
	level := roguelikeLevelForXP(run.Experience)
	items := []*Card{}
	excluded := map[string]bool{}
	if roguelikeDeterministicInt(run.RunSeed, "loot-chance", encounterNo, 100) < 25 {
		kind := roguelikeLootKind(level, roguelikeDeterministicInt(run.RunSeed, "loot-kind", encounterNo, 100))
		card, err := grantRoguelikeLootByKind(tx, run, character, level, kind, "loot-item", encounterNo, excluded)
		if err != nil {
			return nil, err
		}
		if card != nil {
			items = append(items, card)
		}
	}
	if guaranteeMilestoneItem {
		card, err := grantRoguelikeLootByKind(tx, run, character, level, "magic", "hoard-item", 900, excluded)
		if err != nil {
			return nil, err
		}
		if card != nil {
			items = append(items, card)
		}
	}
	return items, nil
}

func rewardRoguelikeVictory(tx *gorm.DB, run *RoguelikeRun) error {
	encounterNo, err := encounterNumber(run, "number")
	if err != nil {
		return err
	}
	xp, err := encounterNumber(run, "xp_total")
	if err != nil {
		return err
	}
	quantity, err := encounterNumber(run, "quantity")
	if err != nil {
		return err
	}
	previousXP := run.Experience
	gold := 0
	for enemy := 0; enemy < quantity; enemy++ {
		for die := 0; die < 3; die++ {
			gold += 1 + roguelikeDeterministicInt(run.RunSeed, "gold", encounterNo*100+enemy*3+die, 6)
		}
	}
	run.Experience += xp
	for _, milestone := range []int{900, 6500} {
		if previousXP < milestone && run.Experience >= milestone {
			hoardDice := 0
			for die := 0; die < 2; die++ {
				hoardDice += 1 + roguelikeDeterministicInt(
					run.RunSeed, "hoard", milestone*10+die, 4,
				)
			}
			gold += hoardDice * 100
		}
	}
	run.Gold += gold
	run.EncountersWon++
	run.GameClockHours++
	setCharacterGold(run.Character, run.Gold)
	loot, err := appendRoguelikeLoot(tx, run, run.Character, encounterNo, previousXP < 900 && run.Experience >= 900)
	if err != nil {
		return err
	}
	clearCharacterSoloCombat(run.Character)
	shop, shopErr := currentShop(run)
	if shopErr != nil {
		return shopErr
	}
	var pinned *RoguelikeOffer
	for index := range shop.Offers {
		if shop.Offers[index].ID == shop.PinnedOfferID && !shop.Offers[index].Sold {
			copy := shop.Offers[index]
			pinned = &copy
			break
		}
	}
	run.Shop, err = generateRoguelikeShop(tx, run, roguelikeLevelForXP(run.Experience), pinned)
	if err != nil {
		return err
	}
	reward := map[string]any{"experience": xp, "gold": gold, "total_experience": run.Experience}
	if len(loot) > 0 {
		items := make([]map[string]any, 0, len(loot))
		for _, card := range loot {
			items = append(items, map[string]any{"card_id": card.ID, "card_number": card.CardNumber, "name": card.Name})
		}
		reward["item"] = items[0]
		reward["items"] = items
	}
	run.LastReward, err = mapFromJSON(reward)
	if err != nil {
		return err
	}
	run.Encounter = JSONMap{}
	run.Phase = RoguelikePhaseCamp
	run.Status = RoguelikeStatusActive
	run.Checkpoint, err = roguelikeCheckpoint(run, run.Character)
	return err
}

func completeRoguelikeEncounter(tx *gorm.DB, run *RoguelikeRun) error {
	if run.Status != RoguelikeStatusActive || run.Phase != RoguelikePhaseCombat {
		return roguelikeError(http.StatusConflict, "combat_required", "активная встреча не найдена")
	}
	outcome := combatOutcome(run.Character)
	switch outcome {
	case "victory":
		return rewardRoguelikeVictory(tx, run)
	case "defeat":
		run.Status = RoguelikeStatusDefeat
		run.Phase = RoguelikePhaseEnded
		return nil
	default:
		return roguelikeError(http.StatusConflict, "combat_not_finished", "бой ещё не завершён или его результат не сохранён")
	}
}

func currentShop(run *RoguelikeRun) (RoguelikeShop, error) {
	var shop RoguelikeShop
	if err := decodeJSONMap(run.Shop, &shop); err != nil {
		return shop, err
	}
	return shop, nil
}

func roguelikePayloadString(request RoguelikeCommandRequest, key string) string {
	value, _ := request.Payload[key].(string)
	return strings.TrimSpace(value)
}

func pinRoguelikeOffer(run *RoguelikeRun, offerID string) error {
	shop, err := currentShop(run)
	if err != nil {
		return err
	}
	if offerID == "" {
		for index := range shop.Offers {
			shop.Offers[index].Pinned = false
		}
		shop.PinnedOfferID = ""
		run.Shop, err = mapFromJSON(shop)
		return err
	}
	for index := range shop.Offers {
		if shop.Offers[index].ID == offerID && !shop.Offers[index].Sold {
			if shop.PinnedOfferID != offerID {
				if run.Gold < 5 {
					return roguelikeError(http.StatusConflict, "insufficient_gold", "нужно 5 зм для фиксации товара")
				}
				run.Gold -= 5
				setCharacterGold(run.Character, run.Gold)
			}
			for other := range shop.Offers {
				shop.Offers[other].Pinned = other == index
			}
			shop.PinnedOfferID = offerID
			run.Shop, err = mapFromJSON(shop)
			return err
		}
	}
	return roguelikeError(http.StatusNotFound, "offer_not_found", "товар для фиксации не найден")
}

func buyRoguelikeOffer(run *RoguelikeRun, offerID string) error {
	shop, err := currentShop(run)
	if err != nil {
		return err
	}
	var offer *RoguelikeOffer
	isStaple := strings.HasPrefix(offerID, "staple:")
	rows := &shop.Offers
	if isStaple {
		rows = &shop.Staples
	}
	for index := range *rows {
		if (*rows)[index].ID == offerID {
			offer = &(*rows)[index]
			break
		}
	}
	if offer == nil {
		return roguelikeError(http.StatusNotFound, "offer_not_found", "товар не найден")
	}
	if offer.Sold {
		return roguelikeError(http.StatusConflict, "offer_sold", "товар уже куплен")
	}
	if run.Gold < offer.Price {
		return roguelikeError(http.StatusConflict, "insufficient_gold", "недостаточно золота")
	}
	run.Gold -= offer.Price
	if offer.ID == "staple:supplies" {
		run.Supplies += offer.Quantity
	} else {
		addInventoryItem(run.Character, offer.CardID, offer.Quantity)
	}
	if !isStaple {
		offer.Sold = true
		offer.Pinned = false
		if shop.PinnedOfferID == offer.ID {
			shop.PinnedOfferID = ""
		}
	}
	setCharacterGold(run.Character, run.Gold)
	run.Shop, err = mapFromJSON(shop)
	return err
}

func refreshRoguelikeShop(tx *gorm.DB, run *RoguelikeRun) error {
	shop, err := currentShop(run)
	if err != nil {
		return err
	}
	cost := 5 * (run.PaidRefreshCount + 1)
	if run.Gold < cost {
		return roguelikeError(http.StatusConflict, "insufficient_gold", fmt.Sprintf("для обновления нужно %d зм", cost))
	}
	var pinned *RoguelikeOffer
	for index := range shop.Offers {
		if shop.Offers[index].ID == shop.PinnedOfferID && !shop.Offers[index].Sold {
			copy := shop.Offers[index]
			pinned = &copy
			break
		}
	}
	run.Gold -= cost
	run.PaidRefreshCount++
	setCharacterGold(run.Character, run.Gold)
	run.Shop, err = generateRoguelikeShop(tx, run, roguelikeLevelForXP(run.Experience), pinned)
	return err
}

type roguelikeRuntimePatch struct {
	CurrentHP     *int              `json:"current_hp"`
	Resources     *JSONMap          `json:"resources"`
	MaxResources  *JSONMap          `json:"max_resources"`
	ActiveEffects *ActiveEffectRows `json:"active_effects"`
	TurnState     *JSONMap          `json:"turn_state"`
}

func resourceMapWithinMaximum(current, maximum *JSONMap) bool {
	if current == nil || maximum == nil {
		return current == nil && maximum == nil
	}
	if len(*current) != len(*maximum) {
		return false
	}
	for key, raw := range *current {
		value, ok := numberFromJSON(raw)
		maxValue, maxOK := numberFromJSON((*maximum)[key])
		if !ok || !maxOK || value < 0 || value > maxValue {
			return false
		}
	}
	return true
}

func applyRoguelikeRuntimePatch(run *RoguelikeRun, patch roguelikeRuntimePatch, long bool, hitDieRolls []int) error {
	if patch.CurrentHP == nil || *patch.CurrentHP < 0 || *patch.CurrentHP > run.Character.MaxHP {
		return roguelikeError(http.StatusBadRequest, "invalid_runtime", "отдых вернул недопустимое количество хитов")
	}
	if patch.MaxResources != nil {
		return roguelikeError(http.StatusBadRequest, "invalid_runtime", "отдых не может менять максимумы ресурсов")
	}
	if !resourceMapWithinMaximum(patch.Resources, run.Character.MaxResources) {
		return roguelikeError(http.StatusBadRequest, "invalid_runtime", "отдых вернул недопустимый запас ресурсов")
	}
	if long && *patch.CurrentHP != run.Character.MaxHP {
		return roguelikeError(http.StatusBadRequest, "invalid_long_rest", "долгий отдых должен полностью восстановить хиты")
	}
	if !long {
		if run.Character.CurrentHP < 1 {
			return roguelikeError(http.StatusConflict, "short_rest_at_zero_hp", "короткий отдых нельзя начать при 0 хитов")
		}
		if *patch.CurrentHP < run.Character.CurrentHP {
			return roguelikeError(http.StatusBadRequest, "invalid_short_rest", "короткий отдых не может уменьшить хиты")
		}
		if run.Character.Resources == nil || patch.Resources == nil {
			return roguelikeError(http.StatusBadRequest, "invalid_hit_dice", "в листе отсутствует ресурс костей хитов")
		}
		oldDice, oldOK := numberFromJSON((*run.Character.Resources)["hit_dice_d10"])
		newDice, newOK := numberFromJSON((*patch.Resources)["hit_dice_d10"])
		if !oldOK || !newOK || oldDice-newDice != len(hitDieRolls) {
			return roguelikeError(http.StatusBadRequest, "invalid_hit_dice", "расход костей хитов не совпадает с бросками")
		}
		conScore := 10
		if run.Character.Abilities != nil {
			if value, ok := numberFromJSON((*run.Character.Abilities)["con"]); ok {
				conScore = value
			}
		}
		maximumHealing := 0
		for _, roll := range hitDieRolls {
			if roll < 1 || roll > 10 {
				return roguelikeError(http.StatusBadRequest, "invalid_hit_die_roll", "результат кости хитов должен быть от 1 до 10")
			}
			healing := roll + (conScore-10)/2
			if healing < 1 {
				healing = 1
			}
			maximumHealing += healing
		}
		wantHP := run.Character.CurrentHP + maximumHealing
		if wantHP > run.Character.MaxHP {
			wantHP = run.Character.MaxHP
		}
		if *patch.CurrentHP != wantHP {
			return roguelikeError(http.StatusBadRequest, "invalid_short_rest", "восстановление хитов не совпадает с бросками костей")
		}
	}
	run.Character.CurrentHP = *patch.CurrentHP
	if patch.Resources != nil {
		run.Character.Resources = patch.Resources
	}
	if patch.ActiveEffects != nil {
		run.Character.ActiveEffects = patch.ActiveEffects
	}
	if patch.TurnState != nil {
		run.Character.TurnState = patch.TurnState
	}
	run.Character.RuntimeRevision++
	return nil
}

func restRoguelike(run *RoguelikeRun, request RoguelikeCommandRequest, long bool) error {
	if run.Status != RoguelikeStatusActive || run.Phase != RoguelikePhaseCamp {
		return roguelikeError(http.StatusConflict, "camp_required", "отдых доступен только в лагере")
	}
	rawRuntime, exists := request.Payload["runtime"]
	if !exists {
		return roguelikeError(http.StatusBadRequest, "runtime_required", "нет рассчитанного результата отдыха")
	}
	raw, err := json.Marshal(rawRuntime)
	if err != nil {
		return err
	}
	var patch roguelikeRuntimePatch
	if err = json.Unmarshal(raw, &patch); err != nil {
		return roguelikeError(http.StatusBadRequest, "invalid_runtime", "неверный результат отдыха")
	}
	hitDieRolls := []int{}
	if rawRolls, exists := request.Payload["hit_die_rolls"]; exists {
		raw, marshalErr := json.Marshal(rawRolls)
		if marshalErr != nil || json.Unmarshal(raw, &hitDieRolls) != nil {
			return roguelikeError(http.StatusBadRequest, "invalid_hit_dice", "неверный список бросков костей хитов")
		}
	}
	if long {
		if run.Character.CurrentHP < 1 {
			return roguelikeError(http.StatusConflict, "long_rest_at_zero_hp", "долгий отдых нельзя начать при 0 хитов")
		}
		if run.Supplies < 1 {
			return roguelikeError(http.StatusConflict, "supplies_required", "для долгого отдыха нужны припасы")
		}
		if since := run.GameClockHours - run.LastLongRestHour; since < 16 {
			run.GameClockHours += 16 - since
		}
		run.GameClockHours += 8
		run.LastLongRestHour = run.GameClockHours
		run.Supplies--
	} else {
		run.GameClockHours++
	}
	return applyRoguelikeRuntimePatch(run, patch, long, hitDieRolls)
}

func consumeRoguelikeInventoryItem(character *CharacterV3, cardID string) bool {
	if character.InventoryItems == nil {
		return false
	}
	rows := append(InventoryItemRows(nil), (*character.InventoryItems)...)
	for index := range rows {
		if rows[index].CardID != cardID || rows[index].ContainerID != "" || rows[index].Qty < 1 {
			continue
		}
		rows[index].Qty--
		if rows[index].Qty == 0 {
			rows = append(rows[:index], rows[index+1:]...)
		}
		character.InventoryItems = &rows
		return true
	}
	return false
}

func useRoguelikeItem(tx *gorm.DB, run *RoguelikeRun, request RoguelikeCommandRequest) error {
	if run.Status != RoguelikeStatusActive || run.Phase != RoguelikePhaseCamp {
		return roguelikeError(http.StatusConflict, "camp_required", "предмет можно применить между столкновениями")
	}
	if run.Character.CurrentHP < 1 {
		return roguelikeError(http.StatusConflict, "item_use_at_zero_hp", "сначала восстановите попытку с контрольной точки")
	}
	if run.Character.CurrentHP >= run.Character.MaxHP {
		return roguelikeError(http.StatusConflict, "healing_not_needed", "у героя уже полные хиты")
	}
	cardID, err := uuid.Parse(roguelikePayloadString(request, "card_id"))
	if err != nil {
		return roguelikeError(http.StatusBadRequest, "invalid_item", "неверный предмет")
	}
	var card Card
	if err = tx.Select("id", "card_number", "name").First(&card, "id = ?", cardID).Error; err != nil {
		return roguelikeError(http.StatusNotFound, "item_not_found", "предмет не найден")
	}
	dice, bonus := 0, 0
	switch card.CardNumber {
	case roguelikeHealingPotionCard:
		dice, bonus = 2, 2
	case roguelikeGreaterPotionCard:
		dice, bonus = 4, 4
	default:
		return roguelikeError(http.StatusBadRequest, "item_not_usable_in_camp", "этот предмет применяется через боевое действие или экипировку")
	}
	if !consumeRoguelikeInventoryItem(run.Character, cardID.String()) {
		return roguelikeError(http.StatusConflict, "item_unavailable", "этого предмета нет в инвентаре")
	}
	healing := bonus
	for die := 0; die < dice; die++ {
		healing += 1 + roguelikeDeterministicInt(run.RunSeed, "item:"+request.CommandID.String(), die, 4)
	}
	run.Character.CurrentHP += healing
	if run.Character.CurrentHP > run.Character.MaxHP {
		run.Character.CurrentHP = run.Character.MaxHP
	}
	run.Character.RuntimeRevision++
	return nil
}

func confirmRoguelikeLevelUp(run *RoguelikeRun) error {
	level := run.Character.Level
	if level < 2 || level > 5 || run.Experience < roguelikeXPThresholds[level-1] {
		return roguelikeError(http.StatusConflict, "level_up_not_earned", "этот уровень ещё не заработан")
	}
	if level > roguelikeLevelForXP(run.Experience) {
		return roguelikeError(http.StatusConflict, "invalid_run_level", "уровень листа не соответствует опыту забега")
	}
	if run.PendingLevel != level {
		return roguelikeError(http.StatusConflict, "level_up_not_pending", "сначала завершите мастер повышения уровня")
	}
	run.PendingLevel = 0
	checkpoint, err := roguelikeCheckpoint(run, run.Character)
	if err != nil {
		return err
	}
	run.Checkpoint = checkpoint
	return nil
}

func restoreRoguelikeCheckpoint(run *RoguelikeRun) error {
	if run.Status != RoguelikeStatusDefeat {
		return roguelikeError(http.StatusConflict, "defeat_required", "повтор доступен только после поражения")
	}
	var snapshot struct {
		Experience       int         `json:"experience"`
		Gold             int         `json:"gold"`
		Supplies         int         `json:"supplies"`
		EncountersWon    int         `json:"encounters_won"`
		GameClockHours   int         `json:"game_clock_hours"`
		LastLongRestHour int         `json:"last_long_rest_hour"`
		PaidRefreshCount int         `json:"paid_refresh_count"`
		PendingLevel     int         `json:"pending_level"`
		Shop             JSONMap     `json:"shop"`
		Character        CharacterV3 `json:"character"`
	}
	if err := decodeJSONMap(run.Checkpoint, &snapshot); err != nil {
		return err
	}
	if snapshot.Character.ID != run.CharacterID || snapshot.Character.UserID != run.UserID {
		return fmt.Errorf("roguelike checkpoint character identity mismatch")
	}
	currentRuntimeRevision := run.Character.RuntimeRevision
	*run.Character = snapshot.Character
	run.Character.RuntimeRevision = currentRuntimeRevision + 1
	run.Experience = snapshot.Experience
	run.Gold = snapshot.Gold
	run.Supplies = snapshot.Supplies
	run.EncountersWon = snapshot.EncountersWon
	run.GameClockHours = snapshot.GameClockHours
	run.LastLongRestHour = snapshot.LastLongRestHour
	run.PaidRefreshCount = snapshot.PaidRefreshCount
	run.PendingLevel = snapshot.PendingLevel
	run.Shop = snapshot.Shop
	run.Encounter = JSONMap{}
	run.LastReward = JSONMap{}
	run.Attempt++
	run.Status = RoguelikeStatusActive
	run.Phase = RoguelikePhaseCamp
	return nil
}

func finishRoguelikeVictory(run *RoguelikeRun) error {
	if run.Status != RoguelikeStatusActive || run.Phase != RoguelikePhaseCamp || run.Experience < roguelikeVictoryXP || run.Character.Level != 5 {
		return roguelikeError(http.StatusConflict, "victory_not_ready", "для победы нужен воин 5 уровня и 14 000 опыта")
	}
	run.Status = RoguelikeStatusVictory
	run.Phase = RoguelikePhaseEnded
	return nil
}

func applyRoguelikeCommand(tx *gorm.DB, run *RoguelikeRun, request RoguelikeCommandRequest) error {
	if run.Character == nil {
		return fmt.Errorf("roguelike character is missing")
	}
	switch request.Type {
	case "start_encounter":
		return startRoguelikeEncounter(tx, run)
	case "complete_encounter":
		return completeRoguelikeEncounter(tx, run)
	case "buy":
		return buyRoguelikeOffer(run, roguelikePayloadString(request, "offer_id"))
	case "pin":
		return pinRoguelikeOffer(run, roguelikePayloadString(request, "offer_id"))
	case "refresh_shop":
		return refreshRoguelikeShop(tx, run)
	case "short_rest":
		return restRoguelike(run, request, false)
	case "long_rest":
		return restRoguelike(run, request, true)
	case "use_item":
		return useRoguelikeItem(tx, run, request)
	case "confirm_level_up":
		return confirmRoguelikeLevelUp(run)
	case "retry":
		return restoreRoguelikeCheckpoint(run)
	case "victory":
		return finishRoguelikeVictory(run)
	default:
		return roguelikeError(http.StatusBadRequest, "unknown_command", "неизвестная команда забега")
	}
}

func (rc *RoguelikeController) Command(c *gin.Context) {
	userID, ok := requireCharacterV3UserID(c)
	if !ok {
		return
	}
	runID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID забега"})
		return
	}
	var request RoguelikeCommandRequest
	if err = c.ShouldBindJSON(&request); err != nil || request.CommandID == uuid.Nil || strings.TrimSpace(request.Type) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверная команда забега", "code": "invalid_command"})
		return
	}
	requestHash, err := roguelikeCommandRequestHash(request)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверная команда забега", "code": "invalid_command"})
		return
	}
	var response JSONMap
	err = rc.db.Transaction(func(tx *gorm.DB) error {
		var receipt RoguelikeCommandReceipt
		receiptResult := tx.Where("run_id = ? AND user_id = ? AND command_id = ?", runID, userID, request.CommandID).First(&receipt)
		if receiptResult.Error == nil {
			if receipt.CommandType != request.Type || receipt.RequestHash != requestHash {
				return roguelikeError(http.StatusConflict, "command_id_reused", "ID команды уже использован для другой операции")
			}
			response = receipt.Response
			return nil
		}
		if !errors.Is(receiptResult.Error, gorm.ErrRecordNotFound) {
			return receiptResult.Error
		}
		run, loadErr := ownedRoguelikeRun(tx, runID, userID, true)
		if loadErr != nil {
			return loadErr
		}
		if request.ExpectedRevision != run.Revision {
			return roguelikeError(http.StatusConflict, "run_revision_conflict", "состояние забега изменилось в другой вкладке")
		}
		if applyErr := applyRoguelikeCommand(tx, run, request); applyErr != nil {
			return applyErr
		}
		run.Revision++
		if err = tx.Omit("User", "Group").Save(run.Character).Error; err != nil {
			return err
		}
		if err = saveRoguelikeRun(tx, run); err != nil {
			return err
		}
		accepted, loadErr := ownedRoguelikeRun(tx, runID, userID, false)
		if loadErr != nil {
			return loadErr
		}
		response, err = roguelikeRunResponse(accepted)
		if err != nil {
			return err
		}
		return tx.Create(&RoguelikeCommandReceipt{
			RunID: runID, UserID: userID, CommandID: request.CommandID,
			CommandType: request.Type, RequestHash: requestHash, Response: response,
		}).Error
	})
	if err != nil {
		writeRoguelikeError(c, err)
		return
	}
	c.JSON(http.StatusOK, response)
}
