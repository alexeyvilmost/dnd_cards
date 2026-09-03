package migrations

import (
	"database/sql"
	"os"
	"strings"
	"testing"
)

func TestWarlockInvocationLevelFiveDeclarations(t *testing.T) {
	if len(warlockInvocationRows180) != 13 {
		t.Fatalf("missing invocation rows: %d", len(warlockInvocationRows180))
	}
	seen := map[string]bool{}
	for _, row := range warlockInvocationRows180 {
		if row.Level != 2 && row.Level != 5 {
			t.Errorf("%s invalid gate %d", row.Card, row.Level)
		}
		if seen[row.Card] {
			t.Errorf("duplicate %s", row.Card)
		}
		seen[row.Card] = true
		if strings.Contains(row.Mechanics, `"kind":"narrative"`) {
			t.Errorf("%s uses narrative mechanics", row.Card)
		}
		if strings.Contains(row.Mechanics, `"kind":"condition"`) {
			t.Errorf("%s uses inline condition", row.Card)
		}
	}
	if !strings.Contains(seenCardMechanics180("EFF-invoc-eldritch-smite"), "COND-prone") {
		t.Fatal("smite must reference library Prone")
	}
}

func seenCardMechanics180(card string) string {
	for _, r := range warlockInvocationRows180 {
		if r.Card == card {
			return r.Mechanics
		}
	}
	return ""
}

func TestMaterializeWarlockInvocationsLevelFiveClone(t *testing.T) {
	dsn := os.Getenv("WARLOCK_INVOCATIONS_180_CLONE_DSN")
	if dsn == "" {
		t.Skip("WARLOCK_INVOCATIONS_180_CLONE_DSN unset")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = materializeWarlockInvocationsLevelFive180(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}
	var total, missing, level5 int
	if err = db.QueryRow(`SELECT jsonb_array_length(mechanics#>'{effects,0,options,items}'),(SELECT count(*) FROM effects WHERE card_number=ANY(ARRAY['EFF-invoc-ascendant-step','EFF-invoc-eldritch-smite','EFF-invoc-eldritch-spear','EFF-invoc-gaze-two-minds','EFF-invoc-gift-depths','EFF-invoc-investment-chain','EFF-invoc-lessons-first-ones','EFF-invoc-master-myriad-forms','EFF-invoc-misty-visions','EFF-invoc-one-with-shadows','EFF-invoc-otherworldly-leap','EFF-invoc-repelling-blast','EFF-invoc-thirsting-blade'])),mechanics#>>'{effects,0,count_by_level,5}' FROM effects WHERE card_number='EFF-eldritch-invocations'`).Scan(&total, &missing, &level5); err != nil {
		t.Fatal(err)
	}
	if total != 22 || missing != 13 || level5 != 5 {
		t.Fatalf("total=%d new=%d l5=%d", total, missing, level5)
	}
}
