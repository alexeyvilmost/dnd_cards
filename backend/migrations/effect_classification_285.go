package migrations

import (
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

//go:embed effect_classification_285_manifest.json
var effectClassification285ManifestJSON []byte

func reviewedEffectClassification285() (effectClassification278Manifest, string, error) {
	var manifest effectClassification278Manifest
	if err := json.Unmarshal(effectClassification285ManifestJSON, &manifest); err != nil {
		return manifest, "", err
	}
	if manifest.SchemaVersion != 1 || manifest.InventoryCount != 54 || len(manifest.Effects) != manifest.InventoryCount {
		return manifest, "", fmt.Errorf("migration 285 classification inventory is incomplete")
	}
	seenIDs, seenNumbers := map[string]bool{}, map[string]bool{}
	validTypes := map[string]bool{"feat_ability": true, "item_effect": true, "spell_effect": true}
	for _, row := range manifest.Effects {
		if row.ID == "" || row.CardNumber == "" || row.Name == "" || row.Reason == "" || !validTypes[row.Before] || !validTypes[row.After] || seenIDs[row.ID] || seenNumbers[row.CardNumber] {
			return manifest, "", fmt.Errorf("migration 285 invalid classification for %q", row.CardNumber)
		}
		seenIDs[row.ID], seenNumbers[row.CardNumber] = true, true
	}
	hash := sha256.Sum256(effectClassification285ManifestJSON)
	return manifest, hex.EncodeToString(hash[:]), nil
}

// This supplements the immutable 707-row classification with the 54 entities
// reviewed in the newer production snapshot. Only the spell-bond type changes.
func classifyProductionEffects285(db *sql.DB) error {
	manifest, manifestHash, err := reviewedEffectClassification285()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`CREATE TABLE IF NOT EXISTS effect_classification_285_runs (
		id integer PRIMARY KEY CHECK(id=1), manifest_sha256 text NOT NULL,
		reviewed_count integer NOT NULL, matched_count integer NOT NULL,
		changed_count integer NOT NULL, skipped_count integer NOT NULL,
		applied_at timestamptz NOT NULL DEFAULT now()
	);
	CREATE TABLE IF NOT EXISTS effect_classification_285_audit (
		effect_id uuid PRIMARY KEY, card_number text NOT NULL,
		previous_type text NOT NULL, classified_type text NOT NULL,
		previous_support jsonb, protected_fingerprint text NOT NULL,
		decision_reason text NOT NULL, manifest_sha256 text NOT NULL,
		applied_at timestamptz NOT NULL DEFAULT now()
	)`); err != nil {
		return err
	}
	if _, err = tx.Exec(`LOCK TABLE effects, effect_classification_285_runs IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return err
	}
	var previousHash string
	err = tx.QueryRow(`SELECT manifest_sha256 FROM effect_classification_285_runs WHERE id=1`).Scan(&previousHash)
	if err == nil {
		if previousHash != manifestHash {
			return fmt.Errorf("migration 285 already applied with another reviewed manifest")
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
		if count == 0 || (count == 1 && deleted) {
			skipped++
			continue
		}
		if count != 1 || id != declaration.ID || number != declaration.CardNumber {
			return fmt.Errorf("migration 285 identity conflict for %s", declaration.CardNumber)
		}
		if currentType != declaration.Before && currentType != declaration.After {
			return fmt.Errorf("migration 285 unexpected type for %s: got %s, expected %s or %s", number, currentType, declaration.Before, declaration.After)
		}
		var supportValue any
		if support.Valid {
			supportValue = support.String
		}
		if _, err = tx.Exec(`INSERT INTO effect_classification_285_audit
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
			return fmt.Errorf("migration 285 modified protected data for %s; transaction rolled back", number)
		}
	}
	if err = resumeReview(); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO effect_classification_285_runs(id,manifest_sha256,reviewed_count,matched_count,changed_count,skipped_count)
		VALUES(1,$1,$2,$3,$4,$5)`, manifestHash, manifest.InventoryCount, matched, changed, skipped); err != nil {
		return err
	}
	return tx.Commit()
}

func refuseEffectClassification285Down(_ *sql.DB) error {
	return fmt.Errorf("migration 285 requires a reviewed restore using effect_classification_285_audit; automatic downgrade would overwrite later classifications")
}
