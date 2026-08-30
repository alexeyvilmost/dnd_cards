package migrations

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestBardSpellcastingRepairAddsOnlyPrimaryAbility(t *testing.T) {
	var legacy, canonical map[string]any
	if err := json.Unmarshal([]byte(bardSpellcastingLegacyMechanics), &legacy); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(bardSpellcastingCanonicalMechanics), &canonical); err != nil {
		t.Fatal(err)
	}
	legacyEffects := legacy["effects"].([]any)
	canonicalEffects := canonical["effects"].([]any)
	if len(legacyEffects) != 3 || len(canonicalEffects) != 3 {
		t.Fatalf("bard spellcasting must retain one declaration and two choices")
	}
	if !reflect.DeepEqual(legacyEffects[1:], canonicalEffects[1:]) {
		t.Fatal("repair changed the bard spell selections")
	}
	legacyResult := legacyEffects[0].(map[string]any)["result"].([]any)
	canonicalResult := canonicalEffects[0].(map[string]any)["result"].([]any)
	if len(legacyResult) != 1 || len(canonicalResult) != 2 || !reflect.DeepEqual(legacyResult[0], canonicalResult[1]) {
		t.Fatal("repair must prepend exactly one declaration")
	}
	ability := canonicalResult[0].(map[string]any)
	if ability["kind"] != "spellcasting_ability" || ability["role"] != "primary" || ability["ability"] != "cha" {
		t.Fatalf("invalid bard primary ability: %#v", ability)
	}
}

func TestBardSpellcastingMigrationFollowsCertifiedMetadataProjection(t *testing.T) {
	migrations := GetAllMigrations()
	for index, migration := range migrations {
		if migration.Version != bardSpellcastingMigrationVersion {
			continue
		}
		if migration.Up == nil || migration.Down == nil {
			t.Fatal("118 must register Up and a safe Down")
		}
		if index == 0 || migrations[index-1].Version != certifiedMetadataProjectionMigrationVersion {
			t.Fatal("migration 118 must immediately follow 117")
		}
		return
	}
	t.Fatal("migration 118 is not registered")
}

func TestRepairBardSpellcastingContractIsExactAuditedAndIdempotent(t *testing.T) {
	db := seedHalfCasterSpellcastingFixture(t, nil)
	const lockedSupport = `{
		"status":"verified_mechanical",
		"certification_version":"micro-mvp-l1-rules-core-v4",
		"mechanics_locked":true,
		"content_hash":"sha256:legacy"
	}`
	if _, err := db.Exec(`
		INSERT INTO effects (id, card_number, name, mechanics, support)
		VALUES ($1::uuid, $2, 'Колдовство барда', $3::jsonb, $4::jsonb)
	`, bardSpellcastingEntityID, bardSpellcastingCardNumber,
		bardSpellcastingLegacyMechanics, lockedSupport,
	); err != nil {
		t.Fatal(err)
	}

	for run := 0; run < 2; run++ {
		if err := repairBardSpellcastingContract(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}

	var canonical bool
	var abilityCount int
	var status, certificationVersion string
	var locked bool
	if err := db.QueryRow(`
		SELECT
			mechanics = $2::jsonb,
			(SELECT count(*) FROM jsonb_array_elements(mechanics->'effects'->0->'result') AS result
			 WHERE result->>'kind' = 'spellcasting_ability' AND result->>'role' = 'primary'
			   AND result->>'ability' = 'cha'),
			support->>'status', support->>'certification_version',
			(support->>'mechanics_locked')::boolean
		FROM effects WHERE card_number = $1
	`, bardSpellcastingCardNumber, bardSpellcastingCanonicalMechanics).Scan(
		&canonical, &abilityCount, &status, &certificationVersion, &locked,
	); err != nil {
		t.Fatal(err)
	}
	if !canonical || abilityCount != 1 || status != "untested" ||
		certificationVersion != bardSpellcastingRevocationVersion || locked {
		t.Fatalf(
			"bard postcondition: canonical=%v abilities=%d status=%q version=%q locked=%v",
			canonical, abilityCount, status, certificationVersion, locked,
		)
	}

	var revocations int
	if err := db.QueryRow(`
		SELECT count(*) FROM content_certification_revocations
		WHERE migration_version = $1 AND card_number = $2
	`, bardSpellcastingMigrationVersion, bardSpellcastingCardNumber).Scan(&revocations); err != nil {
		t.Fatal(err)
	}
	if revocations != 1 {
		t.Fatalf("bard certification revocations = %d, want 1", revocations)
	}

	if _, err := db.Exec(`
		UPDATE effects SET mechanics = '{}'::jsonb
		WHERE card_number = 'EFF-unrelated-locked'
	`); err == nil {
		t.Fatal("restored certification guard accepted an unrelated locked mechanics update")
	}
}
