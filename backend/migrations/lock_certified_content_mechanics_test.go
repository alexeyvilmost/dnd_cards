package migrations

import (
	"strings"
	"testing"
)

func TestCertifiedContentMechanicsLockMigrationIsRegisteredAfter095(t *testing.T) {
	migrations := GetAllMigrations()
	index := -1
	for candidate, migration := range migrations {
		if migration.Version == "096_lock_certified_content_mechanics" {
			index = candidate
			if migration.Up == nil || migration.Down == nil {
				t.Fatal("096 must register Up and safe Down")
			}
		}
	}
	if index < 1 {
		t.Fatal("096_lock_certified_content_mechanics is not registered")
	}
	if previous := migrations[index-1].Version; previous != "095_add_character_runtime_commands" {
		t.Fatalf("migration before 096 = %q, want 095", previous)
	}
}

func TestCertifiedContentMechanicsLockDDLIsFailClosed(t *testing.T) {
	ddl := normalizeDDL(certifiedContentMechanicsLockDDL)
	for label, fragment := range map[string]string{
		"durable marker":  "old.support->>'mechanics_locked'",
		"no unlock":       "certified content mechanics lock cannot be removed",
		"no row mutation": "to_jsonb(new) - array['support', 'updated_at']",
		"no delete":       "if tg_op = 'delete'",
		"actions":         "before update or delete on actions",
		"effects":         "before update or delete on effects",
		"spells":          "before update or delete on spells",
	} {
		if !strings.Contains(ddl, fragment) {
			t.Errorf("missing %s: %s", label, fragment)
		}
	}
	for _, forbidden := range []string{"drop table", "truncate table", "delete from"} {
		if strings.Contains(ddl, forbidden) {
			t.Errorf("lock migration contains destructive DDL %q", forbidden)
		}
	}
}

func TestCertifiedContentMechanicsLockDDLExecutesIdempotently(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, table := range []string{"actions", "effects", "spells"} {
		if _, err := db.Exec(`CREATE TABLE ` + table + ` (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            mechanics JSONB,
            support JSONB,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`); err != nil {
			t.Fatal(err)
		}
	}
	if err := lockCertifiedContentMechanics(db); err != nil {
		t.Fatal(err)
	}
	if err := lockCertifiedContentMechanics(db); err != nil {
		t.Fatalf("096 is not idempotent: %v", err)
	}

	for _, table := range []string{"actions", "effects", "spells"} {
		var id string
		if err := db.QueryRow(`INSERT INTO ` + table + ` (name, mechanics, support)
            VALUES ('Canonical', '{"activation":{"mode":"active"}}',
                '{"status":"verified_mechanical","mechanics_locked":true}') RETURNING id`).Scan(&id); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`UPDATE `+table+` SET support = support || '{"note":"fresh evidence"}' WHERE id=$1`, id); err != nil {
			t.Fatalf("%s rejected evidence refresh: %v", table, err)
		}
		for label, query := range map[string]string{
			"content update":      `UPDATE ` + table + ` SET mechanics='{}' WHERE id=$1`,
			"presentation update": `UPDATE ` + table + ` SET name='Changed' WHERE id=$1`,
			"unlock":              `UPDATE ` + table + ` SET support=support-'mechanics_locked' WHERE id=$1`,
			"delete":              `DELETE FROM ` + table + ` WHERE id=$1`,
		} {
			if _, err := db.Exec(query, id); err == nil {
				t.Fatalf("%s allowed %s for locked row", table, label)
			}
		}
	}
}
