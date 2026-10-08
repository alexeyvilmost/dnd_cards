package main

import (
	"context"
	"os"
	"time"

	"github.com/gin-gonic/gin"
)

// Move verification/loading of a cold pinned frame to battle initialization.
// The caller has already loaded the owned aggregate. This accepts no command;
// command-time PostgreSQL owner and run/character revision gates remain intact.
func (rc *RoguelikeController) warmOwnedCombatRead(c *gin.Context, slot *combatCacheSlot, run *RoguelikeRun) {
	if run.Character == nil || len(run.CombatEnvelope) == 0 {
		return
	}
	artifact, _ := run.CombatEnvelope["artifactHash"].(string)
	if !roguelikeSnapshotHash.MatchString(artifact) {
		return
	}
	cache := rc.combatCache
	cache.mu.Lock()
	if cache.slots[combatCacheKey(run.ID, run.UserID)] != slot || slot.leases != 0 {
		cache.mu.Unlock()
		return
	}
	select {
	case slot.lane <- struct{}{}:
	default:
		cache.mu.Unlock()
		return
	}
	slot.leases++
	cache.mu.Unlock()
	defer func() {
		<-slot.lane
		cache.mu.Lock()
		slot.leases--
		slot.used = time.Now()
		cache.mu.Unlock()
	}()
	slot.mu.Lock()
	available := slot.run == nil && slot.pending == nil && !slot.failure
	slot.mu.Unlock()
	if !available {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), time.Second)
	defer cancel()
	defer performanceSince(ctx, "combat_read_warm_ms")()
	client := roguelikeWorkerClient{URL: os.Getenv("RULES_WORKER_URL"), Token: os.Getenv("RULES_WORKER_TOKEN")}
	body := cachedCombatWorkerBody(run, nil, "")
	// Loading an input frame must not compete with the player's first command
	// by immediately calculating an unused end-turn guess.
	body["deferPrediction"] = true
	result, err := client.call(ctx, "/prefetch", body)
	if err != nil {
		performanceAdd(ctx, "combat_read_warm_unavailable", 1)
		return
	}
	hash, _ := result.Trace["afterHash"].(string)
	if !roguelikeSnapshotHash.MatchString(hash) {
		performanceAdd(ctx, "combat_read_warm_unavailable", 1)
		return
	}
	slot.setFrame(run, hash)
	performanceAdd(ctx, "combat_read_warm_hit", 1)
}
