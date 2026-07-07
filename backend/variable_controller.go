package main

import (
	"net/http"
	"regexp"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// VariableController — CRUD справочника переменных (числовых/dice), выдаваемых
// классами/подклассами/эффектами и доступных в формулах. См. docs/variables.md.
type VariableController struct {
	db *gorm.DB
}

func NewVariableController(db *gorm.DB) *VariableController {
	return &VariableController{db: db}
}

func validVariableID(id string) bool {
	matched, _ := regexp.MatchString("^[a-zA-Z0-9_-]{1,100}$", id)
	return matched
}

func (vc *VariableController) GetVariables(c *gin.Context) {
	var variables []Variable
	query := vc.db.Where("deleted_at IS NULL").Order("sort_order ASC, name ASC")
	if varType := c.Query("var_type"); varType != "" {
		query = query.Where("var_type = ?", varType)
	}
	if err := query.Find(&variables).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения переменных"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"variables": variables})
}

func (vc *VariableController) GetVariable(c *gin.Context) {
	idParam := c.Param("id")
	var variable Variable
	var err error
	if id, parseErr := uuid.Parse(idParam); parseErr == nil {
		err = vc.db.Where("id = ? AND deleted_at IS NULL", id).First(&variable).Error
	} else {
		err = vc.db.Where("variable_id = ? AND deleted_at IS NULL", idParam).First(&variable).Error
	}
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Переменная не найдена"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения переменной"})
		return
	}
	c.JSON(http.StatusOK, variable)
}

func (vc *VariableController) CreateVariable(c *gin.Context) {
	var req CreateVariableRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса", "details": err.Error()})
		return
	}
	if !validVariableID(req.VariableID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID переменной может содержать только латинские буквы, цифры, дефисы и подчёркивания"})
		return
	}
	if req.VarType == "" {
		req.VarType = "number"
	}
	variable := Variable{
		VariableID:   req.VariableID,
		Name:         req.Name,
		Description:  req.Description,
		VarType:      req.VarType,
		DefaultValue: req.DefaultValue,
		ImageURL:     req.ImageURL,
		SortOrder:    req.SortOrder,
	}
	if err := vc.db.Create(&variable).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка создания переменной", "details": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, variable)
}

func (vc *VariableController) UpdateVariable(c *gin.Context) {
	idParam := c.Param("id")
	var variable Variable
	var err error
	if id, parseErr := uuid.Parse(idParam); parseErr == nil {
		err = vc.db.Where("id = ?", id).First(&variable).Error
	} else {
		err = vc.db.Where("variable_id = ?", idParam).First(&variable).Error
	}
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Переменная не найдена"})
		return
	}
	var req UpdateVariableRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса", "details": err.Error()})
		return
	}
	if req.VariableID != "" {
		if !validVariableID(req.VariableID) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "ID переменной может содержать только латинские буквы, цифры, дефисы и подчёркивания"})
			return
		}
		variable.VariableID = req.VariableID
	}
	if req.Name != "" {
		variable.Name = req.Name
	}
	variable.Description = req.Description
	if req.VarType != "" {
		variable.VarType = req.VarType
	}
	variable.DefaultValue = req.DefaultValue
	variable.ImageURL = req.ImageURL
	variable.SortOrder = req.SortOrder
	if err := vc.db.Save(&variable).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка обновления переменной"})
		return
	}
	c.JSON(http.StatusOK, variable)
}

func (vc *VariableController) DeleteVariable(c *gin.Context) {
	idParam := c.Param("id")
	var result *gorm.DB
	if id, parseErr := uuid.Parse(idParam); parseErr == nil {
		result = vc.db.Where("id = ?", id).Delete(&Variable{})
	} else {
		result = vc.db.Where("variable_id = ?", idParam).Delete(&Variable{})
	}
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка удаления переменной"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Переменная не найдена"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Переменная удалена"})
}
