package main

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// RaceController - контроллер для работы с видами (расами)
type RaceController struct {
	db *gorm.DB
}

func NewRaceController(db *gorm.DB) *RaceController { return &RaceController{db: db} }

func (rc *RaceController) GetRaces(c *gin.Context) {
	var races []Race
	query := rc.db.Model(&Race{})

	if size := c.Query("size"); size != "" {
		query = query.Where("size ILIKE ?", "%"+size+"%")
	}
	if creatureType := c.Query("creature_type"); creatureType != "" {
		query = query.Where("creature_type ILIKE ?", "%"+creatureType+"%")
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
	if err := query.Order(sortClause).Offset(offset).Limit(limit).Find(&races).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения видов"})
		return
	}

	responses := make([]RaceResponse, 0)
	for _, r := range races {
		responses = append(responses, r.ToRaceResponse())
	}
	c.JSON(http.StatusOK, gin.H{"races": responses, "total": total, "page": page, "limit": limit})
}

func (rc *RaceController) GetRace(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID вида"})
		return
	}
	var r Race
	if err := rc.db.Where("id = ?", id).First(&r).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Вид не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения вида"})
		return
	}
	c.JSON(http.StatusOK, r.ToRaceResponse())
}

func (rc *RaceController) CreateRace(c *gin.Context) {
	var req CreateRaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}
	if req.Rarity == "" {
		req.Rarity = RarityCommon
	}

	cardNumber := req.CardNumber
	if cardNumber == "" {
		cardNumber = generateNumber(rc.db, &Race{}, "RACE")
	} else {
		var existing Race
		if err := rc.db.Where("card_number = ?", cardNumber).First(&existing).Error; err == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Вид с таким ID уже существует"})
			return
		}
		if !cardNumberRe.MatchString(cardNumber) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Недопустимый ID"})
			return
		}
	}

	r := Race{
		Name: req.Name, Description: req.Description, DetailedDescription: req.DetailedDescription,
		ImageURL: req.ImageURL, Rarity: req.Rarity, CardNumber: cardNumber,
		CreatureType: req.CreatureType, Size: req.Size, Speed: req.Speed, ExtraSpeeds: req.ExtraSpeeds,
		Darkvision: req.Darkvision, Traits: req.Traits, Lineages: req.Lineages,
		RelatedEffects: req.RelatedEffects, RelatedActions: req.RelatedActions, LevelProgression: req.LevelProgression,
		Type: req.Type, Author: req.Author, Source: req.Source, Tags: req.Tags, IsExtended: req.IsExtended,
	}
	if r.Author == "" {
		r.Author = "Admin"
	}
	if err := rc.db.Create(&r).Error; err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Вид с таким ID уже существует"})
			return
		}
		log.Printf("Ошибка создания вида: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Ошибка создания вида: %v", err)})
		return
	}
	c.JSON(http.StatusCreated, r.ToRaceResponse())
}

func (rc *RaceController) UpdateRace(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID вида"})
		return
	}
	var req UpdateRaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса"})
		return
	}
	var r Race
	if err := rc.db.Where("id = ?", id).First(&r).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Вид не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения вида"})
		return
	}
	if req.Name != "" {
		r.Name = req.Name
	}
	if req.Description != "" {
		r.Description = req.Description
	}
	if req.DetailedDescription != nil {
		r.DetailedDescription = req.DetailedDescription
	}
	if req.ImageURL != "" {
		r.ImageURL = req.ImageURL
	}
	if req.Rarity != "" && IsValidRarity(req.Rarity) {
		r.Rarity = req.Rarity
	}
	if req.CreatureType != nil {
		r.CreatureType = req.CreatureType
	}
	if req.Size != nil {
		r.Size = req.Size
	}
	if req.Speed != nil {
		r.Speed = req.Speed
	}
	if req.ExtraSpeeds != nil {
		r.ExtraSpeeds = req.ExtraSpeeds
	}
	if req.Darkvision != nil {
		r.Darkvision = req.Darkvision
	}
	if req.Traits != nil {
		r.Traits = req.Traits
	}
	if req.Lineages != nil {
		r.Lineages = req.Lineages
	}
	if req.RelatedEffects != nil {
		r.RelatedEffects = req.RelatedEffects
	}
	if req.RelatedActions != nil {
		r.RelatedActions = req.RelatedActions
	}
	if req.LevelProgression != nil {
		r.LevelProgression = req.LevelProgression
	}
	if req.Type != nil {
		r.Type = req.Type
	}
	if req.Author != "" {
		r.Author = req.Author
	}
	if req.Source != nil {
		r.Source = req.Source
	}
	if req.Tags != nil {
		r.Tags = req.Tags
	}
	if req.IsExtended != nil {
		r.IsExtended = req.IsExtended
	}
	if err := rc.db.Save(&r).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обновления вида"})
		return
	}
	c.JSON(http.StatusOK, r.ToRaceResponse())
}

func (rc *RaceController) DeleteRace(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID вида"})
		return
	}
	if err := rc.db.Delete(&Race{}, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка удаления вида"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Вид удалён"})
}
