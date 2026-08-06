package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Run against an isolated restored dump after migration 093 with
// CONTENT_MIGRATION_TEST_DSN. It proves transaction behavior that a mocked
// handler cannot: receipt failure rolls create back and hard-delete retains the
// audit receipt while physically removing the ledger-owned Effect.
func TestContentMigrationCreateReceiptRoundTripOnIsolatedPostgres(t *testing.T) {
	dsn := os.Getenv("CONTENT_MIGRATION_TEST_DSN")
	if dsn == "" {
		t.Skip("CONTENT_MIGRATION_TEST_DSN is not set")
	}
	// Force a value PostgreSQL cannot represent exactly. The create endpoint
	// must reload the persisted row before issuing its rollback receipt.
	deterministicNow := time.Date(2026, 8, 6, 6, 5, 51, 455193417, time.UTC)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		NowFunc: func() time.Time { return deterministicNow },
	})
	if err != nil {
		t.Fatal(err)
	}
	prepareContentMigrationIntegrationSchema(t, db)
	controller := NewContentMigrationController(db)
	bundleID := uuid.New()
	actorID := uuid.New()
	suffix := stringsNoDash(uuid.New().String())[:8]

	// The restored production schema has both invalidate_effects_support and
	// update_effects_updated_at. A support-only UPDATE therefore changes the
	// managed timestamp; exact rollback must still preserve every other API
	// field and arbitrary legacy JSON.
	historical := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	supportEffect := Effect{
		Name: "Support integration " + suffix, Description: "Disposable support fixture",
		Rarity: RarityCommon, CardNumber: "EFF-support-" + suffix,
		EffectType: EffectTypePassive, Author: "Admin",
		Mechanics: &JSONMap{
			"legacy":     true,
			"activation": map[string]any{"mode": "legacy"},
		},
		CreatedAt: historical, UpdatedAt: historical,
	}
	if err = db.Create(&supportEffect).Error; err != nil {
		t.Fatal(err)
	}
	defer db.Unscoped().Delete(&supportEffect)
	_, beforeSupportResponse, err := loadContentMigrationEntityForUpdate(
		db, "effect", supportEffect.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	beforeSupportMap, err := apiResponseAsJSONMap(beforeSupportResponse)
	if err != nil {
		t.Fatal(err)
	}
	exactDescription := "CAS-updated disposable support fixture"
	exactMechanics := map[string]any{
		"activation": map[string]any{
			"mode": "rest_decision",
			"cost": []any{map[string]any{"resource": "magic_recovery_charge"}},
		},
		"effects": []any{},
	}
	exactMechanicsJSON, err := json.Marshal(exactMechanics)
	if err != nil {
		t.Fatal(err)
	}
	exactFields := map[string]json.RawMessage{
		"description": json.RawMessage(fmt.Sprintf("%q", exactDescription)),
		"mechanics":   exactMechanicsJSON,
	}
	exactEntity, alreadyUpdated, exactErr := controller.updateExactContent(
		"effect", supportEffect.ID, beforeSupportMap, exactFields,
	)
	if exactErr != nil || alreadyUpdated {
		t.Fatalf("real-trigger exact content update: already=%v err=%v", alreadyUpdated, exactErr)
	}
	exactMap, mapErr := apiResponseAsJSONMap(exactEntity)
	if mapErr != nil {
		t.Fatal(mapErr)
	}
	if exactMap["description"] != exactDescription ||
		!reflect.DeepEqual(exactMap["mechanics"], exactMechanics) || exactMap["support"] != nil ||
		exactMap["id"] != supportEffect.ID.String() || exactMap["card_number"] != supportEffect.CardNumber {
		t.Fatalf("exact content postimage changed identity/support semantics: %#v", exactMap)
	}
	// Retrying the original exact preimage after a committed write is a
	// recognized success and must not issue a second UPDATE.
	_, alreadyUpdated, exactErr = controller.updateExactContent(
		"effect", supportEffect.ID, beforeSupportMap, exactFields,
	)
	if exactErr != nil || !alreadyUpdated {
		t.Fatalf("lost-response exact content retry: already=%v err=%v", alreadyUpdated, exactErr)
	}
	conflictingFields := map[string]json.RawMessage{
		"description": json.RawMessage(`"unreviewed competing value"`),
	}
	if _, _, exactErr = controller.updateExactContent(
		"effect", supportEffect.ID, beforeSupportMap, conflictingFields,
	); !errors.Is(exactErr, errContentMigrationConflict) {
		t.Fatalf("stale exact preimage error=%v, want CAS conflict", exactErr)
	}
	_, afterConflictResponse, loadErr := loadContentMigrationEntityForUpdate(
		db, "effect", supportEffect.ID,
	)
	if loadErr != nil {
		t.Fatal(loadErr)
	}
	afterConflictMap, mapErr := apiResponseAsJSONMap(afterConflictResponse)
	if mapErr != nil || afterConflictMap["description"] != exactDescription {
		t.Fatalf("CAS conflict mutated content: %#v err=%v", afterConflictMap, mapErr)
	}
	beforeSupportMap = exactMap
	legacySupport := map[string]any{
		"status": "legacy",
		"legacy_field": map[string]any{
			"nested": []any{"preserved", true, nil},
		},
	}
	alreadyRestored, err := controller.restoreExactSupport(
		"effect", supportEffect.ID, map[string]any(beforeSupportMap), legacySupport,
	)
	if err != nil || alreadyRestored {
		t.Fatalf("real-trigger exact support restore: %v", err)
	}
	var supportRestored Effect
	if err = db.First(&supportRestored, "id = ?", supportEffect.ID).Error; err != nil {
		t.Fatal(err)
	}
	if supportRestored.Support == nil || !reflect.DeepEqual(
		map[string]any(*supportRestored.Support), legacySupport,
	) {
		t.Fatalf("legacy support changed: %#v", supportRestored.Support)
	}
	if !supportRestored.UpdatedAt.After(historical) {
		t.Fatalf("real updated_at trigger did not run: %s", supportRestored.UpdatedAt)
	}
	// A lost HTTP response must be safely retryable with the original exact
	// expected_current. The server recognizes the requested final state while
	// still comparing every non-managed field.
	alreadyRestored, err = controller.restoreExactSupport(
		"effect", supportEffect.ID, map[string]any(beforeSupportMap), legacySupport,
	)
	if err != nil || !alreadyRestored {
		t.Fatalf("idempotent exact support retry: already=%v err=%v", alreadyRestored, err)
	}

	// Certification64 also contains feats and backgrounds. Exercise their real
	// response adapters, row locks and PostgreSQL support/updated_at triggers.
	feat := Feat{
		Name: "Support feat " + suffix, Description: "Disposable feat adapter",
		Rarity: RarityCommon, CardNumber: "FEAT-support-" + suffix,
		Category: FeatOrigin, Author: "Admin",
	}
	if err = db.Create(&feat).Error; err != nil {
		t.Fatal(err)
	}
	defer db.Unscoped().Delete(&feat)
	background := Background{
		Name: "Support background " + suffix, Description: "Disposable background adapter",
		Rarity: RarityCommon, CardNumber: "BG-support-" + suffix, Author: "Admin",
	}
	if err = db.Create(&background).Error; err != nil {
		t.Fatal(err)
	}
	defer db.Unscoped().Delete(&background)

	for entityType, entityID := range map[string]uuid.UUID{
		"feat": feat.ID, "background": background.ID,
	} {
		_, response, loadErr := loadContentMigrationEntityForUpdate(db, entityType, entityID)
		if loadErr != nil {
			t.Fatalf("%s adapter load: %v", entityType, loadErr)
		}
		before, mapErr := apiResponseAsJSONMap(response)
		if mapErr != nil {
			t.Fatal(mapErr)
		}
		adapterSupport := map[string]any{
			"status": "legacy", "adapter": entityType,
			"nested": map[string]any{"preserved": true},
		}
		already, restoreErr := controller.restoreExactSupport(
			entityType, entityID, map[string]any(before), adapterSupport,
		)
		if restoreErr != nil || already {
			t.Fatalf("%s support restore: already=%v err=%v", entityType, already, restoreErr)
		}
		_, restoredResponse, loadErr := loadContentMigrationEntityForUpdate(db, entityType, entityID)
		if loadErr != nil {
			t.Fatal(loadErr)
		}
		restoredMap, mapErr := apiResponseAsJSONMap(restoredResponse)
		if mapErr != nil || !reflect.DeepEqual(restoredMap["support"], adapterSupport) {
			t.Fatalf("%s legacy support changed: %#v err=%v", entityType, restoredMap["support"], mapErr)
		}
		already, restoreErr = controller.restoreExactSupport(
			entityType, entityID, map[string]any(before), adapterSupport,
		)
		if restoreErr != nil || !already {
			t.Fatalf("%s idempotent retry: already=%v err=%v", entityType, already, restoreErr)
		}
	}

	loadMap := func(entityType string, entityID uuid.UUID) JSONMap {
		t.Helper()
		_, response, loadErr := loadContentMigrationEntityForUpdate(db, entityType, entityID)
		if loadErr != nil {
			t.Fatalf("%s batch fixture load: %v", entityType, loadErr)
		}
		result, mapErr := apiResponseAsJSONMap(response)
		if mapErr != nil {
			t.Fatal(mapErr)
		}
		return result
	}
	batchIdentities := []struct {
		entityType string
		entityID   uuid.UUID
	}{
		{entityType: "background", entityID: background.ID},
		{entityType: "effect", entityID: supportEffect.ID},
		{entityType: "feat", entityID: feat.ID},
	}
	batchEntries := make([]preparedContentSupportBatchEntry, 0, len(batchIdentities))
	originalSupports := make(map[string]any, len(batchIdentities))
	for _, identity := range batchIdentities {
		current := loadMap(identity.entityType, identity.entityID)
		originalSupports[identity.entityType] = current["support"]
		batchEntries = append(batchEntries, preparedContentSupportBatchEntry{
			EntityType: identity.entityType, EntityID: identity.entityID,
			ExpectedCurrent: current,
			Support: map[string]any{
				"status": "verified_mechanical", "batch": identity.entityType,
			},
		})
	}

	// A failure on the final (feat) UPDATE must roll back the earlier
	// background/effect writes in the same transaction.
	functionName := "reject_batch_support_" + suffix
	triggerName := "reject_batch_support_" + suffix
	dropRejectTrigger := func() {
		db.Exec(fmt.Sprintf("DROP TRIGGER IF EXISTS %s ON feats", triggerName))
		db.Exec(fmt.Sprintf("DROP FUNCTION IF EXISTS %s()", functionName))
	}
	defer dropRejectTrigger()
	if exec := db.Exec(fmt.Sprintf(`
		CREATE FUNCTION %s() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF NEW.id = '%s'::uuid AND NEW.support IS DISTINCT FROM OLD.support THEN
				RAISE EXCEPTION 'intentional exact-support batch failure';
			END IF;
			RETURN NEW;
		END $$`, functionName, feat.ID)); exec.Error != nil {
		t.Fatal(exec.Error)
	}
	if exec := db.Exec(fmt.Sprintf(`
		CREATE TRIGGER %s BEFORE UPDATE OF support ON feats
		FOR EACH ROW EXECUTE FUNCTION %s()`, triggerName, functionName)); exec.Error != nil {
		t.Fatal(exec.Error)
	}
	if _, batchErr := controller.applyExactSupportBatch(batchEntries); batchErr == nil {
		t.Fatal("intentional Nth batch UPDATE failure unexpectedly committed")
	}
	for _, identity := range batchIdentities {
		current := loadMap(identity.entityType, identity.entityID)
		if !reflect.DeepEqual(current["support"], originalSupports[identity.entityType]) {
			t.Fatalf("%s changed despite transaction rollback: %#v", identity.entityType, current["support"])
		}
	}
	dropRejectTrigger()

	batchResult, batchErr := controller.applyExactSupportBatch(batchEntries)
	if batchErr != nil || batchResult.Updated != len(batchEntries) || batchResult.AlreadyApplied {
		t.Fatalf("atomic support batch: result=%#v err=%v", batchResult, batchErr)
	}
	retryResult, batchErr := controller.applyExactSupportBatch(batchEntries)
	if batchErr != nil || !retryResult.AlreadyApplied ||
		retryResult.AlreadyInRequestedState != len(batchEntries) {
		t.Fatalf("lost-response batch retry: result=%#v err=%v", retryResult, batchErr)
	}

	// Rollback is the same atomic primitive with exact applied postimages and
	// arbitrary original support (nested legacy objects included).
	rollbackEntries := make([]preparedContentSupportBatchEntry, 0, len(batchEntries))
	for _, entry := range batchEntries {
		rollbackEntries = append(rollbackEntries, preparedContentSupportBatchEntry{
			EntityType: entry.EntityType, EntityID: entry.EntityID,
			ExpectedCurrent: loadMap(entry.EntityType, entry.EntityID),
			Support:         originalSupports[entry.EntityType],
		})
	}
	rollbackResult, batchErr := controller.applyExactSupportBatch(rollbackEntries)
	if batchErr != nil || rollbackResult.Updated != len(rollbackEntries) {
		t.Fatalf("atomic support rollback: result=%#v err=%v", rollbackResult, batchErr)
	}
	retryRollback, batchErr := controller.applyExactSupportBatch(rollbackEntries)
	if batchErr != nil || !retryRollback.AlreadyApplied {
		t.Fatalf("lost-response rollback retry: result=%#v err=%v", retryRollback, batchErr)
	}

	// Concurrent body drift on one locked-set member rejects the complete
	// request before any support UPDATE on the other members.
	driftEntries := make([]preparedContentSupportBatchEntry, 0, len(batchIdentities))
	for _, identity := range batchIdentities {
		driftEntries = append(driftEntries, preparedContentSupportBatchEntry{
			EntityType: identity.entityType, EntityID: identity.entityID,
			ExpectedCurrent: loadMap(identity.entityType, identity.entityID),
			Support:         map[string]any{"status": "verified_mechanical", "drift_test": true},
		})
	}
	if err = db.Model(&feat).UpdateColumn("name", feat.Name+" drift").Error; err != nil {
		t.Fatal(err)
	}
	if _, batchErr = controller.applyExactSupportBatch(driftEntries); !errors.Is(batchErr, errContentMigrationConflict) {
		t.Fatalf("concurrent body drift error=%v, want conflict", batchErr)
	}
	for _, entry := range driftEntries[:2] {
		current := loadMap(entry.EntityType, entry.EntityID)
		if !reflect.DeepEqual(current["support"], entry.ExpectedCurrent["support"]) {
			t.Fatalf("%s support changed before drift rejection", entry.EntityType)
		}
	}

	operationID := "effects:EFF-ledger-" + suffix + ":create"
	const planHash = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
	request := ContentMigrationEffectCreateRequest{
		SchemaVersion: 1,
		PlanHash:      planHash,
		OperationID:   operationID,
		Entity: CreateEffectRequest{
			Name: "Ledger integration " + suffix, Description: "Disposable receipt fixture",
			Rarity: RarityCommon, CardNumber: "EFF-ledger-" + suffix,
			EffectType: EffectTypePassive,
		},
	}
	created, err := controller.createEffectWithReceipt(bundleID, request, actorID)
	if err != nil {
		t.Fatalf("atomic create: %v", err)
	}

	// Same operation identity with another card forces the ledger UNIQUE error
	// after Effect INSERT; the surrounding transaction must remove that Effect.
	secondCard := "EFF-ledger2-" + suffix
	second := request
	second.Entity.CardNumber = secondCard
	if _, err = controller.createEffectWithReceipt(bundleID, second, actorID); err == nil {
		t.Fatal("duplicate operation receipt unexpectedly succeeded")
	}
	var secondCount int64
	if err = db.Unscoped().Model(&Effect{}).Where("card_number = ?", secondCard).Count(&secondCount).Error; err != nil {
		t.Fatal(err)
	}
	if secondCount != 0 {
		t.Fatalf("receipt failure leaked %d Effect rows", secondCount)
	}

	rollback := ContentMigrationEffectRollbackRequest{
		SchemaVersion: 1, BundleID: bundleID, PlanHash: planHash,
		OperationID: operationID, CardNumber: request.Entity.CardNumber,
		ExpectedCurrentHash: created.Rollback.PostimageHash,
	}
	already, err := controller.rollbackCreatedEffect(created.Entity.ID, rollback, actorID)
	if err != nil || already {
		t.Fatalf("first ledger rollback: already=%v err=%v", already, err)
	}
	var effectCount int64
	if err = db.Unscoped().Model(&Effect{}).Where("id = ?", created.Entity.ID).Count(&effectCount).Error; err != nil {
		t.Fatal(err)
	}
	if effectCount != 0 {
		t.Fatalf("ledger rollback left %d physical Effect rows", effectCount)
	}
	var receipt ContentMigrationCreateReceipt
	if err = db.Where("id = ?", created.Rollback.ReceiptID).First(&receipt).Error; err != nil {
		t.Fatal(err)
	}
	if receipt.Status != "rolled_back" || receipt.RolledBackAt == nil || receipt.RolledBackByUserID == nil {
		t.Fatalf("receipt audit was not retained: %#v", receipt)
	}
	already, err = controller.rollbackCreatedEffect(created.Entity.ID, rollback, actorID)
	if err != nil || !already {
		t.Fatalf("idempotent ledger retry: already=%v err=%v", already, err)
	}

	// A caller cannot manufacture provenance for a non-ledger row.
	nonLedger := Effect{
		Name: "Non-ledger " + suffix, Description: "Must survive rejected rollback",
		Rarity: RarityCommon, CardNumber: "EFF-nonledger-" + suffix,
		EffectType: EffectTypePassive, Author: "Admin",
	}
	if err = db.Create(&nonLedger).Error; err != nil {
		t.Fatal(err)
	}
	defer db.Unscoped().Delete(&nonLedger)
	nonLedgerRollback := rollback
	nonLedgerRollback.CardNumber = nonLedger.CardNumber
	if _, err = controller.rollbackCreatedEffect(nonLedger.ID, nonLedgerRollback, actorID); !errors.Is(err, errContentMigrationNotFound) {
		t.Fatalf("non-ledger row rollback error = %v, want not found", err)
	}
	if err = db.First(&Effect{}, "id = ?", nonLedger.ID).Error; err != nil {
		t.Fatalf("non-ledger row was mutated: %v", err)
	}
}

// prepareContentMigrationIntegrationSchema keeps two distinct integration
// modes honest:
//   - release drills point at a restored production dump and exercise its real
//     tables and triggers without modifying the schema here;
//   - CI may opt into a minimal, disposable schema that isolates transaction,
//     trigger and receipt-ledger behavior from production data.
//
// Missing or partially present tables fail closed unless the explicit CI-only
// bootstrap flag is set. This prevents a typo in CONTENT_MIGRATION_TEST_DSN
// from silently turning an arbitrary database into a test fixture.
func prepareContentMigrationIntegrationSchema(t *testing.T, db *gorm.DB) {
	t.Helper()
	tables := []any{&Effect{}, &Feat{}, &Background{}, &ContentMigrationCreateReceipt{}}
	present := 0
	for _, table := range tables {
		if db.Migrator().HasTable(table) {
			present++
		}
	}
	if present == len(tables) {
		return
	}
	if os.Getenv("CONTENT_MIGRATION_TEST_BOOTSTRAP") != "1" {
		t.Fatalf(
			"content migration integration schema is incomplete (%d/%d tables); restore a production dump or explicitly enable disposable CI bootstrap",
			present, len(tables),
		)
	}
	if present != 0 {
		t.Fatalf("refusing to bootstrap a partially populated content migration database (%d/%d tables)", present, len(tables))
	}
	if err := db.Exec(`CREATE EXTENSION IF NOT EXISTS pgcrypto`).Error; err != nil {
		t.Fatalf("enable pgcrypto in disposable content database: %v", err)
	}
	if err := db.AutoMigrate(tables...); err != nil {
		t.Fatalf("bootstrap disposable content tables: %v", err)
	}
	if err := db.Exec(`
		CREATE OR REPLACE FUNCTION update_updated_at_column()
		RETURNS TRIGGER AS $$
		BEGIN
			NEW.updated_at = CURRENT_TIMESTAMP;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;

		CREATE OR REPLACE FUNCTION invalidate_content_support()
		RETURNS TRIGGER AS $$
		BEGIN
			IF (to_jsonb(NEW) - 'support' - 'updated_at')
				IS DISTINCT FROM
			   (to_jsonb(OLD) - 'support' - 'updated_at') THEN
				NEW.support = NULL;
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;

		CREATE TRIGGER update_effects_updated_at
			BEFORE UPDATE ON effects
			FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
		CREATE TRIGGER invalidate_effects_support
			BEFORE UPDATE ON effects
			FOR EACH ROW EXECUTE FUNCTION invalidate_content_support();
		CREATE TRIGGER update_feats_updated_at
			BEFORE UPDATE ON feats
			FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
		CREATE TRIGGER invalidate_feats_support
			BEFORE UPDATE ON feats
			FOR EACH ROW EXECUTE FUNCTION invalidate_content_support();
		CREATE TRIGGER update_backgrounds_updated_at
			BEFORE UPDATE ON backgrounds
			FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
		CREATE TRIGGER invalidate_backgrounds_support
			BEFORE UPDATE ON backgrounds
			FOR EACH ROW EXECUTE FUNCTION invalidate_content_support();

		CREATE UNIQUE INDEX uq_content_migration_receipts_bundle_operation
			ON content_migration_create_receipts(bundle_id, plan_hash, operation_id);
		CREATE UNIQUE INDEX uq_content_migration_receipts_entity
			ON content_migration_create_receipts(entity_type, entity_id);
	`).Error; err != nil {
		t.Fatalf("bootstrap disposable content triggers and receipt constraints: %v", err)
	}
}

func stringsNoDash(value string) string {
	result := make([]byte, 0, len(value))
	for index := 0; index < len(value); index++ {
		if value[index] != '-' {
			result = append(result, value[index])
		}
	}
	return string(result)
}
