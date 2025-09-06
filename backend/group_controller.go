package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// GroupController - контроллер для работы с группами
type GroupController struct {
	db *gorm.DB
}

// NewGroupController - создание нового контроллера групп
func NewGroupController(db *gorm.DB) *GroupController {
	return &GroupController{db: db}
}

// CreateGroup - создание новой группы
func (gc *GroupController) CreateGroup(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	var req CreateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные запроса: " + err.Error()})
		return
	}

	// Создаем группу
	group := Group{
		Name:        req.Name,
		Description: req.Description,
		DMID:        userID, // Создатель группы становится ДМом
	}

	if err := gc.db.Create(&group).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка создания группы"})
		return
	}

	// Добавляем создателя как участника группы с ролью ДМ
	member := GroupMember{
		GroupID: group.ID,
		UserID:  userID,
		Role:    RoleDM,
	}

	if err := gc.db.Create(&member).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка добавления участника"})
		return
	}

	// Загружаем связанные данные
	if err := gc.db.Preload("DM").Preload("Members.User").First(&group, group.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка загрузки данных группы"})
		return
	}

	c.JSON(http.StatusCreated, group)
}

// GetGroups - получение списка групп пользователя
func (gc *GroupController) GetGroups(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	var groups []Group

	// Находим все группы, где пользователь является участником
	if err := gc.db.Preload("DM").Preload("Members.User").
		Joins("JOIN group_members ON groups.id = group_members.group_id").
		Where("group_members.user_id = ?", userID).
		Find(&groups).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения групп"})
		return
	}

	c.JSON(http.StatusOK, groups)
}

// GetGroup - получение информации о группе
func (gc *GroupController) GetGroup(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	groupIDStr := c.Param("id")
	groupID, err := uuid.Parse(groupIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID группы"})
		return
	}

	var group Group
	if err := gc.db.Preload("DM").Preload("Members.User").First(&group, groupID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "группа не найдена"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения группы"})
		return
	}

	// Проверяем, является ли пользователь участником группы
	var member GroupMember
	if err := gc.db.Where("group_id = ? AND user_id = ?", groupID, userID).First(&member).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "вы не являетесь участником этой группы"})
		return
	}

	c.JSON(http.StatusOK, group)
}

// JoinGroup - присоединение к группе
func (gc *GroupController) JoinGroup(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	var req JoinGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные запроса: " + err.Error()})
		return
	}

	// Проверяем, существует ли группа
	var group Group
	if err := gc.db.First(&group, req.GroupID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "группа не найдена"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка поиска группы"})
		return
	}

	// Проверяем, не является ли пользователь уже участником
	var existingMember GroupMember
	if err := gc.db.Where("group_id = ? AND user_id = ?", req.GroupID, userID).First(&existingMember).Error; err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "вы уже являетесь участником этой группы"})
		return
	}

	// Добавляем пользователя в группу с ролью игрока
	member := GroupMember{
		GroupID: req.GroupID,
		UserID:  userID,
		Role:    RolePlayer,
	}

	if err := gc.db.Create(&member).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка присоединения к группе"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "успешно присоединились к группе"})
}

// LeaveGroup - покидание группы
func (gc *GroupController) LeaveGroup(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	groupIDStr := c.Param("id")
	groupID, err := uuid.Parse(groupIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID группы"})
		return
	}

	// Проверяем, является ли пользователь участником группы
	var member GroupMember
	if err := gc.db.Where("group_id = ? AND user_id = ?", groupID, userID).First(&member).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "вы не являетесь участником этой группы"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка поиска участника"})
		return
	}

	// Проверяем, не является ли пользователь ДМом
	if member.Role == RoleDM {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ДМ не может покинуть группу"})
		return
	}

	// Удаляем участника из группы
	if err := gc.db.Delete(&member).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка покидания группы"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "успешно покинули группу"})
}

// GetGroupMembers - получение списка участников группы
func (gc *GroupController) GetGroupMembers(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	groupIDStr := c.Param("id")
	groupID, err := uuid.Parse(groupIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID группы"})
		return
	}

	// Проверяем, является ли пользователь участником группы
	var member GroupMember
	if err := gc.db.Where("group_id = ? AND user_id = ?", groupID, userID).First(&member).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "вы не являетесь участником этой группы"})
		return
	}

	// Получаем всех участников группы
	var members []GroupMember
	if err := gc.db.Preload("User").Where("group_id = ?", groupID).Find(&members).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения участников"})
		return
	}

	c.JSON(http.StatusOK, members)
}
