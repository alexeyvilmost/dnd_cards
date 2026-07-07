package main

import (
	"net/http"
	"regexp"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ConceptController — CRUD справочника «понятий» (глоссарий): пояснения, которые не
// выражаются отдельной сущностью (напр. «Спасбросок»). Понятие = name + описание +
// иконка; на него можно ссылаться из текстов ([[label|concept:slug]]). Аналог переменных.
type ConceptController struct {
	db *gorm.DB
}

func NewConceptController(db *gorm.DB) *ConceptController {
	return &ConceptController{db: db}
}

func validConceptID(id string) bool {
	matched, _ := regexp.MatchString("^[a-zA-Z0-9_-]{1,100}$", id)
	return matched
}

func (cc *ConceptController) GetConcepts(c *gin.Context) {
	var concepts []ConceptEntity
	query := cc.db.Where("deleted_at IS NULL").Order("sort_order ASC, name ASC")
	if err := query.Find(&concepts).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения понятий"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"concepts": concepts})
}

func (cc *ConceptController) GetConcept(c *gin.Context) {
	idParam := c.Param("id")
	var concept ConceptEntity
	var err error
	if id, parseErr := uuid.Parse(idParam); parseErr == nil {
		err = cc.db.Where("id = ? AND deleted_at IS NULL", id).First(&concept).Error
	} else {
		err = cc.db.Where("concept_id = ? AND deleted_at IS NULL", idParam).First(&concept).Error
	}
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Понятие не найдено"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения понятия"})
		return
	}
	c.JSON(http.StatusOK, concept)
}

func (cc *ConceptController) CreateConcept(c *gin.Context) {
	var req CreateConceptRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса", "details": err.Error()})
		return
	}
	if !validConceptID(req.ConceptID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID понятия может содержать только латинские буквы, цифры, дефисы и подчёркивания"})
		return
	}
	concept := ConceptEntity{
		ConceptID:   req.ConceptID,
		Name:        req.Name,
		Description: req.Description,
		ImageURL:    req.ImageURL,
		SortOrder:   req.SortOrder,
	}
	if err := cc.db.Create(&concept).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка создания понятия", "details": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, concept)
}

func (cc *ConceptController) UpdateConcept(c *gin.Context) {
	idParam := c.Param("id")
	var concept ConceptEntity
	var err error
	if id, parseErr := uuid.Parse(idParam); parseErr == nil {
		err = cc.db.Where("id = ?", id).First(&concept).Error
	} else {
		err = cc.db.Where("concept_id = ?", idParam).First(&concept).Error
	}
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Понятие не найдено"})
		return
	}
	var req UpdateConceptRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса", "details": err.Error()})
		return
	}
	if req.ConceptID != "" {
		if !validConceptID(req.ConceptID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "ID понятия может содержать только латинские буквы, цифры, дефисы и подчёркивания"})
			return
		}
		concept.ConceptID = req.ConceptID
	}
	if req.Name != "" {
		concept.Name = req.Name
	}
	concept.Description = req.Description
	concept.ImageURL = req.ImageURL
	concept.SortOrder = req.SortOrder
	if err := cc.db.Save(&concept).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обновления понятия"})
		return
	}
	c.JSON(http.StatusOK, concept)
}

func (cc *ConceptController) DeleteConcept(c *gin.Context) {
	idParam := c.Param("id")
	var result *gorm.DB
	if id, parseErr := uuid.Parse(idParam); parseErr == nil {
		result = cc.db.Where("id = ?", id).Delete(&ConceptEntity{})
	} else {
		result = cc.db.Where("concept_id = ?", idParam).Delete(&ConceptEntity{})
	}
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка удаления понятия"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Понятие не найдено"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Понятие удалено"})
}
