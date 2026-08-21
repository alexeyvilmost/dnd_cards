package migrations

import "testing"

func TestAlignRangedWeaponActionDeclarationIsExactAndIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, statement := range []string{
		`CREATE TABLE actions (
			id uuid PRIMARY KEY, card_number text NOT NULL UNIQUE,
			name_en text, resource text, source text, mechanics jsonb,
			updated_at timestamptz NOT NULL DEFAULT NOW(), deleted_at timestamptz
		)`,
		`INSERT INTO actions (id, card_number, resource, source, mechanics) VALUES (
			'10800000-0000-4000-8000-000000000001',
			'action_basic_weapon_ranged', '', 'PHB 2024',
			'{"primitive":{"type":"weapon_attack"}}'::jsonb
		)`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("fixture DDL/seed failed: %v", err)
		}
	}

	for run := 0; run < 2; run++ {
		if err := alignRangedWeaponActionDeclaration(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	var nameEn, resource, source, mechanics string
	if err := db.QueryRow(`
		SELECT name_en, resource, source, mechanics::text
		FROM actions WHERE card_number = $1 AND deleted_at IS NULL
	`, rangedWeaponActionCardNumber).Scan(&nameEn, &resource, &source, &mechanics); err != nil {
		t.Fatal(err)
	}
	if nameEn != "Ranged Weapon Attack" || resource != "action" ||
		source != "PHB 2024; micro-MVP L1 overlay canonical entity v1" {
		t.Fatalf("declarative metadata was not aligned: name=%q resource=%q source=%q", nameEn, resource, source)
	}
	if mechanics != `{"primitive": {"type": "weapon_attack"}}` {
		t.Fatalf("mechanics changed while aligning metadata: %s", mechanics)
	}
}

func TestAlignRangedWeaponActionDeclarationFailsClosedWithoutOneActiveEntity(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	if _, err := db.Exec(`CREATE TABLE actions (
		id uuid PRIMARY KEY, card_number text NOT NULL UNIQUE,
		name_en text, resource text, source text,
		updated_at timestamptz NOT NULL DEFAULT NOW(), deleted_at timestamptz
	)`); err != nil {
		t.Fatal(err)
	}
	if err := alignRangedWeaponActionDeclaration(db); err == nil {
		t.Fatal("migration accepted a missing canonical ranged weapon action")
	}
}

func TestAlignRangedWeaponActionDeclarationMigrationIsRegisteredAfter110(t *testing.T) {
	migrations := GetAllMigrations()
	for index, migration := range migrations {
		if migration.Version == "111_align_ranged_weapon_action_declaration" {
			if index == 0 || migrations[index-1].Version != "110_deduplicate_goliath_ancestry" {
				t.Fatal("migration 111 must immediately follow 110")
			}
			return
		}
	}
	t.Fatal("migration 111 is not registered")
}
