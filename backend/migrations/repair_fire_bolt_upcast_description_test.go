package migrations

import (
	"strings"
	"testing"
)

func TestFireBoltUpcastDescriptionMigrationFollowsSleepLifecycle(t *testing.T) {
	migrations := GetAllMigrations()
	for index, migration := range migrations {
		if migration.Version != fireBoltUpcastDescriptionMigrationVersion {
			continue
		}
		if migration.Up == nil || migration.Down == nil {
			t.Fatal("124 must register Up and a safe Down")
		}
		if index == 0 || migrations[index-1].Version != sleep2024LifecycleMigrationVersion {
			t.Fatal("migration 124 must immediately follow 123")
		}
		return
	}
	t.Fatal("migration 124 is not registered")
}

func TestFireBoltUpcastDescriptionsUseD10AtEveryTier(t *testing.T) {
	if strings.Contains(fireBoltNewUpcastDescription, "к6") {
		t.Fatalf("canonical Fire Bolt text still contains d6: %s", fireBoltNewUpcastDescription)
	}
	for _, required := range []string{"1к10", "2к10", "3к10", "4к10"} {
		if !strings.Contains(fireBoltNewUpcastDescription, required) {
			t.Fatalf("canonical Fire Bolt text is missing %s: %s", required, fireBoltNewUpcastDescription)
		}
	}
}

func TestRepairFireBoltUpcastDescriptionIsExactAndIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	if _, err := db.Exec(`
		CREATE TABLE spells (
			id UUID PRIMARY KEY,
			card_number TEXT UNIQUE NOT NULL,
			name TEXT NOT NULL,
			level INTEGER NOT NULL,
			upcast_description TEXT,
			mechanics JSONB NOT NULL,
			support JSONB,
			updated_at TIMESTAMPTZ DEFAULT NOW(),
			deleted_at TIMESTAMPTZ
		);
		CREATE OR REPLACE FUNCTION invalidate_content_support()
		RETURNS TRIGGER AS $$
		BEGIN
			IF NEW.upcast_description IS DISTINCT FROM OLD.upcast_description THEN
				NEW.support = NULL;
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;
		CREATE OR REPLACE FUNCTION protect_certified_content_mechanics()
		RETURNS TRIGGER AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;
		CREATE TRIGGER invalidate_spells_support
		BEFORE UPDATE ON spells
		FOR EACH ROW EXECUTE FUNCTION invalidate_content_support();
		CREATE TRIGGER protect_spells_certified_mechanics
		BEFORE UPDATE OR DELETE ON spells
		FOR EACH ROW EXECUTE FUNCTION protect_certified_content_mechanics();
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO spells (
			id, card_number, name, level, upcast_description, mechanics, support
		) VALUES (
			$1::uuid, $2, 'Огненный снаряд', 0, $3,
			'{"effects":[{"on_hit":[{"kind":"damage","dice":"1d10","scaling":{"dice":"1d10","per":"character_level"}}]}]}'::jsonb,
			'{"status":"verified_partial","mechanics_locked":true}'::jsonb
		)
	`, fireBoltEntityID, fireBoltCardNumber, fireBoltOldUpcastDescription); err != nil {
		t.Fatal(err)
	}

	for run := 0; run < 2; run++ {
		if err := repairFireBoltUpcastDescription(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	var description, status string
	var locked bool
	if err := db.QueryRow(`
		SELECT upcast_description, support->>'status',
		       (support->>'mechanics_locked')::boolean
		FROM spells WHERE card_number = $1
	`, fireBoltCardNumber).Scan(&description, &status, &locked); err != nil {
		t.Fatal(err)
	}
	if description != fireBoltNewUpcastDescription || status != "untested" || locked {
		t.Fatalf("unexpected postimage: description=%q status=%q locked=%t", description, status, locked)
	}
}
