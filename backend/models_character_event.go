package main

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// CharacterEvent — запись журнала событий персонажа (фаза B3).
type CharacterEvent struct {
	ID            uuid.UUID  `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	CharacterID   uuid.UUID  `json:"character_id" gorm:"type:uuid;not null;index"`
	ClientEventID *uuid.UUID `json:"client_event_id,omitempty" gorm:"type:uuid"`
	Ts            time.Time  `json:"ts" gorm:"not null"`
	Type          string     `json:"type" gorm:"type:varchar(64);not null"`
	Payload       JSONMap    `json:"payload" gorm:"type:jsonb;not null"`
	CreatedAt     time.Time  `json:"created_at"`
}

func (CharacterEvent) TableName() string { return "character_events" }

// BeforeCreate is the final persistence guard for every backend writer. Route
// handlers validate earlier for clearer batch errors, but an internal writer
// cannot accidentally bypass the EngineEvent contract.
func (event *CharacterEvent) BeforeCreate(_ *gorm.DB) error {
	return validateCharacterEvent(event.Type, event.Payload)
}

// CreateCharacterEventItem — одно событие в batch-запросе.
type CreateCharacterEventItem struct {
	ClientEventID *uuid.UUID `json:"client_event_id"`
	Ts            *time.Time `json:"ts"`
	Type          string     `json:"type" binding:"required"`
	Payload       JSONMap    `json:"payload" binding:"required"`
}

// BatchCharacterEventsRequest — пакетная запись событий.
type BatchCharacterEventsRequest struct {
	Events []CreateCharacterEventItem `json:"events" binding:"required,dive"`
}
