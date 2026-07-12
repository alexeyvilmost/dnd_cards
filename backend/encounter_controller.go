package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"gorm.io/gorm"
)

// EncounterController — серверная истина боя + realtime-рассылка (SSE) изменений всем
// подключённым клиентам (разные устройства/аккаунты). Cross-instance fan-out — через
// Postgres LISTEN/NOTIFY (без Redis): запись делает pg_notify, единый listener на процесс
// загружает событие из журнала и рассылает локальным SSE-подписчикам.
type EncounterController struct {
	db  *gorm.DB
	hub *EncounterHub
}

func NewEncounterController(db *gorm.DB, hub *EncounterHub) *EncounterController {
	return &EncounterController{db: db, hub: hub}
}

func (ec *EncounterController) resolveUserID(c *gin.Context) uuid.UUID {
	if v, ok := c.Get("user_id"); ok {
		if id, ok2 := v.(uuid.UUID); ok2 {
			return id
		}
	}
	// Авторизация отключена — общий public-пользователь (как в characters_v3).
	var user User
	if err := ec.db.Where("username = ?", "public").First(&user).Error; err == nil {
		return user.ID
	}
	user = User{Username: "public", Email: "public@local", PasswordHash: "disabled", DisplayName: "Публичный"}
	if err := ec.db.Create(&user).Error; err != nil {
		_ = ec.db.Where("username = ?", "public").First(&user).Error
	}
	return user.ID
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
func (ec *EncounterController) encounterConflict(cid string, thisEnc uuid.UUID) (string, bool) {
	charUUID, err := uuid.Parse(cid)
	if err != nil {
		return "", false
	}
	var ch CharacterV3
	if err := ec.db.Select("id", "current_encounter_id").First(&ch, "id = ?", charUUID).Error; err != nil {
		return "", false // персонажа нет — не наша забота
	}
	if ch.CurrentEncounterID == nil || *ch.CurrentEncounterID == thisEnc {
		return "", false
	}
	var other Encounter
	if err := ec.db.First(&other, "id = ?", *ch.CurrentEncounterID).Error; err != nil {
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

// --- CRUD ---

func (ec *EncounterController) Create(c *gin.Context) {
	var req CreateEncounterRequest
	_ = c.ShouldBindJSON(&req)
	name := req.Name
	if name == "" {
		name = "Бой"
	}
	owner := ec.resolveUserID(c)
	empty := JSONMap{"combatants": []interface{}{}, "round": 1, "activeIndex": 0}
	enc := Encounter{Name: name, OwnerUserID: owner, MemberUserIDs: Properties{owner.String()}, State: &empty, Seq: 0}
	if err := ec.db.Create(&enc).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "не удалось создать бой"})
		return
	}
	c.JSON(http.StatusCreated, enc)
}

func (ec *EncounterController) List(c *gin.Context) {
	var encs []Encounter
	if err := ec.db.Order("updated_at desc").Limit(100).Find(&encs).Error; err != nil {
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
	c.JSON(http.StatusOK, enc)
}

func (ec *EncounterController) Join(c *gin.Context) {
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
	uid := ec.resolveUserID(c).String()
	members := Properties{}
	if enc.MemberUserIDs != nil {
		members = enc.MemberUserIDs
	}
	found := false
	for _, m := range members {
		if m == uid {
			found = true
			break
		}
	}
	if !found {
		members = append(members, uid)
		enc.MemberUserIDs = members
		_ = ec.db.Save(&enc).Error
	}
	c.JSON(http.StatusOK, enc)
}

// Apply — применить операцию (client-authoritative-relay): бампит seq, персистит state,
// пишет событие в журнал и рассылает через pg_notify → SSE. Возвращает новый seq/state.
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
	var enc Encounter
	if err := ec.db.First(&enc, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "бой не найден"})
		return
	}
	state := map[string]interface{}{}
	if enc.State != nil {
		state = *enc.State
	}
	before := characterIDsInState(state)
	newState := JSONMap(applyOps(state, req))
	after := characterIDsInState(newState)

	// Правило «один бой на персонажа»: если добавляемый персонаж уже в другом бою — отказ.
	for cid := range after {
		if !before[cid] {
			if otherName, conflict := ec.encounterConflict(cid, id); conflict {
				c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("Персонаж уже участвует в бою «%s»", otherName)})
				return
			}
		}
	}

	newSeq := enc.Seq + 1
	enc.State = &newState
	enc.Seq = newSeq
	payload := opPayload(req)
	ev := EncounterEvent{EncounterID: id, Seq: newSeq, Payload: &payload}
	if err := ec.db.Transaction(func(tx *gorm.DB) error {
		if e := tx.Save(&enc).Error; e != nil {
			return e
		}
		if e := tx.Create(&ev).Error; e != nil {
			return e
		}
		// Связь персонаж→бой: проставить добавленным, снять убранным (атомарно с state).
		for cid := range after {
			if !before[cid] {
				if u, e := uuid.Parse(cid); e == nil {
					if e := tx.Model(&CharacterV3{}).Where("id = ?", u).Update("current_encounter_id", id).Error; e != nil {
						return e
					}
				}
			}
		}
		for cid := range before {
			if !after[cid] {
				if u, e := uuid.Parse(cid); e == nil {
					// снимаем только если ссылка ведёт на этот бой (персонаж мог уже уйти в другой)
					if e := tx.Model(&CharacterV3{}).Where("id = ? AND current_encounter_id = ?", u, id).Update("current_encounter_id", nil).Error; e != nil {
						return e
					}
				}
			}
		}
		return nil
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "не удалось применить"})
		return
	}
	// Дверной звонок всем инстансам (включая свой) — listener загрузит событие и разошлёт.
	ec.hub.notify(ec.db, id.String(), newSeq)
	c.JSON(http.StatusOK, gin.H{"seq": newSeq, "state": enc.State})
}

// Stream — SSE-поток изменений боя. ?since=<seq> — реплей пропущенного (докачка), затем live.
// Подписываемся ДО реплея, чтобы не потерять событие в зазоре; клиент дедуплит по seq.
func (ec *EncounterController) Stream(c *gin.Context) {
	id := c.Param("id")
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

	ch := ec.hub.subscribe(id)
	defer ec.hub.unsubscribe(id, ch)

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
