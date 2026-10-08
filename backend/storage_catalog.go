package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Owner-scoped, immutable initialization input. Dynamic state.catalogActions,
// envelope, journal baselines and archived artifacts remain in their old format.
type FrozenCombatCatalog struct {
	UserID            uuid.UUID `gorm:"type:uuid;primaryKey"`
	ContentHash       string    `gorm:"type:varchar(64);primaryKey"`
	SerializerVersion int       `gorm:"not null"`
	ProtocolVersion   int       `gorm:"not null"`
	ArtifactHash      string    `gorm:"type:varchar(71);not null"`
	Payload           JSONMap   `gorm:"type:jsonb;not null"`
	CreatedAt         time.Time
}

func (FrozenCombatCatalog) TableName() string { return "frozen_combat_catalogs" }

// One immutable row, owned by one transaction callback. It never carries the
// pre-worker read into the commit transaction. Serialized storage prevents a
// hydrated run or caller from mutating the record used by the accepted reload.
type frozenCatalogReadScope struct {
	tx    *gorm.DB
	owner uuid.UUID
	hash  string
	raw   []byte
}

func newFrozenCatalogReadScope(tx *gorm.DB) *frozenCatalogReadScope {
	if _, transactional := tx.Statement.ConnPool.(gorm.TxCommitter); !transactional {
		return &frozenCatalogReadScope{}
	}
	return &frozenCatalogReadScope{tx: tx}
}

func (scope *frozenCatalogReadScope) close() {
	scope.tx, scope.raw = nil, nil
}

func (scope *frozenCatalogReadScope) read(tx *gorm.DB, owner uuid.UUID, hash string) (FrozenCombatCatalog, bool, error) {
	var row FrozenCombatCatalog
	if scope == nil || scope.tx != tx || len(scope.raw) == 0 || scope.owner != owner || scope.hash != hash {
		return row, false, nil
	}
	if err := json.Unmarshal(scope.raw, &row); err != nil {
		return row, true, fmt.Errorf("invalid transaction-local frozen catalog")
	}
	return row, true, nil
}

func (scope *frozenCatalogReadScope) remember(tx *gorm.DB, row FrozenCombatCatalog) error {
	if scope == nil || scope.tx != tx {
		return nil
	}
	raw, err := json.Marshal(row)
	if err != nil {
		return err
	}
	// Oversized input keeps the ordinary verified DB path; there is no global
	// cache, shared mutable value or accumulating set of transaction entries.
	if len(raw) > 8<<20 {
		scope.raw = nil
		return nil
	}
	scope.owner, scope.hash, scope.raw = row.UserID, row.ContentHash, raw
	return nil
}

func firstFrozenCatalogScope(scopes []*frozenCatalogReadScope) *frozenCatalogReadScope {
	if len(scopes) == 1 {
		return scopes[0]
	}
	return nil
}

func frozenCatalogHash(row FrozenCombatCatalog) (string, error) {
	if row.SerializerVersion != 1 || row.ProtocolVersion != 1 || row.UserID == uuid.Nil || !roguelikeSnapshotHash.MatchString(row.ArtifactHash) || len(row.Payload) == 0 {
		return "", fmt.Errorf("invalid frozen catalog identity")
	}
	raw, err := json.Marshal(struct {
		Serializer      string    `json:"serializer"`
		ProtocolVersion int       `json:"protocolVersion"`
		UserID          uuid.UUID `json:"userId"`
		ArtifactHash    string    `json:"artifactHash"`
		Catalog         JSONMap   `json:"catalog"`
	}{"go-json-v1", row.ProtocolVersion, row.UserID, row.ArtifactHash, row.Payload})
	if err != nil {
		return "", fmt.Errorf("invalid frozen catalog JSON")
	}
	return fmt.Sprintf("%x", sha256.Sum256(raw)), nil
}

func loadFrozenCombatCatalog(tx *gorm.DB, run *RoguelikeRun, scopes ...*frozenCatalogReadScope) error {
	if run.CombatCatalogRef == nil {
		return nil
	}
	scope := firstFrozenCatalogScope(scopes)
	row, reused, err := scope.read(tx, run.UserID, *run.CombatCatalogRef)
	if err != nil {
		return err
	}
	if !reused {
		if err := tx.Where("user_id=? AND content_hash=?", run.UserID, *run.CombatCatalogRef).First(&row).Error; err != nil {
			return fmt.Errorf("frozen combat catalog unavailable")
		}
	}
	hash, err := frozenCatalogHash(row)
	if err != nil || row.UserID != run.UserID || row.ContentHash != *run.CombatCatalogRef || hash != *run.CombatCatalogRef || len(run.CombatCatalog) != 0 || row.ArtifactHash != run.CombatEnvelope["artifactHash"] {
		return fmt.Errorf("frozen combat catalog integrity failed")
	}
	if !reused {
		if err := scope.remember(tx, row); err != nil {
			return err
		}
	}
	run.CombatCatalog = row.Payload
	return nil
}

// Called only for newly accepted initialize_combat, inside its existing atomic
// state/revision/receipt transaction. Existing battles are never backfilled.
func pinFrozenCombatCatalog(tx *gorm.DB, run *RoguelikeRun, scopes ...*frozenCatalogReadScope) error {
	if os.Getenv("DB_FROZEN_CATALOGS") != "1" {
		return nil
	}
	artifact, _ := run.CombatEnvelope["artifactHash"].(string)
	row := FrozenCombatCatalog{UserID: run.UserID, SerializerVersion: 1, ProtocolVersion: 1, ArtifactHash: artifact, Payload: run.CombatCatalog}
	hash, err := frozenCatalogHash(row)
	if err != nil {
		return err
	}
	row.ContentHash = hash
	// A matching identity must also contain matching bytes/versions. Never trust
	// an ON CONFLICT as evidence of correct immutable content. The usual warm
	// case needs no INSERT; a concurrent first pin still uses the conflict-safe
	// insert followed by a fresh verified read in this same transaction.
	var retained FrozenCombatCatalog
	err = tx.Where("user_id=? AND content_hash=?", run.UserID, hash).First(&retained).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if err = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
			return err
		}
		err = tx.Where("user_id=? AND content_hash=?", run.UserID, hash).First(&retained).Error
	}
	if err != nil {
		return err
	}
	actual, err := frozenCatalogHash(retained)
	if err != nil || retained.UserID != run.UserID || retained.ContentHash != hash || retained.ArtifactHash != artifact || actual != hash {
		return fmt.Errorf("frozen catalog collision or corruption")
	}
	if err := firstFrozenCatalogScope(scopes).remember(tx, retained); err != nil {
		return err
	}
	run.CombatCatalogRef = &hash
	return nil
}

func coldRunColumns(run *RoguelikeRun) map[string]any {
	return map[string]any{"combat_catalog": nonNilRoguelikeMap(run.CombatCatalog), "checkpoint": run.Checkpoint, "shop": run.Shop, "mode_rules": nonNilRoguelikeMap(run.ModeRules)}
}
func captureColdRunColumns(run *RoguelikeRun) error {
	// Inline catalogs also stay constant between combat commands. Avoid rewriting
	// their TOAST values without requiring the separate frozen-storage feature.
	run.storageOriginal = map[string][]byte{}
	for column, value := range coldRunColumns(run) {
		raw, err := json.Marshal(value)
		if err != nil {
			return err
		}
		run.storageOriginal[column] = raw
	}
	return nil
}
func prepareRunStorageColumns(tx *gorm.DB, run *RoguelikeRun, columns map[string]any) error {
	defer performanceSince(tx.Statement.Context, "cold_run_compare_ms")()
	for column, original := range run.storageOriginal {
		raw, err := json.Marshal(columns[column])
		if err != nil {
			return err
		}
		if bytes.Equal(raw, original) {
			delete(columns, column)
			performanceAdd(tx.Statement.Context, "cold_run_omitted_bytes", float64(len(raw)))
		}
	}
	if len(run.CombatCatalog) == 0 {
		if run.CombatCatalogRef != nil {
			run.CombatCatalogRef = nil
			columns["combat_catalog_ref"] = nil
		}
		return nil
	}
	if run.CombatCatalogRef != nil {
		artifact, _ := run.CombatEnvelope["artifactHash"].(string)
		hash, err := frozenCatalogHash(FrozenCombatCatalog{UserID: run.UserID, SerializerVersion: 1, ProtocolVersion: 1, ArtifactHash: artifact, Payload: run.CombatCatalog})
		if err != nil || hash != *run.CombatCatalogRef {
			return fmt.Errorf("attempted frozen catalog mutation")
		}
		columns["combat_catalog_ref"] = *run.CombatCatalogRef
		// New pin needs an empty inline slot. Existing reference rows never send
		// the hydrated cold payload back to PostgreSQL on each combat command.
		if _, changed := columns["combat_catalog"]; changed {
			columns["combat_catalog"] = JSONMap{}
		}
	}
	return nil
}
