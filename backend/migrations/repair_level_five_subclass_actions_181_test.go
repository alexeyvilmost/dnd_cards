package migrations

import (
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

type levelFiveActionMechanics struct {
	Activation struct {
		Mode string `json:"mode"`
		Cost []struct {
			Resource string `json:"resource"`
		} `json:"cost"`
	} `json:"activation"`
	Targeting map[string]any   `json:"targeting"`
	Effects   []map[string]any `json:"effects"`
	Uses      map[string]any   `json:"uses"`
}

func decodeLevelFiveActionRepair(t *testing.T, repair levelFiveSubclassActionRepair) levelFiveActionMechanics {
	t.Helper()
	var mechanics levelFiveActionMechanics
	if err := json.Unmarshal([]byte(repair.mechanics), &mechanics); err != nil {
		t.Fatalf("%s invalid JSON: %v", repair.card, err)
	}
	return mechanics
}

func hasLevelFiveActionCost(mechanics levelFiveActionMechanics, resource string) bool {
	for _, cost := range mechanics.Activation.Cost {
		if cost.Resource == resource {
			return true
		}
	}
	return false
}

func TestLevelFiveSubclassActionRepairDeclaration(t *testing.T) {
	if levelFiveSubclassActionsRepairVersion != "181_repair_level_five_subclass_actions" {
		t.Fatalf("unexpected version %q", levelFiveSubclassActionsRepairVersion)
	}
	if len(levelFiveSubclassActionRepairs) != 15 {
		t.Fatalf("repair rows=%d, want 15", len(levelFiveSubclassActionRepairs))
	}

	seen := map[string]bool{}
	for _, repair := range levelFiveSubclassActionRepairs {
		if seen[repair.card] {
			t.Fatalf("duplicate repair %s", repair.card)
		}
		seen[repair.card] = true
		mechanics := decodeLevelFiveActionRepair(t, repair)
		if mechanics.Activation.Mode != "active" && mechanics.Activation.Mode != "triggered" {
			t.Errorf("%s mode=%q", repair.card, mechanics.Activation.Mode)
		}
		if strings.Contains(repair.mechanics, `"op":"spend"`) {
			t.Errorf("%s retains unsupported result-level spend", repair.card)
		}
		if strings.Contains(repair.mechanics, "focus_points") {
			t.Errorf("%s retains legacy focus_points", repair.card)
		}
		if strings.TrimSpace(repair.note) == "" {
			t.Errorf("%s must disclose its executable boundary", repair.card)
		}
	}

	for _, card := range []string{
		"ACT-subclass-EFFECT-0016", "ACT-subclass-EFFECT-0111", "ACT-subclass-EFFECT-0115",
		"ACT-subclass-EFFECT-0120", "ACT-subclass-EFFECT-0147", "ACT-subclass-EFFECT-0166",
		"ACT-subclass-EFFECT-0170", "ACT-subclass-EFFECT-0176", "ACT-subclass-EFFECT-0182",
	} {
		if !seen[card] {
			t.Errorf("missing audited result-spend repair %s", card)
		}
	}
}

func TestLevelFiveSubclassActionRepairHighRiskContracts(t *testing.T) {
	byCard := map[string]levelFiveActionMechanics{}
	for _, repair := range levelFiveSubclassActionRepairs {
		byCard[repair.card] = decodeLevelFiveActionRepair(t, repair)
	}

	for _, card := range []string{
		"ACT-subclass-EFFECT-0037", "ACT-subclass-EFFECT-0125",
		"ACT-subclass-EFFECT-0142", "ACT-subclass-EFFECT-0244", "ACT-monk-stunning-strike",
	} {
		if !hasLevelFiveActionCost(byCard[card], "self_uses") || byCard[card].Uses["count"] == nil {
			t.Errorf("%s lacks an explicitly consumed uses pool", card)
		}
	}

	healing := byCard["ACT-subclass-EFFECT-0142"]
	if !hasLevelFiveActionCost(healing, "bonus_action") || !hasLevelFiveActionCost(healing, "self_uses") {
		t.Error("Healing Light must atomically spend its bonus action and one bounded die")
	}
	healingResult := healing.Effects[0]["result"].([]any)[0].(map[string]any)
	if healingResult["kind"] != "healing" || healingResult["amount"] != "1d6" {
		t.Fatalf("Healing Light unsafe result: %#v", healingResult)
	}

	psychic := byCard["ACT-subclass-EFFECT-0192"]
	if !hasLevelFiveActionCost(psychic, "action") || psychic.Activation.Mode != "active" {
		t.Error("Psychic Blades must be an action-paid attack, never a free standalone attack")
	}

	nature := byCard["ACT-subclass-EFFECT-0170"]
	area := nature.Targeting["area"].(map[string]any)
	if nature.Targeting["shape"] != "area" || area["radius_ft"] != float64(15) {
		t.Fatalf("Nature's Wrath targeting=%#v", nature.Targeting)
	}
	failure := nature.Effects[0]["on_fail"].([]any)[0].(map[string]any)
	saveEnds := failure["save_ends"].(map[string]any)
	if failure["kind"] != "grant_effect" || failure["value"] != "COND-restrained" || saveEnds["timing"] != "end_of_turn" {
		t.Fatalf("Nature's Wrath strict condition=%#v", failure)
	}

	hand := byCard["ACT-subclass-EFFECT-0147"]
	if !hasLevelFiveActionCost(hand, "focus") || hasLevelFiveActionCost(hand, "focus_points") {
		t.Error("Hand of Healing must use the canonical focus pool")
	}
}

func TestRepairLevelFiveSubclassActionsProductionClone(t *testing.T) {
	dsn := os.Getenv("LEVEL_FIVE_SUBCLASS_ACTIONS_CLONE_DSN")
	if dsn == "" {
		t.Skip("LEVEL_FIVE_SUBCLASS_ACTIONS_CLONE_DSN is not configured")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = db.Ping(); err != nil {
		t.Fatal(err)
	}
	for run := 1; run <= 2; run++ {
		if err = repairLevelFiveSubclassActions(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}

	for _, repair := range levelFiveSubclassActionRepairs {
		var resource, mechanics, supportStatus, supportVersion string
		if err = db.QueryRow(`SELECT resource,mechanics::text,support->>'status',support->>'certification_version'
			FROM actions WHERE card_number=$1 AND deleted_at IS NULL`, repair.card).
			Scan(&resource, &mechanics, &supportStatus, &supportVersion); err != nil {
			t.Fatalf("%s: %v", repair.card, err)
		}
		var got, want any
		if err = json.Unmarshal([]byte(mechanics), &got); err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal([]byte(repair.mechanics), &want); err != nil {
			t.Fatal(err)
		}
		gotJSON, _ := json.Marshal(got)
		wantJSON, _ := json.Marshal(want)
		if resource != repair.resource || string(gotJSON) != string(wantJSON) ||
			supportStatus != "untested" || supportVersion != levelFiveSubclassActionsRepairVersion {
			t.Errorf("%s postimage resource=%s status=%s version=%s mechanics_equal=%t",
				repair.card, resource, supportStatus, supportVersion, string(gotJSON) == string(wantJSON))
		}

		if strings.HasPrefix(repair.card, "ACT-subclass-") {
			var sourceMode, grantAction string
			sourceCard := strings.TrimPrefix(repair.card, "ACT-subclass-")
			if err = db.QueryRow(`SELECT mechanics#>>'{activation,mode}',mechanics#>>'{effects,0,result,0,value}'
				FROM effects WHERE card_number=$1 AND deleted_at IS NULL`, sourceCard).
				Scan(&sourceMode, &grantAction); err != nil {
				t.Fatalf("source %s: %v", sourceCard, err)
			}
			if sourceMode != "passive" || grantAction != repair.card {
				t.Errorf("source %s mode=%s grant=%s", sourceCard, sourceMode, grantAction)
			}
		}
	}
}
