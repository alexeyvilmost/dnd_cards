package migrations

import (
	"database/sql"
	"encoding/json"
	"reflect"
	"testing"
)

func TestHalfCasterSpellcastingRepairCatalogPreservesDeclarativeChoices(t *testing.T) {
	seenIDs := map[string]bool{}
	seenCards := map[string]bool{}
	for _, repair := range halfCasterSpellcastingRepairs {
		if seenIDs[repair.EntityID] || seenCards[repair.CardNumber] {
			t.Fatalf("duplicate half-caster repair identity: %s / %s", repair.EntityID, repair.CardNumber)
		}
		seenIDs[repair.EntityID] = true
		seenCards[repair.CardNumber] = true

		var legacy, canonical map[string]any
		if err := json.Unmarshal([]byte(repair.LegacyMechanics), &legacy); err != nil {
			t.Fatalf("%s legacy mechanics are invalid: %v", repair.CardNumber, err)
		}
		if err := json.Unmarshal([]byte(repair.CanonicalMechanics), &canonical); err != nil {
			t.Fatalf("%s canonical mechanics are invalid: %v", repair.CardNumber, err)
		}
		legacyEffects := legacy["effects"].([]any)
		canonicalEffects := canonical["effects"].([]any)
		if len(legacyEffects) != 2 || len(canonicalEffects) != 2 {
			t.Fatalf("%s must retain the narrative + choice effect pair", repair.CardNumber)
		}
		if !reflect.DeepEqual(legacyEffects[1], canonicalEffects[1]) {
			t.Fatalf("%s changed its class spell choice while adding the ability", repair.CardNumber)
		}
		legacyResult := legacyEffects[0].(map[string]any)["result"].([]any)
		canonicalResult := canonicalEffects[0].(map[string]any)["result"].([]any)
		if len(legacyResult) != 1 || len(canonicalResult) != 2 || !reflect.DeepEqual(legacyResult[0], canonicalResult[1]) {
			t.Fatalf("%s must prepend only the canonical spellcasting ability", repair.CardNumber)
		}
		ability := canonicalResult[0].(map[string]any)
		if ability["kind"] != "spellcasting_ability" || ability["role"] != "primary" || ability["ability"] != repair.Ability {
			t.Fatalf("%s has a malformed primary spellcasting ability: %#v", repair.CardNumber, ability)
		}
	}
	if len(seenCards) != 2 || !seenCards["EFF-paladin-spellcasting"] || !seenCards["EFF-ranger-spellcasting"] {
		t.Fatalf("half-caster repair coverage = %#v", seenCards)
	}
}

func TestHalfCasterSpellcastingMigrationFollows115(t *testing.T) {
	migrations := GetAllMigrations()
	for index, migration := range migrations {
		if migration.Version != halfCasterSpellcastingMigrationVersion {
			continue
		}
		if migration.Up == nil || migration.Down == nil {
			t.Fatal("116 must register Up and safe Down")
		}
		if index == 0 || migrations[index-1].Version != "115_repair_goliath_stone_targeting_contract" {
			t.Fatal("migration 116 must immediately follow 115")
		}
		return
	}
	t.Fatal("migration 116 is not registered")
}

func seedHalfCasterSpellcastingFixture(
	t *testing.T,
	overrides map[string]string,
) *sql.DB {
	t.Helper()
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, statement := range []string{
		`CREATE TABLE actions (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(), card_number text UNIQUE,
			mechanics jsonb, support jsonb, updated_at timestamptz NOT NULL DEFAULT NOW(),
			deleted_at timestamptz
		)`,
		`CREATE TABLE effects (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(), card_number text UNIQUE NOT NULL,
			name text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '', image_url text NOT NULL DEFAULT '',
			mechanics jsonb NOT NULL, support jsonb, updated_at timestamptz NOT NULL DEFAULT NOW(),
			deleted_at timestamptz
		)`,
		`CREATE TABLE spells (
			id uuid PRIMARY KEY DEFAULT gen_random_uuid(), card_number text UNIQUE,
			mechanics jsonb, support jsonb, updated_at timestamptz NOT NULL DEFAULT NOW(),
			deleted_at timestamptz
		)`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("fixture DDL failed: %v", err)
		}
	}
	const lockedSupport = `{
		"status":"verified_mechanical",
		"certification_version":"micro-mvp-l1-rules-core-v4",
		"mechanics_locked":true,
		"content_hash":"sha256:legacy"
	}`
	for _, repair := range halfCasterSpellcastingRepairs {
		mechanics := repair.LegacyMechanics
		if override, ok := overrides[repair.CardNumber]; ok {
			mechanics = override
		}
		if _, err := db.Exec(`
			INSERT INTO effects (id, card_number, name, mechanics, support)
			VALUES ($1::uuid, $2, $2, $3::jsonb, $4::jsonb)
		`, repair.EntityID, repair.CardNumber, mechanics, lockedSupport); err != nil {
			t.Fatalf("seed %s: %v", repair.CardNumber, err)
		}
	}
	if _, err := db.Exec(`
		INSERT INTO effects (id, card_number, name, mechanics, support)
		VALUES (
			'11600000-0000-4000-8000-000000000001',
			'EFF-unrelated-locked',
			'Unrelated locked effect',
			'{"activation":{"mode":"passive"},"effects":[]}'::jsonb,
			'{"status":"verified_mechanical","mechanics_locked":true}'::jsonb
		)
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		t.Fatalf("install certification guard: %v", err)
	}
	return db
}

func TestRepairHalfCasterSpellcastingContractIsExactAuditedAndIdempotent(t *testing.T) {
	db := seedHalfCasterSpellcastingFixture(t, nil)
	for run := 0; run < 2; run++ {
		if err := repairHalfCasterSpellcastingContract(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	for _, repair := range halfCasterSpellcastingRepairs {
		var canonical bool
		var abilityCount int
		var status string
		var locked bool
		if err := db.QueryRow(`
			SELECT
				mechanics = $2::jsonb,
				(SELECT count(*) FROM jsonb_array_elements(mechanics->'effects'->0->'result') AS result
				 WHERE result->>'kind' = 'spellcasting_ability' AND result->>'role' = 'primary'
				   AND result->>'ability' = $3),
				support->>'status',
				(support->>'mechanics_locked')::boolean
			FROM effects WHERE card_number = $1
		`, repair.CardNumber, repair.CanonicalMechanics, repair.Ability).Scan(
			&canonical,
			&abilityCount,
			&status,
			&locked,
		); err != nil {
			t.Fatal(err)
		}
		if !canonical || abilityCount != 1 || status != "untested" || locked {
			t.Fatalf(
				"%s postcondition: canonical=%v abilities=%d status=%q locked=%v",
				repair.CardNumber,
				canonical,
				abilityCount,
				status,
				locked,
			)
		}
	}

	var revocations int
	if err := db.QueryRow(`
		SELECT count(*) FROM content_certification_revocations
		WHERE migration_version = $1
	`, halfCasterSpellcastingMigrationVersion).Scan(&revocations); err != nil {
		t.Fatal(err)
	}
	if revocations != 2 {
		t.Fatalf("half-caster certification revocations = %d, want 2", revocations)
	}

	// The restored policy protects unrelated certified mechanics but deliberately
	// leaves ordinary descriptive metadata editable.
	if _, err := db.Exec(`
		UPDATE effects SET description = 'metadata remains editable'
		WHERE card_number = 'EFF-unrelated-locked'
	`); err != nil {
		t.Fatalf("restored mechanics-only guard blocked metadata: %v", err)
	}
	if _, err := db.Exec(`
		UPDATE effects SET mechanics = '{}'::jsonb
		WHERE card_number = 'EFF-unrelated-locked'
	`); err == nil {
		t.Fatal("restored certification guard accepted an unrelated locked mechanics update")
	}
}

func TestRepairHalfCasterSpellcastingContractRevokesPrepatchedStaleSupport(t *testing.T) {
	paladin := halfCasterSpellcastingRepairs[0]
	db := seedHalfCasterSpellcastingFixture(t, map[string]string{
		paladin.CardNumber: paladin.CanonicalMechanics,
	})
	if err := repairHalfCasterSpellcastingContract(db); err != nil {
		t.Fatal(err)
	}
	if err := repairHalfCasterSpellcastingContract(db); err != nil {
		t.Fatalf("prepatched support repair is not idempotent: %v", err)
	}

	var status, certificationVersion string
	var locked bool
	if err := db.QueryRow(`
		SELECT support->>'status', support->>'certification_version',
		       (support->>'mechanics_locked')::boolean
		FROM effects WHERE card_number = $1
	`, paladin.CardNumber).Scan(&status, &certificationVersion, &locked); err != nil {
		t.Fatal(err)
	}
	if status != "untested" || certificationVersion != halfCasterSpellcastingRevocationVersion || locked {
		t.Fatalf(
			"prepatched stale support survived: status=%q version=%q locked=%v",
			status,
			certificationVersion,
			locked,
		)
	}
	var priorWasCanonical bool
	if err := db.QueryRow(`
		SELECT prior_mechanics = $2::jsonb
		FROM content_certification_revocations
		WHERE migration_version = $1 AND card_number = $3
	`, halfCasterSpellcastingMigrationVersion, paladin.CanonicalMechanics, paladin.CardNumber).Scan(&priorWasCanonical); err != nil {
		t.Fatal(err)
	}
	if !priorWasCanonical {
		t.Fatal("prepatched certification revocation did not preserve the canonical mechanics preimage")
	}
}

func TestRepairHalfCasterSpellcastingContractRejectsDriftAtomically(t *testing.T) {
	db := seedHalfCasterSpellcastingFixture(t, map[string]string{
		"EFF-ranger-spellcasting": `{"activation":{"mode":"passive"},"effects":[]}`,
	})
	ledgerTx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := createCertificationRevocationLedger(ledgerTx); err != nil {
		ledgerTx.Rollback()
		t.Fatal(err)
	}
	if err := ledgerTx.Commit(); err != nil {
		t.Fatal(err)
	}

	if err := repairHalfCasterSpellcastingContract(db); err == nil {
		t.Fatal("migration accepted an unreviewed Ranger mechanics state")
	}
	paladin := halfCasterSpellcastingRepairs[0]
	var legacy, locked bool
	if err := db.QueryRow(`
		SELECT mechanics = $2::jsonb, (support->>'mechanics_locked')::boolean
		FROM effects WHERE card_number = $1
	`, paladin.CardNumber, paladin.LegacyMechanics).Scan(&legacy, &locked); err != nil {
		t.Fatal(err)
	}
	if !legacy || !locked {
		t.Fatalf("failed migration leaked a Paladin write: legacy=%v locked=%v", legacy, locked)
	}
	var revocations int
	if err := db.QueryRow(`
		SELECT count(*) FROM content_certification_revocations
		WHERE migration_version = $1
	`, halfCasterSpellcastingMigrationVersion).Scan(&revocations); err != nil {
		t.Fatal(err)
	}
	if revocations != 0 {
		t.Fatalf("failed migration leaked %d certification revocations", revocations)
	}
	if _, err := db.Exec(`
		UPDATE effects SET mechanics = '{}'::jsonb
		WHERE card_number = 'EFF-paladin-spellcasting'
	`); err == nil {
		t.Fatal("failed migration did not transactionally restore the certification guard")
	}
}
