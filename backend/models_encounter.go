package main

import (
	"time"

	"github.com/google/uuid"
)

// Encounter — серверная сущность боя (источник истины для онлайн-боёв на несколько
// устройств/аккаунтов). Хранит общее состояние (комбатанты + раунд/ход) в state jsonb
// и монотонный seq (номер версии). Изменения приходят от клиентов (client-authoritative-
// relay): сервер применяет op, увеличивает seq, пишет в encounter_events (журнал для
// докачки по ?since=) и рассылает через pg_notify → SSE подписчикам (см. EncounterHub).
type Encounter struct {
	ID            uuid.UUID  `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	Name          string     `json:"name" gorm:"not null"`
	OwnerUserID   uuid.UUID  `json:"owner_user_id" gorm:"type:uuid;not null"`
	MemberUserIDs Properties `json:"member_user_ids" gorm:"type:jsonb"` // uuid-строки участников
	State         *JSONMap   `json:"state" gorm:"type:jsonb"`           // {combatants:[...], round, activeIndex}
	Seq           int64      `json:"seq" gorm:"not null;default:0"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

func (Encounter) TableName() string { return "encounters" }

// EncounterEvent — append-only журнал изменений боя (для реплея по ?since= и Last-Event-ID).
type EncounterEvent struct {
	ID          uuid.UUID `json:"id" gorm:"type:uuid;primary_key;default:gen_random_uuid()"`
	EncounterID uuid.UUID `json:"encounter_id" gorm:"type:uuid;not null;index"`
	Seq         int64     `json:"seq" gorm:"not null"`
	Payload     *JSONMap  `json:"payload" gorm:"type:jsonb"`
	CreatedAt   time.Time `json:"created_at"`
}

func (EncounterEvent) TableName() string { return "encounter_events" }

// --- запросы ---

type CreateEncounterRequest struct {
	Name string `json:"name"`
}

// CombatantPatch — частичное изменение комбатанта: shallow-merge полей Set в объект по ActorID.
type CombatantPatch struct {
	ActorID string  `json:"actor_id" binding:"required"`
	Set     JSONMap `json:"set"`
}

// BattleLogEntry — структурированная запись журнала боя. Message идёт в общий журнал боя
// (панель на доске). Если задан TargetCharacterID — сервер пишет Payload (EngineEvent) в
// журнал персонажа (character_events), чтобы «всё, что взаимодействует с персонажем, даже
// извне, логировалось у него». Payload.type должен совпадать с Type (контракт describeEngineEvent).
type BattleLogEntry struct {
	Message           string  `json:"message"`
	TargetCharacterID string  `json:"targetCharacterId"`
	Type              string  `json:"type"`
	Payload           JSONMap `json:"payload"`
}

// ApplyRequest — атомарная операция над боем (client-authoritative-relay).
// Патчи/добавления/удаления комбатантов + смена раунда/хода + журнал.
// Сервер применяет всё, бампит seq, write-through боевого состояния в листы персонажей,
// пишет журналы (боя + персонажей) и шлёт подписчикам.
type ApplyRequest struct {
	Patches     []CombatantPatch         `json:"patches"`
	Add         []map[string]interface{} `json:"add"`
	Remove      []string                 `json:"remove"`
	Round       *int                     `json:"round"`
	ActiveIndex *int                     `json:"active_index"`
	Events      []interface{}            `json:"events"` // legacy: свободные строки журнала боя
	Log         []BattleLogEntry         `json:"log"`    // структурированный журнал (боя + персонажей)
}
