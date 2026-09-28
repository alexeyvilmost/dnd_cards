package migrations

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
)

const catalogMechanics278Version = "278_catalog_mechanics_audit"

//go:embed data/catalog-audit-20260929/*.json
var catalogMechanics278Files embed.FS

type catalogAudit278Review struct {
	Status      string   `json:"status"`
	Summary     string   `json:"summary"`
	Implemented []string `json:"implemented"`
	Tested      []string `json:"tested"`
	Limitations []string `json:"limitations"`
	Evidence    []string `json:"evidence"`
}

type catalogAudit278Entity struct {
	EntityType        string                     `json:"entity_type"`
	ID                string                     `json:"id"`
	CardNumber        string                     `json:"card_number"`
	Name              string                     `json:"name"`
	DescriptionSHA256 string                     `json:"description_sha256"`
	Preimage          map[string]json.RawMessage `json:"preimage"`
	Patch             map[string]json.RawMessage `json:"patch,omitempty"`
	Review            *catalogAudit278Review     `json:"review,omitempty"`
}

type catalogAudit278Manifest struct {
	SchemaVersion        int                     `json:"schema_version"`
	AuditID              string                  `json:"audit_id"`
	SourceSnapshotSHA256 string                  `json:"source_snapshot_sha256"`
	Entities             []catalogAudit278Entity `json:"entities"`
	Guards               []catalogAudit278Entity `json:"guards,omitempty"`
}

var catalogAudit278Tables = map[string]string{
	"card": "cards", "feat": "feats", "spell": "spells", "action": "actions", "effect": "effects", "resource": "resources",
}

// These are database columns, not API aliases. TEXT containing JSON must stay
// a JSON string in the manifest; jsonb_populate_record keeps the column type.
var catalogAudit278Columns = map[string]string{
	"card":     "slot price range weight effects mastery contents attunement bonus_type properties bonus_value damage_type is_template weapon_type defense_type enchant_bonus battle_profile container_mode price_currency price_abbreviated requires_attunement elemental_damage_type elemental_damage_value",
	"feat":     "category prerequisite ability_increase repeatable",
	"spell":    "area level range damage ritual school classes duration heal_dice resources is_healing subclasses casting_time save_outcome concentration material_text component_verbal component_somatic component_material upcast_description",
	"effect":   "price script weight properties repeatable effect_type condition_description",
	"action":   "price script weight properties distance recharge resource action_type recharge_custom",
	"resource": "category recharge sort_order",
}

func catalogAudit278ColumnAllowed(kind, column string, insert bool) bool {
	common := "name name_en description detailed_description mechanics related_actions related_effects related_cards type rarity is_extended"
	if catalogAudit278Listed(common+" "+catalogAudit278Columns[kind], column) {
		return true
	}
	return insert && catalogAudit278Listed("id card_number resource_id author source image_url deleted_at", column)
}

func catalogAudit278Listed(values, value string) bool {
	for _, allowed := range strings.Fields(values) {
		if allowed == value {
			return true
		}
	}
	return false
}

func catalogAudit278SHA(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size && value == strings.ToLower(value)
}

func catalogAudit278Description(row map[string]json.RawMessage) (string, error) {
	values := [2]*string{}
	for index, column := range []string{"description", "detailed_description"} {
		if raw, ok := row[column]; ok {
			if err := json.Unmarshal(raw, &values[index]); err != nil {
				return "", fmt.Errorf("%s must be a string or null: %w", column, err)
			}
		}
	}
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(values); err != nil {
		return "", err
	}
	// Match JSON.stringify([description ?? null, detailed_description ?? null]).
	text := strings.TrimSuffix(encoded.String(), "\n")
	var javascript strings.Builder
	for index := 0; index < len(text); index++ {
		if text[index] == '\\' && index+1 < len(text) {
			if strings.HasPrefix(text[index:], `\u2028`) || strings.HasPrefix(text[index:], `\u2029`) {
				if text[index+5] == '8' {
					javascript.WriteRune('\u2028')
				} else {
					javascript.WriteRune('\u2029')
				}
				index += 5
				continue
			}
			javascript.WriteByte(text[index])
			index++
			javascript.WriteByte(text[index])
			continue
		}
		javascript.WriteByte(text[index])
	}
	digest := sha256.Sum256([]byte(javascript.String()))
	return hex.EncodeToString(digest[:]), nil
}

func validateCatalogAudit278(manifests []catalogAudit278Manifest) error {
	identities, references, audits := map[string]bool{}, map[string]bool{}, map[string]bool{}
	snapshot := ""
	for _, manifest := range manifests {
		if manifest.SchemaVersion != 1 || strings.TrimSpace(manifest.AuditID) == "" || !catalogAudit278SHA(manifest.SourceSnapshotSHA256) || audits[manifest.AuditID] {
			return fmt.Errorf("invalid/duplicate catalog audit manifest %q", manifest.AuditID)
		}
		audits[manifest.AuditID] = true
		if snapshot != "" && snapshot != manifest.SourceSnapshotSHA256 {
			return fmt.Errorf("catalog audit snapshots differ")
		}
		snapshot = manifest.SourceSnapshotSHA256
		for _, group := range []struct {
			entities []catalogAudit278Entity
			guard    bool
		}{{manifest.Entities, false}, {manifest.Guards, true}} {
			for _, entity := range group.entities {
				id, err := uuid.Parse(entity.ID)
				if err != nil || id == uuid.Nil || id.String() != entity.ID || catalogAudit278Tables[entity.EntityType] == "" || strings.TrimSpace(entity.CardNumber) == "" || strings.TrimSpace(entity.Name) == "" || !catalogAudit278SHA(entity.DescriptionSHA256) {
					return fmt.Errorf("invalid catalog audit identity %s:%s", entity.EntityType, entity.ID)
				}
				if group.guard {
					if entity.Preimage == nil || len(entity.Preimage) == 0 || entity.Patch != nil || entity.Review != nil {
						return fmt.Errorf("dependency guard %s must only assert a preimage", entity.CardNumber)
					}
				} else {
					key, ref := entity.EntityType+":"+entity.ID, entity.EntityType+":"+entity.CardNumber
					if identities[key] || references[ref] {
						return fmt.Errorf("duplicate catalog audit entity %s", key)
					}
					identities[key], references[ref] = true, true
					if entity.Review == nil || strings.TrimSpace(entity.Review.Summary) == "" || !catalogAudit278Listed("verified_partial not_verified not_tested narrative partial_narrative_not_verified partial_narrative_verified_partial", entity.Review.Status) {
						return fmt.Errorf("invalid or automatically promoted review for %s", entity.CardNumber)
					}
					if entity.Patch == nil {
						return fmt.Errorf("missing patch for %s", entity.CardNumber)
					}
					if entity.Preimage != nil && len(entity.Preimage) == 0 {
						return fmt.Errorf("empty preimage for %s", entity.CardNumber)
					}
				}
				for column := range entity.Preimage {
					if column != "deleted_at" && !catalogAudit278ColumnAllowed(entity.EntityType, column, false) {
						return fmt.Errorf("forbidden preimage column %s.%s", entity.CardNumber, column)
					}
				}
				for column := range entity.Patch {
					if !catalogAudit278ColumnAllowed(entity.EntityType, column, entity.Preimage == nil) {
						return fmt.Errorf("forbidden patch column %s.%s", entity.CardNumber, column)
					}
					if column == "deleted_at" && string(bytes.TrimSpace(entity.Patch[column])) != "null" {
						return fmt.Errorf("catalog inserts must remain active: %s", entity.CardNumber)
					}
					if entity.Preimage != nil {
						if _, exists := entity.Preimage[column]; !exists {
							return fmt.Errorf("unguarded patch column %s.%s", entity.CardNumber, column)
						}
					}
				}
			}
		}
	}
	if len(identities) == 0 {
		return fmt.Errorf("catalog audit contains no changes")
	}
	return nil
}

func applyCatalogMechanics278(db *sql.DB) error {
	manifests := make([]catalogAudit278Manifest, 0, 3)
	files, err := catalogMechanics278Files.ReadDir("data/catalog-audit-20260929")
	if err != nil {
		return err
	}
	for _, file := range files {
		if file.IsDir() || !strings.HasSuffix(file.Name(), ".json") {
			continue
		}
		name := file.Name()
		raw, err := catalogMechanics278Files.ReadFile("data/catalog-audit-20260929/" + name)
		if err != nil {
			return err
		}
		var manifest catalogAudit278Manifest
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&manifest); err != nil {
			return fmt.Errorf("%s manifest: %w", name, err)
		}
		manifests = append(manifests, manifest)
	}
	return applyCatalogAudit278(db, manifests)
}

func applyCatalogAudit278(db *sql.DB, manifests []catalogAudit278Manifest) error {
	if err := validateCatalogAudit278(manifests); err != nil {
		return err
	}
	encoded, err := json.Marshal(manifests)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(encoded)
	manifestHash := hex.EncodeToString(digest[:])
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`SELECT pg_advisory_xact_lock(278,1);
	CREATE TABLE IF NOT EXISTS catalog_mechanics_278_transition (
		version text PRIMARY KEY, manifest_sha256 text NOT NULL, completed_at timestamptz NOT NULL DEFAULT NOW());
	CREATE TABLE IF NOT EXISTS catalog_mechanics_278_archive (
		entity_type text NOT NULL, entity_id uuid NOT NULL, audit_id text NOT NULL,
		before_fields jsonb, before_support jsonb, patch jsonb NOT NULL, review jsonb NOT NULL,
		inserted boolean NOT NULL, archived_at timestamptz NOT NULL DEFAULT NOW(), PRIMARY KEY(entity_type,entity_id));`); err != nil {
		return err
	}
	var priorHash string
	err = tx.QueryRow(`SELECT manifest_sha256 FROM catalog_mechanics_278_transition WHERE version=$1`, catalogMechanics278Version).Scan(&priorHash)
	if err == nil {
		if priorHash != manifestHash {
			return fmt.Errorf("completed catalog audit manifest changed")
		}
		return tx.Commit() // A retry never overwrites subsequent human edits/reviews.
	}
	if err != sql.ErrNoRows {
		return err
	}
	type planned struct {
		entity catalogAudit278Entity
		audit  string
		guard  bool
		row    map[string]json.RawMessage
	}
	plan := []planned{}
	tables := map[string]bool{}
	for _, manifest := range manifests {
		for _, entity := range manifest.Entities {
			plan = append(plan, planned{entity: entity, audit: manifest.AuditID})
			tables[catalogAudit278Tables[entity.EntityType]] = true
		}
		for _, entity := range manifest.Guards {
			plan = append(plan, planned{entity: entity, audit: manifest.AuditID, guard: true})
			tables[catalogAudit278Tables[entity.EntityType]] = true
		}
	}
	tableNames := make([]string, 0, len(tables))
	for table := range tables {
		tableNames = append(tableNames, table)
	}
	sort.Strings(tableNames)
	// Row locks guard existing records; table locks also guard missing IDs and
	// card numbers for inserts, including tables without a unique reference index.
	databaseColumns := map[string]map[string]string{}
	for _, table := range tableNames {
		if _, err = tx.Exec("LOCK TABLE " + table + " IN SHARE ROW EXCLUSIVE MODE"); err != nil {
			return err
		}
		columns, queryErr := tx.Query(`SELECT a.attname,t.typcategory::text FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped`, table)
		if queryErr != nil {
			return queryErr
		}
		databaseColumns[table] = map[string]string{}
		for columns.Next() {
			var name, category string
			if err = columns.Scan(&name, &category); err != nil {
				columns.Close()
				return err
			}
			databaseColumns[table][name] = category
		}
		err = columns.Err()
		columns.Close()
		if err != nil {
			return err
		}
	}
	sort.SliceStable(plan, func(i, j int) bool {
		return plan[i].entity.EntityType+plan[i].entity.ID < plan[j].entity.EntityType+plan[j].entity.ID
	})
	// Complete all assertions before applying any catalog write.
	for index := range plan {
		entry := &plan[index]
		entity, table := entry.entity, catalogAudit278Tables[entry.entity.EntityType]
		for column, value := range entity.Patch {
			category, exists := databaseColumns[table][column]
			if !exists {
				return fmt.Errorf("missing database patch column %s.%s", entity.CardNumber, column)
			}
			trimmed := bytes.TrimSpace(value)
			if !json.Valid(trimmed) {
				return fmt.Errorf("invalid JSON patch %s.%s", entity.CardNumber, column)
			}
			if (category == "S" || category == "E") && string(trimmed) != "null" && trimmed[0] != '"' {
				return fmt.Errorf("TEXT/enum patch must remain a JSON string: %s.%s", entity.CardNumber, column)
			}
		}
		refColumn := "card_number"
		if entity.EntityType == "resource" {
			refColumn = "resource_id"
		}
		rows, queryErr := tx.Query("SELECT to_jsonb(e) FROM "+table+" e WHERE id=$1::uuid OR "+refColumn+"=$2 FOR UPDATE", entity.ID, entity.CardNumber)
		if queryErr != nil {
			return queryErr
		}
		matches := []map[string]json.RawMessage{}
		for rows.Next() {
			var raw []byte
			if err = rows.Scan(&raw); err != nil {
				rows.Close()
				return err
			}
			var row map[string]json.RawMessage
			if err = json.Unmarshal(raw, &row); err != nil {
				rows.Close()
				return err
			}
			matches = append(matches, row)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		if entity.Preimage == nil {
			if len(matches) != 0 {
				return fmt.Errorf("insert identity already exists: %s", entity.CardNumber)
			}
			entry.row = nil
			for column, expected := range map[string]string{"id": entity.ID, refColumn: entity.CardNumber, "name": entity.Name} {
				if raw, exists := entity.Patch[column]; exists {
					var value string
					if json.Unmarshal(raw, &value) != nil || value != expected {
						return fmt.Errorf("insert identity differs: %s.%s", entity.CardNumber, column)
					}
				}
			}
			if _, exists := entity.Patch["description"]; !exists {
				return fmt.Errorf("insert description missing: %s", entity.CardNumber)
			}
			if actual, hashErr := catalogAudit278Description(entity.Patch); hashErr != nil || actual != entity.DescriptionSHA256 {
				return fmt.Errorf("insert description hash differs: %s", entity.CardNumber)
			}
			continue
		}
		if len(matches) != 1 {
			return fmt.Errorf("missing/ambiguous identity: %s", entity.CardNumber)
		}
		entry.row = matches[0]
		var id, reference string
		_ = json.Unmarshal(entry.row["id"], &id)
		_ = json.Unmarshal(entry.row[refColumn], &reference)
		if id != entity.ID || reference != entity.CardNumber || string(entry.row["deleted_at"]) != "null" {
			return fmt.Errorf("changed or deleted identity: %s", entity.CardNumber)
		}
		if actual, hashErr := catalogAudit278Description(entry.row); hashErr != nil || actual != entity.DescriptionSHA256 {
			return fmt.Errorf("description drifted: %s", entity.CardNumber)
		}
		for column := range entity.Preimage {
			if _, exists := entry.row[column]; !exists {
				return fmt.Errorf("missing database column %s.%s", entity.CardNumber, column)
			}
		}
		// One round trip per entity, retaining PostgreSQL's exact JSONB value
		// semantics (including array order and TEXT-vs-JSON distinctions).
		actualJSON, marshalErr := json.Marshal(entry.row)
		if marshalErr != nil {
			return marshalErr
		}
		expectedJSON, marshalErr := json.Marshal(entity.Preimage)
		if marshalErr != nil {
			return marshalErr
		}
		var driftedColumn string
		if err = tx.QueryRow(`SELECT COALESCE((
			SELECT key FROM jsonb_each($2::jsonb)
			WHERE ($1::jsonb -> key) IS DISTINCT FROM value
			ORDER BY key LIMIT 1
		), '')`, string(actualJSON), string(expectedJSON)).Scan(&driftedColumn); err != nil {
			return err
		}
		if driftedColumn != "" {
			return fmt.Errorf("preimage drifted: %s.%s", entity.CardNumber, driftedColumn)
		}
	}
	for _, entry := range plan {
		if entry.guard {
			continue
		}
		entity, table := entry.entity, catalogAudit278Tables[entry.entity.EntityType]
		patch := map[string]json.RawMessage{}
		before := map[string]json.RawMessage{}
		for column, value := range entity.Patch {
			patch[column] = value
			if entry.row != nil {
				before[column] = entry.row[column]
			}
		}
		if entity.Preimage == nil {
			refColumn := "card_number"
			if entity.EntityType == "resource" {
				refColumn = "resource_id"
			}
			for column, value := range map[string]string{"id": entity.ID, refColumn: entity.CardNumber, "name": entity.Name} {
				patch[column], _ = json.Marshal(value)
			}
		}
		patchJSON, _ := json.Marshal(patch)
		columns := make([]string, 0, len(patch))
		for column := range patch {
			columns = append(columns, column)
		}
		sort.Strings(columns)
		if len(columns) > 0 {
			fields := strings.Join(columns, ",")
			query := "UPDATE " + table + " SET (" + fields + ")=(SELECT " + fields + " FROM jsonb_populate_record(NULL::" + table + ",$1::jsonb)) WHERE id=$2::uuid"
			args := []any{string(patchJSON), entity.ID}
			if entity.Preimage == nil {
				query = "INSERT INTO " + table + " (" + fields + ") SELECT " + fields + " FROM jsonb_populate_record(NULL::" + table + ",$1::jsonb)"
				args = args[:1]
			}
			if _, err = tx.Exec(query, args...); err != nil {
				return fmt.Errorf("apply %s: %w", entity.CardNumber, err)
			}
		}
		// Mechanics invalidation runs first. Preserve unknown support metadata but
		// remove obsolete certification evidence; retain its exact value in archive.
		support := map[string]json.RawMessage{}
		if entry.row != nil && string(entry.row["support"]) != "null" {
			if err = json.Unmarshal(entry.row["support"], &support); err != nil {
				return err
			}
		}
		for _, key := range strings.Fields("status reviewed_at reviewed_by note limitations content_hash dependency_hash certification_version certified_at evidence_id evidence_hash evidence_completed_at gate_source_hash source_content_hash rules_hash release_content_hash release_hash patch_hash catalog_hash test_coverage mechanics_locked") {
			delete(support, key)
		}
		for key, value := range map[string]any{"status": entity.Review.Status, "note": entity.Review.Summary, "limitations": entity.Review.Limitations, "audit_id": entry.audit, "reviewed_by": "catalog-audit:" + entry.audit, "review": entity.Review} {
			support[key], _ = json.Marshal(value)
		}
		supportJSON, _ := json.Marshal(support)
		if _, err = tx.Exec("UPDATE "+table+" SET support=$1::jsonb || jsonb_build_object('reviewed_at',CURRENT_TIMESTAMP) WHERE id=$2::uuid", string(supportJSON), entity.ID); err != nil {
			return err
		}
		beforeJSON, _ := json.Marshal(before)
		if entry.row == nil {
			beforeJSON = []byte("null")
		}
		beforeSupport := json.RawMessage("null")
		if entry.row != nil {
			beforeSupport = entry.row["support"]
		}
		reviewJSON, _ := json.Marshal(entity.Review)
		if _, err = tx.Exec(`INSERT INTO catalog_mechanics_278_archive(entity_type,entity_id,audit_id,before_fields,before_support,patch,review,inserted) VALUES($1,$2::uuid,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8)`, entity.EntityType, entity.ID, entry.audit, string(beforeJSON), string(beforeSupport), string(patchJSON), string(reviewJSON), entity.Preimage == nil); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(`INSERT INTO catalog_mechanics_278_transition(version,manifest_sha256) VALUES($1,$2)`, catalogMechanics278Version, manifestHash); err != nil {
		return err
	}
	return tx.Commit()
}
