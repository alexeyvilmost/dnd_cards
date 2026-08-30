package migrations

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestSleepSpellClassListRepairChangesOnlyStableClassLinkage(t *testing.T) {
	var legacy, canonical map[string]any
	if err := json.Unmarshal([]byte(sleepSpellLegacyMechanics), &legacy); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(sleepSpellCanonicalMechanics), &canonical); err != nil {
		t.Fatal(err)
	}
	classLists := canonical["spell_class_list_ids"]
	delete(canonical, "spell_class_list_ids")
	if !reflect.DeepEqual(legacy, canonical) {
		t.Fatal("Sleep repair changed executable mechanics")
	}
	if !reflect.DeepEqual(classLists, []any{"CLASS-bard", "CLASS-sorcerer", "CLASS-wizard"}) {
		t.Fatalf("invalid Sleep class lists: %#v", classLists)
	}
}

func TestSleepSpellClassListMigrationFollowsBardRepair(t *testing.T) {
	migrations := GetAllMigrations()
	for index, migration := range migrations {
		if migration.Version != sleepSpellClassListMigrationVersion {
			continue
		}
		if migration.Up == nil || migration.Down == nil {
			t.Fatal("119 must register Up and a safe Down")
		}
		if index == 0 || migrations[index-1].Version != bardSpellcastingMigrationVersion {
			t.Fatal("migration 119 must immediately follow 118")
		}
		return
	}
	t.Fatal("migration 119 is not registered")
}

func TestRepairSleepSpellClassListContractIsExactAuditedAndIdempotent(t *testing.T) {
	db := seedHalfCasterSpellcastingFixture(t, nil)
	const lockedSupport = `{
		"status":"verified_mechanical",
		"certification_version":"micro-mvp-l1-rules-core-v4",
		"mechanics_locked":true,
		"content_hash":"sha256:legacy"
	}`
	if _, err := db.Exec(`
		INSERT INTO spells (id, card_number, mechanics, support)
		VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb)
	`, sleepSpellEntityID, sleepSpellCardNumber,
		sleepSpellLegacyMechanics, lockedSupport,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO spells (id, card_number, mechanics, support)
		VALUES (
			'11900000-0000-4000-8000-000000000001', 'SPELL-unrelated-locked',
			'{"activation":{"mode":"active","cost":[]},"effects":[]}'::jsonb,
			$1::jsonb
		)
	`, lockedSupport); err != nil {
		t.Fatal(err)
	}

	for run := 0; run < 2; run++ {
		if err := repairSleepSpellClassListContract(db); err != nil {
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
		FROM spells WHERE card_number = $1
	`, sleepSpellCardNumber, sleepSpellCanonicalMechanics).Scan(
		&canonical, &status, &certificationVersion, &locked,
	); err != nil {
		t.Fatal(err)
	}
	if !canonical || status != "untested" ||
		certificationVersion != sleepSpellClassListRevocationVersion || locked {
		t.Fatalf(
			"Sleep postcondition: canonical=%v status=%q version=%q locked=%v",
			canonical, status, certificationVersion, locked,
		)
	}

	var revocations int
	if err := db.QueryRow(`
		SELECT count(*) FROM content_certification_revocations
		WHERE migration_version = $1 AND card_number = $2
	`, sleepSpellClassListMigrationVersion, sleepSpellCardNumber).Scan(&revocations); err != nil {
		t.Fatal(err)
	}
	if revocations != 1 {
		t.Fatalf("Sleep certification revocations = %d, want 1", revocations)
	}

	if _, err := db.Exec(`
		UPDATE spells SET mechanics = '{}'::jsonb
		WHERE card_number = 'SPELL-unrelated-locked'
	`); err == nil {
		t.Fatal("restored certification guard accepted an unrelated locked spell update")
	}
}
