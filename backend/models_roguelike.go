package main

import (
	"time"

	"github.com/google/uuid"
)

const (
	RoguelikeStatusActive  = "active"
	RoguelikeStatusVictory = "victory"
	RoguelikeStatusDefeat  = "defeat"

	RoguelikePhaseCamp   = "camp"
	RoguelikePhaseCombat = "combat"
	RoguelikePhaseEnded  = "ended"
)

// RoguelikeRun is the server-owned campaign state. Combat runtime stays on the
// dedicated dungeon_crawl CharacterV3 so the existing certified rules engine is
// reused without introducing a second implementation of D&D mechanics.
type RoguelikeRun struct {
	ID                     uuid.UUID    `json:"id" gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID                 uuid.UUID    `json:"user_id" gorm:"type:uuid;not null;index"`
	SourceCharacterID      uuid.UUID    `json:"source_character_id" gorm:"type:uuid;not null"`
	CharacterID            uuid.UUID    `json:"character_id" gorm:"type:uuid;not null;uniqueIndex"`
	Status                 string       `json:"status" gorm:"type:varchar(24);not null"`
	Phase                  string       `json:"phase" gorm:"type:varchar(24);not null"`
	Revision               int64        `json:"revision" gorm:"not null"`
	Experience             int          `json:"experience" gorm:"not null"`
	Gold                   int          `json:"gold" gorm:"not null"`
	Supplies               int          `json:"supplies" gorm:"not null"`
	EncountersWon          int          `json:"encounters_won" gorm:"not null"`
	Attempt                int          `json:"attempt" gorm:"not null"`
	GameClockHours         int          `json:"game_clock_hours" gorm:"not null"`
	LastLongRestHour       int          `json:"last_long_rest_hour" gorm:"not null"`
	PaidRefreshCount       int          `json:"paid_refresh_count" gorm:"not null"`
	PendingLevel           int          `json:"pending_level,omitempty" gorm:"not null"`
	RunSeed                string       `json:"-" gorm:"type:varchar(64);not null"`
	CombatEnvelope         JSONMap      `json:"-" gorm:"type:jsonb;not null;default:'{}'"`
	CombatCatalog          JSONMap      `json:"-" gorm:"type:jsonb;not null;default:'{}'"`
	CombatState            JSONMap      `json:"combat_state,omitempty" gorm:"-"`
	TrustedCombatAvailable bool         `json:"trusted_combat_available" gorm:"-"`
	Encounter              JSONMap      `json:"encounter" gorm:"type:jsonb;not null"`
	Shop                   JSONMap      `json:"shop" gorm:"type:jsonb;not null"`
	Checkpoint             JSONMap      `json:"-" gorm:"type:jsonb;not null"`
	LastReward             JSONMap      `json:"last_reward" gorm:"type:jsonb;not null"`
	CreatedAt              time.Time    `json:"created_at"`
	UpdatedAt              time.Time    `json:"updated_at"`
	Character              *CharacterV3 `json:"character,omitempty" gorm:"foreignKey:CharacterID"`
}

func (RoguelikeRun) TableName() string { return "roguelike_runs" }

type RoguelikeCommandReceipt struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	RunID       uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_roguelike_run_command"`
	UserID      uuid.UUID `gorm:"type:uuid;not null"`
	CommandID   uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_roguelike_run_command"`
	CommandType string    `gorm:"type:varchar(40);not null"`
	RequestHash string    `gorm:"type:char(64);not null"`
	Response    JSONMap   `gorm:"type:jsonb;not null"`
	CreatedAt   time.Time
}

func (RoguelikeCommandReceipt) TableName() string { return "roguelike_command_receipts" }

type CreateRoguelikeRunRequest struct {
	SourceCharacterID uuid.UUID `json:"source_character_id" binding:"required"`
}

type RoguelikeCommandRequest struct {
	CommandID        uuid.UUID `json:"command_id" binding:"required"`
	ExpectedRevision int64     `json:"expected_revision"`
	Type             string    `json:"type" binding:"required"`
	Payload          JSONMap   `json:"payload"`
}
