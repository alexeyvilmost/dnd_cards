package migrations

import (
	"bytes"
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

const genericSpellFreeuses297Version = "297_retain_generic_spell_free_uses"

// The forward transition is only needed for local snapshots on which the
// unshipped 294/295/296 resource annotations were already applied. Fresh
// installations of their corrected versions already match these postimages.
// Historical migration archives, commands and actor resources stay immutable.
//
//go:embed generic_spell_freeuses_297_manifest.json
var genericSpellFreeuses297JSON []byte

type genericFreeuseEntity297 struct {
	Table          string          `json:"table"`
	ID             string          `json:"id"`
	CardNumber     string          `json:"card_number"`
	Name           string          `json:"name"`
	ExpectedBefore string          `json:"expected_before"`
	ExpectedAfter  string          `json:"expected_after"`
	Mechanics      json.RawMessage `json:"mechanics"`
}
type genericFreeuseResource297 struct {
	ResourceID   string `json:"resource_id"`
	ExpectedHash string `json:"expected_hash"`
}
type genericFreeuseManifest297 struct {
	SchemaVersion    int                         `json:"schema_version"`
	MigrationVersion string                      `json:"migration_version"`
	Entities         []genericFreeuseEntity297   `json:"entities"`
	Resources        []genericFreeuseResource297 `json:"resources"`
}

func genericFreeuseResourceHash297(raw []byte) (string, error) {
	var row map[string]json.RawMessage
	if err := json.Unmarshal(raw, &row); err != nil {
		return "", err
	}
	delete(row, "updated_at")
	delete(row, "deleted_at")
	projection, err := json.Marshal(row)
	if err != nil {
		return "", err
	}
	return spellGrantAbilityHash296(projection)
}

// The catalog's existing UPDATE trigger invalidates manual review when a row
// is soft-deleted. Verify that exact after-state before comparing all authored
// metadata to the retained preimage; no review/history fields are rewritten.
func genericFreeuseClosedResourceHash297(current, before []byte) (string, error) {
	var row, archived map[string]json.RawMessage
	if err := json.Unmarshal(current, &row); err != nil {
		return "", err
	}
	if err := json.Unmarshal(before, &archived); err != nil {
		return "", err
	}
	currentSupport, err := spellGrantAbilityHash296(row["support"])
	if len(row["support"]) == 0 {
		currentSupport, err = "", nil
	}
	if err != nil {
		return "", err
	}
	beforeSupport, err := spellGrantAbilityHash296(archived["support"])
	if len(archived["support"]) == 0 {
		beforeSupport, err = "", nil
	}
	if err != nil {
		return "", err
	}
	if currentSupport != beforeSupport {
		expectedHash, err := spellGrantAbilityHash296([]byte(`{"status":"not_verified"}`))
		if err != nil || expectedHash != currentSupport {
			return "", fmt.Errorf("closed resource support drift")
		}
		row["support"] = archived["support"]
	}
	projection, err := json.Marshal(row)
	if err != nil {
		return "", err
	}
	return genericFreeuseResourceHash297(projection)
}

func loadGenericFreeuseManifest297() (genericFreeuseManifest297, error) {
	var manifest genericFreeuseManifest297
	decoder := json.NewDecoder(bytes.NewReader(genericSpellFreeuses297JSON))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return manifest, err
	}
	return manifest, validateGenericFreeuseManifest297(manifest)
}
func validateGenericFreeuseManifest297(manifest genericFreeuseManifest297) error {
	if manifest.SchemaVersion != 1 || manifest.MigrationVersion != genericSpellFreeuses297Version || len(manifest.Entities) == 0 || len(manifest.Resources) == 0 {
		return fmt.Errorf("invalid generic spell free-use 297 manifest")
	}
	var reviewed genericFreeuseManifest297
	if err := json.Unmarshal(genericSpellFreeuses297JSON, &reviewed); err != nil {
		return err
	}
	if len(manifest.Entities) != len(reviewed.Entities) || len(manifest.Resources) != len(reviewed.Resources) {
		return fmt.Errorf("incomplete generic spell free-use 297 manifest")
	}
	identities := map[string]genericFreeuseEntity297{}
	for _, row := range reviewed.Entities {
		identities[row.Table+":"+row.ID] = row
	}
	seen := map[string]bool{}
	for _, entity := range manifest.Entities {
		key := entity.Table + ":" + entity.ID
		reference, ok := identities[key]
		validTable := false
		for _, table := range resourceTables294 {
			validTable = validTable || entity.Table == table
		}
		if !validTable || !ok || seen[key] || reference.CardNumber != entity.CardNumber || reference.Name != entity.Name {
			return fmt.Errorf("unreviewed/duplicate generic free-use source %s", key)
		}
		seen[key] = true
		hash, err := spellGrantAbilityHash296(entity.Mechanics)
		if err != nil || hash != entity.ExpectedAfter || entity.ExpectedBefore == entity.ExpectedAfter || !strings.HasPrefix(entity.ExpectedBefore, "sha256:") || !catalogAudit278SHA(strings.TrimPrefix(entity.ExpectedBefore, "sha256:")) {
			return fmt.Errorf("invalid generic free-use source hash %s", key)
		}
	}
	resourceIDs := map[string]bool{}
	for _, row := range reviewed.Resources {
		resourceIDs[row.ResourceID] = true
	}
	seen = map[string]bool{}
	for _, row := range manifest.Resources {
		if !resourceIDs[row.ResourceID] || seen[row.ResourceID] || !strings.HasPrefix(row.ResourceID, "freeuse-") || row.ResourceID == "freeuse-spells" || !strings.HasPrefix(row.ExpectedHash, "sha256:") || !catalogAudit278SHA(strings.TrimPrefix(row.ExpectedHash, "sha256:")) {
			return fmt.Errorf("unreviewed/duplicate generic free-use resource %s", row.ResourceID)
		}
		seen[row.ResourceID] = true
	}
	return nil
}

func retainGenericSpellFreeuses297(db *sql.DB) error {
	manifest, err := loadGenericFreeuseManifest297()
	if err != nil {
		return err
	}
	return applyGenericFreeuseManifest297(db, manifest)
}

func applyGenericFreeuseManifest297(db *sql.DB, manifest genericFreeuseManifest297) error {
	if err := validateGenericFreeuseManifest297(manifest); err != nil {
		return err
	}
	rawManifest, _ := json.Marshal(manifest)
	manifestHash, err := spellGrantAbilityHash296(rawManifest)
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`SELECT pg_advisory_xact_lock(297,1);
		CREATE TABLE IF NOT EXISTS generic_spell_freeuses_297_transition(version text PRIMARY KEY,manifest_hash text NOT NULL,completed_at timestamptz NOT NULL DEFAULT NOW());
		CREATE TABLE IF NOT EXISTS generic_spell_freeuses_297_archive(entity_table text NOT NULL,entity_id uuid NOT NULL,before_row jsonb NOT NULL,after_mechanics jsonb NOT NULL,archived_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY(entity_table,entity_id));
		CREATE TABLE IF NOT EXISTS generic_spell_freeuses_297_resource_archive(resource_id text PRIMARY KEY,before_row jsonb NOT NULL,archived_at timestamptz NOT NULL DEFAULT NOW());
		LOCK TABLE resources IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return err
	}
	var priorHash string
	err = tx.QueryRow(`SELECT manifest_hash FROM generic_spell_freeuses_297_transition WHERE version=$1`, genericSpellFreeuses297Version).Scan(&priorHash)
	completed := err == nil
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if completed && priorHash != manifestHash {
		return fmt.Errorf("completed generic free-use 297 manifest changed")
	}
	var cleanupResources bool
	if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM generic_spell_freeuses_297_archive)`).Scan(&cleanupResources); err != nil {
		return err
	}
	locked := map[string]bool{}
	for _, entity := range manifest.Entities {
		if !locked[entity.Table] {
			if _, err = tx.Exec("LOCK TABLE " + entity.Table + " IN SHARE ROW EXCLUSIVE MODE"); err != nil {
				return err
			}
			locked[entity.Table] = true
		}
		var rowRaw, current []byte
		var card, name string
		err = tx.QueryRow("SELECT to_jsonb(e),mechanics,card_number,name FROM "+entity.Table+" e WHERE id=$1::uuid AND deleted_at IS NULL FOR UPDATE", entity.ID).Scan(&rowRaw, &current, &card, &name)
		if err != nil || card != entity.CardNumber || name != entity.Name {
			return fmt.Errorf("generic free-use source identity drift %s/%s: %v", entity.Table, entity.CardNumber, err)
		}
		hash, err := spellGrantAbilityHash296(current)
		if err != nil {
			return err
		}
		if hash == entity.ExpectedAfter {
			continue
		}
		if completed || hash != entity.ExpectedBefore {
			return fmt.Errorf("generic free-use source mechanics drift %s/%s", entity.Table, entity.CardNumber)
		}
		cleanupResources = true
		if _, err = tx.Exec(`INSERT INTO generic_spell_freeuses_297_archive(entity_table,entity_id,before_row,after_mechanics)VALUES($1,$2::uuid,$3::jsonb,$4::jsonb)`, entity.Table, entity.ID, string(rowRaw), string(entity.Mechanics)); err != nil {
			return err
		}
		if _, err = tx.Exec("UPDATE "+entity.Table+" SET mechanics=$1::jsonb,updated_at=NOW() WHERE id=$2::uuid", string(entity.Mechanics), entity.ID); err != nil {
			return err
		}
	}
	for _, resource := range manifest.Resources {
		if !cleanupResources {
			break // Fresh chains must preserve any authored generic metadata.
		}
		var raw []byte
		var deleted bool
		err = tx.QueryRow(`SELECT to_jsonb(r),deleted_at IS NOT NULL FROM resources r WHERE resource_id=$1 FOR UPDATE`, resource.ResourceID).Scan(&raw, &deleted)
		if err == sql.ErrNoRows {
			continue // Corrected 294 never created this generic pool's metadata.
		}
		if err != nil {
			return err
		}
		var archived bool
		if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM generic_spell_freeuses_297_resource_archive WHERE resource_id=$1)`, resource.ResourceID).Scan(&archived); err != nil {
			return err
		}
		if deleted && archived {
			var before []byte
			if err := tx.QueryRow(`SELECT before_row FROM generic_spell_freeuses_297_resource_archive WHERE resource_id=$1`, resource.ResourceID).Scan(&before); err != nil {
				return err
			}
			hash, err := genericFreeuseClosedResourceHash297(raw, before)
			if err != nil || hash != resource.ExpectedHash {
				return fmt.Errorf("closed generic free-use resource metadata drift %s", resource.ResourceID)
			}
			continue
		}
		if deleted || completed {
			return fmt.Errorf("generic free-use resource lifecycle drift %s", resource.ResourceID)
		}
		hash, err := genericFreeuseResourceHash297(raw)
		if err != nil || hash != resource.ExpectedHash {
			return fmt.Errorf("generic free-use resource metadata drift %s", resource.ResourceID)
		}
		if _, err = tx.Exec(`INSERT INTO generic_spell_freeuses_297_resource_archive(resource_id,before_row)VALUES($1,$2::jsonb)`, resource.ResourceID, string(raw)); err != nil {
			return err
		}
		if _, err = tx.Exec(`UPDATE resources SET deleted_at=NOW(),updated_at=NOW() WHERE resource_id=$1`, resource.ResourceID); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(`INSERT INTO generic_spell_freeuses_297_transition(version,manifest_hash)VALUES($1,$2)ON CONFLICT DO NOTHING`, genericSpellFreeuses297Version, manifestHash); err != nil {
		return err
	}
	return tx.Commit()
}
