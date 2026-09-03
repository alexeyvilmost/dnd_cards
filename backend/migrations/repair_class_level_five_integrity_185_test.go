package migrations

import (
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestClassLevelFiveIntegrityDeclarations(t *testing.T) {
	if classLevelFiveIntegrityVersion != "185_repair_class_level_five_integrity" {
		t.Fatalf("unexpected version %q", classLevelFiveIntegrityVersion)
	}
	if len(classLevelFiveEffectRepairs) != 5 || len(classLevelFiveActionRepairs) != 2 {
		t.Fatalf("repairs effects=%d actions=%d", len(classLevelFiveEffectRepairs), len(classLevelFiveActionRepairs))
	}
	for _, repair := range classLevelFiveEffectRepairs {
		var mechanics map[string]any
		if err := json.Unmarshal([]byte(repair.mechanics), &mechanics); err != nil {
			t.Fatalf("%s: %v", repair.card, err)
		}
		if strings.TrimSpace(repair.note) == "" {
			t.Errorf("%s lacks an audit note", repair.card)
		}
	}
	for _, repair := range classLevelFiveActionRepairs {
		if repair.actionType != "class_feature" {
			t.Errorf("%s action_type %q violates actions_action_type_check", repair.card, repair.actionType)
		}
		var mechanics map[string]any
		if err := json.Unmarshal([]byte(repair.mechanics), &mechanics); err != nil {
			t.Fatalf("%s: %v", repair.card, err)
		}
		if strings.Contains(repair.mechanics, "monk_level") || strings.Contains(repair.mechanics, "focus_points") {
			t.Errorf("%s retains a legacy formula/resource", repair.card)
		}
	}
	for name, mechanics := range map[string]string{
		"vow target": vowOfEnmityTargetEffectMechanics,
		"vow action": vowOfEnmityActionMechanics,
	} {
		var decoded map[string]any
		if err := json.Unmarshal([]byte(mechanics), &decoded); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if !strings.Contains(vowOfEnmityTargetEffectMechanics, `"kind":"roller_is_condition_source"`) ||
		!strings.Contains(vowOfEnmityActionMechanics, `"kind":"grant_effect","value":"`+vowOfEnmityTargetEffectCard+`"`) {
		t.Fatal("Vow of Enmity is not source-bound through its library effect")
	}
}

func TestRepairClassLevelFiveIntegrityProductionClone(t *testing.T) {
	dsn := os.Getenv("CLASS_LEVEL_FIVE_INTEGRITY_CLONE_DSN")
	if dsn == "" {
		t.Skip("CLASS_LEVEL_FIVE_INTEGRITY_CLONE_DSN is not configured")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = repairClassLevelFiveIntegrity(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}

	var repairedEffects, repairedActions, vowTarget, vowAction int
	if err = db.QueryRow(`SELECT
		(SELECT count(*) FROM effects WHERE card_number=ANY($1::text[]) AND deleted_at IS NULL
		 AND support->>'status'='untested' AND support->>'certification_version'=$2),
		(SELECT count(*) FROM actions WHERE card_number=ANY($3::text[]) AND deleted_at IS NULL
		 AND support->>'status'='untested' AND support->>'certification_version'=$2),
		(SELECT count(*) FROM effects WHERE card_number=$4 AND deleted_at IS NULL
		 AND mechanics::text LIKE '%"roller_is_condition_source"%'),
		(SELECT count(*) FROM actions WHERE card_number='ACT-subclass-EFFECT-0166' AND deleted_at IS NULL
		 AND mechanics#>>'{effects,0,result,0,value}'=$4)`,
		[]string{"EFFECT-0058", "EFFECT-0233", "EFFECT-0215", "EFFECT-0217", "EFFECT-0187"},
		classLevelFiveIntegrityVersion,
		[]string{"ACT-monk-slow-fall", "ACT-subclass-EFFECT-0106"},
		vowOfEnmityTargetEffectCard).
		Scan(&repairedEffects, &repairedActions, &vowTarget, &vowAction); err != nil {
		t.Fatal(err)
	}
	if repairedEffects != 5 || repairedActions != 2 || vowTarget != 1 || vowAction != 1 {
		t.Fatalf("effects=%d actions=%d vow_target=%d vow_action=%d",
			repairedEffects, repairedActions, vowTarget, vowAction)
	}
}
