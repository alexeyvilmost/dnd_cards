package main

import (
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestFrozenCatalogIdentityIncludesOwnerArtifactAndAllInput(t *testing.T) {
	row := FrozenCombatCatalog{UserID: uuid.New(), SerializerVersion: 1, ProtocolVersion: 1, ArtifactHash: "sha256:" + strings.Repeat("a", 64), Payload: JSONMap{"schemaVersion": 1, "entities": JSONMap{"action": []any{JSONMap{"id": "second-declaration", "cost": 2}}}}}
	base, err := frozenCatalogHash(row)
	if err != nil {
		t.Fatal(err)
	}
	other := row
	other.UserID = uuid.New()
	hash, _ := frozenCatalogHash(other)
	if hash == base {
		t.Fatal("private owners shared identity")
	}
	other = row
	other.ArtifactHash = "sha256:" + strings.Repeat("b", 64)
	hash, _ = frozenCatalogHash(other)
	if hash == base {
		t.Fatal("artifact identity omitted")
	}
	other = row
	other.Payload = JSONMap{"schemaVersion": 1, "entities": JSONMap{"action": []any{JSONMap{"id": "second-declaration", "cost": 3}}}}
	hash, _ = frozenCatalogHash(other)
	if hash == base {
		t.Fatal("input payload omitted")
	}
	other = row
	other.ProtocolVersion = 2
	if _, err = frozenCatalogHash(other); err == nil {
		t.Fatal("unknown protocol accepted")
	}
}

func TestFrozenCatalogPinReadRollbackAndFailClosed(t *testing.T) {
	t.Setenv("DB_FROZEN_CATALOGS", "1")
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&RoguelikeRun{}, &FrozenCombatCatalog{}); err != nil {
		t.Fatal(err)
	}
	run := RoguelikeRun{ID: uuid.New(), UserID: f.owner.ID, CharacterID: f.ownerCharacter.ID, SourceCharacterID: f.ownerCharacter.ID,
		Status: RoguelikeStatusActive, Phase: RoguelikePhaseCombat, RunSeed: "owned-catalog", Encounter: JSONMap{}, Shop: JSONMap{}, Checkpoint: JSONMap{}, LastReward: JSONMap{},
		CombatEnvelope: JSONMap{"artifactHash": "sha256:" + strings.Repeat("a", 64), "state": JSONMap{"dynamic": true}}, CombatCatalog: JSONMap{"schemaVersion": 1, "entities": JSONMap{"action": []any{JSONMap{"cost": 2}}}}}
	if err := f.db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	failed := run
	if err := f.db.Transaction(func(tx *gorm.DB) error {
		if err := pinFrozenCombatCatalog(tx, &failed); err != nil {
			return err
		}
		if err := saveRoguelikeRun(tx, &failed); err != nil {
			return err
		}
		return errors.New("injected failure after catalog pin and run update")
	}); err == nil {
		t.Fatal("catalog transaction unexpectedly committed")
	}
	var count int64
	if err := f.db.Model(&FrozenCombatCatalog{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("catalog escaped rolled-back transaction")
	}
	var retainedRef *string
	if err := f.db.Raw("SELECT combat_catalog_ref FROM roguelike_runs WHERE id=?", run.ID).Scan(&retainedRef).Error; err != nil || retainedRef != nil {
		t.Fatal("reference escaped rolled-back transaction")
	}
	if err := pinFrozenCombatCatalog(f.db, &run); err != nil {
		t.Fatal(err)
	}
	if err := saveRoguelikeRun(f.db, &run); err != nil {
		t.Fatal(err)
	}
	var inline string
	if err := f.db.Raw("SELECT combat_catalog::text FROM roguelike_runs WHERE id=?", run.ID).Scan(&inline).Error; err != nil {
		t.Fatal(err)
	}
	if inline != "{}" {
		t.Fatal("inline duplicate retained")
	}
	t.Setenv("DB_FROZEN_CATALOGS", "0")
	loaded, err := ownedRoguelikeRun(f.db, run.ID, run.UserID, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.CombatCatalog) == 0 {
		t.Fatal("writer disable broke catalog reader")
	}
	columns := coldRunColumns(loaded)
	if err = prepareRunStorageColumns(f.db, loaded, columns); err != nil {
		t.Fatal(err)
	}
	if _, ok := columns["combat_catalog"]; ok {
		t.Fatal("unchanged hydrated catalog was sent on UPDATE")
	}
	foreign := *loaded
	foreign.UserID = f.other.ID
	foreign.CombatCatalog = JSONMap{}
	if err = loadFrozenCombatCatalog(f.db, &foreign); err == nil {
		t.Fatal("foreign catalog read succeeded")
	}
	loaded.CombatCatalog["forged"] = true
	if err = saveRoguelikeRun(f.db, loaded); err == nil {
		t.Fatal("frozen input mutation was accepted")
	}
	if err = f.db.Model(&FrozenCombatCatalog{}).Where("user_id=? AND content_hash=?", run.UserID, *run.CombatCatalogRef).Update("payload", JSONMap{"corrupt": true}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err = ownedRoguelikeRun(f.db, run.ID, run.UserID, false); err == nil {
		t.Fatal("corrupt catalog was hydrated")
	}
	if err = f.db.Where("user_id=?", run.UserID).Delete(&FrozenCombatCatalog{}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err = ownedRoguelikeRun(f.db, run.ID, run.UserID, false); err == nil {
		t.Fatal("missing catalog fell back to current library")
	}
}

func TestColdRunComparisonRetainsChangedValues(t *testing.T) {
	t.Setenv("DB_FROZEN_CATALOGS", "1")
	run := RoguelikeRun{Checkpoint: JSONMap{"nested": JSONMap{"gold": 1}}, Shop: JSONMap{}, CombatCatalog: JSONMap{}, ModeRules: JSONMap{}}
	if err := captureColdRunColumns(&run); err != nil {
		t.Fatal(err)
	}
	run.Checkpoint["nested"].(JSONMap)["gold"] = 2
	if string(run.storageOriginal["checkpoint"]) != `{"nested":{"gold":1}}` {
		t.Fatal("snapshot aliased mutable data")
	}
}
