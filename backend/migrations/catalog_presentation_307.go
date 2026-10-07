package migrations

import (
	"context"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

//go:embed presentation_catalog_307_manifest.json
var catalogPresentation307JSON []byte

// Reviewed metadata is separate from execution. Split choices retain their option
// IDs and inline nested choices, so existing spell/ability selections still resolve.
// Nothing in this migration writes characters, encounters, receipts or frozen rules.
func applyCatalogPresentation307On(tx *sql.Tx) error {
	var manifest struct {
		Actions []struct {
			ID          string `json:"id"`
			CardNumber  string `json:"card_number"`
			IsNarrative bool   `json:"is_narrative"`
		} `json:"actions"`
		Spells []struct {
			ID          string `json:"id"`
			CardNumber  string `json:"card_number"`
			IsNarrative bool   `json:"is_narrative"`
		} `json:"spells"`
		ActionUpdates []struct {
			ID            string `json:"id"`
			CardNumber    string `json:"card_number"`
			Description   string `json:"description"`
			Before, After json.RawMessage
		} `json:"action_updates"`
		TechnicalEffects []struct {
			ID         string `json:"id"`
			CardNumber string `json:"card_number"`
		} `json:"technical_effects"`
		Parents []struct {
			ID            string `json:"id"`
			CardNumber    string `json:"card_number"`
			Before, After json.RawMessage
		} `json:"parents"`
		Effects []struct {
			ID                string `json:"id"`
			CardNumber        string `json:"card_number"`
			Name, Description string
			Mechanics         json.RawMessage
			SourceID          string `json:"source_id"`
			EffectType        string `json:"effect_type"`
		} `json:"effects"`
	}
	if err := json.Unmarshal(catalogPresentation307JSON, &manifest); err != nil {
		return err
	}
	var err error
	if _, err = tx.Exec(`LOCK TABLE actions, effects, spells IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return err
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(catalogPresentation307JSON))
	var applied bool
	if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM entity_presentation_307_receipt WHERE manifest_hash=$1)`, hash).Scan(&applied); err != nil {
		return err
	}
	if applied {
		return nil
	}
	archive := func(table, kind, id string) error {
		var present bool
		if err := tx.QueryRow(fmt.Sprintf(`SELECT EXISTS(SELECT 1 FROM %s WHERE id=$1 AND deleted_at IS NULL)`, table), id).Scan(&present); err != nil {
			return err
		}
		if !present {
			return fmt.Errorf("reviewed %s source is missing", kind)
		}
		_, err := tx.Exec(fmt.Sprintf(`INSERT INTO entity_presentation_307_audit(entity_type,entity_id,row_before)
		 SELECT $1,id,to_jsonb(e) FROM %s e WHERE id=$2 AND deleted_at IS NULL ON CONFLICT DO NOTHING`, table), kind, id)
		return err
	}
	for _, action := range manifest.Actions {
		if !action.IsNarrative {
			continue
		}
		if err = archive("actions", "action", action.ID); err != nil {
			return err
		}
		if err = updateReviewedPresentationRow(tx, `UPDATE actions SET is_narrative=$3,updated_at=now() WHERE id=$1 AND card_number=$2 AND deleted_at IS NULL`, action.ID, action.CardNumber, action.IsNarrative); err != nil {
			return err
		}
	}
	for _, effect := range manifest.TechnicalEffects {
		if err = archive("effects", "effect", effect.ID); err != nil {
			return err
		}
		if err = updateReviewedPresentationRow(tx, `UPDATE effects SET is_technical=true,updated_at=now() WHERE id=$1 AND card_number=$2 AND deleted_at IS NULL`, effect.ID, effect.CardNumber); err != nil {
			return err
		}
	}
	for _, spell := range manifest.Spells {
		if !spell.IsNarrative {
			continue
		}
		if err = archive("spells", "spell", spell.ID); err != nil {
			return err
		}
		if err = updateReviewedPresentationRow(tx, `UPDATE spells SET is_narrative=true,updated_at=now() WHERE id=$1 AND card_number=$2 AND deleted_at IS NULL`, spell.ID, spell.CardNumber); err != nil {
			return err
		}
	}
	for _, effect := range manifest.Effects {
		var compatible bool
		if err = tx.QueryRow(`SELECT NOT EXISTS(SELECT 1 FROM effects WHERE (id=$1 OR card_number=$2) AND (id<>$1 OR card_number<>$2 OR mechanics IS DISTINCT FROM $3::jsonb OR deleted_at IS NOT NULL))`, effect.ID, effect.CardNumber, string(effect.Mechanics)).Scan(&compatible); err != nil {
			return err
		}
		if !compatible {
			return fmt.Errorf("choice ability %s conflicts with existing content", effect.CardNumber)
		}
		_, err = tx.Exec(`INSERT INTO effects(id,card_number,name,description,mechanics,effect_type,rarity,image_url,author,source,support,created_at,updated_at)
		 SELECT $1,$2,$3,$4,$5::jsonb,$6,'common',image_url,'Admin','Выбор способности',
		 '{"status":"not_verified"}'::jsonb,now(),now() FROM effects WHERE id=$7 AND deleted_at IS NULL
		 ON CONFLICT(id) DO NOTHING`, effect.ID, effect.CardNumber, effect.Name, effect.Description, string(effect.Mechanics), effect.EffectType, effect.SourceID)
		if err != nil {
			return fmt.Errorf("create choice ability %s: %w", effect.CardNumber, err)
		}
		// The canonical BEFORE INSERT invalidator removes unsupported certificates.
		// Annotate the resulting row in a second write; retain an existing review.
		if _, err = tx.Exec(`UPDATE effects SET support='{"status":"not_verified"}'::jsonb WHERE id=$1 AND support IS NULL`, effect.ID); err != nil {
			return err
		}
	}
	for _, parent := range manifest.Parents {
		var current string
		err = tx.QueryRow(`SELECT mechanics::text FROM effects WHERE id=$1 AND card_number=$2 AND deleted_at IS NULL`, parent.ID, parent.CardNumber).Scan(&current)
		if err == sql.ErrNoRows {
			return fmt.Errorf("choice source %s is missing", parent.CardNumber)
		}
		if err != nil {
			return err
		}
		var compatible bool
		if err = tx.QueryRow(`SELECT $1::jsonb=$2::jsonb OR $1::jsonb=$3::jsonb`, current, string(parent.Before), string(parent.After)).Scan(&compatible); err != nil {
			return err
		}
		if !compatible {
			return fmt.Errorf("choice source %s changed since review", parent.CardNumber)
		}
		if err = archive("effects", "effect", parent.ID); err != nil {
			return err
		}
		if _, err = tx.Exec(`UPDATE effects SET mechanics=$2::jsonb,updated_at=now() WHERE id=$1 AND mechanics IS DISTINCT FROM $2::jsonb`, parent.ID, string(parent.After)); err != nil {
			return err
		}
		// Canonical invalidation runs first; the new unverified status is a second write.
		if _, err = tx.Exec(`UPDATE effects SET support='{"status":"not_verified"}'::jsonb WHERE id=$1`, parent.ID); err != nil {
			return err
		}
	}
	for _, action := range manifest.ActionUpdates {
		var current string
		err = tx.QueryRow(`SELECT mechanics::text FROM actions WHERE id=$1 AND card_number=$2 AND deleted_at IS NULL`, action.ID, action.CardNumber).Scan(&current)
		if err == sql.ErrNoRows {
			return fmt.Errorf("action source %s is missing", action.CardNumber)
		}
		if err != nil {
			return err
		}
		var compatible bool
		if err = tx.QueryRow(`SELECT $1::jsonb=$2::jsonb OR $1::jsonb=$3::jsonb`, current, string(action.Before), string(action.After)).Scan(&compatible); err != nil {
			return err
		}
		if !compatible {
			return fmt.Errorf("action source %s changed since review", action.CardNumber)
		}
		if err = archive("actions", "action", action.ID); err != nil {
			return err
		}
		if _, err = tx.Exec(`UPDATE actions SET mechanics=$2::jsonb,description=$3,updated_at=now() WHERE id=$1`, action.ID, string(action.After), action.Description); err != nil {
			return err
		}
		if _, err = tx.Exec(`UPDATE actions SET support='{"status":"not_verified"}'::jsonb WHERE id=$1`, action.ID); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(`INSERT INTO entity_presentation_307_receipt(manifest_hash) VALUES($1)`, hash); err != nil {
		return err
	}
	return nil
}

func updateReviewedPresentationRow(tx *sql.Tx, statement string, args ...interface{}) error {
	result, err := tx.Exec(statement, args...)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return errors.New("reviewed catalog identity is missing or changed")
	}
	return nil
}

type CatalogPresentationRequest struct {
	SchemaVersion             int    `json:"schemaVersion"`
	ReleaseID                 string `json:"releaseId"`
	CandidateSourceCommit     string `json:"candidateSourceCommit"`
	CandidateInputFingerprint string `json:"candidateInputFingerprint"`
	ManifestHash              string `json:"manifestHash"`
}

func CatalogPresentationManifestHash() string { return hashBytes(catalogPresentation307JSON) }

// Explicit post-cutover content application, never a startup migration. Source
// preimages, edits and receipt commit together under the release migration lock.
func (m *Migrator) ApplyCatalogPresentation(ctx context.Context, request CatalogPresentationRequest) (runErr error) {
	if request.SchemaVersion != 1 || request.ManifestHash != CatalogPresentationManifestHash() {
		return errors.New("exact catalog manifest required")
	}
	connection, err := m.acquireAdvisoryLock(ctx)
	if err != nil {
		return err
	}
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := releaseAdvisoryLock(releaseCtx, connection); err != nil && runErr == nil {
			runErr = errors.New("catalog lock release outcome unknown")
		}
	}()
	tx, err := connection.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s'`); err != nil {
		return err
	}
	var installed bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version='307_catalog_presentation')`).Scan(&installed); err != nil || !installed {
		return errors.New("verified catalog schema must be installed first")
	}
	if _, err = verifyAdditiveSchema(ctx, tx); err != nil {
		return err
	}
	if err = applyCatalogPresentation307On(tx); err != nil {
		return err
	}
	return tx.Commit()
}
