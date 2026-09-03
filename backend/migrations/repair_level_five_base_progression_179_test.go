package migrations

import (
	"database/sql"
	"os"
	"strings"
	"testing"
)

func TestLevelFiveBaseProgressionRepairDeclaration(t *testing.T) {
	if levelFiveBaseProgressionRepairVersion != "179_repair_level_five_base_progression" {
		t.Fatalf("unexpected version %q", levelFiveBaseProgressionRepairVersion)
	}
	if len(levelFiveSpellChoiceRepairs) != 4 {
		t.Fatalf("spell repair rows=%d, want 4", len(levelFiveSpellChoiceRepairs))
	}
	for _, tc := range []struct {
		class string
		count int
		label string
	}{
		{"bard", 1, "prepared"}, {"cleric", 1, "prepared"}, {"druid", 1, "prepared"}, {"sorcerer", 1, "known"},
	} {
		found := false
		for _, row := range levelFiveSpellChoiceRepairs {
			if strings.Contains(row.card, tc.class) {
				found = row.count == tc.count && row.label == tc.label
			}
		}
		if !found {
			t.Errorf("missing exact %s progression repair", tc.class)
		}
	}
	mechanics := levelFiveSpellChoiceMechanics("бард", "prepared", 1)
	for _, token := range []string{`"only_available_slots":true`, `"label":"prepared"`, `"count":1`} {
		if !strings.Contains(mechanics, token) {
			t.Errorf("spell choice missing %s", token)
		}
	}
}

func TestRepairLevelFiveBaseProgressionProductionClone(t *testing.T) {
	dsn := os.Getenv("LEVEL_FIVE_BASE_PROGRESSION_CLONE_DSN")
	if dsn == "" {
		t.Skip("LEVEL_FIVE_BASE_PROGRESSION_CLONE_DSN is not configured")
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
		if err = repairLevelFiveBaseProgression(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}

	var invocations, invocationOptions, favored, sneak, secondWind, healing string
	if err = db.QueryRow(`SELECT mechanics#>>'{effects,0,count_by_level,5}',jsonb_array_length(mechanics#>'{effects,0,options,items}')::text FROM effects WHERE card_number='EFF-eldritch-invocations'`).Scan(&invocations, &invocationOptions); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT mechanics#>>'{effects,0,result,0,freeuse,count}' FROM effects WHERE card_number='EFF-favored-enemy'`).Scan(&favored); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT mechanics#>>'{effects,0,result,0,dice}' FROM effects WHERE card_number='EFF-sneak-attack'`).Scan(&sneak); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT mechanics#>>'{uses,count}',mechanics#>>'{effects,0,result,0,amount}' FROM actions WHERE card_number='ACT-second-wind'`).Scan(&secondWind, &healing); err != nil {
		t.Fatal(err)
	}
	if invocations != "5" || invocationOptions != "9" || favored != "prof_bonus" || sneak != "class_level:rogue/2 d6" || secondWind != "3" || healing != "1d10 + class_level:fighter" {
		t.Fatalf("bad postimage invocations=%s options=%s favored=%s sneak=%s secondWind=%s healing=%s", invocations, invocationOptions, favored, sneak, secondWind, healing)
	}
	var duplicateAdds int
	if err = db.QueryRow(`SELECT count(*) FROM classes c CROSS JOIN LATERAL jsonb_array_elements_text(c.level_progression#>'{5,effects}') e WHERE c.card_number IN ('CLASS-bard','CLASS-cleric','CLASS-druid') AND e.value LIKE '17900000-0000-4000-8000-%'`).Scan(&duplicateAdds); err != nil {
		t.Fatal(err)
	}
	if duplicateAdds != 3 {
		t.Fatalf("idempotency: level-5 bonus references=%d, want 3", duplicateAdds)
	}
}
