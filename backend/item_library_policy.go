package main

import (
	"dnd-cards-backend/itemsource"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func defaultItemSource(source *string) *string {
	if source == nil || strings.TrimSpace(*source) == "" {
		value := itemsource.BagOfHolding
		return &value
	}
	return source
}

// itemLibraryQuery is the boundary for catalog reads, including direct IDs and
// exports. Runtime builders that load saved/frozen content directly from the DB
// intentionally do not use this scope. Query flags cannot opt out of it.
func itemLibraryQuery(db *gorm.DB, c *gin.Context) *gorm.DB {
	c.Header("Cache-Control", "private, no-store")
	c.Header("Vary", "Authorization")
	query := db.Model(&Card{})
	if canManageEntityTags(c) {
		return query
	}
	return playerItemLibraryQuery(query)
}

// The same non-administrative predicate governs new ordinary-sheet grants.
func playerItemLibraryQuery(query *gorm.DB) *gorm.DB {
	return query.Where(`(cards.source = ? OR (cards.source = ? AND (
		cards.rarity IN ? OR (cards.rarity IN ? AND EXISTS (
			SELECT 1 FROM entity_tag_assignments visibility_tag
			WHERE visibility_tag.entity_type = 'card'
			AND visibility_tag.entity_id = cards.id::text
			AND visibility_tag.tag_id = ?
		))
	)))`, itemsource.PlayersHandbook, itemsource.BagOfHolding, []string{"common", "uncommon", "rare"},
		[]string{"very_rare", "epic", "legendary", "artifact", "relic"}, itemsource.AvailableForPlayersTagID)
}

// Accept the legacy rarity=value, comma-separated values, repeated rarity, and
// rarities. All supplied choices form one OR set; other filters still use AND.
func itemLibraryRarities(c *gin.Context) []string {
	seen := map[string]bool{}
	values := []string{}
	for _, key := range []string{"rarity", "rarities", "rarity[]", "rarities[]"} {
		for _, raw := range c.QueryArray(key) {
			for _, part := range strings.Split(raw, ",") {
				value := strings.TrimSpace(part)
				if value != "" && !seen[value] {
					seen[value] = true
					values = append(values, value)
				}
			}
		}
	}
	return values
}
