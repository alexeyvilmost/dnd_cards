package migrations

import (
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestGeneralFeatSignatureDenominatorAndPayloads(t *testing.T) {
	if generalFeatSignaturesMigrationVersion != "172_materialize_general_feat_signatures" {
		t.Fatal(generalFeatSignaturesMigrationVersion)
	}
	if len(generalFeatSignatures) != 33 {
		t.Fatalf("got %d", len(generalFeatSignatures))
	}
	if len(generalFeatActions) != 7 {
		t.Fatalf("actions=%d", len(generalFeatActions))
	}
	for _, a := range generalFeatActions {
		var payload map[string]any
		if err := json.Unmarshal([]byte(a.mechanics), &payload); err != nil {
			t.Fatalf("%s: %v", a.card, err)
		}
	}
	joined := ""
	for _, s := range generalFeatSignatures {
		joined += s.card + s.mechanics
	}
	for _, card := range []string{"FEAT-0026", "FEAT-0027", "FEAT-0031", "FEAT-0034", "FEAT-0039", "FEAT-0042", "FEAT-0052"} {
		if !strings.Contains(joined, card) {
			t.Fatalf("missing declaration feat %s", card)
		}
	}
	seen := map[string]bool{}
	for _, s := range generalFeatSignatures {
		if seen[s.card] {
			t.Fatalf("duplicate %s", s.card)
		}
		seen[s.card] = true
		var payload []any
		if err := json.Unmarshal([]byte(s.mechanics), &payload); err != nil {
			t.Fatalf("%s: %v", s.card, err)
		}
		if len(payload) == 0 || strings.Contains(s.mechanics, `"kind":"narrative"`) {
			t.Fatalf("non executable %s", s.card)
		}
	}
}

func TestGeneralFeatSignaturesMigrationAgainstPostgres(t *testing.T) {
	dsn := os.Getenv("GENERAL_FEAT_SIGNATURES_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set GENERAL_FEAT_SIGNATURES_TEST_DATABASE_URL")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = materializeGeneralFeatSignatures(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}
	var feats, untested int
	if err = db.QueryRow(`SELECT count(*),count(*) FILTER(WHERE e.support->>'status'='untested') FROM feats f JOIN effects e ON e.card_number='EFF-general-'||f.card_number WHERE f.card_number=ANY($1::text[])`, func() []string {
		out := make([]string, 0, len(generalFeatSignatures))
		for _, s := range generalFeatSignatures {
			out = append(out, s.card)
		}
		return out
	}()).Scan(&feats, &untested); err != nil {
		t.Fatal(err)
	}
	if feats != 33 || untested != 33 {
		t.Fatalf("feats=%d support=%d", feats, untested)
	}
	var actions, resources, poison int
	if err = db.QueryRow(`SELECT (SELECT count(*) FROM actions WHERE card_number=ANY($1::text[]) AND support->>'status'='untested'),(SELECT count(*) FROM resources WHERE resource_id IN ('poisoner_dose','chef_treat') AND deleted_at IS NULL),(SELECT count(*) FROM effects WHERE card_number='EFF-general-potent-poison' AND support->>'status'='untested')`, func() []string {
		out := make([]string, 0, len(generalFeatActions))
		for _, a := range generalFeatActions {
			out = append(out, a.card)
		}
		return out
	}()).Scan(&actions, &resources, &poison); err != nil {
		t.Fatal(err)
	}
	if actions != 7 || resources != 2 || poison != 1 {
		t.Fatalf("actions=%d resources=%d poison=%d", actions, resources, poison)
	}
	for _, s := range generalFeatSignatures {
		var signature []any
		if err = json.Unmarshal([]byte(s.mechanics), &signature); err != nil {
			t.Fatal(err)
		}
		var abilityCount, total int
		if err = db.QueryRow(`SELECT count(*) FILTER(WHERE item->>'id'='general_feat_ability_increase'),count(*) FROM jsonb_array_elements((SELECT mechanics->'effects' FROM effects WHERE card_number='EFF-general-'||$1)) item`, s.card).Scan(&abilityCount, &total); err != nil || abilityCount != 1 || total != len(signature)+1 {
			t.Fatalf("%s ability=%d total=%d want=%d err=%v", s.card, abilityCount, total, len(signature)+1, err)
		}
	}
}
