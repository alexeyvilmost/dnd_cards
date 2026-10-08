package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// This token proves only the exact JSON supplied to this reader. It never
// participates in command acceptance, receipts, ownership or revision checks.
func (rc *RoguelikeController) writeCombatReadResponse(c *gin.Context, run *RoguelikeRun) {
	if combatAsyncEnabled() && rc.combatCache != nil && c.GetHeader("X-Combat-Wire") == combatDeltaWire && run != nil && run.Status == RoguelikeStatusActive && run.Phase == RoguelikePhaseCombat && len(run.CombatState) > 0 {
		rc.combatCache.mu.Lock()
		slot := rc.combatCache.slots[combatCacheKey(run.ID, run.UserID)]
		rc.combatCache.mu.Unlock()
		if slot == nil {
			var release func()
			var err error
			slot, release, err = rc.combatCache.acquire(c.Request.Context(), run.ID, run.UserID)
			if err == nil {
				release()
			}
		}
		if slot != nil {
			rc.warmOwnedCombatRead(c, slot, run)
			token := "read:" + uuid.NewString()
			slot.mu.Lock()
			slot.readBase = &RoguelikeRun{ID: run.ID, UserID: run.UserID, Revision: run.Revision, CombatState: run.CombatState}
			slot.readBaseID = token
			slot.mu.Unlock()
			c.Header("X-Combat-Read-Base", token)
			writeCombatRunResponse(c, run)
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"run": run})
}
