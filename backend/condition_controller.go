package main

import (
	"net/http"
	"regexp"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ConditionController — CRUD справочника состояний (фаза D). Правило состояния —
// данные (self/projected-модификаторы + заметка), а не хардкод в движке.
// См. docs/engine-architecture-review §D2.
type ConditionController struct {
	db *gorm.DB
}

func NewConditionController(db *gorm.DB) *ConditionController {
	return &ConditionController{db: db}
}

func validConditionID(id string) bool {
	matched, _ := regexp.MatchString("^[a-zA-Z0-9_-]{1,100}$", id)
	return matched
}

func (cc *ConditionController) GetConditions(c *gin.Context) {
	var conditions []Condition
	if err := cc.db.Where("deleted_at IS NULL").Order("sort_order ASC, name ASC").Find(&conditions).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения состояний"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"conditions": conditions})
}

func (cc *ConditionController) GetCondition(c *gin.Context) {
	idParam := c.Param("id")
	var condition Condition
	var err error
	if id, parseErr := uuid.Parse(idParam); parseErr == nil {
		err = cc.db.Where("id = ? AND deleted_at IS NULL", id).First(&condition).Error
	} else {
		err = cc.db.Where("condition_id = ? AND deleted_at IS NULL", idParam).First(&condition).Error
	}
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Состояние не найдено"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения состояния"})
		return
	}
	c.JSON(http.StatusOK, condition)
}

func (cc *ConditionController) CreateCondition(c *gin.Context) {
	var req CreateConditionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса", "details": err.Error()})
		return
	}
	if !validConditionID(req.ConditionID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID состояния может содержать только латинские буквы, цифры, дефисы и подчёркивания"})
		return
	}
	condition := Condition{
		ConditionID: req.ConditionID,
		Name:        req.Name,
		Description: req.Description,
		Data:        req.Data,
		ImageURL:    req.ImageURL,
		SortOrder:   req.SortOrder,
	}
	if err := cc.db.Create(&condition).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка создания состояния", "details": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, condition)
}

func (cc *ConditionController) UpdateCondition(c *gin.Context) {
	idParam := c.Param("id")
	var condition Condition
	var err error
	if id, parseErr := uuid.Parse(idParam); parseErr == nil {
		err = cc.db.Where("id = ?", id).First(&condition).Error
	} else {
		err = cc.db.Where("condition_id = ?", idParam).First(&condition).Error
	}
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Состояние не найдено"})
		return
	}
	var req UpdateConditionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса", "details": err.Error()})
		return
	}
	if req.ConditionID != "" {
		if !validConditionID(req.ConditionID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "ID состояния может содержать только латинские буквы, цифры, дефисы и подчёркивания"})
			return
		}
		condition.ConditionID = req.ConditionID
	}
	if req.Name != "" {
		condition.Name = req.Name
	}
	condition.Description = req.Description
	if req.Data != nil {
		condition.Data = req.Data
	}
	condition.ImageURL = req.ImageURL
	condition.SortOrder = req.SortOrder
	if err := cc.db.Save(&condition).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обновления состояния"})
		return
	}
	c.JSON(http.StatusOK, condition)
}

func (cc *ConditionController) DeleteCondition(c *gin.Context) {
	idParam := c.Param("id")
	var result *gorm.DB
	if id, parseErr := uuid.Parse(idParam); parseErr == nil {
		result = cc.db.Where("id = ?", id).Delete(&Condition{})
	} else {
		result = cc.db.Where("condition_id = ?", idParam).Delete(&Condition{})
	}
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка удаления состояния"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Состояние не найдено"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Состояние удалено"})
}
