package main

import (
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var cardNumberRe = regexp.MustCompile("^[a-zA-Z0-9_-]{1,30}$")

// ─── FeatController ───────────────────────────────────────────────────────────

type FeatController struct {
	db *gorm.DB
}

func NewFeatController(db *gorm.DB) *FeatController { return &FeatController{db: db} }

func (fc *FeatController) GetFeats(c *gin.Context) {
	var feats []Feat
	query := fc.db.Model(&Feat{})

	if category := c.Query("category"); category != "" {
		query = query.Where("category = ?", category)
	}
	if repeatable := c.Query("repeatable"); repeatable == "true" || repeatable == "false" {
		query = query.Where("repeatable = ?", repeatable == "true")
	}
	if ability := c.Query("ability"); ability != "" {
		query = query.Where("ability_increase::text ILIKE ?", "%"+ability+"%")
	}
	if search := c.Query("search"); search != "" {
		query = query.Where("name ILIKE ? OR card_number = ?", "%"+search+"%", search)
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset := (page - 1) * limit

	var total int64
	query.Count(&total)

	sortClause := "name ASC"
	if c.Query("sort_by") == "created_desc" {
		sortClause = "created_at DESC"
	}
	if err := query.Order(sortClause).Offset(offset).Limit(limit).Find(&feats).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения черт"})
		return
	}

	responses := make([]FeatResponse, 0)
	for _, f := range feats {
		responses = append(responses, f.ToFeatResponse())
	}
	c.JSON(http.StatusOK, gin.H{"feats": responses, "total": total, "page": page, "limit": limit})
}

func (fc *FeatController) GetFeat(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID черты"})
		return
	}
	var f Feat
	if err := fc.db.Where("id = ?", id).First(&f).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Черта не найдена"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения черты"})
		return
	}
	c.JSON(http.StatusOK, f.ToFeatResponse())
}

func (fc *FeatController) CreateFeat(c *gin.Context) {
	var req CreateFeatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}
	if req.Rarity == "" {
		req.Rarity = RarityCommon
	}
	if req.Category == "" {
		req.Category = FeatGeneral
	}

	cardNumber := req.CardNumber
	if cardNumber == "" {
		cardNumber = generateNumber(fc.db, &Feat{}, "FEAT")
	} else {
		var existing Feat
		if err := fc.db.Where("card_number = ?", cardNumber).First(&existing).Error; err == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Черта с таким ID уже существует"})
			return
		}
		if !cardNumberRe.MatchString(cardNumber) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый ID"})
			return
		}
	}

	f := Feat{
		Name: req.Name, Description: req.Description, DetailedDescription: req.DetailedDescription,
		ImageURL: req.ImageURL, Rarity: req.Rarity, CardNumber: cardNumber, Category: req.Category,
		Prerequisite: req.Prerequisite, AbilityIncrease: req.AbilityIncrease, Repeatable: req.Repeatable,
		Type: req.Type, Author: req.Author, Source: req.Source, Tags: req.Tags, IsExtended: req.IsExtended,
	}
	if f.Author == "" {
		f.Author = "Admin"
	}
	if err := fc.db.Create(&f).Error; err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Черта с таким ID уже существует"})
			return
		}
		log.Printf("Ошибка создания черты: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Ошибка создания черты: %v", err)})
		return
	}
	c.JSON(http.StatusCreated, f.ToFeatResponse())
}

func (fc *FeatController) UpdateFeat(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID черты"})
		return
	}
	var req UpdateFeatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}
	var f Feat
	if err := fc.db.Where("id = ?", id).First(&f).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Черта не найдена"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения черты"})
		return
	}
	if req.Name != "" {
		f.Name = req.Name
	}
	if req.Description != "" {
		f.Description = req.Description
	}
	if req.DetailedDescription != nil {
		f.DetailedDescription = req.DetailedDescription
	}
	if req.ImageURL != "" {
		f.ImageURL = req.ImageURL
	}
	if req.Rarity != "" && IsValidRarity(req.Rarity) {
		f.Rarity = req.Rarity
	}
	if req.Category != "" {
		f.Category = req.Category
	}
	if req.Prerequisite != nil {
		f.Prerequisite = req.Prerequisite
	}
	if req.AbilityIncrease != nil {
		f.AbilityIncrease = req.AbilityIncrease
	}
	if req.Repeatable != nil {
		f.Repeatable = *req.Repeatable
	}
	if req.Type != nil {
		f.Type = req.Type
	}
	if req.Author != "" {
		f.Author = req.Author
	}
	if req.Source != nil {
		f.Source = req.Source
	}
	if req.Tags != nil {
		f.Tags = req.Tags
	}
	if req.IsExtended != nil {
		f.IsExtended = req.IsExtended
	}
	if err := fc.db.Save(&f).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обновления черты"})
		return
	}
	c.JSON(http.StatusOK, f.ToFeatResponse())
}

func (fc *FeatController) DeleteFeat(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID черты"})
		return
	}
	if err := fc.db.Delete(&Feat{}, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка удаления черты"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Черта удалена"})
}

// ─── BackgroundController ─────────────────────────────────────────────────────

type BackgroundController struct {
	db *gorm.DB
}

func NewBackgroundController(db *gorm.DB) *BackgroundController { return &BackgroundController{db: db} }

func (bc *BackgroundController) GetBackgrounds(c *gin.Context) {
	var backgrounds []Background
	query := bc.db.Model(&Background{})

	if ability := c.Query("ability"); ability != "" {
		query = query.Where("ability_scores::text ILIKE ?", "%"+ability+"%")
	}
	if skill := c.Query("skill"); skill != "" {
		query = query.Where("skill_proficiencies::text ILIKE ?", "%"+skill+"%")
	}
	if feat := c.Query("feat"); feat != "" {
		query = query.Where("origin_feat ILIKE ?", "%"+feat+"%")
	}
	if search := c.Query("search"); search != "" {
		query = query.Where("name ILIKE ? OR card_number = ?", "%"+search+"%", search)
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset := (page - 1) * limit

	var total int64
	query.Count(&total)

	sortClause := "name ASC"
	if c.Query("sort_by") == "created_desc" {
		sortClause = "created_at DESC"
	}
	if err := query.Order(sortClause).Offset(offset).Limit(limit).Find(&backgrounds).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения предысторий"})
		return
	}

	responses := make([]BackgroundResponse, 0)
	for _, b := range backgrounds {
		responses = append(responses, b.ToBackgroundResponse())
	}
	c.JSON(http.StatusOK, gin.H{"backgrounds": responses, "total": total, "page": page, "limit": limit})
}

func (bc *BackgroundController) GetBackground(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID предыстории"})
		return
	}
	var b Background
	if err := bc.db.Where("id = ?", id).First(&b).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Предыстория не найдена"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения предыстории"})
		return
	}
	c.JSON(http.StatusOK, b.ToBackgroundResponse())
}

func (bc *BackgroundController) CreateBackground(c *gin.Context) {
	var req CreateBackgroundRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}
	if req.Rarity == "" {
		req.Rarity = RarityCommon
	}

	cardNumber := req.CardNumber
	if cardNumber == "" {
		cardNumber = generateNumber(bc.db, &Background{}, "BG")
	} else {
		var existing Background
		if err := bc.db.Where("card_number = ?", cardNumber).First(&existing).Error; err == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Предыстория с таким ID уже существует"})
			return
		}
		if !cardNumberRe.MatchString(cardNumber) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый ID"})
			return
		}
	}

	b := Background{
		Name: req.Name, Description: req.Description, DetailedDescription: req.DetailedDescription,
		ImageURL: req.ImageURL, Rarity: req.Rarity, CardNumber: cardNumber, AbilityScores: req.AbilityScores,
		OriginFeat: req.OriginFeat, SkillProficiencies: req.SkillProficiencies, ToolProficiency: req.ToolProficiency,
		Equipment: req.Equipment, Type: req.Type, Author: req.Author, Source: req.Source, Tags: req.Tags,
		IsExtended: req.IsExtended,
	}
	if b.Author == "" {
		b.Author = "Admin"
	}
	if err := bc.db.Create(&b).Error; err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Предыстория с таким ID уже существует"})
			return
		}
		log.Printf("Ошибка создания предыстории: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Ошибка создания предыстории: %v", err)})
		return
	}
	c.JSON(http.StatusCreated, b.ToBackgroundResponse())
}

func (bc *BackgroundController) UpdateBackground(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID предыстории"})
		return
	}
	var req UpdateBackgroundRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}
	var b Background
	if err := bc.db.Where("id = ?", id).First(&b).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Предыстория не найдена"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения предыстории"})
		return
	}
	if req.Name != "" {
		b.Name = req.Name
	}
	if req.Description != "" {
		b.Description = req.Description
	}
	if req.DetailedDescription != nil {
		b.DetailedDescription = req.DetailedDescription
	}
	if req.ImageURL != "" {
		b.ImageURL = req.ImageURL
	}
	if req.Rarity != "" && IsValidRarity(req.Rarity) {
		b.Rarity = req.Rarity
	}
	if req.AbilityScores != nil {
		b.AbilityScores = req.AbilityScores
	}
	if req.OriginFeat != nil {
		b.OriginFeat = req.OriginFeat
	}
	if req.SkillProficiencies != nil {
		b.SkillProficiencies = req.SkillProficiencies
	}
	if req.ToolProficiency != nil {
		b.ToolProficiency = req.ToolProficiency
	}
	if req.Equipment != nil {
		b.Equipment = req.Equipment
	}
	if req.Type != nil {
		b.Type = req.Type
	}
	if req.Author != "" {
		b.Author = req.Author
	}
	if req.Source != nil {
		b.Source = req.Source
	}
	if req.Tags != nil {
		b.Tags = req.Tags
	}
	if req.IsExtended != nil {
		b.IsExtended = req.IsExtended
	}
	if err := bc.db.Save(&b).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обновления предыстории"})
		return
	}
	c.JSON(http.StatusOK, b.ToBackgroundResponse())
}

func (bc *BackgroundController) DeleteBackground(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID предыстории"})
		return
	}
	if err := bc.db.Delete(&Background{}, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка удаления предыстории"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Предыстория удалена"})
}

// generateNumber генерирует card_number вида PREFIX-NNNN для переданной модели.
func generateNumber(db *gorm.DB, model interface{}, prefix string) string {
	type row struct{ CardNumber string }
	var r row
	db.Unscoped().Model(model).
		Where("card_number LIKE ?", prefix+"-%").
		Order("card_number DESC").
		Limit(1).
		Scan(&r)

	next := 1
	pfx := prefix + "-"
	if strings.HasPrefix(r.CardNumber, pfx) {
		if n, err := strconv.Atoi(strings.TrimPrefix(r.CardNumber, pfx)); err == nil {
			next = n + 1
		}
	}
	return fmt.Sprintf("%s-%04d", prefix, next)
}
