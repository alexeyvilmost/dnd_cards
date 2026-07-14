package main

import (
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ClassController struct {
	db *gorm.DB
}

func NewClassController(db *gorm.DB) *ClassController { return &ClassController{db: db} }

func (cc *ClassController) GetClasses(c *gin.Context) {
	var classes []Class
	query := cc.db.Model(&Class{})

	if search := c.Query("search"); search != "" {
		query = query.Where("name ILIKE ? OR card_number = ?", "%"+search+"%", search)
	}

	if parent := c.Query("parent_class_id"); parent != "" {
		query = query.Where("parent_class_id = ?", parent)
	}
	if isSub := c.Query("is_subclass"); isSub != "" {
		if isSub == "true" {
			query = query.Where("is_subclass = ?", true)
		} else {
			query = query.Where("(is_subclass = ? OR is_subclass IS NULL)", false)
		}
	}

	page, limit, offset := parseListPagination(c)

	var total int64
	query.Count(&total)

	sortClause := "name ASC"
	if c.Query("sort_by") == "created_desc" {
		sortClause = "created_at DESC"
	}
	if err := query.Order(sortClause).Offset(offset).Limit(limit).Find(&classes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения классов"})
		return
	}

	responses := make([]ClassResponse, 0)
	for _, cl := range classes {
		responses = append(responses, cl.ToClassResponse())
	}
	c.JSON(http.StatusOK, gin.H{"classes": responses, "total": total, "page": page, "limit": limit})
}

func (cc *ClassController) GetClass(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID класса"})
		return
	}
	var cl Class
	if err := cc.db.Where("id = ?", id).First(&cl).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Класс не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения класса"})
		return
	}
	c.JSON(http.StatusOK, cl.ToClassResponse())
}

func (cc *ClassController) CreateClass(c *gin.Context) {
	var req CreateClassRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}
	if req.Rarity == "" {
		req.Rarity = RarityCommon
	}

	cardNumber := req.CardNumber
	if cardNumber == "" {
		cardNumber = generateNumber(cc.db, &Class{}, "CLASS")
	} else {
		var existing Class
		if err := cc.db.Where("card_number = ?", cardNumber).First(&existing).Error; err == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Класс с таким ID уже существует"})
			return
		}
		if !cardNumberRe.MatchString(cardNumber) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый ID"})
			return
		}
	}

	cl := Class{
		Name: req.Name, NameEn: req.NameEn, Description: req.Description, DetailedDescription: req.DetailedDescription,
		ImageURL: req.ImageURL, Rarity: req.Rarity, CardNumber: cardNumber, HitDie: req.HitDie,
		PrimaryAbilities: req.PrimaryAbilities, RecommendedAbilities: req.RecommendedAbilities,
		SavingThrows: req.SavingThrows, ArmorTraining: req.ArmorTraining,
		WeaponProficiencies: req.WeaponProficiencies, ToolProficiencies: req.ToolProficiencies,
		SkillChoices: req.SkillChoices, StartingEquipment: req.StartingEquipment,
		EquipmentOptions: req.EquipmentOptions,
		LevelProgression: req.LevelProgression, Resources: req.Resources,
		IsSubclass: req.IsSubclass, ParentClassID: req.ParentClassID, SubclassLevel: req.SubclassLevel,
		RelatedEffects: req.RelatedEffects, RelatedActions: req.RelatedActions,
		Type: req.Type, Author: req.Author, Source: req.Source, Tags: req.Tags, IsExtended: req.IsExtended,
	}
	if cl.Author == "" {
		cl.Author = "Admin"
	}
	if err := cc.db.Create(&cl).Error; err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Класс с таким ID уже существует"})
			return
		}
		log.Printf("Ошибка создания класса: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Ошибка создания класса: %v", err)})
		return
	}
	c.JSON(http.StatusCreated, cl.ToClassResponse())
}

func (cc *ClassController) UpdateClass(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID класса"})
		return
	}
	var req UpdateClassRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}
	var cl Class
	if err := cc.db.Where("id = ?", id).First(&cl).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Класс не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения класса"})
		return
	}

	if req.Name != "" {
		cl.Name = req.Name
	}
	cl.NameEn = req.NameEn
	if req.Description != "" {
		cl.Description = req.Description
	}
	if req.DetailedDescription != nil {
		cl.DetailedDescription = req.DetailedDescription
	}
	if req.ImageURL != "" {
		cl.ImageURL = req.ImageURL
	}
	if req.Rarity != "" && IsValidRarity(req.Rarity) {
		cl.Rarity = req.Rarity
	}
	if req.HitDie != nil {
		cl.HitDie = req.HitDie
	}
	if req.PrimaryAbilities != nil {
		cl.PrimaryAbilities = req.PrimaryAbilities
	}
	if req.RecommendedAbilities != nil {
		cl.RecommendedAbilities = req.RecommendedAbilities
	}
	if req.SavingThrows != nil {
		cl.SavingThrows = req.SavingThrows
	}
	if req.ArmorTraining != nil {
		cl.ArmorTraining = req.ArmorTraining
	}
	if req.WeaponProficiencies != nil {
		cl.WeaponProficiencies = req.WeaponProficiencies
	}
	if req.ToolProficiencies != nil {
		cl.ToolProficiencies = req.ToolProficiencies
	}
	if req.SkillChoices != nil {
		cl.SkillChoices = req.SkillChoices
	}
	if req.StartingEquipment != nil {
		cl.StartingEquipment = req.StartingEquipment
	}
	if req.EquipmentOptions != nil {
		cl.EquipmentOptions = req.EquipmentOptions
	}
	if req.LevelProgression != nil {
		cl.LevelProgression = req.LevelProgression
	}
	if req.Resources != nil {
		cl.Resources = req.Resources
	}
	if req.IsSubclass != nil {
		cl.IsSubclass = req.IsSubclass
		if !*req.IsSubclass {
			cl.ParentClassID = nil
		}
	}
	if req.ParentClassID != nil {
		cl.ParentClassID = req.ParentClassID
	}
	if req.SubclassLevel != nil {
		cl.SubclassLevel = req.SubclassLevel
	}
	if req.RelatedEffects != nil {
		cl.RelatedEffects = req.RelatedEffects
	}
	if req.RelatedActions != nil {
		cl.RelatedActions = req.RelatedActions
	}
	if req.Type != nil {
		cl.Type = req.Type
	}
	if req.Author != "" {
		cl.Author = req.Author
	}
	if req.Source != nil {
		cl.Source = req.Source
	}
	if req.Tags != nil {
		cl.Tags = req.Tags
	}
	if req.IsExtended != nil {
		cl.IsExtended = req.IsExtended
	}

	if err := cc.db.Save(&cl).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обновления класса"})
		return
	}
	c.JSON(http.StatusOK, cl.ToClassResponse())
}

func (cc *ClassController) DeleteClass(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID класса"})
		return
	}
	if err := cc.db.Delete(&Class{}, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка удаления класса"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Класс удалён"})
}
