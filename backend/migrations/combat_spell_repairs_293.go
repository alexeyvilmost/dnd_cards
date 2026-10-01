package migrations

import (
	"bytes"
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"unicode/utf16"
)

const combatSpellRepairs293Version = "293_combat_spell_repairs"

//go:embed combat_spell_repairs_293_manifest.json
var combatSpellRepairs293JSON []byte

type combatSpellRepair293 struct {
	ID             string          `json:"id"`
	CardNumber     string          `json:"card_number"`
	Name           string          `json:"name"`
	ExpectedBefore string          `json:"expected_before"`
	ExpectedAfter  string          `json:"expected_after"`
	Mechanics      json.RawMessage `json:"mechanics"`
}

type combatSpellRepairManifest293 struct {
	SchemaVersion    int                    `json:"schema_version"`
	MigrationVersion string                 `json:"migration_version"`
	Entities         []combatSpellRepair293 `json:"entities"`
}

var combatSpellRepairIdentities293 = map[string][2]string{
	"a9a0d114-ad46-435e-a3c9-128b305b8a5d": {"SPELL-0260", "Погребальный звон"},
	"fe0a8d3c-318c-4308-9ff0-3838367f75e6": {"SPELL-0164", "Божественная кара"},
	"ae684edc-08c3-4f00-94ab-5c11c6b05f4e": {"SPELL-0186", "Громовая кара"},
	"04dc8ba1-388f-4acc-ab4b-5a6784faeeaa": {"SPELL-0254", "Палящая кара"},
}

// This package cannot import the API's main-package canonicalJSON helper.
// Keep the same JSON/JavaScript string and UTF-16 ordering contract here, and
// reuse the migration SHA helper. No content/root metadata fields are removed.
func combatSpellRepairCanonical293(raw []byte) ([]byte, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	var output bytes.Buffer
	var appendValue func(any) error
	appendString := func(text string) {
		output.WriteByte('"')
		for _, character := range text {
			switch character {
			case '"', '\\':
				output.WriteByte('\\')
				output.WriteRune(character)
			case '\b':
				output.WriteString(`\b`)
			case '\f':
				output.WriteString(`\f`)
			case '\n':
				output.WriteString(`\n`)
			case '\r':
				output.WriteString(`\r`)
			case '\t':
				output.WriteString(`\t`)
			default:
				if character < 0x20 {
					fmt.Fprintf(&output, `\u%04x`, character)
				} else {
					output.WriteRune(character)
				}
			}
		}
		output.WriteByte('"')
	}
	appendValue = func(value any) error {
		switch typed := value.(type) {
		case map[string]any:
			keys := make([]string, 0, len(typed))
			for key := range typed {
				keys = append(keys, key)
			}
			sort.Slice(keys, func(left, right int) bool {
				return strings.Compare(string(utf16SortUnits293(keys[left])), string(utf16SortUnits293(keys[right]))) < 0
			})
			output.WriteByte('{')
			for index, key := range keys {
				if index > 0 {
					output.WriteByte(',')
				}
				appendString(key)
				output.WriteByte(':')
				if err := appendValue(typed[key]); err != nil {
					return err
				}
			}
			output.WriteByte('}')
		case []any:
			output.WriteByte('[')
			for index, item := range typed {
				if index > 0 {
					output.WriteByte(',')
				}
				if err := appendValue(item); err != nil {
					return err
				}
			}
			output.WriteByte(']')
		case string:
			appendString(typed)
		default:
			if number, ok := value.(float64); ok && (math.IsInf(number, 0) || math.IsNaN(number)) {
				return fmt.Errorf("non-finite combat repair JSON number")
			}
			if number, ok := value.(float64); ok && number == 0 {
				output.WriteByte('0')
				return nil
			}
			encoded, err := json.Marshal(value)
			if err != nil {
				return err
			}
			output.Write(encoded)
		}
		return nil
	}
	if err := appendValue(value); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func utf16SortUnits293(value string) []byte {
	units := utf16.Encode([]rune(value))
	encoded := make([]byte, 0, len(units)*2)
	for _, unit := range units {
		encoded = append(encoded, byte(unit>>8), byte(unit))
	}
	return encoded
}

func combatSpellRepairHash293(raw []byte) (string, error) {
	encoded, err := combatSpellRepairCanonical293(raw)
	if err != nil {
		return "", err
	}
	return levelTwoCertificationHash(string(encoded)), nil
}

func validateCombatSpellRepairManifest293(manifest combatSpellRepairManifest293) error {
	if manifest.SchemaVersion != 1 || manifest.MigrationVersion != combatSpellRepairs293Version || len(manifest.Entities) != len(combatSpellRepairIdentities293) {
		return fmt.Errorf("invalid combat spell repair 293 manifest identity/count")
	}
	seen := map[string]bool{}
	for _, entity := range manifest.Entities {
		identity, allowed := combatSpellRepairIdentities293[entity.ID]
		if !allowed || seen[entity.ID] || identity != [2]string{entity.CardNumber, entity.Name} {
			return fmt.Errorf("unexpected/duplicate combat spell repair identity %s", entity.CardNumber)
		}
		seen[entity.ID] = true
		if !strings.HasPrefix(entity.ExpectedBefore, "sha256:") || !catalogAudit278SHA(strings.TrimPrefix(entity.ExpectedBefore, "sha256:")) || entity.ExpectedBefore == entity.ExpectedAfter {
			return fmt.Errorf("invalid combat spell repair preimage %s", entity.CardNumber)
		}
		var mechanics map[string]json.RawMessage
		if err := json.Unmarshal(entity.Mechanics, &mechanics); err != nil || len(mechanics) == 0 {
			return fmt.Errorf("invalid combat spell repair mechanics %s", entity.CardNumber)
		}
		hash, err := combatSpellRepairHash293(entity.Mechanics)
		if err != nil || hash != entity.ExpectedAfter {
			return fmt.Errorf("combat spell repair postimage hash differs %s", entity.CardNumber)
		}
	}
	return nil
}

func loadCombatSpellRepairManifest293() (combatSpellRepairManifest293, error) {
	var manifest combatSpellRepairManifest293
	decoder := json.NewDecoder(bytes.NewReader(combatSpellRepairs293JSON))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return manifest, err
	}
	return manifest, validateCombatSpellRepairManifest293(manifest)
}

func applyCombatSpellRepairs293(db *sql.DB) error {
	manifest, err := loadCombatSpellRepairManifest293()
	if err != nil {
		return err
	}
	return applyCombatSpellRepairManifest293(db, manifest)
}

func applyCombatSpellRepairManifest293(db *sql.DB, manifest combatSpellRepairManifest293) error {
	if err := validateCombatSpellRepairManifest293(manifest); err != nil {
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
	if _, err := tx.Exec(`SELECT pg_advisory_xact_lock(293,1);
		CREATE TABLE IF NOT EXISTS combat_spell_repairs_293_transition (
			version text PRIMARY KEY, manifest_hash text NOT NULL, completed_at timestamptz NOT NULL DEFAULT NOW());
		CREATE TABLE IF NOT EXISTS combat_spell_repairs_293_archive (
			entity_id uuid PRIMARY KEY, card_number text NOT NULL, name text NOT NULL,
			before_row jsonb NOT NULL, before_mechanics jsonb, before_support jsonb,
			after_mechanics jsonb NOT NULL, expected_before text NOT NULL, expected_after text NOT NULL,
			changed boolean NOT NULL, archived_at timestamptz NOT NULL DEFAULT NOW());`); err != nil {
		return err
	}
	var priorManifestHash string
	err = tx.QueryRow(`SELECT manifest_hash FROM combat_spell_repairs_293_transition WHERE version=$1`, combatSpellRepairs293Version).Scan(&priorManifestHash)
	completed := err == nil
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if completed && priorManifestHash != manifestHash {
		return fmt.Errorf("completed combat spell repair 293 manifest changed")
	}
	// The library reference column is not unique in every historical schema.
	// Prevent an alias insert while the four exact identities are being checked;
	// their individual rows are still locked below before reading preimages.
	if _, err := tx.Exec(`LOCK TABLE spells IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return err
	}
	type planned struct {
		entity combatSpellRepair293
		raw    []byte
		row    map[string]json.RawMessage
		change bool
	}
	entities := append([]combatSpellRepair293(nil), manifest.Entities...)
	sort.Slice(entities, func(left, right int) bool { return entities[left].ID < entities[right].ID })
	plan := make([]planned, 0, len(entities))
	for _, entity := range entities {
		rows, err := tx.Query(`SELECT to_jsonb(s) FROM spells s WHERE id=$1::uuid OR card_number=$2 FOR UPDATE`, entity.ID, entity.CardNumber)
		if err != nil {
			return err
		}
		var matches [][]byte
		for rows.Next() {
			var raw []byte
			if err := rows.Scan(&raw); err != nil {
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
			return fmt.Errorf("missing/ambiguous combat spell repair identity %s", entity.CardNumber)
		}
		var row map[string]json.RawMessage
		if err := json.Unmarshal(matches[0], &row); err != nil {
			return err
		}
		for column, expected := range map[string]string{"id": entity.ID, "card_number": entity.CardNumber, "name": entity.Name} {
			var actual string
			if json.Unmarshal(row[column], &actual) != nil || actual != expected {
				return fmt.Errorf("combat spell repair identity drift %s.%s", entity.CardNumber, column)
			}
		}
		if string(row["deleted_at"]) != "null" {
			return fmt.Errorf("combat spell repair deleted identity %s", entity.CardNumber)
		}
		hash, err := combatSpellRepairHash293(row["mechanics"])
		if err != nil {
			return err
		}
		if hash != entity.ExpectedAfter && (completed || hash != entity.ExpectedBefore) {
			return fmt.Errorf("combat spell repair mechanics drift %s (got %s)", entity.CardNumber, hash)
		}
		plan = append(plan, planned{entity: entity, raw: matches[0], row: row, change: hash != entity.ExpectedAfter})
	}
	if completed {
		return tx.Commit() // Revalidate postimages, preserve later manual assessments.
	}
	for _, entry := range plan {
		entity := entry.entity
		if entry.change {
			// 277's review trigger also sets this status on mechanical changes.
			// Set it explicitly so no alternate/local trigger can promote a repair.
			var actualMechanics, actualSupport []byte
			if err := tx.QueryRow(`UPDATE spells SET mechanics=$1::jsonb,support='{"status":"not_verified"}'::jsonb,updated_at=NOW()
				WHERE id=$2::uuid RETURNING mechanics,support`, string(entity.Mechanics), entity.ID).Scan(&actualMechanics, &actualSupport); err != nil {
				return err
			}
			hash, err := combatSpellRepairHash293(actualMechanics)
			var support struct {
				Status string `json:"status"`
			}
			if err != nil || hash != entity.ExpectedAfter || json.Unmarshal(actualSupport, &support) != nil || support.Status != "not_verified" {
				return fmt.Errorf("combat spell repair persisted postimage/review differs %s", entity.CardNumber)
			}
		}
		if _, err := tx.Exec(`INSERT INTO combat_spell_repairs_293_archive
			(entity_id,card_number,name,before_row,before_mechanics,before_support,after_mechanics,expected_before,expected_after,changed)
			VALUES($1::uuid,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10)`, entity.ID, entity.CardNumber, entity.Name,
			string(entry.raw), string(entry.row["mechanics"]), string(entry.row["support"]), string(entity.Mechanics), entity.ExpectedBefore, entity.ExpectedAfter, entry.change); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`INSERT INTO combat_spell_repairs_293_transition(version,manifest_hash) VALUES($1,$2)`, combatSpellRepairs293Version, manifestHash); err != nil {
		return err
	}
	return tx.Commit()
}
