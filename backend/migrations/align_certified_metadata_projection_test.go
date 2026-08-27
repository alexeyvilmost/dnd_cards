package migrations

import (
	"fmt"
	"testing"
)

func TestCertifiedMetadataProjectionMigrationFollows116(t *testing.T) {
	migrations := GetAllMigrations()
	for index, migration := range migrations {
		if migration.Version != certifiedMetadataProjectionMigrationVersion {
			continue
		}
		if migration.Up == nil || migration.Down == nil {
			t.Fatal("117 must register Up and safe Down")
		}
		if index == 0 || migrations[index-1].Version != halfCasterSpellcastingMigrationVersion {
			t.Fatal("migration 117 must immediately follow 116")
		}
		return
	}
	t.Fatal("migration 117 is not registered")
}

func TestCertifiedMutableMetadataPolicyKeepsExecutionFieldsAuthoritative(t *testing.T) {
	fields, err := certifiedMutableMetadataFields()
	if err != nil {
		t.Fatal(err)
	}
	wantMutable := []string{
		"author", "description", "image_url", "name", "rarity", "source",
	}
	for _, field := range wantMutable {
		if !containsString(fields, field) {
			t.Errorf("metadata policy is missing editable %q", field)
		}
	}
	for _, field := range []string{
		"id", "card_number", "mechanics", "action_type", "effect_type",
		"resources", "related_actions", "level_progression", "support",
	} {
		if containsString(fields, field) {
			t.Errorf("execution/identity field %q became mutable metadata", field)
		}
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func TestCertifiedMetadataProjectionPreservesOnlyMetadataSupport(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, table := range supportCertifiedTables {
		statement := fmt.Sprintf(`CREATE TABLE %s (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
			card_number text UNIQUE NOT NULL,
			name text NOT NULL DEFAULT '', name_en text,
			description text NOT NULL DEFAULT '', detailed_description text,
			image_url text NOT NULL DEFAULT '', image_cloudinary_id text NOT NULL DEFAULT '',
			image_cloudinary_url text NOT NULL DEFAULT '', image_generated boolean NOT NULL DEFAULT false,
			image_generation_prompt text NOT NULL DEFAULT '', rarity text NOT NULL DEFAULT 'common',
			author text NOT NULL DEFAULT '', source text,
			action_type text, effect_type text, resources jsonb, related_actions jsonb,
			level_progression jsonb, mechanics jsonb, support jsonb,
			updated_at timestamptz NOT NULL DEFAULT NOW(), deleted_at timestamptz
		)`, table)
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("create %s fixture: %v", table, err)
		}
	}
	if err := addContentSupportCertification(db); err != nil {
		t.Fatalf("install migration-081 invalidator: %v", err)
	}
	if _, err := db.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		t.Fatalf("install migration-108 mechanics lock: %v", err)
	}
	if err := alignCertifiedMetadataProjection(db); err != nil {
		t.Fatal(err)
	}
	if err := alignCertifiedMetadataProjection(db); err != nil {
		t.Fatalf("migration 117 is not idempotent: %v", err)
	}

	const lockedSupport = `{
		"status":"verified_mechanical",
		"mechanics_locked":true,
		"content_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	}`
	var actionID string
	if err := db.QueryRow(`
		INSERT INTO actions (
			card_number, name, description, image_url, rarity, author, source,
			action_type, mechanics, support
		) VALUES (
			'ACTION-certified', 'Before', 'Before', '/before.png', 'common', 'Before', 'Before',
			'base_action', '{"activation":{"mode":"active"}}'::jsonb, $1::jsonb
		) RETURNING id
	`, lockedSupport).Scan(&actionID); err != nil {
		t.Fatal(err)
	}

	if _, err := db.Exec(`
		UPDATE actions SET
			name='After', description='After', image_url='data:image/png;base64,AA==',
			rarity='rare', author='After', source='After'
		WHERE id=$1
	`, actionID); err != nil {
		t.Fatalf("certified metadata update was blocked: %v", err)
	}
	var supportAfterMetadata string
	if err := db.QueryRow(`SELECT support::text FROM actions WHERE id=$1`, actionID).
		Scan(&supportAfterMetadata); err != nil {
		t.Fatal(err)
	}
	var expectedSupport string
	if err := db.QueryRow(`SELECT $1::jsonb::text`, lockedSupport).Scan(&expectedSupport); err != nil {
		t.Fatal(err)
	}
	if supportAfterMetadata != expectedSupport {
		t.Fatalf("metadata edit changed certification support: %s", supportAfterMetadata)
	}

	if _, err := db.Exec(`UPDATE actions SET mechanics='{}'::jsonb WHERE id=$1`, actionID); err == nil {
		t.Fatal("locked mechanics update unexpectedly succeeded")
	}
	if _, err := db.Exec(`UPDATE actions SET support=NULL WHERE id=$1`, actionID); err == nil {
		t.Fatal("standalone certification unlock unexpectedly succeeded")
	}

	const refreshedSupport = `{
		"status":"verified_mechanical",
		"mechanics_locked":true,
		"content_hash":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	}`
	if _, err := db.Exec(`UPDATE actions SET support=$2::jsonb WHERE id=$1`, actionID, refreshedSupport); err != nil {
		t.Fatalf("explicit locked support refresh failed: %v", err)
	}
	if err := db.QueryRow(`SELECT $1::jsonb::text`, refreshedSupport).Scan(&expectedSupport); err != nil {
		t.Fatal(err)
	}

	var actionType string
	var mechanicsCanonical bool
	if err := db.QueryRow(`
		SELECT action_type, mechanics = '{"activation":{"mode":"active"}}'::jsonb, support::text
		FROM actions WHERE id=$1
	`, actionID).Scan(&actionType, &mechanicsCanonical, &supportAfterMetadata); err != nil {
		t.Fatal(err)
	}
	if actionType != "base_action" || !mechanicsCanonical || supportAfterMetadata != expectedSupport {
		t.Fatalf("rejected execution edits changed row: type=%q mechanics_canonical=%v support=%s",
			actionType, mechanicsCanonical, supportAfterMetadata)
	}
	if _, err := db.Exec(`UPDATE actions SET action_type='reaction' WHERE id=$1`, actionID); err != nil {
		t.Fatalf("non-mechanics structural action update was blocked: %v", err)
	}
	var actionSupportCleared bool
	if err := db.QueryRow(`
		SELECT action_type, support IS NULL FROM actions WHERE id=$1
	`, actionID).Scan(&actionType, &actionSupportCleared); err != nil {
		t.Fatal(err)
	}
	if actionType != "reaction" || !actionSupportCleared {
		t.Fatalf("structural edit did not revoke support: type=%q support_cleared=%v",
			actionType, actionSupportCleared)
	}

	var classID string
	if err := db.QueryRow(`
		INSERT INTO classes (card_number, name, level_progression, support)
		VALUES ('CLASS-certified', 'Before', '{"1":{}}'::jsonb, $1::jsonb)
		RETURNING id
	`, lockedSupport).Scan(&classID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE classes SET name='After' WHERE id=$1`, classID); err != nil {
		t.Fatalf("class presentation update failed: %v", err)
	}
	if _, err := db.Exec(`UPDATE classes SET level_progression='{"1":{"effects":[]}}'::jsonb WHERE id=$1`, classID); err != nil {
		t.Fatalf("unlocked structural class update failed: %v", err)
	}
	var classSupportCleared bool
	if err := db.QueryRow(`SELECT support IS NULL FROM classes WHERE id=$1`, classID).Scan(&classSupportCleared); err != nil {
		t.Fatal(err)
	}
	if !classSupportCleared {
		t.Fatal("structural class edit retained stale support")
	}
}
