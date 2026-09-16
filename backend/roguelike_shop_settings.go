package main

import (
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"math"
)

type MerchantLevel struct {
	Level      int `json:"level"`
	Slots      int `json:"slots"`
	MagicLimit int `json:"magic_limit"`
	UncommonBP int `json:"uncommon_bp"`
	RareBP     int `json:"rare_bp"`
	EpicBP     int `json:"epic_bp"`
}
type MerchantConfig struct {
	PoolTag       string          `json:"pool_tag"`
	StartingTag   string          `json:"starting_tag"`
	StapleTag     string          `json:"staple_tag"`
	SuppliesPrice int             `json:"supplies_price"`
	RefreshPrice  int             `json:"refresh_price"`
	Levels        []MerchantLevel `json:"levels"`
}
type MerchantSettings struct {
	ID      int     `json:"-"`
	Version int     `json:"version"`
	Config  JSONMap `json:"config" gorm:"type:jsonb"`
}

func (MerchantSettings) TableName() string { return "roguelike_shop_settings" }

type MerchantItemRule struct {
	CardID   string `json:"card_id" gorm:"type:uuid;primaryKey"`
	MinLevel int    `json:"min_level"`
	Weight   int    `json:"weight"`
	Kind     string `json:"kind"`
	Quantity int    `json:"quantity"`
	Price    *int   `json:"price"`
}

func (MerchantItemRule) TableName() string { return "roguelike_item_rules" }
func validateMerchantConfig(cfg MerchantConfig) error {
	if len(cfg.Levels) != 5 || cfg.SuppliesPrice < 0 || cfg.RefreshPrice < 0 || cfg.SuppliesPrice > 1000000 || cfg.RefreshPrice > 1000000 {
		return fmt.Errorf("Нужны настройки пяти уровней и неотрицательные цены до 1 000 000")
	}
	for _, id := range []string{cfg.PoolTag, cfg.StartingTag, cfg.StapleTag} {
		if _, e := uuid.Parse(id); e != nil {
			return fmt.Errorf("Выберите теги пулов")
		}
	}
	seen := map[int]bool{}
	for _, r := range cfg.Levels {
		if r.Level < 1 || r.Level > 5 || seen[r.Level] || r.Slots < 0 || r.Slots > 40 || r.MagicLimit < 0 || r.MagicLimit > r.Slots || r.UncommonBP < 0 || r.RareBP < 0 || r.EpicBP < 0 || r.UncommonBP+r.RareBP+r.EpicBP > 10000 {
			return fmt.Errorf("Уровни 1–5 без повторов; 0–40 товаров; лимит магических не больше числа товаров; сумма шансов не больше 100%%")
		}
		seen[r.Level] = true
	}
	return nil
}
func (cfg MerchantConfig) level(level int) MerchantLevel {
	if level < 1 {
		level = 1
	}
	if level > 5 {
		level = 5
	}
	for _, row := range cfg.Levels {
		if row.Level == level {
			return row
		}
	}
	return MerchantLevel{}
}
func (r MerchantLevel) rarity(roll int) string {
	if roll < r.EpicBP {
		return "epic"
	}
	if roll < r.EpicBP+r.RareBP {
		return "rare"
	}
	if roll < r.EpicBP+r.RareBP+r.UncommonBP {
		return "uncommon"
	}
	return "common"
}
func loadMerchantConfig(db *gorm.DB) (MerchantConfig, int, error) {
	var s MerchantSettings
	var cfg MerchantConfig
	if err := db.First(&s, 1).Error; err != nil {
		return cfg, 0, err
	}
	if err := decodeJSONMap(s.Config, &cfg); err != nil {
		return cfg, 0, err
	}
	return cfg, s.Version, validateMerchantConfig(cfg)
}
func runCardRule(db *gorm.DB, card Card) (MerchantItemRule, error) {
	r := defaultRunCardRule(card)
	var stored MerchantItemRule
	err := db.Where("card_id=?", card.ID).First(&stored).Error
	if err == nil {
		return stored, nil
	}
	if err != gorm.ErrRecordNotFound {
		return r, err
	}
	return r, nil
}
func defaultRunCardRule(card Card) MerchantItemRule {
	r := MerchantItemRule{CardID: card.ID.String(), MinLevel: 1, Weight: 1, Quantity: 1, Kind: "equipment"}
	if card.Rarity != "common" {
		r.Kind = "magic"
	} else if hasProperty(&card, "consumable") {
		r.Kind = "consumable"
	}
	return r
}

type taggedMerchantItem struct {
	Card Card
	Rule MerchantItemRule
}

func taggedMerchantItems(db *gorm.DB, tag string) ([]taggedMerchantItem, error) {
	cards, err := taggedRunCards(db, tag)
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for _, card := range cards {
		ids = append(ids, card.ID.String())
	}
	rules := []MerchantItemRule{}
	if len(ids) > 0 {
		if err = db.Where("card_id IN ?", ids).Find(&rules).Error; err != nil {
			return nil, err
		}
	}
	byID := map[string]MerchantItemRule{}
	for _, rule := range rules {
		byID[rule.CardID] = rule
	}
	result := []taggedMerchantItem{}
	for _, card := range cards {
		rule, ok := byID[card.ID.String()]
		if !ok {
			rule = defaultRunCardRule(card)
		}
		result = append(result, taggedMerchantItem{card, rule})
	}
	return result, nil
}
func runCardPrice(card Card, rule MerchantItemRule) (int, error) {
	if rule.Price != nil {
		if *rule.Price < 0 || *rule.Price > 1000000 {
			return 0, fmt.Errorf("Недопустимая цена товара")
		}
		return *rule.Price * 100, nil
	}
	if card.Price == nil || *card.Price < 0 {
		return 0, fmt.Errorf("У предмета %s не задана цена", card.CardNumber)
	}
	factor := 100.0
	if card.PriceCurrency != nil {
		switch *card.PriceCurrency {
		case "", "gold":
		case "silver":
			factor = 10
		case "copper":
			factor = 1
		case "platinum":
			factor = 1000
		default:
			return 0, fmt.Errorf("Неизвестная валюта %s", *card.PriceCurrency)
		}
	}
	// Price is stored in copper, without rounding up to a whole gold piece.
	price := math.Ceil(*card.Price*factor*float64(rule.Quantity) - 1e-8)
	if math.IsNaN(price) || math.IsInf(price, 0) || price < 0 || price > 100000000 {
		return 0, fmt.Errorf("Цена пачки должна быть от 0 до 1 000 000 зм")
	}
	return int(price), nil
}
func runPoolEntries(db *gorm.DB, tag string) ([]roguelikeShopManifestEntry, map[string]Card, error) {
	items, err := taggedMerchantItems(db, tag)
	if err != nil {
		return nil, nil, err
	}
	entries := []roguelikeShopManifestEntry{}
	byNumber := map[string]Card{}
	for _, item := range items {
		card, rule := item.Card, item.Rule
		price, e := runCardPrice(card, rule)
		if e != nil {
			return nil, nil, e
		}
		entries = append(entries, roguelikeShopManifestEntry{card.CardNumber, price, rule.MinLevel, rule.Weight, rule.Kind})
		byNumber[card.CardNumber] = card
	}
	return entries, byNumber, nil
}
func registerRoguelikeShopSettingsRoutes(api *gin.RouterGroup, auth *AuthService, db *gorm.DB) {
	api.GET("/roguelike/shop-settings", AuthMiddleware(auth), func(c *gin.Context) {
		cfg, version, err := loadMerchantConfig(db)
		if err != nil {
			writeRoguelikeError(c, err)
			return
		}
		c.JSON(200, gin.H{"config": cfg, "version": version, "can_manage": canManageEntityTags(c)})
	})
	api.PUT("/roguelike/shop-settings", ContentAdminAuthMiddleware(auth), JSONBodyLimitMiddleware(32<<10), func(c *gin.Context) {
		var req struct {
			Config  MerchantConfig `json:"config"`
			Version int            `json:"version"`
		}
		if c.ShouldBindJSON(&req) != nil {
			c.JSON(400, gin.H{"error": "Некорректные настройки"})
			return
		}
		if err := validateMerchantConfig(req.Config); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		err := db.Transaction(func(tx *gorm.DB) error {
			for _, id := range []string{req.Config.PoolTag, req.Config.StartingTag, req.Config.StapleTag} {
				var n int64
				if e := tx.Model(&EntityTag{}).Where("id=?", id).Count(&n).Error; e != nil {
					return e
				}
				if n != 1 {
					return roguelikeError(400, "missing_tag", "Тег не найден")
				}
			}
			data, _ := json.Marshal(req.Config)
			result := tx.Model(&MerchantSettings{}).Where("id=1 AND version=?", req.Version).Updates(map[string]any{"config": string(data), "version": req.Version + 1})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return roguelikeError(409, "settings_conflict", "Настройки уже изменены. Загрузите актуальную версию.")
			}
			return nil
		})
		if err != nil {
			writeRoguelikeError(c, err)
			return
		}
		c.JSON(200, gin.H{"config": req.Config, "version": req.Version + 1, "can_manage": true})
	})
	api.GET("/roguelike/item-rules/:id", AuthMiddleware(auth), func(c *gin.Context) {
		var card Card
		if db.Where("id::text=?", c.Param("id")).First(&card).Error != nil {
			c.JSON(404, gin.H{"error": "Предмет не найден"})
			return
		}
		r, err := runCardRule(db, card)
		if err != nil {
			writeRoguelikeError(c, err)
			return
		}
		c.JSON(200, r)
	})
	api.PUT("/roguelike/item-rules/:id", ContentAdminAuthMiddleware(auth), JSONBodyLimitMiddleware(16<<10), func(c *gin.Context) {
		var r MerchantItemRule
		if c.ShouldBindJSON(&r) != nil || r.MinLevel < 1 || r.MinLevel > 5 || r.Weight < 1 || r.Weight > 1000 || r.Quantity < 1 || r.Quantity > 1000 || (r.Price != nil && (*r.Price < 0 || *r.Price > 1000000)) || (r.Kind != "equipment" && r.Kind != "consumable" && r.Kind != "magic") {
			c.JSON(400, gin.H{"error": "Некорректные параметры товара"})
			return
		}
		r.CardID = c.Param("id")
		err := db.Transaction(func(tx *gorm.DB) error {
			if e := validateTaggedEntity(tx, "card", r.CardID, true); e != nil {
				return e
			}
			return tx.Save(&r).Error
		})
		if err != nil {
			writeRoguelikeError(c, err)
			return
		}
		c.JSON(200, r)
	})
}
