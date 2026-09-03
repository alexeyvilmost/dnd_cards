package migrations

import (
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestSpeciesLevelFiveIntegrityDeclarations(t *testing.T) {
	if speciesLevelFiveIntegrityVersion != "183_repair_species_level_five_integrity" {
		t.Fatalf("unexpected version %q", speciesLevelFiveIntegrityVersion)
	}
	var action map[string]any
	if err := json.Unmarshal([]byte(aasimarRevelationActionMechanics), &action); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(aasimarRevelationActionMechanics, `"kind":"narrative"`) {
		t.Fatal("Celestial Revelation must not retain narrative-only branches")
	}
	for _, card := range []string{"RE-sub-wings", "RE-sub-radiance", "RE-sub-necrotic"} {
		if !strings.Contains(aasimarRevelationActionMechanics, `"kind":"grant_effect","value":"`+card+`"`) {
			t.Errorf("Celestial Revelation does not grant %s", card)
		}
	}
	if len(aasimarRevelationEffectRepairs) != 3 {
		t.Fatalf("Aasimar effect repairs=%d, want 3", len(aasimarRevelationEffectRepairs))
	}
	for _, repair := range aasimarRevelationEffectRepairs {
		var mechanics map[string]any
		if err := json.Unmarshal([]byte(repair.mechanics), &mechanics); err != nil {
			t.Fatalf("%s: %v", repair.card, err)
		}
		if !strings.Contains(repair.mechanics, `"kind":"damage_rider"`) ||
			!strings.Contains(repair.mechanics, `"once_per_turn":"aasimar:celestial-revelation:damage"`) {
			t.Errorf("%s lacks the bounded revelation damage rider", repair.card)
		}
		if strings.TrimSpace(repair.note) == "" {
			t.Errorf("%s must disclose its remaining runtime boundary", repair.card)
		}
	}
	var large map[string]any
	if err := json.Unmarshal([]byte(goliathLargeFormEffectMechanics), &large); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`"op":"set","value":3,"applies_to":{"roll":"size"}`,
		`"op":"add","value":10,"applies_to":{"roll":"speed"}`,
		`"op":"advantage","applies_to":{"roll":"ability_check","filter":{"ability":"str"}}`,
	} {
		if !strings.Contains(goliathLargeFormEffectMechanics, want) {
			t.Errorf("Goliath Large Form misses %s", want)
		}
	}
}

func TestSpeciesLevelFiveIntegrityProductionClone(t *testing.T) {
	dsn := os.Getenv("SPECIES_LEVEL_FIVE_INTEGRITY_CLONE_DSN")
	if dsn == "" {
		t.Skip("SPECIES_LEVEL_FIVE_INTEGRITY_CLONE_DSN is not configured")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = repairSpeciesLevelFiveIntegrity(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}

	var options, grants, revelationEffects, largeForm, staleCertified, obsoleteRefs, wrapperRefs int
	if err = db.QueryRow(`SELECT
		(SELECT jsonb_array_length(mechanics#>'{effects,0,options,items}') FROM actions
		 WHERE card_number='ACT-aasimar-revelation' AND deleted_at IS NULL),
		(SELECT count(*) FROM actions a
		 CROSS JOIN LATERAL jsonb_array_elements(a.mechanics#>'{effects,0,options,items}') item
		 CROSS JOIN LATERAL jsonb_array_elements(item->'grants') grant_payload
		 WHERE a.card_number='ACT-aasimar-revelation' AND a.deleted_at IS NULL
		 AND grant_payload->>'kind'='grant_effect'),
		(SELECT count(*) FROM effects WHERE card_number=ANY(ARRAY['RE-sub-wings','RE-sub-radiance','RE-sub-necrotic'])
		 AND deleted_at IS NULL AND support->>'status'='untested'
		 AND mechanics::text LIKE '%"kind": "damage_rider"%'),
		(SELECT count(*) FROM effects WHERE card_number='EFFECT-goliath-large-form'
		 AND deleted_at IS NULL AND mechanics#>>'{duration,amount}'='10'
		 AND mechanics::text LIKE '%"roll": "size"%'
		 AND mechanics::text LIKE '%"roll": "speed"%'),
		(SELECT count(*) FROM effects WHERE card_number=ANY(ARRAY[
		  'RE-aasimar-5','RE-tiefling-3','RE-goliath-2','RE-sub-cloud','RE-sub-fire',
		  'RE-sub-frost','RE-sub-hill','RE-sub-storm','RE-halfling-2','RE-halfling-4','RE-sub-rock'])
		 AND deleted_at IS NULL AND support->>'status' LIKE 'verified%'),
		(SELECT count(*) FROM races r CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(r.related_effects,'[]')) ref
		 JOIN effects e ON e.id::text=ref
		 WHERE e.card_number=ANY(ARRAY['RE-aasimar-5','RE-tiefling-3','RE-goliath-2'])),
		(SELECT count(*) FROM races r CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(r.related_effects,'[]')) ref
		 JOIN effects e ON e.id::text=ref
		 WHERE e.card_number=ANY(ARRAY['RE-sub-cloud','RE-sub-fire','RE-sub-frost','RE-sub-hill','RE-sub-storm']))`).
		Scan(&options, &grants, &revelationEffects, &largeForm, &staleCertified, &obsoleteRefs, &wrapperRefs); err != nil {
		t.Fatal(err)
	}
	if options != 3 || grants != 3 || revelationEffects != 3 || largeForm != 1 ||
		staleCertified != 0 || obsoleteRefs != 0 || wrapperRefs != 0 {
		t.Fatalf("options=%d grants=%d effects=%d large=%d stale=%d obsolete_refs=%d wrapper_refs=%d",
			options, grants, revelationEffects, largeForm, staleCertified, obsoleteRefs, wrapperRefs)
	}
}
