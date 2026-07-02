package main

import (
	"time"

	"github.com/google/uuid"
)

// CharacterEvent — запись журнала событий персонажа (фаза B3).
type CharacterEvent struct {
	ID          uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	CharacterID uuid.UUID `json:"character_id" gorm:"type:uuid;not null;index"`
	Ts          time.Time `json:"ts" gorm:"not null"`
	Type        string    `json:"type" gorm:"type:varchar(64);not null"`
	Payload     JSONMap   `json:"payload" gorm:"type:jsonb;not null"`
	CreatedAt   time.Time `json:"created_at"`
}

func (CharacterEvent) TableName() string { return "character_events" }

// CreateCharacterEventItem — одно событие в batch-запросе.
type CreateCharacterEventItem struct {
	Ts      *time.Time `json:"ts"`
	Type    string     `json:"type" binding:"required"`
	Payload JSONMap    `json:"payload" binding:"required"`
}

// BatchCharacterEventsRequest — пакетная запись событий.
type BatchCharacterEventsRequest struct {
	Events []CreateCharacterEventItem `json:"events" binding:"required,dive"`
}
