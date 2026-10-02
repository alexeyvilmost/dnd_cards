package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"io"
	"net/http"
	"os"
)

type CharacterItemSaleRequest struct {
	CommandID               string `json:"command_id"`
	ExpectedRuntimeRevision int64  `json:"expected_runtime_revision"`
	CardID                  string `json:"card_id"`
	Quantity                int    `json:"quantity"`
}

// A sale is computed from locked, server-owned inventory and card data. Its
// receipt shares the caller command namespace with other atomic sheet changes.
func (cc *CharacterV3Controller) SellCharacterItem(c *gin.Context) {
	userID, ok := requireCharacterV3UserID(c)
	if !ok || cc.rejectLegacyPublicIdentity(c, userID) {
		return
	}
	characterID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "неверный ID персонажа"})
		return
	}
	raw, err := c.GetRawData()
	if err != nil {
		c.JSON(400, gin.H{"error": "не удалось прочитать продажу"})
		return
	}
	var request CharacterItemSaleRequest
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&request); err != nil {
		c.JSON(400, gin.H{"error": "неверная команда продажи"})
		return
	}
	if err = decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		c.JSON(400, gin.H{"error": "неверная команда продажи"})
		return
	}
	commandID, err := uuid.Parse(request.CommandID)
	if err != nil || commandID == uuid.Nil || request.ExpectedRuntimeRevision < 0 || request.Quantity < 1 || request.Quantity > 10000 {
		c.JSON(400, gin.H{"error": "неверная команда продажи"})
		return
	}
	_, canonical, err := canonicalizeRawJSON(raw)
	if err != nil {
		c.JSON(400, gin.H{"error": "неверная команда продажи"})
		return
	}
	requestHash := canonicalSHA256([]byte(characterID.String() + ":inventory-sale:" + string(canonical)))
	var response JSONMap
	err = cc.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", userID.String()+":"+commandID.String()).Error; err != nil {
			return err
		}
		var receipt CharacterRuntimeCommandRecord
		lookup := tx.Where("user_id = ? AND command_id = ?", userID, commandID).First(&receipt)
		if lookup.Error == nil {
			if receipt.RequestHash != requestHash {
				return roguelikeError(409, "command_id_reuse", "ID команды уже использован")
			}
			response = cloneJSONMapValue(&receipt.Response)
			response["replayed"] = true
			return nil
		}
		if !errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
			return lookup.Error
		}
		var character CharacterV3
		if err := characterV3OwnerScope(tx.Clauses(clause.Locking{Strength: "UPDATE"}), c, userID).
			Where("id = ?", characterID).First(&character).Error; err != nil {
			return roguelikeError(403, "sale_forbidden", "Нет доступа к персонажу")
		}
		if character.CharacterType == "dungeon_crawl" {
			return roguelikeError(409, "run_shop_required", "Продавайте предметы через магазин забега")
		}
		if character.CurrentEncounterID != nil || characterSaleCombatActive(character.TurnState) {
			return roguelikeError(409, "character_in_combat", "Продажа недоступна во время боя")
		}
		if character.RuntimeRevision != request.ExpectedRuntimeRevision {
			return roguelikeError(409, "runtime_revision_conflict", "Состояние персонажа изменилось: обновите магазин")
		}
		next, amount, err := projectOwnedItemSale(c.Request.Context(), tx, roguelikeWorkerClient{URL: os.Getenv("RULES_WORKER_URL"), Token: os.Getenv("RULES_WORKER_TOKEN")}, &character, JSONMap{"card_id": request.CardID, "quantity": request.Quantity})
		if err != nil {
			return err
		}
		wallet, err := saleWalletCopper(&character)
		if err != nil {
			return err
		}
		wallet += amount
		if wallet < 0 || wallet > 1000000000000 {
			return roguelikeError(409, "wallet_limit", "Слишком большая сумма продажи")
		}
		setCurrencyCopper(next, wallet)
		if err := tx.Omit("User", "Group").Save(next).Error; err != nil {
			return err
		}
		next.AccessMode = characterV3AccessOwner
		response, err = mapFromJSON(map[string]any{"character": next, "command_id": request.CommandID, "replayed": false, "received_copper": amount})
		if err != nil {
			return err
		}
		return tx.Create(&CharacterRuntimeCommandRecord{UserID: userID, CommandID: commandID, RequestHash: requestHash, RulesetRef: JSONMap{"operation": "inventory-sale"}, Response: response}).Error
	})
	if err != nil {
		writeRoguelikeError(c, err)
		return
	}
	c.JSON(http.StatusOK, response)
}

func characterSaleCombatActive(turn *JSONMap) bool {
	if turn == nil {
		return false
	}
	solo, _ := (*turn)["solo_combat_v1"].(map[string]any)
	if solo["outcome"] == "active" {
		return true
	}
	pending, _ := (*turn)["canonical_pending_combat_v1"].(map[string]any)
	if world, ok := pending["world"].(map[string]any); ok {
		if world["pendingResolution"] != nil || world["pendingDecision"] != nil {
			return true
		}
		if scene, ok := world["scene"].(map[string]any); ok && (scene["mode"] == "combat" || scene["mode"] == "encounter") {
			return true
		}
	}
	return false
}
