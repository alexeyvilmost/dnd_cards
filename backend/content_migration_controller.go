package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"reflect"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var contentMigrationSHA256Pattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
var contentMigrationCardNumberPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,30}$`)

var (
	errContentMigrationConflict = errors.New("content migration CAS conflict")
	errContentMigrationNotFound = errors.New("content migration receipt not found")
)

type ContentMigrationCreateReceipt struct {
	ID                 uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	BundleID           uuid.UUID  `json:"bundle_id" gorm:"type:uuid;not null"`
	PlanHash           string     `json:"plan_hash" gorm:"type:varchar(71);not null"`
	OperationID        string     `json:"operation_id" gorm:"type:varchar(255);not null"`
	EntityType         string     `json:"entity_type" gorm:"type:varchar(20);not null"`
	EntityID           uuid.UUID  `json:"entity_id" gorm:"type:uuid;not null"`
	CardNumber         string     `json:"card_number" gorm:"type:varchar(255);not null"`
	PostimageHash      string     `json:"postimage_hash" gorm:"type:varchar(71);not null"`
	Postimage          JSONMap    `json:"postimage" gorm:"type:jsonb;not null"`
	CreatedByUserID    uuid.UUID  `json:"created_by_user_id" gorm:"type:uuid;not null"`
	Status             string     `json:"status" gorm:"type:varchar(20);not null"`
	CreatedAt          time.Time  `json:"created_at"`
	RolledBackAt       *time.Time `json:"rolled_back_at"`
	RolledBackByUserID *uuid.UUID `json:"rolled_back_by_user_id" gorm:"type:uuid"`
}

func (ContentMigrationCreateReceipt) TableName() string {
	return "content_migration_create_receipts"
}

type ContentMigrationEffectCreateRequest struct {
	SchemaVersion int                 `json:"schema_version"`
	PlanHash      string              `json:"plan_hash"`
	OperationID   string              `json:"operation_id"`
	Entity        CreateEffectRequest `json:"entity"`
}

type ContentMigrationActionCreateRequest struct {
	SchemaVersion int                 `json:"schema_version"`
	PlanHash      string              `json:"plan_hash"`
	OperationID   string              `json:"operation_id"`
	Entity        CreateActionRequest `json:"entity"`
}

type ContentMigrationEffectRollbackRequest struct {
	SchemaVersion       int       `json:"schema_version"`
	BundleID            uuid.UUID `json:"bundle_id"`
	PlanHash            string    `json:"plan_hash"`
	OperationID         string    `json:"operation_id"`
	CardNumber          string    `json:"card_number"`
	ExpectedCurrentHash string    `json:"expected_current_hash"`
}

type ContentMigrationSupportRollbackRequest struct {
	SchemaVersion   int             `json:"schema_version"`
	ExpectedCurrent json.RawMessage `json:"expected_current"`
	Support         json.RawMessage `json:"support"`
}

type ContentMigrationReceiptResponse struct {
	ReceiptID     uuid.UUID `json:"receipt_id"`
	BundleID      uuid.UUID `json:"bundle_id"`
	PlanHash      string    `json:"plan_hash"`
	OperationID   string    `json:"operation_id"`
	EntityID      uuid.UUID `json:"entity_id"`
	CardNumber    string    `json:"card_number"`
	PostimageHash string    `json:"postimage_hash"`
}

type ContentMigrationEffectCreateResponse struct {
	Entity   EffectResponse                  `json:"entity"`
	Rollback ContentMigrationReceiptResponse `json:"rollback"`
}

type ContentMigrationActionCreateResponse struct {
	Entity   ActionResponse                  `json:"entity"`
	Rollback ContentMigrationReceiptResponse `json:"rollback"`
}

type contentMigrationCreateEffectFunc func(
	bundleID uuid.UUID,
	request ContentMigrationEffectCreateRequest,
	actorUserID uuid.UUID,
) (ContentMigrationEffectCreateResponse, error)

type contentMigrationRollbackEffectFunc func(
	entityID uuid.UUID,
	request ContentMigrationEffectRollbackRequest,
	actorUserID uuid.UUID,
) (alreadyRolledBack bool, err error)

type contentMigrationCreateActionFunc func(
	bundleID uuid.UUID,
	request ContentMigrationActionCreateRequest,
	actorUserID uuid.UUID,
) (ContentMigrationActionCreateResponse, error)

type contentMigrationRollbackActionFunc func(
	entityID uuid.UUID,
	request ContentMigrationEffectRollbackRequest,
	actorUserID uuid.UUID,
) (alreadyRolledBack bool, err error)

type contentMigrationRestoreSupportFunc func(
	entityType string,
	entityID uuid.UUID,
	expectedCurrent any,
	support any,
) (alreadyRestored bool, err error)

type ContentMigrationController struct {
	db               *gorm.DB
	certificationKey string
	createEffect     contentMigrationCreateEffectFunc
	rollbackEffect   contentMigrationRollbackEffectFunc
	createAction     contentMigrationCreateActionFunc
	rollbackAction   contentMigrationRollbackActionFunc
	restoreSupport   contentMigrationRestoreSupportFunc
	batchSupport     contentMigrationBatchSupportFunc
	exactUpdate      contentMigrationExactUpdateFunc
}

func NewContentMigrationController(db *gorm.DB) *ContentMigrationController {
	controller := &ContentMigrationController{
		db:               db,
		certificationKey: strings.TrimSpace(os.Getenv("CONTENT_CERTIFICATION_KEY")),
	}
	controller.createEffect = controller.createEffectWithReceipt
	controller.rollbackEffect = controller.rollbackCreatedEffect
	controller.createAction = controller.createActionWithReceipt
	controller.rollbackAction = controller.rollbackCreatedAction
	controller.restoreSupport = controller.restoreExactSupport
	controller.batchSupport = controller.applyExactSupportBatch
	controller.exactUpdate = controller.updateExactContent
	return controller
}

func (cc *ContentMigrationController) authorize(c *gin.Context) bool {
	if cc.certificationKey == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "content migration API не настроен"})
		return false
	}
	if !isCertificationKeyAuthorized(cc.certificationKey, c.GetHeader("X-Content-Certification-Key")) {
		c.JSON(http.StatusForbidden, gin.H{"error": "нет доступа к миграции контента"})
		return false
	}
	return true
}

func decodeStrictContentMigrationJSON(c *gin.Context, destination any) error {
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

func validateContentMigrationIdentity(planHash, operationID, cardNumber string) error {
	if !contentMigrationSHA256Pattern.MatchString(planHash) {
		return errors.New("invalid plan_hash")
	}
	if strings.TrimSpace(operationID) == "" || len(operationID) > 255 {
		return errors.New("invalid operation_id")
	}
	if !contentMigrationCardNumberPattern.MatchString(cardNumber) {
		return errors.New("invalid card_number")
	}
	return nil
}

func validateContentMigrationEffectCreate(request ContentMigrationEffectCreateRequest) error {
	if request.SchemaVersion != 1 {
		return errors.New("unsupported schema_version")
	}
	if err := validateContentMigrationIdentity(
		request.PlanHash,
		request.OperationID,
		request.Entity.CardNumber,
	); err != nil {
		return err
	}
	if strings.TrimSpace(request.Entity.Name) == "" ||
		strings.TrimSpace(request.Entity.Description) == "" ||
		strings.TrimSpace(string(request.Entity.EffectType)) == "" {
		return errors.New("name, description and effect_type are required")
	}
	if !IsValidRarity(request.Entity.Rarity) {
		return errors.New("invalid rarity")
	}
	if !ValidateProperties(request.Entity.Properties) ||
		!ValidatePrice(request.Entity.Price) ||
		!ValidateWeight(request.Entity.Weight) {
		return errors.New("invalid effect properties, price or weight")
	}
	return nil
}

func effectFromContentMigrationRequest(request CreateEffectRequest) Effect {
	author := request.Author
	if author == "" {
		author = "Admin"
	}
	return Effect{
		Name: request.Name, NameEn: request.NameEn, Description: request.Description,
		DetailedDescription: request.DetailedDescription, ImageURL: request.ImageURL,
		Rarity: request.Rarity, CardNumber: request.CardNumber, EffectType: request.EffectType,
		ConditionDescription: request.ConditionDescription, Script: request.Script,
		Mechanics: request.Mechanics, Type: request.Type, Author: author, Source: request.Source,
		Tags: request.Tags, Price: request.Price, Weight: request.Weight, Properties: request.Properties,
		RelatedCards: request.RelatedCards, RelatedActions: request.RelatedActions,
		RelatedEffects: request.RelatedEffects, Repeatable: request.Repeatable,
		IsExtended: request.IsExtended, DescriptionFontSize: request.DescriptionFontSize,
		TextAlignment: request.TextAlignment, TextFontSize: request.TextFontSize,
		ShowDetailedDescription:      request.ShowDetailedDescription,
		DetailedDescriptionAlignment: request.DetailedDescriptionAlignment,
		DetailedDescriptionFontSize:  request.DetailedDescriptionFontSize,
	}
}

func validateContentMigrationActionCreate(request ContentMigrationActionCreateRequest) error {
	if request.SchemaVersion != 1 {
		return errors.New("unsupported schema_version")
	}
	if err := validateContentMigrationIdentity(
		request.PlanHash, request.OperationID, request.Entity.CardNumber,
	); err != nil {
		return err
	}
	if strings.TrimSpace(request.Entity.Name) == "" ||
		strings.TrimSpace(request.Entity.Description) == "" ||
		strings.TrimSpace(string(request.Entity.ActionType)) == "" ||
		len(request.Entity.Resources) == 0 {
		return errors.New("name, description, action_type and resources are required")
	}
	if !IsValidRarity(request.Entity.Rarity) ||
		!ValidateProperties(request.Entity.Properties) ||
		!ValidatePrice(request.Entity.Price) ||
		!ValidateWeight(request.Entity.Weight) {
		return errors.New("invalid action rarity, properties, price or weight")
	}
	return nil
}

func actionFromContentMigrationRequest(request CreateActionRequest) Action {
	resources := make(ActionResources, len(request.Resources))
	copy(resources, request.Resources)
	author := request.Author
	if author == "" {
		author = "Admin"
	}
	return Action{
		Name: request.Name, NameEn: request.NameEn, Description: request.Description,
		DetailedDescription: request.DetailedDescription, ImageURL: request.ImageURL,
		Rarity: request.Rarity, CardNumber: request.CardNumber, Resource: resources,
		Distance: request.Distance, Recharge: request.Recharge, RechargeCustom: request.RechargeCustom,
		Script: request.Script, Mechanics: request.Mechanics, ActionType: request.ActionType,
		Type: request.Type, Author: author, Source: request.Source, Tags: request.Tags,
		Price: request.Price, Weight: request.Weight, Properties: request.Properties,
		RelatedCards: request.RelatedCards, RelatedActions: request.RelatedActions,
		IsExtended: request.IsExtended, DescriptionFontSize: request.DescriptionFontSize,
		TextAlignment: request.TextAlignment, TextFontSize: request.TextFontSize,
		ShowDetailedDescription:      request.ShowDetailedDescription,
		DetailedDescriptionAlignment: request.DetailedDescriptionAlignment,
		DetailedDescriptionFontSize:  request.DetailedDescriptionFontSize,
	}
}

// rollbackEffectSnapshotV1 includes every API/content field (including exact
// support and created_at) except timestamps changed by transport/soft-delete.
// It is server-internal: both ledger issuance and rollback CAS use this code.
func rollbackEffectSnapshotV1(response EffectResponse) (JSONMap, string, error) {
	return rollbackCreatedContentSnapshotV1(response)
}

func rollbackActionSnapshotV1(response ActionResponse) (JSONMap, string, error) {
	return rollbackCreatedContentSnapshotV1(response)
}

func rollbackCreatedContentSnapshotV1(response any) (JSONMap, string, error) {
	raw, err := json.Marshal(response)
	if err != nil {
		return nil, "", err
	}
	var snapshot JSONMap
	if err = json.Unmarshal(raw, &snapshot); err != nil {
		return nil, "", err
	}
	delete(snapshot, "updated_at")
	delete(snapshot, "deleted_at")
	canonical, err := json.Marshal(snapshot)
	if err != nil {
		return nil, "", err
	}
	digest := sha256.Sum256(canonical)
	return snapshot, "sha256:" + hex.EncodeToString(digest[:]), nil
}

func apiResponseAsJSONMap(response any) (JSONMap, error) {
	raw, err := json.Marshal(response)
	if err != nil {
		return nil, err
	}
	var result JSONMap
	if err = json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func contentMigrationComparableResponse(response JSONMap) JSONMap {
	comparable := make(JSONMap, len(response))
	for key, value := range response {
		if key != "updated_at" {
			comparable[key] = value
		}
	}
	return comparable
}

func contentMigrationExpectedRestoredSupport(expected JSONMap, support any) JSONMap {
	restored := make(JSONMap, len(expected))
	for key, value := range expected {
		restored[key] = value
	}
	restored["support"] = support
	return restored
}

func contentMigrationSupportAlreadyRestored(current, expected JSONMap, support any) bool {
	return reflect.DeepEqual(
		contentMigrationComparableResponse(current),
		contentMigrationComparableResponse(
			contentMigrationExpectedRestoredSupport(expected, support),
		),
	)
}

func loadContentMigrationEntityForUpdate(
	tx *gorm.DB,
	entityType string,
	entityID uuid.UUID,
) (model any, response any, err error) {
	query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", entityID)
	switch entityType {
	case "card":
		var entity Card
		err = query.First(&entity).Error
		return &entity, entity.ToCardResponse(), err
	case "effect":
		var entity Effect
		err = query.First(&entity).Error
		response := entity.ToEffectResponse()
		if err != nil {
			return &entity, response, err
		}
		recommendations, recommendationErr := loadChoiceRecommendations(
			tx, "effect", []string{entity.CardNumber},
		)
		if recommendationErr != nil {
			return &entity, response, recommendationErr
		}
		response.ChoiceRecommendations = recommendations[entity.CardNumber]
		return &entity, response, nil
	case "action":
		var entity Action
		err = query.First(&entity).Error
		return &entity, entity.ToActionResponse(), err
	case "spell":
		var entity Spell
		err = query.First(&entity).Error
		return &entity, entity.ToSpellResponse(), err
	case "race":
		var entity Race
		err = query.First(&entity).Error
		return &entity, entity.ToRaceResponse(), err
	case "class":
		var entity Class
		err = query.First(&entity).Error
		response := entity.ToClassResponse()
		if err != nil {
			return &entity, response, err
		}
		recommendations, recommendationErr := loadChoiceRecommendations(
			tx, "class", []string{entity.CardNumber},
		)
		if recommendationErr != nil {
			return &entity, response, recommendationErr
		}
		response.ChoiceRecommendations = recommendations[entity.CardNumber]
		return &entity, response, nil
	case "feat":
		var entity Feat
		err = query.First(&entity).Error
		return &entity, entity.ToFeatResponse(), err
	case "background":
		var entity Background
		err = query.First(&entity).Error
		return &entity, entity.ToBackgroundResponse(), err
	default:
		return nil, nil, errors.New("unsupported content migration entity type")
	}
}

func (cc *ContentMigrationController) restoreExactSupport(
	entityType string,
	entityID uuid.UUID,
	expectedCurrent any,
	support any,
) (alreadyRestored bool, err error) {
	err = cc.db.Transaction(func(tx *gorm.DB) error {
		model, response, err := loadContentMigrationEntityForUpdate(tx, entityType, entityID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errContentMigrationNotFound
		}
		if err != nil {
			return err
		}
		current, err := apiResponseAsJSONMap(response)
		if err != nil {
			return err
		}
		expectedObject, ok := expectedCurrent.(map[string]any)
		if !ok {
			return errContentMigrationConflict
		}
		expected := JSONMap(expectedObject)
		if !reflect.DeepEqual(current, expected) {
			// A retry after a committed support update sees only the trigger-owned
			// updated_at drift plus the requested exact support. Treat that state
			// as success; every other field still participates in the CAS.
			if contentMigrationSupportAlreadyRestored(current, expected, support) {
				alreadyRestored = true
				return nil
			}
			return errContentMigrationConflict
		}

		var supportValue any
		if support != nil {
			supportObject, ok := support.(map[string]any)
			if !ok {
				return errors.New("support rollback value must be object or null")
			}
			supportValue = JSONMap(supportObject)
		}
		update := tx.Model(model).UpdateColumn("support", supportValue)
		if update.Error != nil {
			return update.Error
		}
		if update.RowsAffected != 1 {
			return errContentMigrationConflict
		}

		_, restoredResponse, err := loadContentMigrationEntityForUpdate(tx, entityType, entityID)
		if err != nil {
			return err
		}
		restored, err := apiResponseAsJSONMap(restoredResponse)
		if err != nil {
			return err
		}
		expectedAfterUpdate := JSONMap{}
		for key, value := range current {
			expectedAfterUpdate[key] = value
		}
		expectedAfterUpdate["support"] = support
		// PostgreSQL's generic update_updated_at trigger runs even for this
		// support-only update. updated_at is the sole documented server-managed
		// field; every other API field, including arbitrary legacy support JSON,
		// must remain exactly equal.
		if !reflect.DeepEqual(
			contentMigrationComparableResponse(restored),
			contentMigrationComparableResponse(expectedAfterUpdate),
		) {
			return errContentMigrationConflict
		}
		return nil
	})
	return alreadyRestored, err
}

func (cc *ContentMigrationController) createEffectWithReceipt(
	bundleID uuid.UUID,
	request ContentMigrationEffectCreateRequest,
	actorUserID uuid.UUID,
) (response ContentMigrationEffectCreateResponse, err error) {
	err = cc.db.Transaction(func(tx *gorm.DB) error {
		var issued ContentMigrationCreateReceipt
		receiptLookup := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"bundle_id = ? AND plan_hash = ? AND operation_id = ? AND entity_type = 'effect' AND card_number = ?",
			bundleID, request.PlanHash, request.OperationID, request.Entity.CardNumber,
		).First(&issued)
		if receiptLookup.Error == nil {
			if issued.Status != "active" {
				return errContentMigrationConflict
			}
			var issuedEffect Effect
			if load := tx.Unscoped().Where(
				"id = ? AND card_number = ? AND deleted_at IS NULL",
				issued.EntityID, issued.CardNumber,
			).First(&issuedEffect); load.Error != nil {
				return errContentMigrationConflict
			}
			issuedResponse := issuedEffect.ToEffectResponse()
			issuedSnapshot, issuedHash, snapshotErr := rollbackEffectSnapshotV1(issuedResponse)
			if snapshotErr != nil {
				return snapshotErr
			}
			if issuedHash != issued.PostimageHash || !reflect.DeepEqual(issuedSnapshot, issued.Postimage) {
				return errContentMigrationConflict
			}
			response = ContentMigrationEffectCreateResponse{
				Entity: issuedResponse,
				Rollback: ContentMigrationReceiptResponse{
					ReceiptID: issued.ID, BundleID: issued.BundleID, PlanHash: issued.PlanHash,
					OperationID: issued.OperationID, EntityID: issued.EntityID,
					CardNumber: issued.CardNumber, PostimageHash: issued.PostimageHash,
				},
			}
			return nil
		}
		if !errors.Is(receiptLookup.Error, gorm.ErrRecordNotFound) {
			return receiptLookup.Error
		}

		var existing Effect
		lookup := tx.Unscoped().Where("card_number = ?", request.Entity.CardNumber).First(&existing)
		if lookup.Error == nil {
			return errContentMigrationConflict
		}
		if !errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
			return lookup.Error
		}

		effect := effectFromContentMigrationRequest(request.Entity)
		if create := tx.Create(&effect); create.Error != nil {
			return create.Error
		}
		// PostgreSQL stores timestamptz with microsecond precision while GORM's
		// in-memory CreatedAt may still contain nanoseconds.  The receipt must be
		// derived from the persisted API postimage, not from that pre-round-trip
		// struct; otherwise an immediate exact rollback can fail its own CAS.
		var persisted Effect
		if reload := tx.Where(
			"id = ? AND card_number = ? AND deleted_at IS NULL",
			effect.ID, effect.CardNumber,
		).First(&persisted); reload.Error != nil {
			return reload.Error
		}
		entityResponse := persisted.ToEffectResponse()
		postimage, postimageHash, snapshotErr := rollbackEffectSnapshotV1(entityResponse)
		if snapshotErr != nil {
			return snapshotErr
		}
		receipt := ContentMigrationCreateReceipt{
			BundleID: bundleID, PlanHash: request.PlanHash, OperationID: request.OperationID,
			EntityType: "effect", EntityID: persisted.ID, CardNumber: persisted.CardNumber,
			PostimageHash: postimageHash, Postimage: postimage,
			CreatedByUserID: actorUserID, Status: "active",
		}
		if create := tx.Create(&receipt); create.Error != nil {
			// The transaction rolls the Effect back as well: a row without a
			// server-issued receipt can never escape this endpoint.
			return create.Error
		}
		response = ContentMigrationEffectCreateResponse{
			Entity: entityResponse,
			Rollback: ContentMigrationReceiptResponse{
				ReceiptID: receipt.ID, BundleID: bundleID, PlanHash: request.PlanHash,
				OperationID: request.OperationID, EntityID: persisted.ID,
				CardNumber: persisted.CardNumber, PostimageHash: postimageHash,
			},
		}
		return nil
	})
	return response, err
}

func (cc *ContentMigrationController) createActionWithReceipt(
	bundleID uuid.UUID,
	request ContentMigrationActionCreateRequest,
	actorUserID uuid.UUID,
) (response ContentMigrationActionCreateResponse, err error) {
	err = cc.db.Transaction(func(tx *gorm.DB) error {
		var issued ContentMigrationCreateReceipt
		receiptLookup := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"bundle_id = ? AND plan_hash = ? AND operation_id = ? AND entity_type = 'action' AND card_number = ?",
			bundleID, request.PlanHash, request.OperationID, request.Entity.CardNumber,
		).First(&issued)
		if receiptLookup.Error == nil {
			if issued.Status != "active" {
				return errContentMigrationConflict
			}
			var issuedAction Action
			if load := tx.Unscoped().Where(
				"id = ? AND card_number = ? AND deleted_at IS NULL", issued.EntityID, issued.CardNumber,
			).First(&issuedAction); load.Error != nil {
				return errContentMigrationConflict
			}
			issuedResponse := issuedAction.ToActionResponse()
			issuedSnapshot, issuedHash, snapshotErr := rollbackActionSnapshotV1(issuedResponse)
			if snapshotErr != nil {
				return snapshotErr
			}
			if issuedHash != issued.PostimageHash || !reflect.DeepEqual(issuedSnapshot, issued.Postimage) {
				return errContentMigrationConflict
			}
			response = ContentMigrationActionCreateResponse{
				Entity: issuedResponse,
				Rollback: ContentMigrationReceiptResponse{
					ReceiptID: issued.ID, BundleID: issued.BundleID, PlanHash: issued.PlanHash,
					OperationID: issued.OperationID, EntityID: issued.EntityID,
					CardNumber: issued.CardNumber, PostimageHash: issued.PostimageHash,
				},
			}
			return nil
		}
		if !errors.Is(receiptLookup.Error, gorm.ErrRecordNotFound) {
			return receiptLookup.Error
		}

		var existing Action
		lookup := tx.Unscoped().Where("card_number = ?", request.Entity.CardNumber).First(&existing)
		if lookup.Error == nil {
			return errContentMigrationConflict
		}
		if !errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
			return lookup.Error
		}

		action := actionFromContentMigrationRequest(request.Entity)
		if create := tx.Create(&action); create.Error != nil {
			return create.Error
		}
		var persisted Action
		if reload := tx.Where(
			"id = ? AND card_number = ? AND deleted_at IS NULL", action.ID, action.CardNumber,
		).First(&persisted); reload.Error != nil {
			return reload.Error
		}
		entityResponse := persisted.ToActionResponse()
		postimage, postimageHash, snapshotErr := rollbackActionSnapshotV1(entityResponse)
		if snapshotErr != nil {
			return snapshotErr
		}
		receipt := ContentMigrationCreateReceipt{
			BundleID: bundleID, PlanHash: request.PlanHash, OperationID: request.OperationID,
			EntityType: "action", EntityID: persisted.ID, CardNumber: persisted.CardNumber,
			PostimageHash: postimageHash, Postimage: postimage,
			CreatedByUserID: actorUserID, Status: "active",
		}
		if create := tx.Create(&receipt); create.Error != nil {
			return create.Error
		}
		response = ContentMigrationActionCreateResponse{
			Entity: entityResponse,
			Rollback: ContentMigrationReceiptResponse{
				ReceiptID: receipt.ID, BundleID: bundleID, PlanHash: request.PlanHash,
				OperationID: request.OperationID, EntityID: persisted.ID,
				CardNumber: persisted.CardNumber, PostimageHash: postimageHash,
			},
		}
		return nil
	})
	return response, err
}

func (cc *ContentMigrationController) rollbackCreatedEffect(
	entityID uuid.UUID,
	request ContentMigrationEffectRollbackRequest,
	actorUserID uuid.UUID,
) (alreadyRolledBack bool, err error) {
	err = cc.db.Transaction(func(tx *gorm.DB) error {
		var receipt ContentMigrationCreateReceipt
		lookup := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"bundle_id = ? AND plan_hash = ? AND operation_id = ? AND entity_type = 'effect' AND entity_id = ? AND card_number = ?",
			request.BundleID, request.PlanHash, request.OperationID, entityID, request.CardNumber,
		).First(&receipt)
		if errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
			return errContentMigrationNotFound
		}
		if lookup.Error != nil {
			return lookup.Error
		}
		if receipt.PostimageHash != request.ExpectedCurrentHash {
			return errContentMigrationConflict
		}

		var effect Effect
		entityLookup := tx.Unscoped().Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"id = ? AND card_number = ?", entityID, request.CardNumber,
		).First(&effect)
		if receipt.Status == "rolled_back" {
			if errors.Is(entityLookup.Error, gorm.ErrRecordNotFound) {
				alreadyRolledBack = true
				return nil
			}
			return errContentMigrationConflict
		}
		if entityLookup.Error != nil {
			return errContentMigrationConflict
		}
		currentSnapshot, currentHash, snapshotErr := rollbackEffectSnapshotV1(effect.ToEffectResponse())
		if snapshotErr != nil {
			return snapshotErr
		}
		if currentHash != receipt.PostimageHash || !reflect.DeepEqual(currentSnapshot, receipt.Postimage) {
			return errContentMigrationConflict
		}

		// Physical deletion is allowed only after this transaction has a locked,
		// ledger-proven tombstone. A live receipt-owned row is soft-deleted here
		// first; failures roll both mutations back and expose no tombstone window.
		if !effect.DeletedAt.Valid {
			softDelete := tx.Where("id = ? AND card_number = ?", entityID, request.CardNumber).Delete(&Effect{})
			if softDelete.Error != nil || softDelete.RowsAffected != 1 {
				return errContentMigrationConflict
			}
			if reload := tx.Unscoped().Where("id = ?", entityID).First(&effect); reload.Error != nil || !effect.DeletedAt.Valid {
				return errContentMigrationConflict
			}
		}
		hardDelete := tx.Unscoped().Where("id = ? AND card_number = ? AND deleted_at IS NOT NULL", entityID, request.CardNumber).Delete(&Effect{})
		if hardDelete.Error != nil || hardDelete.RowsAffected != 1 {
			return errContentMigrationConflict
		}
		now := time.Now().UTC()
		update := tx.Model(&ContentMigrationCreateReceipt{}).Where(
			"id = ? AND status = 'active'", receipt.ID,
		).Updates(map[string]any{
			"status": "rolled_back", "rolled_back_at": now,
			"rolled_back_by_user_id": actorUserID,
		})
		if update.Error != nil || update.RowsAffected != 1 {
			return errContentMigrationConflict
		}
		return nil
	})
	return alreadyRolledBack, err
}

func (cc *ContentMigrationController) rollbackCreatedAction(
	entityID uuid.UUID,
	request ContentMigrationEffectRollbackRequest,
	actorUserID uuid.UUID,
) (alreadyRolledBack bool, err error) {
	err = cc.db.Transaction(func(tx *gorm.DB) error {
		var receipt ContentMigrationCreateReceipt
		lookup := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"bundle_id = ? AND plan_hash = ? AND operation_id = ? AND entity_type = 'action' AND entity_id = ? AND card_number = ?",
			request.BundleID, request.PlanHash, request.OperationID, entityID, request.CardNumber,
		).First(&receipt)
		if errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
			return errContentMigrationNotFound
		}
		if lookup.Error != nil {
			return lookup.Error
		}
		if receipt.PostimageHash != request.ExpectedCurrentHash {
			return errContentMigrationConflict
		}

		var action Action
		entityLookup := tx.Unscoped().Clauses(clause.Locking{Strength: "UPDATE"}).Where(
			"id = ? AND card_number = ?", entityID, request.CardNumber,
		).First(&action)
		if receipt.Status == "rolled_back" {
			if errors.Is(entityLookup.Error, gorm.ErrRecordNotFound) {
				alreadyRolledBack = true
				return nil
			}
			return errContentMigrationConflict
		}
		if entityLookup.Error != nil {
			return errContentMigrationConflict
		}
		currentSnapshot, currentHash, snapshotErr := rollbackActionSnapshotV1(action.ToActionResponse())
		if snapshotErr != nil {
			return snapshotErr
		}
		if currentHash != receipt.PostimageHash || !reflect.DeepEqual(currentSnapshot, receipt.Postimage) {
			return errContentMigrationConflict
		}

		if !action.DeletedAt.Valid {
			softDelete := tx.Where("id = ? AND card_number = ?", entityID, request.CardNumber).Delete(&Action{})
			if softDelete.Error != nil || softDelete.RowsAffected != 1 {
				return errContentMigrationConflict
			}
			if reload := tx.Unscoped().Where("id = ?", entityID).First(&action); reload.Error != nil || !action.DeletedAt.Valid {
				return errContentMigrationConflict
			}
		}
		hardDelete := tx.Unscoped().Where(
			"id = ? AND card_number = ? AND deleted_at IS NOT NULL", entityID, request.CardNumber,
		).Delete(&Action{})
		if hardDelete.Error != nil || hardDelete.RowsAffected != 1 {
			return errContentMigrationConflict
		}
		now := time.Now().UTC()
		update := tx.Model(&ContentMigrationCreateReceipt{}).Where(
			"id = ? AND status = 'active'", receipt.ID,
		).Updates(map[string]any{
			"status": "rolled_back", "rolled_back_at": now,
			"rolled_back_by_user_id": actorUserID,
		})
		if update.Error != nil || update.RowsAffected != 1 {
			return errContentMigrationConflict
		}
		return nil
	})
	return alreadyRolledBack, err
}

func (cc *ContentMigrationController) CreateEffect(c *gin.Context) {
	if !cc.authorize(c) {
		return
	}
	bundleID, err := uuid.Parse(c.Param("bundleId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный bundle ID"})
		return
	}
	var request ContentMigrationEffectCreateRequest
	if err = decodeStrictContentMigrationJSON(c, &request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Невалидный atomic create payload"})
		return
	}
	if err = validateContentMigrationEffectCreate(request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	actorUserID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Строгая авторизация не установила пользователя"})
		return
	}
	response, err := cc.createEffect(bundleID, request, actorUserID)
	if err != nil {
		if errors.Is(err, errContentMigrationConflict) {
			c.JSON(http.StatusConflict, gin.H{"error": "Create identity уже существует или receipt конфликтует"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Atomic effect create + receipt не выполнен"})
		return
	}
	c.JSON(http.StatusCreated, response)
}

func (cc *ContentMigrationController) CreateAction(c *gin.Context) {
	if !cc.authorize(c) {
		return
	}
	bundleID, err := uuid.Parse(c.Param("bundleId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный bundle ID"})
		return
	}
	var request ContentMigrationActionCreateRequest
	if err = decodeStrictContentMigrationJSON(c, &request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Невалидный atomic create payload"})
		return
	}
	if err = validateContentMigrationActionCreate(request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	actorUserID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Строгая авторизация не установила пользователя"})
		return
	}
	response, err := cc.createAction(bundleID, request, actorUserID)
	if err != nil {
		if errors.Is(err, errContentMigrationConflict) {
			c.JSON(http.StatusConflict, gin.H{"error": "Create identity уже существует или receipt конфликтует"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Atomic action create + receipt не выполнен"})
		return
	}
	c.JSON(http.StatusCreated, response)
}

func (cc *ContentMigrationController) RollbackCreatedEffect(c *gin.Context) {
	if !cc.authorize(c) {
		return
	}
	entityID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID эффекта"})
		return
	}
	var request ContentMigrationEffectRollbackRequest
	if err = decodeStrictContentMigrationJSON(c, &request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Невалидный ledger rollback payload"})
		return
	}
	if request.SchemaVersion != 1 || request.BundleID == uuid.Nil ||
		!contentMigrationSHA256Pattern.MatchString(request.ExpectedCurrentHash) ||
		validateContentMigrationIdentity(request.PlanHash, request.OperationID, request.CardNumber) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Невалидная ledger identity"})
		return
	}
	actorUserID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Строгая авторизация не установила пользователя"})
		return
	}
	already, err := cc.rollbackEffect(entityID, request, actorUserID)
	if err != nil {
		switch {
		case errors.Is(err, errContentMigrationNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "Server-issued create receipt не найден"})
		case errors.Is(err, errContentMigrationConflict):
			c.JSON(http.StatusConflict, gin.H{"error": "Ledger identity или current postimage изменились"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Ledger rollback не выполнен"})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"entity_type": "effect", "entity_id": entityID,
		"card_number": request.CardNumber, "rolled_back": true,
		"already_rolled_back": already, "cas": "server_issued_create_receipt_v1",
	})
}

func (cc *ContentMigrationController) RollbackCreatedAction(c *gin.Context) {
	if !cc.authorize(c) {
		return
	}
	entityID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID действия"})
		return
	}
	var request ContentMigrationEffectRollbackRequest
	if err = decodeStrictContentMigrationJSON(c, &request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Невалидный ledger rollback payload"})
		return
	}
	if request.SchemaVersion != 1 || request.BundleID == uuid.Nil ||
		!contentMigrationSHA256Pattern.MatchString(request.ExpectedCurrentHash) ||
		validateContentMigrationIdentity(request.PlanHash, request.OperationID, request.CardNumber) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Невалидная ledger identity"})
		return
	}
	actorUserID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Строгая авторизация не установила пользователя"})
		return
	}
	already, err := cc.rollbackAction(entityID, request, actorUserID)
	if err != nil {
		switch {
		case errors.Is(err, errContentMigrationNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "Server-issued create receipt не найден"})
		case errors.Is(err, errContentMigrationConflict):
			c.JSON(http.StatusConflict, gin.H{"error": "Ledger identity или current postimage изменились"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Ledger rollback не выполнен"})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"entity_type": "action", "entity_id": entityID,
		"card_number": request.CardNumber, "rolled_back": true,
		"already_rolled_back": already, "cas": "server_issued_create_receipt_v1",
	})
}

func (cc *ContentMigrationController) RestoreSupport(c *gin.Context) {
	if !cc.authorize(c) {
		return
	}
	entityType := c.Param("entityType")
	if !map[string]bool{
		"card": true, "effect": true, "action": true, "spell": true, "race": true, "class": true,
		"feat": true, "background": true,
	}[entityType] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неподдерживаемый тип support rollback"})
		return
	}
	entityID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный ID сущности"})
		return
	}
	var request ContentMigrationSupportRollbackRequest
	if err = decodeStrictContentMigrationJSON(c, &request); err != nil || request.SchemaVersion != 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Невалидный support rollback payload"})
		return
	}
	var expectedCurrent any
	if len(request.ExpectedCurrent) == 0 || json.Unmarshal(request.ExpectedCurrent, &expectedCurrent) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "expected_current должен быть exact JSON object"})
		return
	}
	if _, ok := expectedCurrent.(map[string]any); !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "expected_current должен быть exact JSON object"})
		return
	}
	if len(request.Support) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "support должен быть явным object или null"})
		return
	}
	var support any
	if err = json.Unmarshal(request.Support, &support); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "support должен быть явным object или null"})
		return
	}
	if support != nil {
		if _, ok := support.(map[string]any); !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "support должен быть явным object или null"})
			return
		}
	}
	if cc.restoreSupport == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "support rollback API не настроен"})
		return
	}
	alreadyRestored, err := cc.restoreSupport(entityType, entityID, expectedCurrent, support)
	if err != nil {
		switch {
		case errors.Is(err, errContentMigrationNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "Сущность support rollback не найдена"})
		case errors.Is(err, errContentMigrationConflict):
			c.JSON(http.StatusConflict, gin.H{"error": "Current content изменился; support rollback отменён"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Exact support rollback не выполнен"})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"entity_type": entityType, "entity_id": entityID,
		"support": support, "cas": "exact_current_api_response_v1",
		"already_rolled_back": alreadyRestored,
	})
}
