package migrations

import (
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

//go:embed effect_classification_278_manifest.json
var effectClassification278ManifestJSON []byte

type effectClassification278Row struct {
	ID         string `json:"id"`
	CardNumber string `json:"card_number"`
	Name       string `json:"name"`
	Before     string `json:"before"`
	After      string `json:"after"`
	Reason     string `json:"reason"`
}

type effectClassification278Manifest struct {
	SchemaVersion  int                          `json:"schema_version"`
	InventoryCount int                          `json:"inventory_count"`
	Effects        []effectClassification278Row `json:"effects"`
}

func reviewedEffectClassification278() (effectClassification278Manifest, string, error) {
	var manifest effectClassification278Manifest
	if err := json.Unmarshal(effectClassification278ManifestJSON, &manifest); err != nil {
		return manifest, "", err
	}
	if manifest.SchemaVersion != 1 || manifest.InventoryCount != 707 || len(manifest.Effects) != manifest.InventoryCount {
		return manifest, "", fmt.Errorf("migration 278 classification inventory is incomplete")
	}
	seenIDs, seenNumbers := map[string]bool{}, map[string]bool{}
	validTypes := map[string]bool{"passive": true, "conditional": true, "triggered": true, "class_ability": true, "species_ability": true, "feat_ability": true, "item_effect": true, "spell_effect": true, "negative_effect": true, "positive_effect": true, "condition": true, "eldritch_invocation": true, "fighting_style": true, "maneuver_variant": true, "weapon_mastery": true, "run_aura": true}
	for _, row := range manifest.Effects {
		if row.ID == "" || row.CardNumber == "" || row.Name == "" || row.Reason == "" || !validTypes[row.Before] || !validTypes[row.After] || seenIDs[row.ID] || seenNumbers[row.CardNumber] {
			return manifest, "", fmt.Errorf("migration 278 invalid classification for %q", row.CardNumber)
		}
		seenIDs[row.ID], seenNumbers[row.CardNumber] = true, true
	}
	hash := sha256.Sum256(effectClassification278ManifestJSON)
	return manifest, hex.EncodeToString(hash[:]), nil
}

// Classification is a reviewed one-time editorial operation. The manifest is
// explicit; future entities are never classified by their name or UUID shape.
func classifyLibraryEffects278(db *sql.DB) error {
	manifest, manifestHash, err := reviewedEffectClassification278()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`CREATE TABLE IF NOT EXISTS effect_classification_278_runs (
		id integer PRIMARY KEY CHECK(id=1), manifest_sha256 text NOT NULL,
		reviewed_count integer NOT NULL, matched_count integer NOT NULL,
		changed_count integer NOT NULL, skipped_count integer NOT NULL,
		applied_at timestamptz NOT NULL DEFAULT now()
	);
	CREATE TABLE IF NOT EXISTS effect_classification_278_audit (
		effect_id uuid PRIMARY KEY, card_number text NOT NULL,
		previous_type text NOT NULL, classified_type text NOT NULL,
		previous_support jsonb, protected_fingerprint text NOT NULL,
		decision_reason text NOT NULL, manifest_sha256 text NOT NULL,
		applied_at timestamptz NOT NULL DEFAULT now()
	)`); err != nil {
		return err
	}
	// Serialize concurrent invocations before inspecting the one-time receipt.
	if _, err = tx.Exec(`LOCK TABLE effects, effect_classification_278_runs IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return err
	}
	var previousHash string
	err = tx.QueryRow(`SELECT manifest_sha256 FROM effect_classification_278_runs WHERE id=1`).Scan(&previousHash)
	if err == nil {
		if previousHash != manifestHash {
			return fmt.Errorf("migration 278 already applied with another reviewed manifest")
		}
		return tx.Commit()
	}
	if err != sql.ErrNoRows {
		return err
	}
	resumeReview, err := suspendEffectClassificationReviewTrigger(tx)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(fmt.Sprintf(`ALTER TABLE effects DROP CONSTRAINT IF EXISTS effects_effect_type_check;
		ALTER TABLE effects ADD CONSTRAINT effects_effect_type_check CHECK (effect_type IN (%s,
		'eldritch_invocation','fighting_style','maneuver_variant','weapon_mastery','run_aura'))`, effectTypeCheckValues)); err != nil {
		return fmt.Errorf("migration 278 expand effect categories: %w", err)
	}
	matched, changed, skipped := 0, 0, 0
	for _, declaration := range manifest.Effects {
		rows, queryErr := tx.Query(`SELECT id::text,card_number,effect_type,support::text,
			md5((to_jsonb(e)-ARRAY['effect_type','updated_at']::text[])::text),deleted_at IS NOT NULL
			FROM effects e WHERE id::text=$1 OR card_number=$2 ORDER BY id`, declaration.ID, declaration.CardNumber)
		if queryErr != nil {
			return queryErr
		}
		var id, number, currentType, fingerprint string
		var support sql.NullString
		var deleted bool
		count := 0
		for rows.Next() {
			count++
			if err = rows.Scan(&id, &number, &currentType, &support, &fingerprint, &deleted); err != nil {
				rows.Close()
				return err
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		// Smaller installations and removed historic entities need no replacement
		// content. Any actual identity/type conflict fails closed.
		if count == 0 || (count == 1 && deleted) {
			skipped++
			continue
		}
		if count != 1 || id != declaration.ID || number != declaration.CardNumber {
			return fmt.Errorf("migration 278 identity conflict for %s", declaration.CardNumber)
		}
		if currentType != declaration.Before && currentType != declaration.After {
			return fmt.Errorf("migration 278 unexpected type for %s: got %s, expected %s or %s", number, currentType, declaration.Before, declaration.After)
		}
		var supportValue any
		if support.Valid {
			supportValue = support.String
		}
		if _, err = tx.Exec(`INSERT INTO effect_classification_278_audit
			(effect_id,card_number,previous_type,classified_type,previous_support,protected_fingerprint,decision_reason,manifest_sha256)
			VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`, id, number, currentType, declaration.After, supportValue, fingerprint, declaration.Reason, manifestHash); err != nil {
			return err
		}
		matched++
		if currentType != declaration.After {
			if _, err = tx.Exec(`UPDATE effects SET effect_type=$2 WHERE id=$1`, id, declaration.After); err != nil {
				return err
			}
			changed++
		}
		var unchanged bool
		if err = tx.QueryRow(`SELECT effect_type=$2 AND md5((to_jsonb(e)-ARRAY['effect_type','updated_at']::text[])::text)=$3
			FROM effects e WHERE id=$1`, id, declaration.After, fingerprint).Scan(&unchanged); err != nil {
			return err
		}
		if !unchanged {
			return fmt.Errorf("migration 278 modified protected data for %s; transaction rolled back", number)
		}
	}
	if err = resumeReview(); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO effect_classification_278_runs(id,manifest_sha256,reviewed_count,matched_count,changed_count,skipped_count)
		VALUES(1,$1,$2,$3,$4,$5)`, manifestHash, manifest.InventoryCount, matched, changed, skipped); err != nil {
		return err
	}
	return tx.Commit()
}

// The caller holds the effects write lock for the whole transaction. Suspend
// only review invalidation: reference-index and other triggers remain active.
// Restoring old support after invalidation is not safe with the newer review
// validator, which intentionally rejects assigning legacy NULL/unknown statuses.
// Transactional DDL also restores the original trigger state on any rollback.
func suspendEffectClassificationReviewTrigger(tx *sql.Tx) (func() error, error) {
	var state string
	err := tx.QueryRow(`SELECT tgenabled::text FROM pg_trigger
		WHERE tgrelid='effects'::regclass AND tgname='invalidate_effects_support' AND NOT tgisinternal`).Scan(&state)
	if err == sql.ErrNoRows || (err == nil && state == "D") {
		return func() error { return nil }, nil
	}
	if err != nil {
		return nil, err
	}
	restoreStatements := map[string]string{
		"O": `ALTER TABLE effects ENABLE TRIGGER invalidate_effects_support`,
		"R": `ALTER TABLE effects ENABLE REPLICA TRIGGER invalidate_effects_support`,
		"A": `ALTER TABLE effects ENABLE ALWAYS TRIGGER invalidate_effects_support`,
	}
	restore, known := restoreStatements[state]
	if !known {
		return nil, fmt.Errorf("unexpected effect review trigger state %q", state)
	}
	if _, err = tx.Exec(`ALTER TABLE effects DISABLE TRIGGER invalidate_effects_support`); err != nil {
		return nil, err
	}
	return func() error {
		_, err := tx.Exec(restore)
		return err
	}, nil
}

func refuseEffectClassification278Down(_ *sql.DB) error {
	return fmt.Errorf("migration 278 requires a reviewed restore using effect_classification_278_audit; automatic downgrade would overwrite later classifications")
}
