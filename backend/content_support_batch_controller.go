package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const contentSupportBatchMaxEntries = 100

var exactSupportBatchEntityTypes = map[string]bool{
	"card": true, "effect": true, "action": true, "spell": true, "race": true,
	"class": true, "feat": true, "background": true,
}

type ContentSupportBatchEntryRequest struct {
	EntityType      string          `json:"entity_type"`
	EntityID        uuid.UUID       `json:"entity_id"`
	ExpectedCurrent json.RawMessage `json:"expected_current"`
	Support         json.RawMessage `json:"support"`
}

type ContentSupportBatchRequest struct {
	SchemaVersion int                               `json:"schema_version"`
	Mode          string                            `json:"mode"`
	PlanHash      string                            `json:"plan_hash"`
	OperationID   string                            `json:"operation_id"`
	ExpectedCount int                               `json:"expected_count"`
	Entries       []ContentSupportBatchEntryRequest `json:"entries"`
}

type preparedContentSupportBatchEntry struct {
	EntityType      string
	EntityID        uuid.UUID
	ExpectedCurrent JSONMap
	Support         any
}

type ContentSupportBatchResult struct {
	Total                   int  `json:"total"`
	Updated                 int  `json:"updated"`
	AlreadyInRequestedState int  `json:"already_in_requested_state_count"`
	AlreadyApplied          bool `json:"already_applied"`
}

type contentMigrationBatchSupportFunc func(
	entries []preparedContentSupportBatchEntry,
) (ContentSupportBatchResult, error)

func prepareContentSupportBatch(
	request ContentSupportBatchRequest,
) ([]preparedContentSupportBatchEntry, error) {
	if request.SchemaVersion != 1 {
		return nil, errors.New("unsupported schema_version")
	}
	if !contentMigrationSHA256Pattern.MatchString(request.PlanHash) {
		return nil, errors.New("invalid plan_hash")
	}
	if request.Mode != "certification_apply" && request.Mode != "exact_rollback" {
		return nil, errors.New("mode must be certification_apply or exact_rollback")
	}
	if strings.TrimSpace(request.OperationID) == "" || len(request.OperationID) > 255 {
		return nil, errors.New("invalid operation_id")
	}
	if request.ExpectedCount < 1 || request.ExpectedCount > contentSupportBatchMaxEntries ||
		request.ExpectedCount != len(request.Entries) {
		return nil, errors.New("expected_count must exactly match 1..100 entries")
	}

	seen := make(map[string]bool, len(request.Entries))
	prepared := make([]preparedContentSupportBatchEntry, 0, len(request.Entries))
	for _, entry := range request.Entries {
		if !exactSupportBatchEntityTypes[entry.EntityType] || entry.EntityID == uuid.Nil {
			return nil, errors.New("unsupported or invalid entry identity")
		}
		identity := entry.EntityType + ":" + entry.EntityID.String()
		if seen[identity] {
			return nil, errors.New("duplicate entry identity")
		}
		seen[identity] = true

		var expectedCurrent any
		if len(entry.ExpectedCurrent) == 0 ||
			json.Unmarshal(entry.ExpectedCurrent, &expectedCurrent) != nil {
			return nil, errors.New("expected_current must be an exact JSON object")
		}
		expectedObject, ok := expectedCurrent.(map[string]any)
		if !ok {
			return nil, errors.New("expected_current must be an exact JSON object")
		}
		expectedID, ok := expectedObject["id"].(string)
		parsedExpectedID, parseErr := uuid.Parse(expectedID)
		if !ok || parseErr != nil || parsedExpectedID != entry.EntityID {
			return nil, errors.New("expected_current identity differs from entry identity")
		}
		if _, ok = expectedObject["support"]; !ok {
			return nil, errors.New("expected_current must include explicit support")
		}

		if len(entry.Support) == 0 {
			return nil, errors.New("support must be an explicit object or null")
		}
		var support any
		if json.Unmarshal(entry.Support, &support) != nil {
			return nil, errors.New("support must be an explicit object or null")
		}
		if support != nil {
			if _, ok = support.(map[string]any); !ok {
				return nil, errors.New("support must be an explicit object or null")
			}
		}
		if request.Mode == "certification_apply" {
			if err := validateBatchCertificationSupport(support); err != nil {
				return nil, err
			}
		}

		prepared = append(prepared, preparedContentSupportBatchEntry{
			EntityType: entry.EntityType, EntityID: entry.EntityID,
			ExpectedCurrent: JSONMap(expectedObject), Support: support,
		})
	}

	// Every transaction acquires locks in one global order, independent of
	// manifest order, so concurrent apply/rollback requests cannot deadlock by
	// asking for the same rows in a different sequence.
	sort.Slice(prepared, func(left, right int) bool {
		if prepared[left].EntityType != prepared[right].EntityType {
			return prepared[left].EntityType < prepared[right].EntityType
		}
		return prepared[left].EntityID.String() < prepared[right].EntityID.String()
	})
	return prepared, nil
}

func validateBatchCertificationSupport(support any) error {
	object, ok := support.(map[string]any)
	if !ok {
		return errors.New("certification_apply support must be a verified object")
	}
	allowedFields := map[string]bool{
		"status": true, "content_hash": true, "dependency_hash": true,
		"certification_version": true, "certified_at": true,
		"limitations": true, "note": true,
		"evidence_id": true, "evidence_hash": true, "evidence_completed_at": true,
		"gate_source_hash": true, "source_content_hash": true, "rules_hash": true,
		"release_content_hash": true, "release_hash": true, "patch_hash": true,
		"catalog_hash": true,
	}
	for key := range object {
		if !allowedFields[key] {
			return errors.New("certification_apply support contains an unknown field")
		}
	}
	raw, err := json.Marshal(object)
	if err != nil {
		return errors.New("certification_apply support is not JSON-serializable")
	}
	var request ContentSupportRequest
	if err = json.Unmarshal(raw, &request); err != nil {
		return errors.New("certification_apply support has invalid field types")
	}
	if !strings.HasPrefix(request.Status, "verified_") {
		return errors.New("certification_apply requires a verified support status")
	}
	if request.CertifiedAt == nil || strings.TrimSpace(*request.CertifiedAt) == "" {
		return errors.New("certification_apply requires explicit certified_at")
	}
	if issues := validateContentSupportRequest(request); len(issues) > 0 {
		return errors.New("certification_apply support is invalid: " + strings.Join(issues, "; "))
	}
	return nil
}

type lockedContentSupportBatchEntry struct {
	prepared preparedContentSupportBatchEntry
	model    any
	current  JSONMap
}

func (cc *ContentMigrationController) applyExactSupportBatch(
	entries []preparedContentSupportBatchEntry,
) (result ContentSupportBatchResult, err error) {
	result.Total = len(entries)
	err = cc.db.Transaction(func(tx *gorm.DB) error {
		locked := make([]lockedContentSupportBatchEntry, 0, len(entries))
		hasPreimageOnly := false
		hasDesiredOnly := false

		// Lock and classify the complete set before the first UPDATE. A valid
		// request is globally all-preimage or all-desired. Mixed state is
		// evidence of an older partial writer or outside interference and is
		// deliberately not healed automatically.
		for _, entry := range entries {
			model, response, loadErr := loadContentMigrationEntityForUpdate(
				tx, entry.EntityType, entry.EntityID,
			)
			if errors.Is(loadErr, gorm.ErrRecordNotFound) {
				return errContentMigrationNotFound
			}
			if loadErr != nil {
				return loadErr
			}
			current, mapErr := apiResponseAsJSONMap(response)
			if mapErr != nil {
				return mapErr
			}
			isPreimage := reflect.DeepEqual(current, entry.ExpectedCurrent)
			isDesired := contentMigrationSupportAlreadyRestored(
				current, entry.ExpectedCurrent, entry.Support,
			)
			if !isPreimage && !isDesired {
				return errContentMigrationConflict
			}
			if isPreimage && !isDesired {
				hasPreimageOnly = true
			}
			if isDesired && !isPreimage {
				hasDesiredOnly = true
			}
			locked = append(locked, lockedContentSupportBatchEntry{
				prepared: entry, model: model, current: current,
			})
		}
		if hasPreimageOnly && hasDesiredOnly {
			return errContentMigrationConflict
		}
		if hasDesiredOnly {
			result.AlreadyInRequestedState = len(entries)
			result.AlreadyApplied = true
			return nil
		}

		for _, entry := range locked {
			update := tx.Model(entry.model).UpdateColumn("support", entry.prepared.Support)
			if update.Error != nil {
				return update.Error
			}
			if update.RowsAffected != 1 {
				return errContentMigrationConflict
			}
			_, response, loadErr := loadContentMigrationEntityForUpdate(
				tx, entry.prepared.EntityType, entry.prepared.EntityID,
			)
			if loadErr != nil {
				return loadErr
			}
			restored, mapErr := apiResponseAsJSONMap(response)
			if mapErr != nil {
				return mapErr
			}
			expected := contentMigrationExpectedRestoredSupport(
				entry.current, entry.prepared.Support,
			)
			if !reflect.DeepEqual(
				contentMigrationComparableResponse(restored),
				contentMigrationComparableResponse(expected),
			) {
				return errContentMigrationConflict
			}
		}
		result.Updated = len(entries)
		return nil
	})
	return result, err
}

func (cc *ContentMigrationController) ApplyExactSupportBatch(c *gin.Context) {
	if !cc.authorize(c) {
		return
	}
	var request ContentSupportBatchRequest
	if err := decodeStrictContentMigrationJSON(c, &request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Невалидный exact-support batch payload"})
		return
	}
	entries, err := prepareContentSupportBatch(request)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if cc.batchSupport == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Exact-support batch API не настроен"})
		return
	}
	result, err := cc.batchSupport(entries)
	if err != nil {
		switch {
		case errors.Is(err, errContentMigrationNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "Сущность exact-support batch не найдена"})
		case errors.Is(err, errContentMigrationConflict):
			c.JSON(http.StatusConflict, gin.H{"error": "Batch не находится целиком в expected или requested состоянии"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Atomic exact-support batch не выполнен"})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"schema_version": 1,
		"mode":           request.Mode, "plan_hash": request.PlanHash,
		"operation_id": request.OperationID,
		"total":        result.Total, "updated": result.Updated,
		"already_in_requested_state_count": result.AlreadyInRequestedState,
		"already_applied":                  result.AlreadyApplied,
		"cas":                              "atomic_exact_full_api_response_v1",
	})
}
