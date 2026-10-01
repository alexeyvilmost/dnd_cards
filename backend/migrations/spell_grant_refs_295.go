package migrations

import (
	"bytes"
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

const spellGrantRefs295Version = "295_stable_spell_grant_references"

//go:embed spell_grant_refs_295_manifest.json
var spellGrantRefs295JSON []byte

type spellGrantTarget295 struct {
	ID         string  `json:"id"`
	CardNumber string  `json:"card_number"`
	NameEn     *string `json:"name_en"`
}

type spellGrantManifest295 struct {
	SchemaVersion    int                   `json:"schema_version"`
	MigrationVersion string                `json:"migration_version"`
	Entities         []spellGrantRepair295 `json:"entities"`
	Targets          []spellGrantTarget295 `json:"targets"`
}

type spellGrantRepair295 struct {
	combatSpellRepair293
	ExpectedDescription string `json:"expected_description_hash"`
}

func validateSpellGrantManifest295(manifest spellGrantManifest295) error {
	if manifest.SchemaVersion != 1 || manifest.MigrationVersion != spellGrantRefs295Version || len(manifest.Entities) != 26 || len(manifest.Targets) == 0 {
		return fmt.Errorf("invalid stable spell grant 295 manifest")
	}
	var reviewed spellGrantManifest295
	if err := json.Unmarshal(spellGrantRefs295JSON, &reviewed); err != nil {
		return err
	}
	identities := map[string][2]string{}
	for _, row := range reviewed.Entities {
		identities[row.ID] = [2]string{row.CardNumber, row.Name}
	}
	seen := map[string]bool{}
	for _, entity := range manifest.Entities {
		identity, ok := identities[entity.ID]
		if !ok || seen[entity.ID] || identity != [2]string{entity.CardNumber, entity.Name} {
			return fmt.Errorf("unreviewed/duplicate spell grant source %s", entity.CardNumber)
		}
		seen[entity.ID] = true
		if !strings.HasPrefix(entity.ExpectedDescription, "sha256:") || !catalogAudit278SHA(strings.TrimPrefix(entity.ExpectedDescription, "sha256:")) {
			return fmt.Errorf("invalid reviewed spell grant description hash %s", entity.CardNumber)
		}
		hash, err := combatSpellRepairHash293(entity.Mechanics)
		if err != nil || hash != entity.ExpectedAfter || entity.ExpectedBefore == entity.ExpectedAfter || !strings.HasPrefix(entity.ExpectedBefore, "sha256:") || !catalogAudit278SHA(strings.TrimPrefix(entity.ExpectedBefore, "sha256:")) {
			return fmt.Errorf("invalid stable spell grant mechanics/hash %s", entity.CardNumber)
		}
		var mechanics map[string]any
		if json.Unmarshal(entity.Mechanics, &mechanics) != nil || len(mechanics) == 0 {
			return fmt.Errorf("invalid spell grant mechanics %s", entity.CardNumber)
		}
	}
	targets := map[string]bool{}
	for _, target := range manifest.Targets {
		if target.ID == "" || target.CardNumber == "" || targets[target.ID] {
			return fmt.Errorf("invalid/duplicate spell grant target")
		}
		targets[target.ID] = true
		targets[target.CardNumber] = true
	}
	for _, entity := range manifest.Entities {
		var mechanics any
		if err := json.Unmarshal(entity.Mechanics, &mechanics); err != nil {
			return err
		}
		var visit func(any) error
		visit = func(value any) error {
			switch node := value.(type) {
			case []any:
				for _, child := range node {
					if err := visit(child); err != nil {
						return err
					}
				}
			case map[string]any:
				if node["kind"] == "grant_spell" {
					if reference, ok := node["value"].(string); ok && !targets[reference] {
						return fmt.Errorf("spell grant postimage has unresolved reference %s", reference)
					}
				}
				for _, child := range node {
					if err := visit(child); err != nil {
						return err
					}
				}
			}
			return nil
		}
		if err := visit(mechanics); err != nil {
			return err
		}
	}
	return nil
}

func loadSpellGrantManifest295() (spellGrantManifest295, error) {
	var manifest spellGrantManifest295
	decoder := json.NewDecoder(bytes.NewReader(spellGrantRefs295JSON))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return manifest, err
	}
	return manifest, validateSpellGrantManifest295(manifest)
}

func repairSpellGrantReferences295(db *sql.DB) error {
	manifest, err := loadSpellGrantManifest295()
	if err != nil {
		return err
	}
	return applySpellGrantManifest295(db, manifest)
}

func applySpellGrantManifest295(db *sql.DB, manifest spellGrantManifest295) error {
	if err := validateSpellGrantManifest295(manifest); err != nil {
		return err
	}
	rawManifest, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	manifestHash, err := combatSpellRepairHash293(rawManifest)
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`SELECT pg_advisory_xact_lock(295,1);
		CREATE TABLE IF NOT EXISTS spell_grant_refs_295_transition (version text PRIMARY KEY,manifest_hash text NOT NULL,completed_at timestamptz NOT NULL DEFAULT NOW());
		CREATE TABLE IF NOT EXISTS spell_grant_refs_295_archive (entity_id uuid PRIMARY KEY,card_number text NOT NULL,name text NOT NULL,
			before_row jsonb NOT NULL,before_mechanics jsonb,before_support jsonb,after_mechanics jsonb NOT NULL,
			expected_before text NOT NULL,expected_after text NOT NULL,changed boolean NOT NULL,archived_at timestamptz NOT NULL DEFAULT NOW());
		LOCK TABLE effects,spells IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return err
	}
	var priorHash string
	err = tx.QueryRow(`SELECT manifest_hash FROM spell_grant_refs_295_transition WHERE version=$1`, spellGrantRefs295Version).Scan(&priorHash)
	completed := err == nil
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if completed && priorHash != manifestHash {
		return fmt.Errorf("completed spell grant 295 manifest changed")
	}
	// Stable UUID/card identities are checked while alias inserts are excluded.
	// A cast variant can never replace the reviewed independently granted parent.
	for _, target := range manifest.Targets {
		rows, err := tx.Query(`SELECT id::text,card_number,name_en,mechanics->>'variant_of_spell_id',deleted_at IS NOT NULL
			FROM spells WHERE id=$1::uuid OR card_number=$2 FOR UPDATE`, target.ID, target.CardNumber)
		if err != nil {
			return err
		}
		matches := 0
		for rows.Next() {
			var id, card string
			var nameEn, variant sql.NullString
			var deleted bool
			if err = rows.Scan(&id, &card, &nameEn, &variant, &deleted); err != nil {
				rows.Close()
				return err
			}
			matches++
			if id != target.ID || card != target.CardNumber || deleted || variant.Valid || (target.NameEn == nil) != (!nameEn.Valid) || (target.NameEn != nil && *target.NameEn != nameEn.String) {
				rows.Close()
				return fmt.Errorf("spell grant target identity drift %s", target.CardNumber)
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		if matches != 1 {
			return fmt.Errorf("missing/ambiguous spell grant target %s", target.CardNumber)
		}
	}
	type planned struct {
		entity spellGrantRepair295
		raw    []byte
		row    map[string]json.RawMessage
		change bool
	}
	entities := append([]spellGrantRepair295(nil), manifest.Entities...)
	sort.Slice(entities, func(i, j int) bool { return entities[i].ID < entities[j].ID })
	plan := make([]planned, 0, len(entities))
	for _, entity := range entities {
		rows, err := tx.Query(`SELECT to_jsonb(e) FROM effects e WHERE id=$1::uuid OR card_number=$2 FOR UPDATE`, entity.ID, entity.CardNumber)
		if err != nil {
			return err
		}
		var matches [][]byte
		for rows.Next() {
			var raw []byte
			if err = rows.Scan(&raw); err != nil {
				rows.Close()
				return err
			}
			matches = append(matches, raw)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		if len(matches) != 1 {
			return fmt.Errorf("missing/ambiguous spell grant source %s", entity.CardNumber)
		}
		var row map[string]json.RawMessage
		if err = json.Unmarshal(matches[0], &row); err != nil {
			return err
		}
		for key, expected := range map[string]string{"id": entity.ID, "card_number": entity.CardNumber, "name": entity.Name} {
			var actual string
			if json.Unmarshal(row[key], &actual) != nil || actual != expected {
				return fmt.Errorf("spell grant source identity drift %s.%s", entity.CardNumber, key)
			}
		}
		if string(row["deleted_at"]) != "null" {
			return fmt.Errorf("deleted spell grant source %s", entity.CardNumber)
		}
		descriptionHash, err := combatSpellRepairHash293(row["description"])
		if err != nil || descriptionHash != entity.ExpectedDescription {
			return fmt.Errorf("spell grant source description drift %s", entity.CardNumber)
		}
		hash, err := combatSpellRepairHash293(row["mechanics"])
		if err != nil {
			return err
		}
		if hash != entity.ExpectedAfter && (completed || hash != entity.ExpectedBefore) {
			return fmt.Errorf("spell grant mechanics drift %s", entity.CardNumber)
		}
		plan = append(plan, planned{entity, matches[0], row, hash != entity.ExpectedAfter})
	}
	if completed {
		return tx.Commit()
	}
	for _, entry := range plan {
		entity := entry.entity
		if entry.change {
			var mechanics, support []byte
			if err = tx.QueryRow(`UPDATE effects SET mechanics=$1::jsonb,support='{"status":"not_verified"}'::jsonb,updated_at=NOW()
				WHERE id=$2::uuid RETURNING mechanics,support`, string(entity.Mechanics), entity.ID).Scan(&mechanics, &support); err != nil {
				return err
			}
			hash, hashErr := combatSpellRepairHash293(mechanics)
			var status struct {
				Status string `json:"status"`
			}
			if hashErr != nil || hash != entity.ExpectedAfter || json.Unmarshal(support, &status) != nil || status.Status != "not_verified" {
				return fmt.Errorf("spell grant persisted postimage/review drift %s", entity.CardNumber)
			}
		}
		if _, err = tx.Exec(`INSERT INTO spell_grant_refs_295_archive(entity_id,card_number,name,before_row,before_mechanics,before_support,after_mechanics,expected_before,expected_after,changed)
			VALUES($1::uuid,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10)`, entity.ID, entity.CardNumber, entity.Name, string(entry.raw), string(entry.row["mechanics"]), string(entry.row["support"]), string(entity.Mechanics), entity.ExpectedBefore, entity.ExpectedAfter, entry.change); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(`INSERT INTO spell_grant_refs_295_transition(version,manifest_hash) VALUES($1,$2)`, spellGrantRefs295Version, manifestHash); err != nil {
		return err
	}
	return tx.Commit()
}
