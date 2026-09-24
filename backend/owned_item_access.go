package main

import (
	"net/http"
	"sort"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// All caller-owned runtime access flows through this scope. In particular,
// current arbitrary free-sheet JSON is NEVER evidence of item entitlement.
func ownedItemQuery(db *gorm.DB, userID uuid.UUID) *gorm.DB {
	return db.Model(&Card{}).Where(`cards.id::text IN (
 SELECT g.card_id::text FROM owned_item_grants g
 JOIN characters_v3 ch ON ch.id=g.character_id AND ch.user_id=g.user_id
 WHERE g.user_id=? AND ch.character_type IN ('free','campaign')
 UNION
 SELECT refs.card_id FROM roguelike_runs run
 JOIN characters_v3 ch ON ch.user_id=run.user_id AND ch.character_type='dungeon_crawl' AND (
   (COALESCE(run.party,'{}'::jsonb)='{}'::jsonb AND ch.id=run.character_id)
   OR (run.party->'members'->0->>'character_id'=run.character_id::text AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(run.party->'members')='array' THEN run.party->'members' ELSE '[]'::jsonb END) member
     WHERE member->>'character_id'=ch.id::text)))
 CROSS JOIN LATERAL saved_item_card_ids(ch.equipment,ch.inventory_items) refs
 WHERE run.user_id=? AND run.status IN ('active','victory','defeat')
 UNION
 SELECT offer->>'card_id' FROM roguelike_runs run
 CROSS JOIN LATERAL jsonb_array_elements(
   CASE WHEN jsonb_typeof(run.shop->'offers')='array' THEN run.shop->'offers' ELSE '[]'::jsonb END ||
   CASE WHEN jsonb_typeof(run.shop->'staples')='array' THEN run.shop->'staples' ELSE '[]'::jsonb END ||
   CASE WHEN jsonb_typeof(run.last_reward->'items')='array' THEN run.last_reward->'items' ELSE '[]'::jsonb END ||
   CASE WHEN jsonb_typeof(run.last_reward->'item')='object' THEN jsonb_build_array(run.last_reward->'item') ELSE '[]'::jsonb END
 ) offer
 WHERE run.user_id=? AND run.status IN ('active','victory','defeat')
 )`, userID, userID, userID)
}

// Keep /cards, exports and tag-member discovery strictly library-only. A direct
// reference can additionally resolve a saved grant or a server-managed run.
func itemAccessQuery(db *gorm.DB, c *gin.Context) *gorm.DB {
	library := itemLibraryQuery(db, c)
	userID, err := GetCurrentUserID(c)
	if err != nil || userID == uuid.Nil || canManageEntityTags(c) {
		return library
	}
	return db.Model(&Card{}).Where("cards.id IN (?) OR cards.id IN (?)",
		library.Select("cards.id"), ownedItemQuery(db, userID).Select("cards.id"))
}

// Called only in a transaction after locking/authorizing the owning character.
// New hidden IDs cannot become grants by first writing them into free inventory.
// Existing grants are per-character and cannot be copied to a fresh sheet.
// actorIsAdmin comes from the authenticated request, never character.UserID.
func grantOrdinaryCharacterItems(tx *gorm.DB, character CharacterV3, equipment *JSONMap, inventory *InventoryItemRows, actorIsAdmin bool) error {
	if equipment == nil && inventory == nil {
		return nil
	}
	owned, err := roguelikeItemOwnership(equipment, inventory)
	if err != nil {
		return invalidRuntimeCommand(err.Error())
	}
	ids := make([]string, 0, len(owned))
	for id := range owned {
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil
	}
	sort.Strings(ids)
	visibleItems := func() *gorm.DB {
		query := tx.Model(&Card{})
		if !actorIsAdmin {
			query = playerItemLibraryQuery(query)
		}
		return query
	}
	var allowed []string
	if err := tx.Model(&Card{}).Where("cards.id IN ?", ids).Where(
		"cards.id IN (?) OR cards.id IN (SELECT card_id FROM owned_item_grants WHERE character_id=? AND user_id=?)",
		visibleItems().Select("cards.id"), character.ID, character.UserID,
	).Pluck("cards.id", &allowed).Error; err != nil {
		return err
	}
	if len(allowed) != len(ids) {
		return &characterRuntimeCommandError{Status: http.StatusForbidden, Code: "item_not_available", Message: "новый предмет недоступен этому персонажу", CharacterID: character.ID.String()}
	}
	// The INSERT itself repeats the visibility predicate: even an old grant
	// cannot grant a different character or turn a hidden card into a new grant.
	visible := visibleItems().Where("cards.id IN ?", ids).Select("cards.id")
	reason := "library"
	if actorIsAdmin {
		reason = "admin"
	}
	return tx.Exec(`INSERT INTO owned_item_grants(character_id,user_id,card_id,reason)
	 SELECT ?,?,cards.id,? FROM cards WHERE cards.id IN (?) ON CONFLICT DO NOTHING`, character.ID, character.UserID, reason, visible).Error
}

// Legacy untrusted combat PATCHes can consume but cannot mint run inventory.
// Camp's existing guard is stronger (exact ownership equality).
func validateRunItemPatch(character CharacterV3, req PatchCharacterRuntimeRequest) error {
	if req.Equipment == nil && req.InventoryItems == nil {
		return nil
	}
	equipment, inventory := character.Equipment, character.InventoryItems
	if req.Equipment != nil {
		equipment = req.Equipment
	}
	if req.InventoryItems != nil {
		inventory = req.InventoryItems
	}
	before, err := roguelikeItemOwnership(character.Equipment, character.InventoryItems)
	if err != nil {
		return invalidRuntimeCommand(err.Error())
	}
	after, err := roguelikeItemOwnership(equipment, inventory)
	if err != nil {
		return invalidRuntimeCommand(err.Error())
	}
	for id, qty := range after {
		if qty > before[id] {
			return roguelikeMutationError("roguelike_item_ownership_changed", "изменение листа не может выдавать предметы забега", character.ID)
		}
	}
	return nil
}

// Register from main alongside the card routes, after migration 265 is applied.
func registerOwnedItemRoutes(api *gin.RouterGroup, auth *AuthService, db *gorm.DB) {
	api.GET("/my-item-catalog", StrictAuthMiddleware(auth), (&CardController{db: db}).GetMyItemCatalog)
}

func (cc *CardController) GetMyItemCatalog(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("Vary", "Authorization")
	userID, ok := requireCharacterV3UserID(c)
	if !ok {
		return
	}
	query := ownedItemQuery(cc.db, userID)
	page, limit, offset := parseListPagination(c)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(500, gin.H{"error": "ошибка личного каталога"})
		return
	}
	light := wantsListView(c)
	if light {
		query = query.Omit("ImageURL", "DetailedDescription", "ImageGenerationPrompt", "Mechanics")
	}
	var cards []Card
	if err := query.Order("cards.id").Offset(offset).Limit(limit).Find(&cards).Error; err != nil {
		c.JSON(500, gin.H{"error": "ошибка личного каталога"})
		return
	}
	responses, err := cc.cardListResponses(cards, light)
	if err != nil {
		c.JSON(500, gin.H{"error": "ошибка личного каталога"})
		return
	}
	c.JSON(200, gin.H{"cards": responses, "total": total, "page": page, "limit": limit})
}
