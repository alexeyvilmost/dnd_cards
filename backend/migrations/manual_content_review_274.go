package migrations

import (
	"database/sql"
	"fmt"
)

const manualContentReviewMigrationVersion = "274_manual_content_review"

var manualContentReviewTables = []string{
	"cards", "actions", "effects", "spells", "feats", "backgrounds", "races", "classes",
	"resources", "variables", "concepts", "monsters", "passive_presentations",
}

func enableManualContentReview274(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Preserve the exact former metadata separately, including null support.
	// Combat snapshots, certificates and saved events are not touched.
	if _, err = tx.Exec(`CREATE TABLE IF NOT EXISTS content_review_support_archive (
		entity_table text NOT NULL,
		entity_id text NOT NULL,
		support jsonb,
		archived_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
		migration_version text NOT NULL,
		PRIMARY KEY (entity_table, entity_id)
	);
	CREATE TABLE IF NOT EXISTS content_review_transitions (
		migration_version text PRIMARY KEY,
		completed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		return err
	}
	transition, err := tx.Exec(`INSERT INTO content_review_transitions(migration_version) VALUES ($1) ON CONFLICT DO NOTHING`, manualContentReviewMigrationVersion)
	if err != nil {
		return err
	}
	firstRun, err := transition.RowsAffected()
	if err != nil {
		return err
	}
	metadata, err := certifiedMutableMetadataFields()
	if err != nil {
		return err
	}
	excluded := quotedTextArray(append([]string{"support", "updated_at", "version"}, metadata...))
	if _, err = tx.Exec(fmt.Sprintf(`CREATE OR REPLACE FUNCTION invalidate_content_support()
		RETURNS TRIGGER AS $$
		BEGIN
			IF TG_OP = 'INSERT' THEN
				NEW.support = jsonb_build_object('status', 'not_tested');
			ELSIF (to_jsonb(NEW) - ARRAY[%s]::text[])
				IS DISTINCT FROM (to_jsonb(OLD) - ARRAY[%s]::text[]) THEN
				NEW.support = jsonb_build_object('status', 'not_verified');
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;`, excluded, excluded)); err != nil {
		return err
	}
	for _, table := range manualContentReviewTables {
		idColumn := "id"
		if table == "passive_presentations" {
			idColumn = "key"
		}
		if _, err = tx.Exec(fmt.Sprintf(`
			ALTER TABLE %[1]s ADD COLUMN IF NOT EXISTS support jsonb;
			DROP TRIGGER IF EXISTS protect_%[1]s_certified_mechanics ON %[1]s;
			DROP TRIGGER IF EXISTS invalidate_%[1]s_support ON %[1]s;
			ALTER TABLE %[1]s ALTER COLUMN support SET DEFAULT '{"status":"not_tested"}'::jsonb;
			WITH archived AS (
				INSERT INTO content_review_support_archive(entity_table, entity_id, support, migration_version)
				SELECT '%[1]s', %[2]s::text, support, '%[3]s' FROM %[1]s WHERE %[4]t
				ON CONFLICT (entity_table, entity_id) DO NOTHING RETURNING entity_id
			)
			UPDATE %[1]s AS entity SET support = '{"status":"not_verified"}'::jsonb
			FROM archived WHERE entity.%[2]s::text = archived.entity_id;
			CREATE TRIGGER invalidate_%[1]s_support BEFORE INSERT OR UPDATE ON %[1]s
			FOR EACH ROW EXECUTE FUNCTION invalidate_content_support();
		`, table, idColumn, manualContentReviewMigrationVersion, firstRun > 0)); err != nil {
			return fmt.Errorf("enable manual review for %s: %w", table, err)
		}
	}
	if _, err = tx.Exec(`DROP FUNCTION IF EXISTS protect_certified_content_mechanics()`); err != nil {
		return err
	}
	return tx.Commit()
}
