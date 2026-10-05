package main

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ResolveRuntimeCards is the same full card projection and visibility as GetCard,
// with a bounded explicit ID set. It never broadens a public list to owned items.
func (cc *CardController) ResolveRuntimeCards(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Writer.Header().Add("Vary", "Authorization")
	values, present := c.Request.URL.Query()["ids"]
	if !present || len(values) != 1 {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_card_ids", "error": "Укажите список предметов"})
		return
	}
	rawIDs := strings.Split(values[0], ",")
	if len(rawIDs) == 0 || len(rawIDs) > 128 {
		c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_card_ids", "error": "Недопустимый размер списка предметов"})
		return
	}
	ids, seen := make([]uuid.UUID, 0, len(rawIDs)), map[uuid.UUID]bool{}
	for _, raw := range rawIDs {
		id, err := uuid.Parse(raw)
		if err != nil || id == uuid.Nil || id.String() != raw {
			c.JSON(http.StatusBadRequest, gin.H{"code": "invalid_card_ids", "error": "Недопустимый ID предмета"})
			return
		}
		if !seen[id] {
			ids, seen[id] = append(ids, id), true
		}
	}
	var cards []Card
	if err := itemAccessQuery(cc.db.WithContext(c.Request.Context()), c).Where("cards.id IN ?", ids).Find(&cards).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": "card_catalog_unavailable", "error": "Не удалось загрузить предметы"})
		return
	}
	if len(cards) != len(ids) {
		// Missing and invisible IDs are indistinguishable; no partial disclosure.
		c.JSON(http.StatusNotFound, gin.H{"code": "cards_unavailable", "error": "Не все предметы доступны"})
		return
	}
	byID := make(map[uuid.UUID]CardResponse, len(cards))
	for _, card := range cards {
		byID[card.ID] = card.ToCardResponse()
	}
	rows := make([]CardResponse, 0, len(ids))
	for _, id := range ids {
		rows = append(rows, byID[id])
	}
	c.JSON(http.StatusOK, gin.H{"cards": rows})
}
