package migrations

import "testing"

func TestRepairGoliathStoneTargetingContractIsIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, statement := range []string{
		`CREATE TABLE actions (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(), card_number text NOT NULL UNIQUE,
			mechanics jsonb, support jsonb, updated_at timestamptz NOT NULL DEFAULT NOW(),
			deleted_at timestamptz
		)`,
		`CREATE TABLE effects (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mechanics jsonb, support jsonb,
			updated_at timestamptz NOT NULL DEFAULT NOW(), deleted_at timestamptz
		)`,
		`CREATE TABLE spells (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mechanics jsonb, support jsonb,
			updated_at timestamptz NOT NULL DEFAULT NOW(), deleted_at timestamptz
		)`,
		`INSERT INTO actions (card_number, mechanics) VALUES (
			'ACT-goliath-stone', '{
			  "activation":{"mode":"reaction","trigger":{"event":"damage_taken","timing":"before"}},
			  "targeting":{"domain":"actor","actor_targets":true,"shape":"self"},
			  "effects":[{"resolution":"auto","result":[{"kind":"reduce_damage","amount":"1d12+con"}]}]
			}'::jsonb
		)`,
		certifiedContentMechanicsOnlyLockDDL,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("fixture DDL/seed failed: %v", err)
		}
	}

	for run := 0; run < 2; run++ {
		if err := repairGoliathStoneTargetingContract(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	var actorTargets bool
	if err := db.QueryRow(`
		SELECT (mechanics->'targeting'->>'actor_targets')::boolean
		FROM actions WHERE card_number = 'ACT-goliath-stone'
	`).Scan(&actorTargets); err != nil {
		t.Fatal(err)
	}
	if actorTargets {
		t.Fatal("self-target Stone Endurance remained an external actor-target action")
	}
}

func TestGoliathStoneTargetingContractMigrationFollowsEquipmentRepair(t *testing.T) {
	migrations := GetAllMigrations()
	for index, migration := range migrations {
		if migration.Version != "115_repair_goliath_stone_targeting_contract" {
			continue
		}
		if index == 0 || migrations[index-1].Version != "114_repair_class_starting_equipment_references" {
			t.Fatal("migration 115 must immediately follow 114")
		}
		return
	}
	t.Fatal("migration 115 is not registered")
}
