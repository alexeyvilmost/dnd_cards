package main

import (
	"encoding/json"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ShopController struct {
	db *gorm.DB
}

func NewShopController(db *gorm.DB) *ShopController {
	return &ShopController{db: db}
}

type ShopData struct {
	Slug    string                    `json:"slug"`
	Created time.Time                 `json:"created"`
	Vendors map[string][]CardResponse `json:"vendors"`
}

// rollDice parses expressions like "1d10+6", "1d4-1", "1d2-1"
func rollDice(expr string) int {
	expr = strings.TrimSpace(expr)
	// Default fallback
	total := 0
	// Very small parser: aBdC where B sides, A dice count (assume 1), optional +/- C
	parts := strings.Split(expr, "d")
	if len(parts) != 2 {
		return 0
	}
	// dice count (often 1)
	diceCount := 1
	if parts[0] != "" {
		if v, err := strconv.Atoi(parts[0]); err == nil {
			diceCount = v
		}
	}
	rest := parts[1]
	sides := 0
	modifier := 0
	if strings.Contains(rest, "+") {
		sub := strings.Split(rest, "+")
		if len(sub) == 2 {
			sides, _ = strconv.Atoi(strings.TrimSpace(sub[0]))
			modifier, _ = strconv.Atoi(strings.TrimSpace(sub[1]))
		}
	} else if strings.Contains(rest, "-") {
		sub := strings.Split(rest, "-")
		if len(sub) == 2 {
			sides, _ = strconv.Atoi(strings.TrimSpace(sub[0]))
			m, _ := strconv.Atoi(strings.TrimSpace(sub[1]))
			modifier = -m
		}
	} else {
		sides, _ = strconv.Atoi(strings.TrimSpace(rest))
	}
	if sides <= 0 {
		return 0
	}
	for i := 0; i < diceCount; i++ {
		total += rand.Intn(sides) + 1
	}
	total += modifier
	if total < 0 {
		total = 0
	}
	return total
}

// filter helpers
func hasProperty(card *Card, prop string) bool {
	if card.Properties == nil {
		return false
	}
	for _, p := range *card.Properties {
		if p == prop {
			return true
		}
	}
	return false
}

func hasTag(card *Card, tag string) bool {
	if card.Tags == nil {
		return false
	}
	for _, t := range *card.Tags {
		if t == tag {
			return true
		}
	}
	return false
}

func rarityGEUncommon(r Rarity) bool {
	switch r {
	case RarityUncommon, RarityRare, RarityVeryRare, RarityArtifact:
		return true
	default:
		return false
	}
}

// CreateShop generates a shop assortment and persists it with a slug
func (sc *ShopController) CreateShop(c *gin.Context) {
	rand.Seed(time.Now().UnixNano())

	// Load all non-deleted cards and exclude template-only
	var cards []Card
	if err := sc.db.Model(&Card{}).
		Where("deleted_at IS NULL").
		Where("is_template != ? OR is_template IS NULL", "only_template").
		Find(&cards).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка загрузки карточек"})
		return
	}

	// Build vendor lists
	vendors := map[string][]*Card{
		"Кожевник":         {},
		"Оруженик":         {},
		"Кузнец-оружейник": {},
		"Кузнец-броневик":  {},
		"Ювелир":           {},
		"Магическая лавка": {},
		"Лавка Раввана":    {},
	}

	for i := range cards {
		card := &cards[i]
		// Кожевник: properties cloth or light_armor
		if hasProperty(card, string(PropertyCloth)) || hasProperty(card, string(PropertyLightArmor)) {
			vendors["Кожевник"] = append(vendors["Кожевник"], card)
		}
		// Оруженик: type weapon
		if card.Type != nil && *card.Type == string(ItemTypeWeapon) {
			vendors["Оруженик"] = append(vendors["Оруженик"], card)
		}
		// Кузнец-оружейник: type weapon and tag Воинское
		if card.Type != nil && *card.Type == string(ItemTypeWeapon) && hasTag(card, "Воинское") {
			vendors["Кузнец-оружейник"] = append(vendors["Кузнец-оружейник"], card)
		}
		// Кузнец-броневик: properties medium_armor or heavy_armor or type shield
		if hasProperty(card, string(PropertyMediumArmor)) || hasProperty(card, string(PropertyHeavyArmor)) || (card.Type != nil && *card.Type == string(ItemTypeShield)) {
			vendors["Кузнец-броневик"] = append(vendors["Кузнец-броневик"], card)
		}
		// Ювелир: type ring or necklace
		if (card.Type != nil && *card.Type == string(ItemTypeRing)) || (card.Type != nil && *card.Type == string(ItemTypeNecklace)) {
			vendors["Ювелир"] = append(vendors["Ювелир"], card)
		}
		// Магическая лавка: rarity uncommon and rarer
		if rarityGEUncommon(card.Rarity) {
			vendors["Магическая лавка"] = append(vendors["Магическая лавка"], card)
		}
		// Лавка Раввана: rarity uncommon and rarer (same as Магическая лавка)
		if rarityGEUncommon(card.Rarity) {
			vendors["Лавка Раввана"] = append(vendors["Лавка Раввана"], card)
		}
	}

	// Sampling rules per base shop (used for non-magic vendors)
	baseRules := map[string]string{
		"common":    "1d10+6",
		"uncommon":  "1d6+1",
		"rare":      "1d4-1",
		"very_rare": "1d2-1",
	}
	// Magic shop rules
	magicRules := map[string]string{
		"uncommon":  "1d8+2",
		"rare":      "1d6",
		"very_rare": "1d4-1",
		"artifact":  "1d2-1",
	}
	// Ravva shop rules (4x magic shop quantity)
	ravvaRules := map[string]string{
		"uncommon":  "1d8+2",
		"rare":      "1d6",
		"very_rare": "1d4-1",
		"artifact":  "1d2-1",
	}

	// Helper to select by rarity from a pool
	pickByRarity := func(pool []*Card, r Rarity, count int) []CardResponse {
		res := make([]CardResponse, 0)
		if count <= 0 {
			return res
		}
		// build candidates
		candidates := make([]*Card, 0)
		for _, ccard := range pool {
			if ccard.Rarity == r {
				candidates = append(candidates, ccard)
			}
		}
		// random sample w/o replacement
		rand.Shuffle(len(candidates), func(i, j int) { candidates[i], candidates[j] = candidates[j], candidates[i] })
		if count > len(candidates) {
			count = len(candidates)
		}
		for i := 0; i < count; i++ {
			res = append(res, toCardResponse(*candidates[i]))
		}
		return res
	}

	buildVendor := func(name string, pool []*Card, rules map[string]string, multiplier int) []CardResponse {
		out := make([]CardResponse, 0)
		if len(pool) == 0 {
			return out
		}
		if expr, ok := rules["common"]; ok {
			count := rollDice(expr) * multiplier
			out = append(out, pickByRarity(pool, RarityCommon, count)...)
		}
		if expr, ok := rules["uncommon"]; ok {
			count := rollDice(expr) * multiplier
			out = append(out, pickByRarity(pool, RarityUncommon, count)...)
		}
		if expr, ok := rules["rare"]; ok {
			count := rollDice(expr) * multiplier
			out = append(out, pickByRarity(pool, RarityRare, count)...)
		}
		if expr, ok := rules["very_rare"]; ok {
			count := rollDice(expr) * multiplier
			out = append(out, pickByRarity(pool, RarityVeryRare, count)...)
		}
		if expr, ok := rules["artifact"]; ok {
			count := rollDice(expr) * multiplier
			out = append(out, pickByRarity(pool, RarityArtifact, count)...)
		}
		return out
	}

	result := ShopData{
		Slug:    uuid.New().String(),
		Created: time.Now(),
		Vendors: map[string][]CardResponse{},
	}
	// Build assortments
	for vname, pool := range vendors {
		if vname == "Магическая лавка" {
			result.Vendors[vname] = buildVendor(vname, pool, magicRules, 1)
		} else if vname == "Лавка Раввана" {
			result.Vendors[vname] = buildVendor(vname, pool, ravvaRules, 4)
		} else {
			result.Vendors[vname] = buildVendor(vname, pool, baseRules, 1)
		}
	}

	// Persist to shops table
	raw, err := json.Marshal(result)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка сериализации магазина"})
		return
	}
	// Save with slug and data
	if err := sc.db.Exec("INSERT INTO shops (id, slug, data) VALUES (?, ?, ?)", uuid.New(), result.Slug, raw).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка сохранения магазина"})
		return
	}

	c.JSON(http.StatusOK, result)
}

// GetShop returns stored shop by slug
func (sc *ShopController) GetShop(c *gin.Context) {
	slug := c.Param("slug")
	type row struct{ Data []byte }
	var r row
	if err := sc.db.Raw("SELECT data FROM shops WHERE slug = ?", slug).Scan(&r).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Магазин не найден"})
		return
	}
	var data ShopData
	if err := json.Unmarshal(r.Data, &data); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка чтения магазина"})
		return
	}
	c.JSON(http.StatusOK, data)
}

func toCardResponse(card Card) CardResponse {
	return CardResponse{
		ID:                           card.ID,
		Name:                         card.Name,
		Properties:                   card.Properties,
		Description:                  card.Description,
		DetailedDescription:          card.DetailedDescription,
		ImageURL:                     card.ImageURL,
		Rarity:                       card.Rarity,
		CardNumber:                   card.CardNumber,
		Price:                        card.Price,
		Weight:                       card.Weight,
		BonusType:                    card.BonusType,
		BonusValue:                   card.BonusValue,
		DamageType:                   card.DamageType,
		DefenseType:                  card.DefenseType,
		Type:                         card.Type,
		DescriptionFontSize:          card.DescriptionFontSize,
		TextAlignment:                card.TextAlignment,
		TextFontSize:                 card.TextFontSize,
		ShowDetailedDescription:      card.ShowDetailedDescription,
		DetailedDescriptionAlignment: card.DetailedDescriptionAlignment,
		DetailedDescriptionFontSize:  card.DetailedDescriptionFontSize,
		IsExtended:                   card.IsExtended,
		Tags:                         card.Tags,
		IsTemplate:                   card.IsTemplate,
		Slot:                         card.Slot,
		Effects:                      card.Effects,
		CreatedAt:                    card.CreatedAt,
		UpdatedAt:                    card.UpdatedAt,
	}
}
