package migrations

import (
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestRemainingLevelFiveGeneralFeatDeclarations(t *testing.T) {
	if remainingLevelFiveGeneralFeatsVersion != "187_materialize_remaining_level_five_general_feats" {
		t.Fatal(remainingLevelFiveGeneralFeatsVersion)
	}
	var mechanics map[string]any
	if err := json.Unmarshal([]byte(polearmMasterButtMechanics), &mechanics); err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{
		`"events":["hit","miss"]`,
		`"source_action_card_number":"action_basic_weapon"`,
		`"feat_polearm_master_butt":true`,
		`"resource":"bonus_action"`,
		`"dice":"1d4"`,
		`"type":"bludgeoning"`,
		`"ability":"auto"`,
	} {
		if !strings.Contains(polearmMasterButtMechanics, required) {
			t.Errorf("Polearm Master action misses %s", required)
		}
	}
	if strings.Contains(polearmMasterButtMechanics, `"status":"certified"`) {
		t.Fatal("migration must not fabricate certification")
	}
}

func TestRemainingLevelFiveGeneralFeatsAgainstPostgres(t *testing.T) {
	dsn := os.Getenv("LEVEL5_GENERAL_FEAT_187_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("LEVEL5_GENERAL_FEAT_187_TEST_DATABASE_URL is not configured")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = materializeRemainingLevelFiveGeneralFeats(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}
	var capabilities, grants, actions, certified int
	if err = db.QueryRow(`SELECT
		(SELECT count(*) FROM effects WHERE card_number IN ('EFF-general-FEAT-0017','EFF-general-FEAT-0028')
			AND deleted_at IS NULL AND jsonb_array_length(COALESCE(mechanics->'capabilities','[]'::jsonb))>=1
			AND support->>'certification_version'=$1),
		(SELECT count(*) FROM effects WHERE card_number='EFF-general-FEAT-0028' AND deleted_at IS NULL
			AND mechanics::text LIKE '%ACT-general-polearm-master-butt%'),
		(SELECT count(*) FROM actions WHERE card_number='ACT-general-polearm-master-butt' AND deleted_at IS NULL),
		(SELECT count(*) FROM effects WHERE card_number IN ('EFF-general-FEAT-0017','EFF-general-FEAT-0028')
			AND deleted_at IS NULL AND support->>'status'='certified')`,
		remainingLevelFiveGeneralFeatsVersion).Scan(&capabilities, &grants, &actions, &certified); err != nil {
		t.Fatal(err)
	}
	if capabilities != 2 || grants != 1 || actions != 1 || certified != 0 {
		t.Fatalf("capabilities=%d grants=%d actions=%d certified=%d, want 2/1/1/0",
			capabilities, grants, actions, certified)
	}
}

func TestLevelFiveTailReplayRestoresCertifiedGuardsAgainstPostgres(t *testing.T) {
	dsn := os.Getenv("LEVEL5_GENERAL_FEAT_187_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("LEVEL5_GENERAL_FEAT_187_TEST_DATABASE_URL is not configured")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	for run := 1; run <= 2; run++ {
		for _, migration := range []struct {
			name string
			up   func(*sql.DB) error
		}{
			{"187", materializeRemainingLevelFiveGeneralFeats},
			{"188", materializeWizardMemorizeSpell},
			{"189", repairSpeciesTransformationRuntime},
			{"190", repairSorcererLevelFiveRuntime},
		} {
			if err = migration.up(db); err != nil {
				t.Fatalf("tail migration %s run %d: %v", migration.name, run, err)
			}
		}
	}

	var guards int
	if err = db.QueryRow(`SELECT count(*) FROM pg_trigger
		WHERE NOT tgisinternal AND tgname=ANY(ARRAY[
			'protect_actions_certified_mechanics',
			'protect_effects_certified_mechanics',
			'protect_spells_certified_mechanics'
		])`).Scan(&guards); err != nil {
		t.Fatal(err)
	}
	if guards != 3 {
		t.Fatalf("certified mechanics guards=%d, want 3 after the 187-190 tail", guards)
	}
}
