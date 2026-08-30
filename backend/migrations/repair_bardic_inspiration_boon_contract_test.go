package migrations

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestBardicInspirationRepairChangesNarrativeToTargetBoonOnly(t *testing.T) {
	var legacy, canonical map[string]any
	if err := json.Unmarshal([]byte(bardicInspirationLegacyMechanics), &legacy); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(bardicInspirationCanonicalMechanics), &canonical); err != nil {
		t.Fatal(err)
	}
	legacyEffects := legacy["effects"]
	canonicalEffects := canonical["effects"]
	delete(legacy, "effects")
	delete(canonical, "effects")
	if !reflect.DeepEqual(legacy, canonical) {
		t.Fatal("Bardic Inspiration repair changed activation or targeting")
	}
	if reflect.DeepEqual(legacyEffects, canonicalEffects) {
		t.Fatal("Bardic Inspiration repair did not replace narrative mechanics")
	}
	effect := canonicalEffects.([]any)[0].(map[string]any)
	if effect["resolution"] != "auto" || effect["who"] != "target" {
		t.Fatalf("invalid target routing: %#v", effect)
	}
	boon := effect["result"].([]any)[0].(map[string]any)
	if boon["kind"] != "boon" || boon["id"] != "bardic_inspiration" || boon["die"] != "1d6" {
		t.Fatalf("invalid Bardic Inspiration boon: %#v", boon)
	}
}

func TestBardicInspirationMigrationFollowsSleepRepair(t *testing.T) {
	migrations := GetAllMigrations()
	for index, migration := range migrations {
		if migration.Version != bardicInspirationMigrationVersion {
			continue
		}
		if migration.Up == nil || migration.Down == nil {
			t.Fatal("120 must register Up and a safe Down")
		}
		if index == 0 || migrations[index-1].Version != sleepSpellClassListMigrationVersion {
			t.Fatal("migration 120 must immediately follow 119")
		}
		return
	}
	t.Fatal("migration 120 is not registered")
}

func TestRepairBardicInspirationBoonContractIsExactAuditedAndIdempotent(t *testing.T) {
	db := seedHalfCasterSpellcastingFixture(t, nil)
	const lockedSupport = `{
		"status":"verified_mechanical",
		"certification_version":"micro-mvp-l1-rules-core-v4",
		"mechanics_locked":true,
		"content_hash":"sha256:legacy"
	}`
	if _, err := db.Exec(`
		INSERT INTO actions (id, card_number, name, mechanics, support)
		VALUES ($1::uuid, $2, 'Вдохновение барда', $3::jsonb, $4::jsonb)
	`, bardicInspirationEntityID, bardicInspirationCardNumber,
		bardicInspirationLegacyMechanics, lockedSupport,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO actions (id, card_number, name, mechanics, support)
		VALUES (
			'12000000-0000-4000-8000-000000000001', 'ACT-unrelated-locked', 'Locked',
			'{"activation":{"mode":"active","cost":[]},"effects":[]}'::jsonb,
			$1::jsonb
		)
	`, lockedSupport); err != nil {
		t.Fatal(err)
	}

	for run := 0; run < 2; run++ {
		if err := repairBardicInspirationBoonContract(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	var canonical bool
	var status, certificationVersion string
	var locked bool
	if err := db.QueryRow(`
		SELECT mechanics = $2::jsonb, support->>'status',
		       support->>'certification_version',
		       (support->>'mechanics_locked')::boolean
		FROM actions WHERE card_number = $1
	`, bardicInspirationCardNumber, bardicInspirationCanonicalMechanics).Scan(
		&canonical, &status, &certificationVersion, &locked,
	); err != nil {
		t.Fatal(err)
	}
	if !canonical || status != "untested" ||
		certificationVersion != bardicInspirationRevocationVersion || locked {
		t.Fatalf(
			"Bardic Inspiration postcondition: canonical=%v status=%q version=%q locked=%v",
			canonical, status, certificationVersion, locked,
		)
	}

	var revocations int
	if err := db.QueryRow(`
		SELECT count(*) FROM content_certification_revocations
		WHERE migration_version = $1 AND card_number = $2
	`, bardicInspirationMigrationVersion, bardicInspirationCardNumber).Scan(&revocations); err != nil {
		t.Fatal(err)
	}
	if revocations != 1 {
		t.Fatalf("Bardic Inspiration certification revocations = %d, want 1", revocations)
	}

	if _, err := db.Exec(`
		UPDATE actions SET mechanics = '{}'::jsonb
		WHERE card_number = 'ACT-unrelated-locked'
	`); err == nil {
		t.Fatal("restored certification guard accepted an unrelated locked action update")
	}
}
