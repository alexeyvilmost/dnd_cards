package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// EncounterController — серверная истина боя + realtime-рассылка (SSE) изменений всем
// подключённым клиентам (разные устройства/аккаунты). Cross-instance fan-out — через
// Postgres LISTEN/NOTIFY (без Redis): запись делает pg_notify, единый listener на процесс
// загружает событие из журнала и рассылает локальным SSE-подписчикам.
type EncounterController struct {
	db            *gorm.DB
	hub           *EncounterHub
	inviteService *EncounterInviteService
}

func NewEncounterController(db *gorm.DB, hub *EncounterHub, inviteService *EncounterInviteService) *EncounterController {
	return &EncounterController{db: db, hub: hub, inviteService: inviteService}
}

// applyOps — ЧИСТАЯ функция применения операции к состоянию боя (тестируется без БД).
// Комбатанты идентифицируются полем actorId; Set — shallow-merge в объект комбатанта.
func applyOps(state map[string]interface{}, req ApplyRequest) map[string]interface{} {
	if state == nil {
		state = map[string]interface{}{}
	}
	var combatants []map[string]interface{}
	if raw, ok := state["combatants"].([]interface{}); ok {
		for _, c := range raw {
			if m, ok := c.(map[string]interface{}); ok {
				combatants = append(combatants, m)
			}
		}
	}
	idx := func(id string) int {
		for i, c := range combatants {
			if fmt.Sprint(c["actorId"]) == id {
				return i
			}
		}
		return -1
	}
	for _, rid := range req.Remove {
		if i := idx(rid); i >= 0 {
			combatants = append(combatants[:i], combatants[i+1:]...)
		}
	}
	for _, p := range req.Patches {
		if i := idx(p.ActorID); i >= 0 {
			for k, v := range p.Set {
				combatants[i][k] = v
			}
		}
	}
	for _, a := range req.Add {
		combatants = append(combatants, a)
	}
	arr := make([]interface{}, len(combatants))
	for i, c := range combatants {
		arr[i] = c
	}
	state["combatants"] = arr
	if req.Round != nil {
		state["round"] = *req.Round
	}
	if req.ActiveIndex != nil {
		state["activeIndex"] = *req.ActiveIndex
	}
	return state
}

func opPayload(req ApplyRequest) JSONMap {
	b, _ := json.Marshal(req)
	var m JSONMap
	_ = json.Unmarshal(b, &m)
	// expected_seq is command precondition metadata, not part of the replayable
	// encounter operation delivered over SSE.
	delete(m, "expected_seq")
	return m
}

// characterIDsInState — множество characterId среди комбатантов состояния боя
// (только реальные персонажи; у монстров characterId нет).
func characterIDsInState(state map[string]interface{}) map[string]bool {
	out := map[string]bool{}
	raw, ok := state["combatants"].([]interface{})
	if !ok {
		return out
	}
	for _, c := range raw {
		if m, ok := c.(map[string]interface{}); ok {
			if cid, ok := m["characterId"].(string); ok && cid != "" {
				out[cid] = true
			}
		}
	}
	return out
}

// encounterConflict — правило «один бой на персонажа»: возвращает имя другого боя, если
// персонаж cid уже реально участвует в ином (существующем) бою. Устаревшую ссылку (бой
// удалён или персонажа там уже нет) игнорируем, чтобы не залочить персонажа навсегда.
func encounterConflict(db *gorm.DB, cid string, thisEnc uuid.UUID) (string, bool) {
	charUUID, err := uuid.Parse(cid)
	if err != nil {
		return "", false
	}
	var ch CharacterV3
	if err := db.Select("id", "current_encounter_id").First(&ch, "id = ?", charUUID).Error; err != nil {
		return "", false // персонажа нет — не наша забота
	}
	if ch.CurrentEncounterID == nil || *ch.CurrentEncounterID == thisEnc {
		return "", false
	}
	var other Encounter
	if err := db.First(&other, "id = ?", *ch.CurrentEncounterID).Error; err != nil {
		return "", false // бой удалён — ссылка устарела
	}
	otherState := map[string]interface{}{}
	if other.State != nil {
		otherState = *other.State
	}
	if characterIDsInState(otherState)[cid] {
		return other.Name, true // реальный конфликт
	}
	return "", false // персонажа там уже нет — ссылка устарела
}

// syncCombatantsToCharacters — write-through боевого состояния персонажей-комбатантов в их запись
// characters_v3: current_hp (из hp), turn_state.temp_hp (из temp, merge), active_effects (из
// activeEffects). ПОЛЕВОЙ write-through: пишем только те поля, что этот op реально менял (changed
// по actorId), — иначе патч, менявший лишь состояния, затирал бы current_hp значением комбатанта
// (которое могло разойтись с листом). max_hp НЕ трогаем — заморожен при добавлении. Монстры (без
// characterId) пропускаются; ошибка записи уже разрешённого CharacterV3 откатывает весь encounter op.
func syncCombatantsToCharacters(tx *gorm.DB, state map[string]interface{}, changed map[string]map[string]bool, characterOwners map[string]uuid.UUID) error {
	raw, ok := state["combatants"].([]interface{})
	if !ok {
		return nil
	}
	for _, it := range raw {
		m, ok := it.(map[string]interface{})
		if !ok {
			continue
		}
		aid, _ := m["actorId"].(string)
		fields := changed[aid]
		if fields == nil {
			continue
		}
		cid, _ := m["characterId"].(string)
		if cid == "" {
			continue
		}
		u, e := uuid.Parse(cid)
		if e != nil {
			continue
		}
		ownerID, authorized := characterOwners[u.String()]
		if !authorized || ownerID == uuid.Nil {
			continue
		}
		upd := map[string]interface{}{}
		if fields["hp"] {
			if hp, ok := m["hp"].(float64); ok {
				upd["current_hp"] = int(hp)
			}
		}
		if fields["activeEffects"] {
			if ae, ok := m["activeEffects"].([]interface{}); ok {
				var eff ActiveEffectRows
				b, _ := json.Marshal(ae)
				_ = json.Unmarshal(b, &eff)
				upd["active_effects"] = &eff
			}
		}
		if fields["temp"] {
			if t, ok := m["temp"].(float64); ok {
				// turn_state — read-merge-write только ключа temp_hp (не затираем death_saves/attuned_ids).
				var cur CharacterV3
				if e := tx.Select("turn_state").First(&cur, "id = ? AND user_id = ?", u, ownerID).Error; e != nil {
					return fmt.Errorf("load encounter character %s turn state: %w", cid, e)
				}
				ts := JSONMap{}
				if cur.TurnState != nil {
					ts = *cur.TurnState
				}
				ts["temp_hp"] = int(t)
				upd["turn_state"] = &ts
			}
		}
		if len(upd) == 0 {
			continue
		}
		upd["runtime_revision"] = gorm.Expr("runtime_revision + 1")
		update := tx.Model(&CharacterV3{}).Where("id = ? AND user_id = ?", u, ownerID).Updates(upd)
		if update.Error != nil {
			return fmt.Errorf("write encounter state to character %s: %w", cid, update.Error)
		}
		if update.RowsAffected != 1 {
			return fmt.Errorf("write encounter state to character %s: owner row changed", cid)
		}
	}
	return nil
}

// writeCharacterJournal — пишет адресные записи журнала боя в журналы персонажей (character_events),
// чтобы всё, что произошло с персонажем (даже с другого устройства/аккаунта), было у него в журнале.
// Apply policy заранее разрешает target id; отсутствующий/битый EngineEvent возвращает ошибку
// и откатывает всю операцию боя. Неадресные message-only записи остаются только в журнале боя.
func writeCharacterJournal(tx *gorm.DB, entries []BattleLogEntry, allowedCharacterIDs map[string]uuid.UUID) error {
	now := time.Now()
	for _, le := range entries {
		if le.TargetCharacterID == "" {
			continue
		}
		if le.Payload == nil {
			return invalidCharacterEvent("log.payload", "is required for a targeted character journal entry")
		}
		u, e := uuid.Parse(le.TargetCharacterID)
		if e != nil {
			return invalidCharacterEvent("log.targetCharacterId", "must be a UUID in this encounter")
		}
		if allowed, ok := allowedCharacterIDs[u.String()]; !ok || allowed != u {
			continue
		}
		typ := le.Type
		if typ == "" {
			return invalidCharacterEvent("log.type", "must be a supported EngineEvent type")
		}
		if e := validateCharacterEvent(typ, le.Payload); e != nil {
			return fmt.Errorf("encounter log for character %s: %w", le.TargetCharacterID, e)
		}
		ev := CharacterEvent{CharacterID: u, Ts: now, Type: typ, Payload: le.Payload}
		if e := tx.Create(&ev).Error; e != nil {
			return fmt.Errorf("write encounter journal for character %s: %w", le.TargetCharacterID, e)
		}
	}
	return nil
}

func stateOfEncounter(enc *Encounter) map[string]interface{} {
	if enc == nil || enc.State == nil {
		return map[string]interface{}{}
	}
	// applyOps mutates its input. A JSON round-trip gives the operation an
	// isolated state value and also normalizes numeric JSON values consistently.
	b, err := json.Marshal(*enc.State)
	if err != nil {
		return map[string]interface{}{}
	}
	var state map[string]interface{}
	if err := json.Unmarshal(b, &state); err != nil || state == nil {
		return map[string]interface{}{}
	}
	return state
}

func writeEncounterError(c *gin.Context, err error, fallback string) {
	var validationErr *characterEventValidationError
	if errors.As(err, &validationErr) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверное событие журнала", "details": validationErr.Error()})
		return
	}
	var accessErr *encounterAccessError
	if errors.As(err, &accessErr) {
		c.JSON(accessErr.Status, gin.H{"error": accessErr.Message})
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "бой не найден"})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": fallback})
}

// --- CRUD ---

func (ec *EncounterController) Create(c *gin.Context) {
	var req CreateEncounterRequest
	_ = c.ShouldBindJSON(&req)
	name := req.Name
	if name == "" {
		name = "Бой"
	}
	owner, err := GetCurrentUserID(c)
	if err != nil || owner == uuid.Nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "требуется авторизация"})
		return
	}
	empty := JSONMap{"combatants": []interface{}{}, "round": 1, "activeIndex": 0}
	enc := Encounter{Name: name, OwnerUserID: owner, MemberUserIDs: Properties{owner.String()}, State: &empty, Seq: 0}
	if err := ec.db.Create(&enc).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "не удалось создать бой"})
		return
	}
	c.JSON(http.StatusCreated, enc)
}

func (ec *EncounterController) List(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil || userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "требуется авторизация"})
		return
	}
	var encs []Encounter
	if err := ec.db.
		Where("owner_user_id = ? OR jsonb_exists(COALESCE(member_user_ids, '[]'::jsonb), ?)", userID, userID.String()).
		Order("updated_at desc").Limit(100).Find(&encs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка загрузки"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"encounters": encs})
}

func (ec *EncounterController) Get(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный id"})
		return
	}
	var enc Encounter
	if err := ec.db.First(&enc, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "бой не найден"})
		return
	}
	if _, ok := requireEncounterParticipant(c, &enc); !ok {
		return
	}
	c.JSON(http.StatusOK, enc)
}

// Delete removes an encounter owned by the caller. Encounter and linked
// CharacterV3 rows use the same lock order as Apply (encounter first, then
// characters), so deletion cannot strand current_encounter_id during a race.
func (ec *EncounterController) Delete(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный id"})
		return
	}
	caller, err := GetCurrentUserID(c)
	if err != nil || caller == uuid.Nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "требуется авторизация"})
		return
	}

	txErr := ec.db.Transaction(func(tx *gorm.DB) error {
		var enc Encounter
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&enc, "id = ?", id).Error; err != nil {
			return err
		}
		if enc.OwnerUserID != caller {
			return &encounterAccessError{Status: http.StatusForbidden, Message: "удалить бой может только его мастер"}
		}

		var linked []CharacterV3
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("id", "user_id", "current_encounter_id").
			Where("current_encounter_id = ?", id).
			Order("id asc").Find(&linked).Error; err != nil {
			return err
		}
		if len(linked) > 0 {
			if err := tx.Model(&CharacterV3{}).
				Where("current_encounter_id = ?", id).
				Update("current_encounter_id", nil).Error; err != nil {
				return err
			}
		}
		// Production historically had no FK cascade on encounter_events, so the
		// child delete is explicit and remains valid if a cascade is added later.
		if err := tx.Where("encounter_id = ?", id).Delete(&EncounterEvent{}).Error; err != nil {
			return err
		}
		result := tx.Where("id = ? AND owner_user_id = ?", id, caller).Delete(&Encounter{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return &encounterAccessError{Status: http.StatusConflict, Message: "владелец боя изменился; повторите запрос"}
		}
		return nil
	})
	if txErr != nil {
		writeEncounterError(c, txErr, "не удалось удалить бой")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "бой удалён"})
}

// Events — последние N событий боя (общий журнал боя) для бэкскролла на доске.
// Каждый EncounterEvent несёт seq + payload (в payload — log/events операции). Отдаём в
// хронологическом порядке (старые→новые), как ждёт панель журнала.
func (ec *EncounterController) Events(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный id"})
		return
	}
	limit := 100
	if s := c.Query("limit"); s != "" {
		if v, e := strconv.Atoi(s); e == nil && v > 0 && v <= 500 {
			limit = v
		}
	}
	var enc Encounter
	if err := ec.db.First(&enc, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "бой не найден"})
		return
	}
	if _, ok := requireEncounterParticipant(c, &enc); !ok {
		return
	}
	var events []EncounterEvent
	if err := ec.db.Where("encounter_id = ?", id).Order("seq desc").Limit(limit).Find(&events).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка загрузки"})
		return
	}
	for i, j := 0, len(events)-1; i < j; i, j = i+1, j-1 {
		events[i], events[j] = events[j], events[i]
	}
	c.JSON(http.StatusOK, gin.H{"events": events})
}

// IssueInvite creates a short-lived stateless capability. Only the encounter
// owner can issue it; the raw token is returned once and is never persisted or
// logged by this controller.
func (ec *EncounterController) IssueInvite(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный id"})
		return
	}
	userID, err := GetCurrentUserID(c)
	if err != nil || userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "требуется авторизация"})
		return
	}
	var enc Encounter
	if err := ec.db.First(&enc, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "бой не найден"})
		return
	}
	if !canIssueEncounterInvite(&enc, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "приглашение может создать только мастер боя"})
		return
	}
	if ec.inviteService == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "приглашения в бой не настроены"})
		return
	}
	token, expiresAt, err := ec.inviteService.Issue(enc.ID, enc.OwnerUserID)
	if err != nil {
		if errors.Is(err, ErrEncounterInviteNotConfigured) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "приглашения в бой не настроены"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "не удалось создать приглашение"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.JSON(http.StatusOK, EncounterInviteResponse{Token: token, ExpiresAt: expiresAt})
}

func (ec *EncounterController) Join(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный id"})
		return
	}
	userID, err := GetCurrentUserID(c)
	if err != nil || userID == uuid.Nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "требуется авторизация"})
		return
	}
	var request JoinEncounterRequest
	if err := c.ShouldBindJSON(&request); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные приглашения"})
		return
	}
	var result Encounter
	txErr := ec.db.Transaction(func(tx *gorm.DB) error {
		var enc Encounter
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&enc, "id = ?", id).Error; err != nil {
			return err
		}
		combatants, accessErr := combatantMaps(stateOfEncounter(&enc))
		if accessErr != nil {
			return accessErr
		}
		characterIDs, accessErr := characterUUIDsInCombatants(combatants)
		if accessErr != nil {
			return accessErr
		}
		characters, err := loadEncounterCharacters(tx, characterIDs, false)
		if err != nil {
			return err
		}
		actors, accessErr := actorAccessFromCombatants(combatants, characters)
		if accessErr != nil {
			return accessErr
		}
		// Existing membership and linked-character ownership preserve the
		// idempotent/legacy repair path. Every unrelated outsider needs a valid,
		// exact-encounter short-lived capability issued by this encounter owner.
		if accessErr := authorizeEncounterJoin(&enc, userID, actors, request.InviteToken, ec.inviteService); accessErr != nil {
			return accessErr
		}
		if !isEncounterParticipant(&enc, userID) {
			members := append(Properties{}, enc.MemberUserIDs...)
			members = append(members, userID.String())
			enc.MemberUserIDs = members
			if err := tx.Model(&Encounter{}).Where("id = ?", enc.ID).Update("member_user_ids", members).Error; err != nil {
				return err
			}
		}
		result = enc
		return nil
	})
	if txErr != nil {
		writeEncounterError(c, txErr, "не удалось присоединиться к бою")
		return
	}
	c.JSON(http.StatusOK, result)
}

// Apply — применить разрешённую боевую операцию: участники могут менять только
// interaction-поля (HP/temp/effects/pending saves/attacks), топологию боя меняет мастер,
// а добавить/убрать персонажа может его реальный контроллер. После проверки операция
// бампит seq, персистит state, пишет событие и рассылает его через pg_notify → SSE.
func (ec *EncounterController) Apply(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный id"})
		return
	}
	var req ApplyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные"})
		return
	}
	if req.ExpectedSeq == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "expected_seq обязателен"})
		return
	}
	if *req.ExpectedSeq < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "expected_seq не может быть отрицательным"})
		return
	}
	if err := validateEncounterApplyEnvelope(req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверная операция боя", "details": err.Error()})
		return
	}
	caller, err := GetCurrentUserID(c)
	if err != nil || caller == uuid.Nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "требуется авторизация"})
		return
	}

	var newState JSONMap
	var newSeq int64
	changed := map[string]map[string]bool{}
	characterOwners := map[string]uuid.UUID{}
	journalCharacters := map[string]uuid.UUID{}

	txErr := ec.db.Transaction(func(tx *gorm.DB) error {
		var enc Encounter
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&enc, "id = ?", id).Error; err != nil {
			return err
		}
		if !isEncounterParticipant(&enc, caller) {
			return &encounterAccessError{Status: http.StatusForbidden, Message: "нет доступа к этому бою"}
		}
		if enc.Seq != *req.ExpectedSeq {
			return &encounterAccessError{
				Status:  http.StatusConflict,
				Message: fmt.Sprintf("состояние боя устарело: ожидалась версия %d, текущая версия %d", *req.ExpectedSeq, enc.Seq),
			}
		}

		state := stateOfEncounter(&enc)
		combatants, accessErr := combatantMaps(state)
		if accessErr != nil {
			return accessErr
		}
		currentCharacterIDs, accessErr := characterUUIDsInCombatants(combatants)
		if accessErr != nil {
			return accessErr
		}

		allCharacterIDs := append([]uuid.UUID{}, currentCharacterIDs...)
		seenCharacterIDs := make(map[uuid.UUID]struct{}, len(allCharacterIDs))
		for _, characterID := range currentCharacterIDs {
			seenCharacterIDs[characterID] = struct{}{}
		}
		addedCharacterIDs := make([]uuid.UUID, 0, len(req.Add))
		for _, added := range req.Add {
			rawCharacterID, exists := added["characterId"]
			if !exists || rawCharacterID == nil || strings.TrimSpace(fmt.Sprint(rawCharacterID)) == "" {
				continue
			}
			characterID, parseErr := uuid.Parse(strings.TrimSpace(fmt.Sprint(rawCharacterID)))
			if parseErr != nil || characterID == uuid.Nil {
				return &encounterAccessError{Status: http.StatusBadRequest, Message: "неверный characterId"}
			}
			addedCharacterIDs = append(addedCharacterIDs, characterID)
			if _, exists := seenCharacterIDs[characterID]; !exists {
				seenCharacterIDs[characterID] = struct{}{}
				allCharacterIDs = append(allCharacterIDs, characterID)
			}
		}

		// Lock linked character rows in a stable transaction before checking the
		// one-encounter invariant or writing through HP/effects.
		characters, err := loadEncounterCharacters(tx, allCharacterIDs, true)
		if err != nil {
			return err
		}
		actors, accessErr := actorAccessFromCombatants(combatants, characters)
		if accessErr != nil {
			return accessErr
		}
		addedControllers := make(map[uuid.UUID]uuid.UUID, len(addedCharacterIDs))
		for _, characterID := range addedCharacterIDs {
			character, exists := characters[characterID]
			if exists {
				addedControllers[characterID] = character.UserID
			}
		}
		if accessErr := validateEncounterApplyPolicy(&enc, caller, actors, addedControllers, req); accessErr != nil {
			return accessErr
		}

		normalizedReq := normalizeEncounterAdds(req, characters)
		before := characterIDsInState(state)
		newState = JSONMap(applyOps(state, normalizedReq))
		after := characterIDsInState(newState)

		// A locked CharacterV3 row makes this invariant safe even when two
		// different encounters concurrently try to add the same character.
		for characterID := range after {
			if !before[characterID] {
				if otherName, conflict := encounterConflict(tx, characterID, id); conflict {
					return &encounterAccessError{Status: http.StatusConflict, Message: fmt.Sprintf("Персонаж уже участвует в бою «%s»", otherName)}
				}
			}
		}

		for characterID, character := range characters {
			canonical := characterID.String()
			characterOwners[canonical] = character.UserID
			journalCharacters[canonical] = characterID
		}

		mark := func(actorID, field string) {
			if changed[actorID] == nil {
				changed[actorID] = map[string]bool{}
			}
			changed[actorID][field] = true
		}
		for _, patch := range normalizedReq.Patches {
			for field := range patch.Set {
				mark(patch.ActorID, field)
			}
		}
		for _, added := range normalizedReq.Add {
			if actorID, ok := added["actorId"].(string); ok {
				for field := range added {
					mark(actorID, field)
				}
			}
		}

		newSeq = enc.Seq + 1
		enc.State = &newState
		enc.Seq = newSeq
		payload := opPayload(normalizedReq)
		event := EncounterEvent{EncounterID: id, Seq: newSeq, Payload: &payload}
		if err := tx.Save(&enc).Error; err != nil {
			return err
		}
		if err := tx.Create(&event).Error; err != nil {
			return err
		}

		// Character links are always qualified by their authoritative owner.
		for characterID := range after {
			if before[characterID] {
				continue
			}
			u, parseErr := uuid.Parse(characterID)
			if parseErr != nil {
				return parseErr
			}
			character := characters[u]
			result := tx.Model(&CharacterV3{}).
				Where("id = ? AND user_id = ?", u, character.UserID).
				Update("current_encounter_id", id)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return &encounterAccessError{Status: http.StatusConflict, Message: "контроллер персонажа изменился; повторите операцию"}
			}
		}
		for characterID := range before {
			if after[characterID] {
				continue
			}
			u, parseErr := uuid.Parse(characterID)
			if parseErr != nil {
				return parseErr
			}
			character := characters[u]
			if err := tx.Model(&CharacterV3{}).
				Where("id = ? AND user_id = ? AND current_encounter_id = ?", u, character.UserID, id).
				Update("current_encounter_id", nil).Error; err != nil {
				return err
			}
		}
		if err := syncCombatantsToCharacters(tx, newState, changed, characterOwners); err != nil {
			return err
		}
		if err := writeCharacterJournal(tx, req.Log, journalCharacters); err != nil {
			return err
		}
		return nil
	})
	if txErr != nil {
		writeEncounterError(c, txErr, "не удалось применить операцию")
		return
	}
	// Дверной звонок всем инстансам (включая свой) — listener загрузит событие и разошлёт.
	if ec.hub != nil {
		ec.hub.notify(ec.db, id.String(), newSeq)
	}
	c.JSON(http.StatusOK, gin.H{"seq": newSeq, "state": &newState})
}

// Stream — SSE-поток изменений боя. ?since=<seq> — реплей пропущенного (докачка), затем live.
// Подписываемся ДО реплея, чтобы не потерять событие в зазоре; клиент дедуплит по seq.
func (ec *EncounterController) Stream(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный id"})
		return
	}
	var enc Encounter
	if err := ec.db.First(&enc, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "бой не найден"})
		return
	}
	if _, ok := requireEncounterParticipant(c, &enc); !ok {
		return
	}

	since := int64(0)
	if s := c.Query("since"); s != "" {
		if v, e := strconv.ParseInt(s, 10, 64); e == nil {
			since = v
		}
	}
	// Нативный реконнект EventSource шлёт Last-Event-ID (последний доставленный seq) —
	// возобновляем с него, если он свежее query-параметра.
	if leid := c.GetHeader("Last-Event-ID"); leid != "" {
		if v, e := strconv.ParseInt(leid, 10, 64); e == nil && v > since {
			since = v
		}
	}
	w := c.Writer
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // не буферизировать в прокси
	w.WriteHeader(http.StatusOK)
	w.Flush()

	encounterID := id.String()
	ch := ec.hub.subscribe(encounterID)
	defer ec.hub.unsubscribe(encounterID, ch)

	// Реплей журнала после since.
	var events []EncounterEvent
	if err := ec.db.Where("encounter_id = ? AND seq > ?", id, since).Order("seq asc").Find(&events).Error; err == nil {
		for _, e := range events {
			if _, err := w.Write(sseBytes(e.Seq, e.Payload)); err != nil {
				return
			}
		}
		w.Flush()
	}

	ctx := c.Request.Context()
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case data, ok := <-ch:
			if !ok {
				return
			}
			if _, err := w.Write(data); err != nil {
				return
			}
			w.Flush()
		case <-ping.C:
			if _, err := w.Write([]byte(": ping\n\n")); err != nil {
				return
			}
			w.Flush()
		}
	}
}

func sseBytes(seq int64, payload *JSONMap) []byte {
	env := map[string]interface{}{"seq": seq}
	if payload != nil {
		for k, v := range *payload {
			env[k] = v
		}
	}
	b, _ := json.Marshal(env)
	return []byte(fmt.Sprintf("id: %d\ndata: %s\n\n", seq, b))
}

// ===================== EncounterHub (SSE + LISTEN/NOTIFY) =====================

// EncounterHub — рассылка событий боя локальным SSE-подписчикам. Единственный путь
// доставки — через LISTEN (даже для событий своего инстанса), поэтому 1 и N реплик
// ведут себя одинаково. Durable-источник — таблица encounter_events (реплей по ?since=).
type EncounterHub struct {
	mu   sync.RWMutex
	subs map[string]map[chan []byte]struct{}
	dsn  string
}

func NewEncounterHub(dsn string) *EncounterHub {
	return &EncounterHub{subs: make(map[string]map[chan []byte]struct{}), dsn: dsn}
}

func (h *EncounterHub) subscribe(encID string) chan []byte {
	ch := make(chan []byte, 64)
	h.mu.Lock()
	if h.subs[encID] == nil {
		h.subs[encID] = make(map[chan []byte]struct{})
	}
	h.subs[encID][ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *EncounterHub) unsubscribe(encID string, ch chan []byte) {
	h.mu.Lock()
	if set := h.subs[encID]; set != nil {
		delete(set, ch)
		if len(set) == 0 {
			delete(h.subs, encID)
		}
	}
	h.mu.Unlock()
	close(ch)
}

// publishLocal — неблокирующая рассылка (если подписчик медленный и буфер полон — дропаем;
// клиент восстановится реконнектом с ?since=<его seq>).
func (h *EncounterHub) publishLocal(encID string, data []byte) {
	h.mu.RLock()
	set := h.subs[encID]
	chans := make([]chan []byte, 0, len(set))
	for ch := range set {
		chans = append(chans, ch)
	}
	h.mu.RUnlock()
	for _, ch := range chans {
		select {
		case ch <- data:
		default:
		}
	}
}

// notify — дверной звонок через pg_notify (payload крошечный: {encounter_id, seq}; сам
// эвент листенер загрузит из журнала, обходя лимит NOTIFY 8000 байт).
func (h *EncounterHub) notify(db *gorm.DB, encID string, seq int64) {
	b, _ := json.Marshal(map[string]interface{}{"encounter_id": encID, "seq": seq})
	if err := db.Exec("SELECT pg_notify('encounter_events', ?)", string(b)).Error; err != nil {
		log.Printf("encounter notify error: %v", err)
	}
}

// StartListener — единый LISTEN encounter_events на процесс: на уведомление грузит событие
// из журнала и рассылает локальным подписчикам. Реконнект с бэкоффом при обрыве.
func (h *EncounterHub) StartListener(db *gorm.DB) {
	go func() {
		backoff := time.Second
		for {
			if err := h.listenLoop(db); err != nil {
				log.Printf("encounter listener: %v (reconnect in %s)", err, backoff)
			}
			time.Sleep(backoff)
			if backoff < 30*time.Second {
				backoff *= 2
			}
		}
	}()
}

func (h *EncounterHub) listenLoop(db *gorm.DB) error {
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, h.dsn)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer conn.Close(ctx)
	if _, err := conn.Exec(ctx, "LISTEN encounter_events"); err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	log.Println("encounter listener: подписан на encounter_events")
	for {
		n, err := conn.WaitForNotification(ctx)
		if err != nil {
			return fmt.Errorf("wait: %w", err)
		}
		var msg struct {
			EncounterID string `json:"encounter_id"`
			Seq         int64  `json:"seq"`
		}
		if json.Unmarshal([]byte(n.Payload), &msg) != nil {
			continue
		}
		// Загружаем событие из журнала (durable) и рассылаем.
		var ev EncounterEvent
		if err := db.Where("encounter_id = ? AND seq = ?", msg.EncounterID, msg.Seq).First(&ev).Error; err != nil {
			continue
		}
		h.publishLocal(msg.EncounterID, sseBytes(ev.Seq, ev.Payload))
	}
}
