package migrations

import (
	"database/sql"
	"encoding/json"
	"os"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestGeneralFeatChoiceIntegrityPayload(t *testing.T) {
	if generalFeatChoiceIntegrityRepairVersion != "178_repair_general_feat_choice_integrity" {
		t.Fatal(generalFeatChoiceIntegrityRepairVersion)
	}
	var mechanics struct {
		Effects []struct {
			ID      string `json:"id"`
			Options struct {
				Items []struct {
					ID     string           `json:"id"`
					Grants []map[string]any `json:"grants"`
				} `json:"items"`
			} `json:"options"`
		} `json:"effects"`
	}
	if err := json.Unmarshal([]byte(resilientCoupledMechanics), &mechanics); err != nil {
		t.Fatal(err)
	}
	if len(mechanics.Effects) != 1 || mechanics.Effects[0].ID != "general_feat_ability_increase" {
		t.Fatalf("unexpected Resilient effects: %#v", mechanics.Effects)
	}
	if len(mechanics.Effects[0].Options.Items) != 6 {
		t.Fatalf("Resilient ability choices=%d, want 6", len(mechanics.Effects[0].Options.Items))
	}
	for _, item := range mechanics.Effects[0].Options.Items {
		if len(item.Grants) != 2 || item.Grants[0]["ability"] != item.ID || item.Grants[1]["value"] != item.ID {
			t.Fatalf("Resilient %s is not coupled: %#v", item.ID, item.Grants)
		}
	}
}

func TestGeneralFeatChoiceIntegrityPostgresClone(t *testing.T) {
	dsn := os.Getenv("GENERAL_FEAT_CHOICE_REPAIR_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set GENERAL_FEAT_CHOICE_REPAIR_TEST_DATABASE_URL for clone integration")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = repairGeneralFeatChoiceIntegrity(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}
	var repaired int
	if err = db.QueryRow(`SELECT count(*) FROM effects WHERE deleted_at IS NULL AND (
		(card_number='EFF-general-FEAT-0050'
		 AND jsonb_array_length(mechanics->'effects')=1
		 AND jsonb_array_length(mechanics#>'{effects,0,options,items}')=6)
		OR
		(card_number='EFF-general-FEAT-0043'
		 AND mechanics#>>'{effects,1,unique_across_instances}'='true')
		OR
		(card_number='EFF-general-FEAT-0044'
		 AND mechanics#>>'{effects,1,result,0,applies_to,roll}'='saving_throw'
		 AND mechanics#>>'{effects,1,result,0,applies_to,filter,kind}'='death')
	) AND support->>'certification_version'=$1`, generalFeatChoiceIntegrityRepairVersion).Scan(&repaired); err != nil {
		t.Fatal(err)
	}
	if repaired != 3 {
		t.Fatalf("repaired General-feat choice rows=%d, want 3", repaired)
	}
}
