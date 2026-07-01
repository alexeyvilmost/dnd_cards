package main

import (
	"net/http"
	"regexp"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ResourceController struct {
	db *gorm.DB
}

func NewResourceController(db *gorm.DB) *ResourceController {
	return &ResourceController{db: db}
}

func validResourceID(id string) bool {
	matched, _ := regexp.MatchString("^[a-zA-Z0-9_-]{1,100}$", id)
	return matched
}

func (rc *ResourceController) GetResources(c *gin.Context) {
	var resources []ResourceDefinition
	query := rc.db.Where("deleted_at IS NULL").Order("sort_order ASC, name ASC")
	if category := c.Query("category"); category != "" {
		query = query.Where("category = ?", category)
	}
	if err := query.Find(&resources).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения ресурсов"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"resources": resources})
}

func (rc *ResourceController) GetResource(c *gin.Context) {
	idParam := c.Param("id")
	var resource ResourceDefinition
	var err error
	if id, parseErr := uuid.Parse(idParam); parseErr == nil {
		err = rc.db.Where("id = ? AND deleted_at IS NULL", id).First(&resource).Error
	} else {
		err = rc.db.Where("resource_id = ? AND deleted_at IS NULL", idParam).First(&resource).Error
	}
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Ресурс не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения ресурса"})
		return
	}
	c.JSON(http.StatusOK, resource)
}

func (rc *ResourceController) CreateResource(c *gin.Context) {
	var req CreateResourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса", "details": err.Error()})
		return
	}
	if !validResourceID(req.ResourceID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID ресурса может содержать только латинские буквы, цифры, дефисы и подчеркивания"})
		return
	}
	if req.Category == "" {
		req.Category = "character"
	}
	resource := ResourceDefinition{
		ResourceID:  req.ResourceID,
		Name:        req.Name,
		Description: req.Description,
		Category:    req.Category,
		ImageURL:    req.ImageURL,
		Recharge:    req.Recharge,
		SortOrder:   req.SortOrder,
	}
	if err := rc.db.Create(&resource).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка создания ресурса", "details": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, resource)
}

func (rc *ResourceController) UpdateResource(c *gin.Context) {
	idParam := c.Param("id")
	var resource ResourceDefinition
	var err error
	if id, parseErr := uuid.Parse(idParam); parseErr == nil {
		err = rc.db.Where("id = ?", id).First(&resource).Error
	} else {
		err = rc.db.Where("resource_id = ?", idParam).First(&resource).Error
	}
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ресурс не найден"})
		return
	}
	var req UpdateResourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса", "details": err.Error()})
		return
	}
	if req.ResourceID != "" {
		if !validResourceID(req.ResourceID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "ID ресурса может содержать только латинские буквы, цифры, дефисы и подчеркивания"})
			return
		}
		resource.ResourceID = req.ResourceID
	}
	if req.Name != "" {
		resource.Name = req.Name
	}
	resource.Description = req.Description
	if req.Category != "" {
		resource.Category = req.Category
	}
	resource.ImageURL = req.ImageURL
	resource.Recharge = req.Recharge
	resource.SortOrder = req.SortOrder
	if err := rc.db.Save(&resource).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обновления ресурса"})
		return
	}
	c.JSON(http.StatusOK, resource)
}

func (rc *ResourceController) DeleteResource(c *gin.Context) {
	idParam := c.Param("id")
	var result *gorm.DB
	if id, parseErr := uuid.Parse(idParam); parseErr == nil {
		result = rc.db.Where("id = ?", id).Delete(&ResourceDefinition{})
	} else {
		result = rc.db.Where("resource_id = ?", idParam).Delete(&ResourceDefinition{})
	}
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка удаления ресурса"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Ресурс не найден"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Ресурс удалён"})
}
