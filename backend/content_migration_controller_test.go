package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func contentMigrationTestRouter(controller *ContentMigrationController) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("user_id", uuid.MustParse("00000000-0000-4000-8000-000000000999"))
		c.Set("username", "migration-test")
		c.Next()
	})
	router.POST("/api/content-migrations/:bundleId/effects", controller.CreateEffect)
	router.POST("/api/content-migrations/:bundleId/actions", controller.CreateAction)
	router.POST("/api/content-migrations/:bundleId/:entityType/:id/exact-update", controller.ExactUpdate)
	router.POST("/api/content-rollback/effect/:id/hard-delete-created", controller.RollbackCreatedEffect)
	router.POST("/api/content-rollback/action/:id/hard-delete-created", controller.RollbackCreatedAction)
	router.POST("/api/content-rollback/:entityType/:id/support", controller.RestoreSupport)
	router.POST("/api/content-support/batch-exact", controller.ApplyExactSupportBatch)
	return router
}

func migrationRequest(
	t *testing.T,
	router http.Handler,
	method string,
	path string,
	body any,
	key string,
) *httptest.ResponseRecorder {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(method, path, bytes.NewReader(encoded))
	request.Header.Set("Content-Type", "application/json")
	if key != "" {
		request.Header.Set("X-Content-Certification-Key", key)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func TestRollbackEffectSnapshotV1IgnoresOnlyManagedTimestamp(t *testing.T) {
	id := uuid.MustParse("00000000-0000-4000-8000-000000000101")
	base := EffectResponse{
		ID: id, Name: "Receipt effect", Description: "Created atomically",
		Rarity: RarityCommon, CardNumber: "EFF-receipt", EffectType: EffectTypePassive,
		Author: "Admin", CreatedAt: time.Date(2026, 8, 5, 10, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2026, 8, 5, 10, 0, 0, 0, time.UTC),
	}
	_, baseHash, err := rollbackEffectSnapshotV1(base)
	if err != nil {
		t.Fatal(err)
	}
	updated := base
	updated.UpdatedAt = updated.UpdatedAt.Add(time.Hour)
	_, updatedHash, _ := rollbackEffectSnapshotV1(updated)
	if updatedHash != baseHash {
		t.Fatal("server-managed updated_at must not invalidate create receipt")
	}
	contentDrift := base
	contentDrift.Description = "drift"
	_, contentHash, _ := rollbackEffectSnapshotV1(contentDrift)
	if contentHash == baseHash {
		t.Fatal("content drift must invalidate create receipt")
	}
	supportDrift := base
	supportDrift.Support = &JSONMap{"status": "untested"}
	_, supportHash, _ := rollbackEffectSnapshotV1(supportDrift)
	if supportHash == baseHash {
		t.Fatal("support drift must invalidate create receipt")
	}
}

func TestSupportRetryRecognitionIgnoresOnlyUpdatedAt(t *testing.T) {
	expected := JSONMap{
		"id":   "00000000-0000-4000-8000-000000000111",
		"name": "Exact content", "updated_at": "2026-08-05T10:00:00Z",
		"support": nil,
	}
	support := map[string]any{
		"status": "legacy",
		"nested": map[string]any{"preserved": []any{true, "exact", nil}},
	}
	restored := contentMigrationExpectedRestoredSupport(expected, support)
	restored["updated_at"] = "2026-08-05T10:00:01Z"
	if !contentMigrationSupportAlreadyRestored(restored, expected, support) {
		t.Fatal("committed exact support with only managed timestamp drift must be retryable")
	}

	for name, mutate := range map[string]func(JSONMap){
		"content drift": func(value JSONMap) { value["name"] = "foreign edit" },
		"support drift": func(value JSONMap) {
			value["support"] = map[string]any{"status": "another"}
		},
		"missing field": func(value JSONMap) { delete(value, "name") },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := contentMigrationExpectedRestoredSupport(expected, support)
			candidate["updated_at"] = "2026-08-05T10:00:01Z"
			mutate(candidate)
			if contentMigrationSupportAlreadyRestored(candidate, expected, support) {
				t.Fatal("unreviewed drift was accepted as an idempotent retry")
			}
		})
	}
}

func TestExactUpdateHandlerRequiresCertificationKeyAndCoversFixedAdapters(t *testing.T) {
	bundleID := uuid.MustParse("00000000-0000-4000-8000-000000000120")
	entityID := uuid.MustParse("00000000-0000-4000-8000-000000000121")
	const planHash = "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
	controller := &ContentMigrationController{certificationKey: "migration-secret"}
	called := 0
	controller.exactUpdate = func(
		entityType string,
		gotID uuid.UUID,
		expected JSONMap,
		fields map[string]json.RawMessage,
	) (any, bool, error) {
		called++
		if gotID != entityID || expected["card_number"] != "ROW-001" {
			t.Fatal("exact update identity was not forwarded exactly")
		}
		if len(fields) != 1 {
			t.Fatalf("exact update forwarded %d fields, want one", len(fields))
		}
		return expected, entityType == "background", nil
	}
	router := contentMigrationTestRouter(controller)

	fieldByType := map[string]map[string]any{
		"card":       {"mastery": "mastery-id"},
		"effect":     {"mechanics": map[string]any{"activation": map[string]any{"mode": "passive"}}},
		"action":     {"mechanics": map[string]any{"activation": map[string]any{"mode": "action"}}},
		"spell":      {"mechanics": map[string]any{"activation": map[string]any{"mode": "action"}}},
		"race":       {"level_progression": map[string]any{"1": map[string]any{}}},
		"class":      {"equipment_options": map[string]any{"option_b": map[string]any{"gold": 50}}},
		"feat":       {"repeatable": true},
		"background": {"origin_feat": "Skilled"},
	}
	for entityType, fields := range fieldByType {
		body := map[string]any{
			"schema_version": 1, "plan_hash": planHash,
			"operation_id": entityType + ":ROW-001:update", "card_number": "ROW-001",
			"expected_current": map[string]any{
				"id": entityID.String(), "card_number": "ROW-001", "support": nil,
				mapsFirstKey(fields): nil,
			},
			"fields": fields,
		}
		path := "/api/content-migrations/" + bundleID.String() + "/" + entityType + "/" + entityID.String() + "/exact-update"
		response := migrationRequest(t, router, http.MethodPost, path, body, "migration-secret")
		if response.Code != http.StatusOK {
			t.Fatalf("%s: expected 200, got %d: %s", entityType, response.Code, response.Body.String())
		}
	}
	if called != len(fieldByType) {
		t.Fatalf("exact update adapters called %d times, want %d", called, len(fieldByType))
	}

	protectedPath := "/api/content-migrations/" + bundleID.String() + "/effect/" + entityID.String() + "/exact-update"
	protectedBody := map[string]any{
		"schema_version": 1, "plan_hash": planHash,
		"operation_id": "effect:ROW-001:update", "card_number": "ROW-001",
		"expected_current": map[string]any{
			"id": entityID.String(), "card_number": "ROW-001", "support": nil,
			"mechanics": nil,
		},
		"fields": map[string]any{"mechanics": map[string]any{}},
	}
	withoutKey := migrationRequest(t, router, http.MethodPost, protectedPath, protectedBody, "")
	if withoutKey.Code != http.StatusForbidden || called != len(fieldByType) {
		t.Fatalf("exact update ran without certification key: status=%d calls=%d", withoutKey.Code, called)
	}
	forbiddenBody := map[string]any{
		"schema_version": 1, "plan_hash": planHash,
		"operation_id": "effect:ROW-001:update", "card_number": "ROW-001",
		"expected_current": map[string]any{
			"id": entityID.String(), "card_number": "ROW-001", "support": nil,
			"mechanics": nil,
		},
		"fields": map[string]any{"id": entityID.String()},
	}
	forbidden := migrationRequest(
		t, router, http.MethodPost, protectedPath, forbiddenBody, "migration-secret",
	)
	if forbidden.Code != http.StatusBadRequest || called != len(fieldByType) {
		t.Fatalf("identity field reached exact update: status=%d calls=%d", forbidden.Code, called)
	}
	unknown := strings.TrimSuffix(string(mustJSON(t, protectedBody)), "}") + `,"purge_all":true}`
	request := httptest.NewRequest(http.MethodPost, protectedPath, strings.NewReader(unknown))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Content-Certification-Key", "migration-secret")
	unknownResponse := httptest.NewRecorder()
	router.ServeHTTP(unknownResponse, request)
	if unknownResponse.Code != http.StatusBadRequest || called != len(fieldByType) {
		t.Fatalf("unknown command reached exact update: status=%d calls=%d", unknownResponse.Code, called)
	}
}

func mapsFirstKey(values map[string]any) string {
	for key := range values {
		return key
	}
	return ""
}

func TestExactUpdateValidationPreservesIdentityAndServerFields(t *testing.T) {
	expected := JSONMap{
		"id": "00000000-0000-4000-8000-000000000122", "card_number": "EFF-exact",
		"name": "Exact", "mechanics": nil, "support": map[string]any{"status": "verified"},
		"created_at": "2026-08-05T10:00:00Z", "updated_at": "2026-08-05T10:00:00Z",
	}
	mechanics := json.RawMessage(`{"activation":{"mode":"passive"}}`)
	fields := map[string]json.RawMessage{"mechanics": mechanics}
	columns, err := validateContentMigrationExactUpdateFields("effect", expected, fields)
	if err != nil || !reflect.DeepEqual(columns, []string{"mechanics"}) {
		t.Fatalf("allowlisted fields: columns=%v err=%v", columns, err)
	}
	desired, err := contentMigrationDesiredUpdate(expected, fields)
	if err != nil {
		t.Fatal(err)
	}
	if desired["id"] != expected["id"] || desired["card_number"] != expected["card_number"] || desired["support"] != nil {
		t.Fatalf("identity/support semantics changed: %#v", desired)
	}
	retry := JSONMap{}
	for key, value := range desired {
		retry[key] = value
	}
	retry["updated_at"] = "2026-08-05T10:00:01Z"
	if !contentMigrationUpdateEquivalent(retry, desired) {
		t.Fatal("lost-response retry with only updated_at drift was not recognized")
	}
	retry["name"] = "foreign edit"
	if contentMigrationUpdateEquivalent(retry, desired) {
		t.Fatal("foreign content drift was accepted as an idempotent retry")
	}

	for _, forbidden := range []string{"id", "card_number", "support", "updated_at", "image_cloudinary_id"} {
		if _, err = validateContentMigrationExactUpdateFields(
			"effect", expected, map[string]json.RawMessage{forbidden: json.RawMessage(`null`)},
		); !errors.Is(err, errContentMigrationInvalidUpdate) {
			t.Fatalf("%s was not rejected as non-content/server-owned: %v", forbidden, err)
		}
	}
	if _, err = contentMigrationDesiredUpdate(
		expected, map[string]json.RawMessage{"mechanics": json.RawMessage(`null`)},
	); !errors.Is(err, errContentMigrationInvalidUpdate) {
		t.Fatalf("no-op exact update was accepted: %v", err)
	}
}

func TestAtomicCreateHandlerRequiresKeyAndRejectsUnknownCommands(t *testing.T) {
	bundleID := uuid.MustParse("00000000-0000-4000-8000-000000000102")
	entityID := uuid.MustParse("00000000-0000-4000-8000-000000000103")
	receiptID := uuid.MustParse("00000000-0000-4000-8000-000000000104")
	const planHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	called := 0
	controller := &ContentMigrationController{
		certificationKey: "migration-secret",
		createEffect: func(gotBundle uuid.UUID, request ContentMigrationEffectCreateRequest, actor uuid.UUID) (ContentMigrationEffectCreateResponse, error) {
			called++
			if gotBundle != bundleID || request.OperationID != "effects:EFF-receipt:create" || actor == uuid.Nil {
				t.Fatal("atomic create identity was not forwarded exactly")
			}
			return ContentMigrationEffectCreateResponse{
				Entity: EffectResponse{ID: entityID, CardNumber: "EFF-receipt"},
				Rollback: ContentMigrationReceiptResponse{
					ReceiptID: receiptID, BundleID: bundleID, PlanHash: planHash,
					OperationID: request.OperationID, EntityID: entityID,
					CardNumber:    "EFF-receipt",
					PostimageHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				},
			}, nil
		},
	}
	router := contentMigrationTestRouter(controller)
	body := map[string]any{
		"schema_version": 1,
		"plan_hash":      planHash,
		"operation_id":   "effects:EFF-receipt:create",
		"entity": map[string]any{
			"name": "Receipt", "description": "Atomic", "rarity": "common",
			"card_number": "EFF-receipt", "effect_type": "passive",
		},
	}
	path := "/api/content-migrations/" + bundleID.String() + "/effects"
	for name, key := range map[string]string{"missing": "", "wrong": "wrong"} {
		t.Run(name, func(t *testing.T) {
			response := migrationRequest(t, router, http.MethodPost, path, body, key)
			if response.Code != http.StatusForbidden {
				t.Fatalf("expected 403, got %d", response.Code)
			}
		})
	}
	if called != 0 {
		t.Fatal("atomic create ran without exact certification key")
	}
	response := migrationRequest(t, router, http.MethodPost, path, body, "migration-secret")
	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
	}
	if called != 1 {
		t.Fatalf("expected one atomic create, got %d", called)
	}

	unknown := strings.TrimSuffix(string(mustJSON(t, body)), "}") + `,"purge_all":true}`
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(unknown))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Content-Certification-Key", "migration-secret")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("unknown command must fail closed, got %d", response.Code)
	}
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func TestAtomicActionCreateHandlerUsesTheSameCrashSafeContract(t *testing.T) {
	bundleID := uuid.MustParse("00000000-0000-4000-8000-000000000112")
	entityID := uuid.MustParse("00000000-0000-4000-8000-000000000113")
	const planHash = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
	called := 0
	controller := &ContentMigrationController{
		certificationKey: "migration-secret",
		createAction: func(gotBundle uuid.UUID, request ContentMigrationActionCreateRequest, actor uuid.UUID) (ContentMigrationActionCreateResponse, error) {
			called++
			if gotBundle != bundleID || request.OperationID != "actions:action-ranged:create" || actor == uuid.Nil {
				t.Fatal("atomic action identity was not forwarded exactly")
			}
			return ContentMigrationActionCreateResponse{
				Entity: ActionResponse{ID: entityID, CardNumber: "action-ranged"},
				Rollback: ContentMigrationReceiptResponse{
					BundleID: bundleID, PlanHash: planHash, OperationID: request.OperationID,
					EntityID: entityID, CardNumber: "action-ranged",
					PostimageHash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
				},
			}, nil
		},
	}
	router := contentMigrationTestRouter(controller)
	body := map[string]any{
		"schema_version": 1, "plan_hash": planHash,
		"operation_id": "actions:action-ranged:create",
		"entity": map[string]any{
			"name": "Ranged", "description": "Atomic action", "rarity": "common",
			"card_number": "action-ranged", "action_type": "base_action",
			"resources": []string{"action"},
		},
	}
	path := "/api/content-migrations/" + bundleID.String() + "/actions"
	if response := migrationRequest(t, router, http.MethodPost, path, body, ""); response.Code != http.StatusForbidden {
		t.Fatalf("action create without key: got %d", response.Code)
	}
	response := migrationRequest(t, router, http.MethodPost, path, body, "migration-secret")
	if response.Code != http.StatusCreated || called != 1 {
		t.Fatalf("expected one action create, status=%d calls=%d body=%s", response.Code, called, response.Body.String())
	}
}

func TestLedgerRollbackHandlerRequiresExactTuple(t *testing.T) {
	entityID := uuid.MustParse("00000000-0000-4000-8000-000000000105")
	bundleID := uuid.MustParse("00000000-0000-4000-8000-000000000106")
	const hash = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
	called := 0
	controller := &ContentMigrationController{
		certificationKey: "migration-secret",
		rollbackEffect: func(gotID uuid.UUID, request ContentMigrationEffectRollbackRequest, actor uuid.UUID) (bool, error) {
			called++
			if gotID != entityID || request.BundleID != bundleID || request.ExpectedCurrentHash != hash || actor == uuid.Nil {
				t.Fatal("ledger rollback tuple was not forwarded exactly")
			}
			return false, nil
		},
	}
	router := contentMigrationTestRouter(controller)
	body := map[string]any{
		"schema_version": 1, "bundle_id": bundleID, "plan_hash": hash,
		"operation_id": "effects:EFF-receipt:create", "card_number": "EFF-receipt",
		"expected_current_hash": hash,
	}
	path := "/api/content-rollback/effect/" + entityID.String() + "/hard-delete-created"
	response := migrationRequest(t, router, http.MethodPost, path, body, "migration-secret")
	if response.Code != http.StatusOK || called != 1 {
		t.Fatalf("expected exact ledger rollback, status=%d calls=%d", response.Code, called)
	}
}

func TestSupportRollbackHandlerAcceptsExactObjectAndNullForFixedRegistry(t *testing.T) {
	entityID := uuid.MustParse("00000000-0000-4000-8000-000000000107")
	controller := &ContentMigrationController{certificationKey: "migration-secret"}
	called := 0
	controller.restoreSupport = func(entityType string, gotID uuid.UUID, current any, support any) (bool, error) {
		called++
		if gotID != entityID || current.(map[string]any)["id"] != entityID.String() {
			t.Fatal("support CAS identity drift")
		}
		if entityType == "effect" {
			if support.(map[string]any)["legacy_field"] != "preserved" {
				t.Fatal("exact legacy support object was not preserved")
			}
		} else if support != nil {
			t.Fatal("explicit null support was not preserved")
		}
		return entityType == "background", nil
	}
	router := contentMigrationTestRouter(controller)
	for _, entityType := range []string{
		"card", "effect", "action", "spell", "race", "class", "feat", "background",
	} {
		support := any(nil)
		if entityType == "effect" {
			support = map[string]any{"status": "untested", "legacy_field": "preserved"}
		}
		body := map[string]any{
			"schema_version":   1,
			"expected_current": map[string]any{"id": entityID.String(), "support": nil},
			"support":          support,
		}
		path := "/api/content-rollback/" + entityType + "/" + entityID.String() + "/support"
		response := migrationRequest(t, router, http.MethodPost, path, body, "migration-secret")
		if response.Code != http.StatusOK {
			t.Fatalf("%s: expected 200, got %d: %s", entityType, response.Code, response.Body.String())
		}
		var responseBody map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &responseBody); err != nil {
			t.Fatal(err)
		}
		if got, want := responseBody["already_rolled_back"], entityType == "background"; got != want {
			t.Fatalf("%s: already_rolled_back = %#v, want %#v", entityType, got, want)
		}
	}
	if called != 8 {
		t.Fatalf("expected all eight fixed entity adapters, got %d", called)
	}
}

func verifiedBatchSupport() map[string]any {
	return map[string]any{
		"status":                "verified_mechanical",
		"content_hash":          "sha256:" + strings.Repeat("a", 64),
		"dependency_hash":       "sha256:" + strings.Repeat("b", 64),
		"certification_version": "micro-mvp-test-v1",
		"certified_at":          "2026-08-05T12:00:00Z",
		"limitations":           []string{},
	}
}

func verifiedV3BatchSupport() map[string]any {
	support := verifiedBatchSupport()
	hash := "sha256:" + strings.Repeat("d", 64)
	support["certification_version"] = microMVPEvidenceCertificationVersion
	support["evidence_id"] = "00000000-0000-4000-8000-000000000001"
	support["evidence_hash"] = hash
	support["evidence_completed_at"] = "2026-08-05T11:59:00Z"
	for _, field := range []string{
		"gate_source_hash", "source_content_hash", "rules_hash", "release_content_hash",
		"release_hash", "patch_hash", "catalog_hash",
	} {
		support[field] = hash
	}
	support["test_coverage"] = map[string]any{
		"schema_version": 1, "scope": "micro-mvp-l1",
		"required": 12, "passed": 12, "percent": 100,
	}
	support["mechanics_locked"] = true
	return support
}

func exactSupportBatchBody(t *testing.T, mode string) map[string]any {
	t.Helper()
	entityTypes := []string{"effect", "action", "spell", "race", "class", "feat", "background"}
	entries := make([]map[string]any, 0, len(entityTypes))
	for index, entityType := range entityTypes {
		entityID := uuid.MustParse(fmt.Sprintf("00000000-0000-4000-8000-%012d", index+1))
		support := any(verifiedBatchSupport())
		if mode == "exact_rollback" {
			if index%2 == 0 {
				support = nil
			} else {
				support = map[string]any{
					"status": "legacy", "nested": []any{entityType, true, nil},
				}
			}
		}
		entries = append(entries, map[string]any{
			"entity_type": entityType,
			"entity_id":   entityID,
			"expected_current": map[string]any{
				"id": entityID, "name": entityType, "support": nil,
				"updated_at": "2026-08-05T10:00:00Z",
			},
			"support": support,
		})
	}
	return map[string]any{
		"schema_version": 1, "mode": mode,
		"plan_hash":      "sha256:" + strings.Repeat("c", 64),
		"operation_id":   "micro-mvp-certification-test",
		"expected_count": len(entries), "entries": entries,
	}
}

func TestExactSupportBatchHandlerCoversAllSevenTypesAndRequiresKey(t *testing.T) {
	controller := &ContentMigrationController{certificationKey: "migration-secret"}
	called := 0
	controller.batchSupport = func(entries []preparedContentSupportBatchEntry) (ContentSupportBatchResult, error) {
		called++
		if len(entries) != 7 {
			t.Fatalf("expected seven batch entries, got %d", len(entries))
		}
		gotTypes := make([]string, 0, len(entries))
		for _, entry := range entries {
			gotTypes = append(gotTypes, entry.EntityType)
		}
		wantTypes := []string{"action", "background", "class", "effect", "feat", "race", "spell"}
		if !reflect.DeepEqual(gotTypes, wantTypes) {
			t.Fatalf("entries were not deterministically sorted: %v", gotTypes)
		}
		return ContentSupportBatchResult{Total: 7, Updated: 7}, nil
	}
	router := contentMigrationTestRouter(controller)
	body := exactSupportBatchBody(t, "certification_apply")

	withoutKey := migrationRequest(
		t, router, http.MethodPost, "/api/content-support/batch-exact", body, "",
	)
	if withoutKey.Code != http.StatusForbidden || called != 0 {
		t.Fatalf("batch ran without certification key: status=%d calls=%d", withoutKey.Code, called)
	}
	response := migrationRequest(
		t, router, http.MethodPost, "/api/content-support/batch-exact", body, "migration-secret",
	)
	if response.Code != http.StatusOK || called != 1 {
		t.Fatalf("expected atomic batch success, status=%d calls=%d body=%s", response.Code, called, response.Body.String())
	}
}

func TestExactSupportBatchValidationFailsClosed(t *testing.T) {
	valid := exactSupportBatchBody(t, "certification_apply")
	invalidHashSupport := verifiedBatchSupport()
	invalidHashSupport["content_hash"] = "content-v1"

	for name, mutate := range map[string]func(map[string]any){
		"missing mode": func(body map[string]any) { delete(body, "mode") },
		"wrong count":  func(body map[string]any) { body["expected_count"] = 6 },
		"duplicate identity": func(body map[string]any) {
			bodyEntries := body["entries"].([]map[string]any)
			bodyEntries[1]["entity_type"] = bodyEntries[0]["entity_type"]
			bodyEntries[1]["entity_id"] = bodyEntries[0]["entity_id"]
			bodyEntries[1]["expected_current"] = bodyEntries[0]["expected_current"]
		},
		"identity mismatch": func(body map[string]any) {
			bodyEntries := body["entries"].([]map[string]any)
			bodyEntries[0]["entity_id"] = uuid.MustParse("00000000-0000-4000-8000-000000000099")
		},
		"invalid verified hash": func(body map[string]any) {
			body["entries"].([]map[string]any)[0]["support"] = invalidHashSupport
		},
		"missing explicit timestamp": func(body map[string]any) {
			support := verifiedBatchSupport()
			delete(support, "certified_at")
			body["entries"].([]map[string]any)[0]["support"] = support
		},
		"unknown support field": func(body map[string]any) {
			support := verifiedBatchSupport()
			support["unreviewed"] = true
			body["entries"].([]map[string]any)[0]["support"] = support
		},
	} {
		t.Run(name, func(t *testing.T) {
			body := stableCloneTestMap(t, valid)
			mutate(body)
			encoded, err := json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
			var request ContentSupportBatchRequest
			if err = json.Unmarshal(encoded, &request); err != nil {
				t.Fatal(err)
			}
			if _, err = prepareContentSupportBatch(request); err == nil {
				t.Fatal("invalid exact-support batch was accepted")
			}
		})
	}

	rollbackBody := exactSupportBatchBody(t, "exact_rollback")
	encoded, err := json.Marshal(rollbackBody)
	if err != nil {
		t.Fatal(err)
	}
	var rollback ContentSupportBatchRequest
	if err = json.Unmarshal(encoded, &rollback); err != nil {
		t.Fatal(err)
	}
	if _, err = prepareContentSupportBatch(rollback); err != nil {
		t.Fatalf("exact rollback must accept nested legacy support and null: %v", err)
	}

	v3Body := exactSupportBatchBody(t, "certification_apply")
	for _, entry := range v3Body["entries"].([]map[string]any) {
		entry["support"] = verifiedV3BatchSupport()
	}
	v3Encoded, err := json.Marshal(v3Body)
	if err != nil {
		t.Fatal(err)
	}
	var v3Request ContentSupportBatchRequest
	if err = json.Unmarshal(v3Encoded, &v3Request); err != nil {
		t.Fatal(err)
	}
	if _, err = prepareContentSupportBatch(v3Request); err != nil {
		t.Fatalf("complete current release evidence was rejected: %v", err)
	}
	v3Body["entries"].([]map[string]any)[0]["support"] = verifiedBatchSupport()
	v3Body["entries"].([]map[string]any)[0]["support"].(map[string]any)["certification_version"] =
		microMVPEvidenceCertificationVersion
	v3Encoded, err = json.Marshal(v3Body)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(v3Encoded, &v3Request); err != nil {
		t.Fatal(err)
	}
	if _, err = prepareContentSupportBatch(v3Request); err == nil {
		t.Fatal("current certification without release evidence was accepted")
	}
}

func TestExactSupportBatchAcceptsCompleteMicroMVPClosure(t *testing.T) {
	const certifiedClosureEntries = 243
	support, err := json.Marshal(verifiedBatchSupport())
	if err != nil {
		t.Fatal(err)
	}

	entries := make([]ContentSupportBatchEntryRequest, 0, certifiedClosureEntries)
	for index := 0; index < certifiedClosureEntries; index++ {
		entityID := uuid.MustParse(fmt.Sprintf("00000000-0000-4000-8000-%012d", index+1))
		expectedCurrent, marshalErr := json.Marshal(map[string]any{
			"id":      entityID,
			"name":    fmt.Sprintf("certified-effect-%03d", index+1),
			"support": nil,
		})
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		entries = append(entries, ContentSupportBatchEntryRequest{
			EntityType:      "effect",
			EntityID:        entityID,
			ExpectedCurrent: expectedCurrent,
			Support:         support,
		})
	}

	request := ContentSupportBatchRequest{
		SchemaVersion: 1,
		Mode:          "certification_apply",
		PlanHash:      "sha256:" + strings.Repeat("c", 64),
		OperationID:   "complete-micro-mvp-closure-test",
		ExpectedCount: certifiedClosureEntries,
		Entries:       entries,
	}
	prepared, err := prepareContentSupportBatch(request)
	if err != nil {
		t.Fatalf("complete %d-entity certification closure was rejected: %v", certifiedClosureEntries, err)
	}
	if len(prepared) != certifiedClosureEntries {
		t.Fatalf("prepared %d entries, want %d", len(prepared), certifiedClosureEntries)
	}

	request.ExpectedCount = contentSupportBatchMaxEntries + 1
	if _, err = prepareContentSupportBatch(request); err == nil {
		t.Fatalf("batch above the hard %d-entry bound was accepted", contentSupportBatchMaxEntries)
	}
}

func TestExactSupportBatchHasIsolatedBoundedCapacity(t *testing.T) {
	if contentSupportBatchMaxEntries < 243 {
		t.Fatalf("entry bound %d cannot contain the certified micro-MVP closure", contentSupportBatchMaxEntries)
	}
	if maxContentSupportBatchBodyBytes != 8<<20 {
		t.Fatalf("unexpected atomic certification body bound: %d", maxContentSupportBatchBodyBytes)
	}
}

func stableCloneTestMap(t *testing.T, value map[string]any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var cloned map[string]any
	if err = json.Unmarshal(raw, &cloned); err != nil {
		t.Fatal(err)
	}
	// Restore the concrete slice shape expected by the small test mutators.
	rawEntries := cloned["entries"].([]any)
	entries := make([]map[string]any, 0, len(rawEntries))
	for _, entry := range rawEntries {
		entries = append(entries, entry.(map[string]any))
	}
	cloned["entries"] = entries
	return cloned
}
