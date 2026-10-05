package main

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func frozenScopeFixture(t *testing.T) (characterV3AccessFixture, RoguelikeRun) {
	t.Helper()
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&RoguelikeRun{}, &FrozenCombatCatalog{}); err != nil {
		t.Fatal(err)
	}
	run := RoguelikeRun{ID: uuid.New(), UserID: f.owner.ID, CharacterID: f.ownerCharacter.ID, SourceCharacterID: f.ownerCharacter.ID,
		Status: RoguelikeStatusActive, Phase: RoguelikePhaseCombat, RunSeed: "owned-scope", Encounter: JSONMap{}, Shop: JSONMap{}, Checkpoint: JSONMap{}, LastReward: JSONMap{},
		CombatEnvelope: JSONMap{"artifactHash": "sha256:" + strings.Repeat("a", 64)}, CombatCatalog: JSONMap{"schemaVersion": 1, "entities": JSONMap{"action": []any{JSONMap{"cost": 2}}}}}
	if err := f.db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	return f, run
}

func frozenScopeQueries(t *testing.T, db *gorm.DB) (*atomic.Int64, *atomic.Int64) {
	t.Helper()
	reads, writes := new(atomic.Int64), new(atomic.Int64)
	name := "frozen-scope-" + uuid.NewString()
	if err := db.Callback().Query().After("gorm:query").Register(name, func(tx *gorm.DB) {
		if tx.Statement.Table == "frozen_combat_catalogs" {
			reads.Add(1)
		}
	}); err != nil {
		t.Fatal(err)
	}
	if err := db.Callback().Create().After("gorm:create").Register(name, func(tx *gorm.DB) {
		if tx.Statement.Table == "frozen_combat_catalogs" {
			writes.Add(1)
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Callback().Query().Remove(name); db.Callback().Create().Remove(name) })
	return reads, writes
}

func TestFrozenCatalogTransactionScopeClonesAndRevalidatesRun(t *testing.T) {
	t.Setenv("DB_FROZEN_CATALOGS", "1")
	f, run := frozenScopeFixture(t)
	if err := pinFrozenCombatCatalog(f.db, &run); err != nil {
		t.Fatal(err)
	}
	if err := saveRoguelikeRun(f.db, &run); err != nil {
		t.Fatal(err)
	}
	reads, _ := frozenScopeQueries(t, f.db)
	if err := f.db.Transaction(func(tx *gorm.DB) error {
		scope := newFrozenCatalogReadScope(tx)
		defer scope.close()
		first, err := ownedRoguelikeRun(tx, run.ID, run.UserID, true, scope)
		if err != nil {
			return err
		}
		first.CombatCatalog["mutated"] = true
		second, err := ownedRoguelikeRun(tx, run.ID, run.UserID, false, scope)
		if err != nil {
			return err
		}
		if second.CombatCatalog["mutated"] != nil || reads.Load() != 1 {
			t.Fatal("accepted reload shared a mutable payload or repeated its catalog SELECT")
		}
		if _, err := ownedRoguelikeRun(tx, run.ID, f.other.ID, false, scope); err == nil {
			t.Fatal("cached catalog bypassed current run ownership")
		}
		for _, kind := range []string{"owner", "artifact", "ref", "inline"} {
			bad := *second
			bad.CombatCatalog = JSONMap{}
			bad.CombatEnvelope = JSONMap{"artifactHash": second.CombatEnvelope["artifactHash"]}
			switch kind {
			case "owner":
				bad.UserID = f.other.ID
			case "artifact":
				bad.CombatEnvelope["artifactHash"] = "sha256:" + strings.Repeat("b", 64)
			case "ref":
				ref := strings.Repeat("c", 64)
				bad.CombatCatalogRef = &ref
			case "inline":
				bad.CombatCatalog["forged"] = true
			}
			if err := loadFrozenCombatCatalog(tx, &bad, scope); err == nil {
				t.Fatalf("scope bypassed current %s validation", kind)
			}
		}
		// Even a corrupted serialized scope must fail its full content hash.
		scope.raw = []byte(strings.Replace(string(scope.raw), `"cost":2`, `"cost":3`, 1))
		bad := *second
		bad.CombatCatalog = JSONMap{}
		if err := loadFrozenCombatCatalog(tx, &bad, scope); err == nil {
			t.Fatal("scope payload hash was not revalidated")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestFrozenCatalogWarmPinReadsWithoutInsertAndRejectsCorruption(t *testing.T) {
	t.Setenv("DB_FROZEN_CATALOGS", "1")
	f, run := frozenScopeFixture(t)
	if err := pinFrozenCombatCatalog(f.db, &run); err != nil {
		t.Fatal(err)
	}
	reads, writes := frozenScopeQueries(t, f.db)
	if err := f.db.Transaction(func(tx *gorm.DB) error {
		scope := newFrozenCatalogReadScope(tx)
		defer scope.close()
		if err := pinFrozenCombatCatalog(tx, &run, scope); err != nil {
			return err
		}
		loaded := run
		loaded.CombatCatalog = JSONMap{}
		if err := loadFrozenCombatCatalog(tx, &loaded, scope); err != nil {
			return err
		}
		if reads.Load() != 1 || writes.Load() != 0 {
			t.Fatalf("warm pin+reload reads=%d inserts=%d", reads.Load(), writes.Load())
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.db.Model(&FrozenCombatCatalog{}).Where("user_id=? AND content_hash=?", run.UserID, *run.CombatCatalogRef).Update("payload", JSONMap{"corrupt": true}).Error; err != nil {
		t.Fatal(err)
	}
	if err := pinFrozenCombatCatalog(f.db, &run); err == nil {
		t.Fatal("warm pin trusted a matching primary key over corrupted payload")
	}
	if writes.Load() != 0 {
		t.Fatal("warm pin attempted to replace corrupt immutable row")
	}
}

func TestFrozenCatalogScopeCannotEscapeTransactionOrRollback(t *testing.T) {
	t.Setenv("DB_FROZEN_CATALOGS", "1")
	f, run := frozenScopeFixture(t)
	var retained *frozenCatalogReadScope
	rollback := errors.New("owned rollback")
	if err := f.db.Transaction(func(tx *gorm.DB) error {
		retained = newFrozenCatalogReadScope(tx)
		defer retained.close()
		if err := pinFrozenCombatCatalog(tx, &run, retained); err != nil {
			return err
		}
		// Another transaction cannot reuse the first transaction's uncommitted row.
		if err := f.db.Transaction(func(other *gorm.DB) error {
			loaded := run
			loaded.CombatCatalog = JSONMap{}
			if err := loadFrozenCombatCatalog(other, &loaded, retained); err == nil {
				t.Fatal("uncommitted catalog escaped to another transaction")
			}
			return nil
		}); err != nil {
			return err
		}
		return rollback
	}); !errors.Is(err, rollback) {
		t.Fatalf("wrong rollback result: %v", err)
	}
	if retained.tx != nil || len(retained.raw) != 0 {
		t.Fatal("transaction scope retained private content after callback exit")
	}
	loaded := run
	loaded.CombatCatalog = JSONMap{}
	if err := loadFrozenCombatCatalog(f.db, &loaded, retained); err == nil {
		t.Fatal("rolled-back catalog escaped through a stale scope")
	}
	if scope := newFrozenCatalogReadScope(f.db); scope.tx != nil {
		t.Fatal("autocommit scope would permit cross-transaction reuse")
	}
}

func TestFrozenCatalogConcurrentFirstPinsRemainVerified(t *testing.T) {
	t.Setenv("DB_FROZEN_CATALOGS", "1")
	f, run := frozenScopeFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	arrived, release := make(chan struct{}, 2), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	var misses atomic.Int64
	name := "catalog-race-" + uuid.NewString()
	if err := f.db.Callback().Query().After("gorm:query").Register(name, func(tx *gorm.DB) {
		if tx.Statement.Table == "frozen_combat_catalogs" && errors.Is(tx.Error, gorm.ErrRecordNotFound) && misses.Add(1) <= 2 {
			arrived <- struct{}{}
			select {
			case <-release:
			case <-ctx.Done():
			}
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.db.Callback().Query().Remove(name) })
	results := make(chan error, 2)
	for range 2 {
		go func() {
			copy := run
			results <- f.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
				scope := newFrozenCatalogReadScope(tx)
				defer scope.close()
				if err := pinFrozenCombatCatalog(tx, &copy, scope); err != nil {
					return err
				}
				copy.CombatCatalog = JSONMap{}
				return loadFrozenCombatCatalog(tx, &copy, scope)
			})
		}()
	}
	for range 2 {
		select {
		case <-arrived:
		case <-ctx.Done():
			t.Fatal("two pins did not reach the real missing-row boundary")
		}
	}
	unblock()
	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	var rows []FrozenCombatCatalog
	if err := f.db.Find(&rows).Error; err != nil || len(rows) != 1 {
		t.Fatalf("concurrent pins retained %d rows: %v", len(rows), err)
	}
	actual, err := frozenCatalogHash(rows[0])
	if err != nil || actual != rows[0].ContentHash {
		t.Fatal("concurrent winner did not retain the verified content")
	}
}
