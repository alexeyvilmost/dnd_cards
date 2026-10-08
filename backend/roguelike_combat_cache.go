package main

import (
	"context"
	"log"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// One unflushed command per run is the explicitly accepted loss budget. Slots
// serialize all run commands; PostgreSQL still checks ownership and revisions
// under row locks before an asynchronous response is released.
type combatCacheSlot struct {
	lane        chan struct{}
	mu          sync.Mutex
	run         *RoguelikeRun
	hash        string
	commandID   uuid.UUID
	requestHash string
	receiptRun  *RoguelikeRun
	pending     chan struct{}
	failure     bool
	used        time.Time
	leases      int
}
type combatRuntimeCache struct {
	mu    sync.Mutex
	slots map[string]*combatCacheSlot
}

var combatPersistenceWG sync.WaitGroup

func newCombatRuntimeCache() *combatRuntimeCache {
	return &combatRuntimeCache{slots: map[string]*combatCacheSlot{}}
}
func combatCacheKey(id, owner uuid.UUID) string { return owner.String() + ":" + id.String() }
func (cache *combatRuntimeCache) acquire(ctx context.Context, id, owner uuid.UUID) (*combatCacheSlot, func(), error) {
	key := combatCacheKey(id, owner)
	cache.mu.Lock()
	slot := cache.slots[key]
	if slot == nil {
		// Bound retained private frames. In-flight slots cannot be evicted.
		for len(cache.slots) >= 16 {
			var oldest string
			for k, s := range cache.slots {
				s.mu.Lock()
				pending := s.pending != nil
				s.mu.Unlock()
				if s.leases == 0 && !pending && (oldest == "" || s.used.Before(cache.slots[oldest].used)) {
					oldest = k
				}
			}
			if oldest == "" {
				break
			}
			delete(cache.slots, oldest)
		}
		if len(cache.slots) >= 32 {
			cache.mu.Unlock()
			return nil, nil, roguelikeError(503, "combat_cache_busy", "Бои заняты обработкой команд; повторите запрос")
		}
		slot = &combatCacheSlot{lane: make(chan struct{}, 1)}
		cache.slots[key] = slot
	}
	slot.leases++
	slot.used = time.Now()
	cache.mu.Unlock()
	select {
	case slot.lane <- struct{}{}:
	case <-ctx.Done():
		cache.mu.Lock()
		slot.leases--
		cache.mu.Unlock()
		return nil, nil, ctx.Err()
	}
	release := func() { <-slot.lane; cache.mu.Lock(); slot.leases--; slot.used = time.Now(); cache.mu.Unlock() }
	slot.mu.Lock()
	pending := slot.pending
	slot.mu.Unlock()
	if pending != nil {
		done := performanceSince(ctx, "previous_persistence_wait_ms")
		select {
		case <-pending:
		case <-ctx.Done():
			done()
			release()
			return nil, nil, ctx.Err()
		}
		done()
	}
	slot.mu.Lock()
	failed := slot.failure
	slot.mu.Unlock()
	if failed {
		release()
		return nil, nil, roguelikeError(503, "combat_persistence_failed", "Последний ход не сохранился. Обновите бой перед следующим действием.")
	}
	return slot, release, nil
}
func cloneCachedCombatRun(run *RoguelikeRun) *RoguelikeRun {
	copy := *run
	copy.Characters = nil
	for _, c := range run.Characters {
		member := *c
		copy.Characters = append(copy.Characters, &member)
		if c.ID == run.CharacterID {
			copy.Character = &member
		}
	}
	if len(copy.Characters) == 0 && run.Character != nil {
		character := *run.Character
		copy.Character = &character
	}
	return &copy
}
func (slot *combatCacheSlot) frame() (*RoguelikeRun, string) {
	slot.mu.Lock()
	defer slot.mu.Unlock()
	if slot.run == nil {
		return nil, ""
	}
	return cloneCachedCombatRun(slot.run), slot.hash
}
func (slot *combatCacheSlot) setFrame(run *RoguelikeRun, hash string) {
	slot.mu.Lock()
	defer slot.mu.Unlock()
	slot.run = cloneCachedCombatRun(run)
	slot.hash = hash
}
func (slot *combatCacheSlot) load(db *gorm.DB, id, owner uuid.UUID, locked bool) (*RoguelikeRun, error) {
	frame, _ := slot.frame()
	if frame != nil {
		var gate struct {
			ID        uuid.UUID
			Revision  int64
			UpdatedAt time.Time
		}
		query := db.Model(&RoguelikeRun{}).Select("id", "revision", "updated_at").Where("id=? AND user_id=?", id, owner)
		if locked {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.First(&gate).Error; err != nil {
			return nil, err
		}
		if gate.Revision == frame.Revision && gate.UpdatedAt.Equal(frame.UpdatedAt) {
			ids := []uuid.UUID{}
			for _, c := range roguelikeCharacters(frame) {
				ids = append(ids, c.ID)
			}
			var members []struct {
				ID              uuid.UUID
				RuntimeRevision int64
				UpdatedAt       time.Time
			}
			q := db.Model(&CharacterV3{}).Select("id", "runtime_revision", "updated_at").Where("id IN ? AND user_id=?", ids, owner).Order("id")
			if locked {
				q = q.Clauses(clause.Locking{Strength: "UPDATE"})
			}
			if err := q.Find(&members).Error; err != nil {
				return nil, err
			}
			match := len(members) == len(ids)
			for _, row := range members {
				found := false
				for _, c := range roguelikeCharacters(frame) {
					if c.ID == row.ID {
						found = c.RuntimeRevision == row.RuntimeRevision && c.UpdatedAt.Equal(row.UpdatedAt)
					}
				}
				match = match && found
			}
			if match {
				performanceAdd(db.Statement.Context, "combat_frame_cache_hit", 1)
				if locked && frame.storageOriginal == nil {
					if err := captureColdRunColumns(frame); err != nil {
						return nil, err
					}
				}
				return frame, nil
			}
		}
	}
	performanceAdd(db.Statement.Context, "combat_frame_cache_miss", 1)
	run, err := ownedRoguelikeRun(db, id, owner, locked)
	if err == nil {
		slot.setFrame(run, "")
	}
	return run, err
}
func (cache *combatRuntimeCache) pendingFrame(id, owner uuid.UUID) *RoguelikeRun {
	cache.mu.Lock()
	slot := cache.slots[combatCacheKey(id, owner)]
	cache.mu.Unlock()
	if slot == nil {
		return nil
	}
	slot.mu.Lock()
	defer slot.mu.Unlock()
	if slot.pending == nil || slot.run == nil || slot.failure {
		return nil
	}
	return cloneCachedCombatRun(slot.run)
}

// A retry does not accept a second command and need not wait for persistence.
// It returns the exact immutable frame already acknowledged to this owner.
func (cache *combatRuntimeCache) replay(id, owner, commandID uuid.UUID, requestHash string) (*RoguelikeRun, bool, error) {
	cache.mu.Lock()
	slot := cache.slots[combatCacheKey(id, owner)]
	cache.mu.Unlock()
	if slot == nil {
		return nil, false, nil
	}
	slot.mu.Lock()
	defer slot.mu.Unlock()
	if slot.failure || slot.receiptRun == nil || slot.commandID != commandID {
		return nil, false, nil
	}
	if slot.requestHash != requestHash {
		return nil, false, roguelikeError(409, "command_id_reused", "ID команды уже использован")
	}
	return cloneCachedCombatRun(slot.receiptRun), slot.pending != nil, nil
}

// Successful completion restores ordinary durable semantics. A failed write
// invalidates the uncommitted frame and blocks further commands until a reload.
func (slot *combatCacheSlot) finish(err error, started time.Time, requestID string, published bool) {
	slot.mu.Lock()
	if err != nil {
		slot.run = nil
		slot.hash = ""
		slot.failure = published
		if published {
			slot.receiptRun = nil
			slot.commandID = uuid.Nil
			slot.requestHash = ""
		}
	}
	done := slot.pending
	slot.pending = nil
	slot.mu.Unlock()
	if done != nil {
		close(done)
	}
	status := "saved"
	if err != nil {
		status = "failed"
	}
	log.Printf("combat_persistence request_id=%s status=%s duration_ms=%.3f", requestID, status, float64(time.Since(started).Microseconds())/1000)
}
func (cache *combatRuntimeCache) acknowledgeReload(id, owner uuid.UUID) {
	cache.mu.Lock()
	slot := cache.slots[combatCacheKey(id, owner)]
	cache.mu.Unlock()
	if slot == nil {
		return
	}
	slot.mu.Lock()
	if slot.pending == nil && slot.failure {
		slot.failure = false
		slot.run = nil
		slot.hash = ""
	}
	slot.mu.Unlock()
}
func combatAsyncEnabled() bool { return os.Getenv("RULES_COMBAT_ASYNC_PERSIST_ENABLED") == "1" }

// Publish only the canonical reloaded aggregate after a successful transaction.
// Opening presentation and failed/replayed transactions cannot become a base.
func (rc *RoguelikeController) primeCommittedCombat(run *RoguelikeRun, trace JSONMap) {
	if !combatAsyncEnabled() || rc.combatCache == nil || run == nil || len(run.CombatEnvelope) == 0 {
		return
	}
	rc.combatCache.mu.Lock()
	slot := rc.combatCache.slots[combatCacheKey(run.ID, run.UserID)]
	rc.combatCache.mu.Unlock()
	if slot == nil {
		return
	}
	hash, _ := trace["afterHash"].(string)
	if !roguelikeSnapshotHash.MatchString(hash) {
		hash = ""
	}
	slot.setFrame(run, hash)
}

// Warm recent active snapshots after process startup without accepting a game
// command or writing to PostgreSQL. Revision gates still run on each command.
func (rc *RoguelikeController) warmCombatCache() {
	if !combatAsyncEnabled() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var runs []struct{ ID, UserID uuid.UUID }
	if rc.db.WithContext(ctx).Model(&RoguelikeRun{}).Select("id", "user_id").Where("status=? AND phase=?", RoguelikeStatusActive, RoguelikePhaseCombat).Order("updated_at DESC").Limit(8).Find(&runs).Error != nil {
		log.Print("combat_cache_warm status=unavailable")
		return
	}
	count := 0
	for _, run := range runs {
		slot, release, err := rc.combatCache.acquire(ctx, run.ID, run.UserID)
		if err != nil {
			continue
		}
		func() {
			defer release()
			frame, err := slot.load(rc.db.WithContext(ctx), run.ID, run.UserID, false)
			if err != nil || len(frame.CombatEnvelope) == 0 {
				return
			}
			client := roguelikeWorkerClient{URL: os.Getenv("RULES_WORKER_URL"), Token: os.Getenv("RULES_WORKER_TOKEN")}
			result, err := client.call(ctx, "/prefetch", map[string]any{"artifactHash": frame.CombatEnvelope["artifactHash"], "envelope": frame.CombatEnvelope})
			if err == nil {
				hash, _ := result.Trace["afterHash"].(string)
				slot.setFrame(frame, hash)
				count++
			}
		}()
	}
	log.Printf("combat_cache_warm status=finished count=%d", count)
}
func waitCombatPersistence(ctx context.Context) error {
	done := make(chan struct{})
	go func() { combatPersistenceWG.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
