package main

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type MonsterController struct{ db *gorm.DB }

func NewMonsterController(db *gorm.DB) *MonsterController { return &MonsterController{db: db} }

var monsterSlugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,99}$`)

var monsterEditableColumns = []string{
	"slug", "name", "name_en", "description", "size", "creature_type", "alignment",
	"challenge_rating", "armor_class", "max_hp", "speed", "initiative_bonus",
	"proficiency_bonus", "abilities", "action_ids", "effect_ids", "ai", "token_url", "source",
}

func normalizeMonsterRequest(req *MonsterUpsertRequest) {
	req.Slug = strings.ToLower(strings.TrimSpace(req.Slug))
	req.Name = strings.TrimSpace(req.Name)
	if req.Size == "" {
		req.Size = "medium"
	}
	if req.CreatureType == "" {
		req.CreatureType = "humanoid"
	}
	if req.ChallengeRating == "" {
		req.ChallengeRating = "0"
	}
	if req.ArmorClass <= 0 {
		req.ArmorClass = 10
	}
	if req.MaxHP <= 0 {
		req.MaxHP = 1
	}
	if req.Speed <= 0 {
		req.Speed = 30
	}
	if req.ProficiencyBonus <= 0 {
		req.ProficiencyBonus = 2
	}
	if req.Abilities == nil {
		abilities := JSONMap{"str": 10, "dex": 10, "con": 10, "int": 10, "wis": 10, "cha": 10}
		req.Abilities = &abilities
	}
	if req.ActionIDs == nil {
		values := Properties{}
		req.ActionIDs = &values
	}
	if req.EffectIDs == nil {
		values := Properties{}
		req.EffectIDs = &values
	}
	if req.AI == nil {
		value := JSONMap{"strategy": "melee_chase"}
		req.AI = &value
	}
}

func monsterRequestIssue(req MonsterUpsertRequest) string {
	if req.Name == "" {
		return "Название монстра обязательно"
	}
	if !monsterSlugPattern.MatchString(req.Slug) {
		return "Slug должен содержать 2–100 латинских букв, цифр, дефисов или подчёркиваний"
	}
	for _, key := range []string{"str", "dex", "con", "int", "wis", "cha"} {
		raw, exists := (*req.Abilities)[key]
		if !exists {
			return "Не указана характеристика " + key
		}
		value, ok := raw.(float64)
		if !ok {
			if intValue, yes := raw.(int); yes {
				value, ok = float64(intValue), true
			}
		}
		if !ok || value < 1 || value > 30 {
			return "Характеристика " + key + " должна быть числом от 1 до 30"
		}
	}
	for key := range *req.Abilities {
		if key != "str" && key != "dex" && key != "con" && key != "int" && key != "wis" && key != "cha" {
			return "Неизвестная характеристика " + key
		}
	}
	for _, references := range []*Properties{req.ActionIDs, req.EffectIDs} {
		seen := map[string]bool{}
		for _, id := range *references {
			if _, err := uuid.Parse(id); err != nil {
				return "Ссылки на действия и эффекты должны быть UUID"
			}
			if seen[id] {
				return "Ссылки на действия и эффекты не должны повторяться"
			}
			seen[id] = true
		}
	}
	return ""
}

func (mc *MonsterController) referenceIssue(req MonsterUpsertRequest) (string, error) {
	checks := []struct {
		label string
		model interface{}
		ids   *Properties
	}{
		{"действия", &Action{}, req.ActionIDs},
		{"эффекты", &Effect{}, req.EffectIDs},
	}
	for _, check := range checks {
		if check.ids == nil || len(*check.ids) == 0 {
			continue
		}
		var count int64
		if err := mc.db.Model(check.model).Where("id IN ?", []string(*check.ids)).Count(&count).Error; err != nil {
			return "", fmt.Errorf("validate monster %s: %w", check.label, err)
		}
		if count != int64(len(*check.ids)) {
			return "Не найдены все выбранные " + check.label, nil
		}
	}
	return "", nil
}

func monsterFromRequest(req MonsterUpsertRequest) Monster {
	return Monster{
		Slug: req.Slug, Name: req.Name, NameEn: req.NameEn, Description: req.Description,
		Size: req.Size, CreatureType: req.CreatureType, Alignment: req.Alignment,
		ChallengeRating: req.ChallengeRating, ArmorClass: req.ArmorClass, MaxHP: req.MaxHP,
		Speed: req.Speed, InitiativeBonus: req.InitiativeBonus, ProficiencyBonus: req.ProficiencyBonus,
		Abilities: req.Abilities, ActionIDs: req.ActionIDs, EffectIDs: req.EffectIDs, AI: req.AI,
		TokenURL: req.TokenURL, Source: req.Source,
	}
}

func (mc *MonsterController) List(c *gin.Context) {
	query := mc.db.Model(&Monster{})
	if search := strings.TrimSpace(c.Query("search")); search != "" {
		query = query.Where("name ILIKE ? OR slug = ?", "%"+search+"%", strings.ToLower(search))
	}
	page, limit, offset := parseListPagination(c)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения монстров"})
		return
	}
	var monsters []Monster
	if err := query.Order("challenge_rating ASC, name ASC").Offset(offset).Limit(limit).Find(&monsters).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения монстров"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"monsters": monsters, "total": total, "page": page, "limit": limit})
}

func (mc *MonsterController) Get(c *gin.Context) {
	var monster Monster
	id := c.Param("id")
	query := mc.db.Where("slug = ?", id)
	if parsed, err := uuid.Parse(id); err == nil {
		query = mc.db.Where("id = ?", parsed)
	}
	if err := query.First(&monster).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Монстр не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка получения монстра"})
		return
	}
	c.JSON(http.StatusOK, monster)
}

func (mc *MonsterController) Create(c *gin.Context) {
	var req MonsterUpsertRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса", "details": err.Error()})
		return
	}
	normalizeMonsterRequest(&req)
	if issue := monsterRequestIssue(req); issue != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": issue})
		return
	}
	if issue, err := mc.referenceIssue(req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка проверки ссылок монстра"})
		return
	} else if issue != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": issue})
		return
	}
	monster := monsterFromRequest(req)
	if err := mc.db.Create(&monster).Error; err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Не удалось создать монстра", "details": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, monster)
}

func (mc *MonsterController) Update(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID монстра"})
		return
	}
	var current Monster
	if err := mc.db.First(&current, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Монстр не найден"})
		return
	}
	var req MonsterUpsertRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверные данные запроса", "details": err.Error()})
		return
	}
	normalizeMonsterRequest(&req)
	if issue := monsterRequestIssue(req); issue != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": issue})
		return
	}
	if issue, err := mc.referenceIssue(req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка проверки ссылок монстра"})
		return
	} else if issue != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": issue})
		return
	}
	updates := monsterFromRequest(req)
	if err := mc.db.Model(&current).Select(monsterEditableColumns).Updates(&updates).Error; err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Не удалось обновить монстра", "details": err.Error()})
		return
	}
	if err := mc.db.First(&current, "id = ?", current.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Монстр обновлён, но не удалось перечитать результат"})
		return
	}
	c.JSON(http.StatusOK, current)
}

func (mc *MonsterController) Delete(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID монстра"})
		return
	}
	result := mc.db.Delete(&Monster{}, "id = ?", id)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось удалить монстра"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Монстр не найден"})
		return
	}
	c.Status(http.StatusNoContent)
}
