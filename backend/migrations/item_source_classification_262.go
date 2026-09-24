package migrations

import (
	"context"
	"database/sql"
	"dnd-cards-backend/itemsource"
	"fmt"
)

const itemSourceClassification262Version = "262_item_source_classification"

// classifyItemSources262 is deliberately not registered until the local audit
// has been reviewed. Only active library metadata is changed. Historical and
// deleted rows are untouched. The receipt makes a direct retry a true no-op,
// even after an administrator subsequently edits a source or tag.
func classifyItemSources262(db *sql.DB) error {
	classifier, err := itemsource.New()
	if err != nil {
		return err
	}
	fields, err := CertifiedMutableMetadataFields()
	if err != nil {
		return err
	}
	sourceMutable := false
	for _, field := range fields {
		if field == "source" {
			sourceMutable = true
		}
	}
	if !sourceMutable {
		return fmt.Errorf("source is part of certified content; migration 262 refused")
	}
	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Serialize direct invocations as well as ordinary migration-runner calls.
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(262,262)`); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS item_source_classification_262_runs (
			id integer PRIMARY KEY CHECK(id=1), catalog_sha256 text NOT NULL,
			active_count integer NOT NULL, ph_count integer NOT NULL, review_count integer NOT NULL,
			applied_at timestamptz NOT NULL DEFAULT now()
		);
		CREATE TABLE IF NOT EXISTS item_source_classification_262_audit (
			card_id uuid PRIMARY KEY, card_number text NOT NULL,
			previous_source text, classified_source text NOT NULL,
			rule_id text NOT NULL, canonical text NOT NULL, decision text NOT NULL,
			reason text NOT NULL, rules_fingerprint text NOT NULL, catalog_sha256 text NOT NULL,
			applied_at timestamptz NOT NULL DEFAULT now()
		);`); err != nil {
		return err
	}
	var priorHash string
	err = tx.QueryRowContext(ctx, `SELECT catalog_sha256 FROM item_source_classification_262_runs WHERE id=1`).Scan(&priorHash)
	if err == nil {
		if priorHash != classifier.Hash() {
			return fmt.Errorf("migration 262 already applied with another catalog; use a new reviewed migration")
		}
		return tx.Commit()
	}
	if err != sql.ErrNoRows {
		return err
	}
	// Prevent insertion/edit/delete between inventory, classification and checks.
	if _, err = tx.ExecContext(ctx, `LOCK TABLE cards,entity_tag_definitions IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return err
	}
	rows, err := itemsource.Inventory(ctx, tx)
	if err != nil {
		return err
	}
	// Reuse only the reserved definition. Never steal another tag's name or ID.
	if _, err = tx.ExecContext(ctx, `INSERT INTO entity_tag_definitions(id,name,description)
		VALUES($1,$2,'Player availability is administered through entity tag assignments.')
		ON CONFLICT DO NOTHING`, itemsource.AvailableForPlayersTagID, itemsource.AvailableForPlayersTagName); err != nil {
		return err
	}
	var tagName string
	if err = tx.QueryRowContext(ctx, `SELECT name FROM entity_tag_definitions WHERE id=$1`, itemsource.AvailableForPlayersTagID).Scan(&tagName); err != nil || tagName != itemsource.AvailableForPlayersTagName {
		return fmt.Errorf("migration 262 tag name/ID conflict; reserved ID %s", itemsource.AvailableForPlayersTagID)
	}
	active, ph, review := 0, 0, 0
	for _, row := range rows {
		if row.Deleted {
			continue
		}
		active++
		result := classifier.Classify(row.Card)
		if result.Source == itemsource.PlayersHandbook {
			ph++
		}
		if result.NeedsReview {
			review++
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO item_source_classification_262_audit
			(card_id,card_number,previous_source,classified_source,rule_id,canonical,decision,reason,rules_fingerprint,catalog_sha256)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, row.ID, row.CardNumber, row.PreviousSource, result.Source, result.RuleID, result.Canonical, result.Status, result.Reason, row.RulesFingerprint, classifier.Hash()); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE cards SET source=$2 WHERE id=$1 AND source IS DISTINCT FROM $2`, row.ID, result.Source); err != nil {
			return err
		}
		// Actual database triggers, not just a source-code policy assertion, must
		// preserve every field except source and the ordinary update timestamp.
		var unchanged bool
		if err = tx.QueryRowContext(ctx, `SELECT (to_jsonb(c)-ARRAY['source','updated_at']::text[])=$2::jsonb
			AND source=$3 FROM cards c WHERE id=$1`, row.ID, row.BeforeJSON, result.Source).Scan(&unchanged); err != nil {
			return err
		}
		if !unchanged {
			return fmt.Errorf("migration 262 changed protected data/support for %s; transaction rolled back", row.CardNumber)
		}
	}
	// The default covers INSERTs that omit source. Explicit empty/manual sources
	// and future PH classification belong to the authorized application writer.
	if _, err = tx.ExecContext(ctx, `ALTER TABLE cards ALTER COLUMN source SET DEFAULT 'Bag Of Holding'`); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO item_source_classification_262_runs(id,catalog_sha256,active_count,ph_count,review_count)
		VALUES(1,$1,$2,$3,$4)`, classifier.Hash(), active, ph, review); err != nil {
		return err
	}
	return tx.Commit()
}

func refuseItemSourceClassification262Down(_ *sql.DB) error {
	return fmt.Errorf("migration 262 requires a separately reviewed restore from item_source_classification_262_audit; automatic downgrade would overwrite later metadata edits")
}
