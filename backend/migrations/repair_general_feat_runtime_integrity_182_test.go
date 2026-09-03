package migrations

import (
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestGeneralFeatRuntimeIntegrityDeclarations(t *testing.T) {
	if generalFeatRuntimeIntegrityVersion != "182_repair_general_feat_runtime_integrity" {
		t.Fatal(generalFeatRuntimeIntegrityVersion)
	}
	if len(inspiringLeaderActionSeeds) != 2 {
		t.Fatalf("Inspiring Leader variants=%d, want 2", len(inspiringLeaderActionSeeds))
	}
	if len(generalFeatRuntimeActionSeeds) != 6 {
		t.Fatalf("additional General-feat actions=%d, want 6", len(generalFeatRuntimeActionSeeds))
	}
	for _, seed := range generalFeatRuntimeActionSeeds {
		var action map[string]any
		if err := json.Unmarshal([]byte(seed.mechanics), &action); err != nil {
			t.Fatalf("%s: %v", seed.card, err)
		}
	}
	joined := strings.Join([]string{
		generalFeatRuntimeActionSeeds[0].mechanics,
		generalFeatRuntimeActionSeeds[1].mechanics,
		generalFeatRuntimeActionSeeds[2].mechanics,
		generalFeatRuntimeActionSeeds[3].mechanics,
		generalFeatRuntimeActionSeeds[4].mechanics,
		generalFeatRuntimeActionSeeds[5].mechanics,
	}, "\n")
	for _, want := range []string{
		`"feat_defensive_duelist":true`, `"feat_requires_shield":true`,
		`"resolution":"save"`, `"value":"COND-prone"`,
		`"feat_charger":true`, `"feat_sentinel_opportunity":true`,
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("additional runtime action declarations miss %s", want)
		}
	}
	if strings.Contains(joined, `"resolution":"saving_throw"`) {
		t.Fatal("General-feat save actions must use the executable save resolution")
	}
	var effect map[string]any
	if err := json.Unmarshal([]byte(inspiringLeaderMechanics), &effect); err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(effect)
	for _, want := range []string{
		`"general_feat_ability_increase"`, `"ACT-general-inspiring-leader-wis"`,
		`"ACT-general-inspiring-leader-cha"`, `"inspiring_leader_rest"`,
	} {
		if !strings.Contains(string(encoded), want) {
			t.Errorf("Inspiring Leader effect misses %s", want)
		}
	}
	for _, seed := range inspiringLeaderActionSeeds {
		var action map[string]any
		payload := inspiringLeaderActionMechanics(seed.ability)
		if err := json.Unmarshal([]byte(payload), &action); err != nil {
			t.Fatalf("%s: %v", seed.card, err)
		}
		if !strings.Contains(payload, `"amount":"self_level + `+seed.ability+`"`) {
			t.Errorf("%s does not bind its selected ability", seed.card)
		}
	}
	var durable map[string]any
	if err := json.Unmarshal([]byte(durableActionMechanics), &durable); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(durableActionMechanics, `"hit_die_modifier":"con"`) ||
		strings.Contains(durableActionMechanics, "prof_bonus") {
		t.Fatal("Durable must use Constitution and never substitute proficiency")
	}
	if !strings.Contains(generalFeatRuntimeIntegrityVersion, "182_") {
		t.Fatal("runtime repair must remain isolated to migration 182")
	}
}

func TestGeneralFeatRuntimeIntegrityProductionClone(t *testing.T) {
	dsn := os.Getenv("GENERAL_FEAT_RUNTIME_INTEGRITY_CLONE_DSN")
	if dsn == "" {
		t.Skip("GENERAL_FEAT_RUNTIME_INTEGRITY_CLONE_DSN is not configured")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = repairGeneralFeatRuntimeIntegrity(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}
	var actions, runtimeActions, effects, feats, additionalEffects, additionalFeats int
	var resources, piercer, slasher, sentinel, asi, asiEffect int
	if err = db.QueryRow(`SELECT
		(SELECT count(*) FROM actions WHERE card_number IN
			 ('ACT-general-inspiring-leader-wis','ACT-general-inspiring-leader-cha','ACT-general-durable')
			 AND deleted_at IS NULL AND support->>'status'='untested'),
		(SELECT count(*) FROM actions WHERE card_number IN
			 ('ACT-general-defensive-duelist','ACT-general-shield-master-push','ACT-general-shield-master-prone',
			 'ACT-general-charger-damage','ACT-general-charger-push','ACT-general-sentinel-stop')
			 AND deleted_at IS NULL AND support->>'certification_version'=$1),
		(SELECT count(*) FROM effects WHERE card_number IN
		 ('EFF-general-FEAT-0011','EFF-general-FEAT-0020','EFF-general-FEAT-0026','EFF-general-FEAT-0030','EFF-general-FEAT-0038','EFF-general-FEAT-0042','EFF-general-FEAT-0044','EFF-general-FEAT-0052')
		 AND deleted_at IS NULL AND support->>'certification_version'=$1),
		(SELECT count(*) FROM feats WHERE card_number IN ('FEAT-0011','FEAT-0020','FEAT-0026','FEAT-0030','FEAT-0038','FEAT-0042','FEAT-0044','FEAT-0052')
			 AND deleted_at IS NULL AND support->>'status'='untested'),
		(SELECT count(*) FROM effects WHERE card_number IN
			 ('EFF-general-FEAT-0012','EFF-general-FEAT-0015','EFF-general-FEAT-0032',
			 'EFF-general-FEAT-0035','EFF-general-FEAT-0036','EFF-general-FEAT-0045')
			 AND deleted_at IS NULL AND support->>'certification_version'=$1),
		(SELECT count(*) FROM feats WHERE card_number IN
			 ('FEAT-0012','FEAT-0015','FEAT-0032','FEAT-0035','FEAT-0036','FEAT-0045')
			 AND deleted_at IS NULL AND support->>'certification_version'=$1),
		(SELECT count(*) FROM resources WHERE resource_id='inspiring_leader_rest' AND deleted_at IS NULL),
		(SELECT count(*) FROM effects WHERE card_number='EFF-general-FEAT-0039' AND deleted_at IS NULL
		 AND mechanics#>>'{effects,1,result,1,op}'='critical_extra_die'
		 AND mechanics#>>'{effects,1,result,1,applies_to,filter,critical}'='true'
		 AND support->>'certification_version'=$1),
		(SELECT count(*) FROM effects WHERE card_number='EFF-general-slasher-slow' AND deleted_at IS NULL
			 AND mechanics#>>'{duration,type}'='until_start_of_source_next_turn'
			 AND support->>'certification_version'=$1),
		(SELECT count(*) FROM effects WHERE card_number='EFF-general-sentinel-stop' AND deleted_at IS NULL
			 AND mechanics#>>'{effects,0,result,0,applies_to,roll}'='speed'
			 AND mechanics#>>'{effects,0,result,0,op}'='set'
			 AND mechanics#>>'{effects,0,result,0,value}'='0'
			 AND support->>'certification_version'=$1),
		(SELECT count(*) FROM feats WHERE card_number='FEAT-0049' AND deleted_at IS NULL
			 AND jsonb_typeof(support)='object' AND support->>'certification_version'=$1),
		(SELECT count(*) FROM effects WHERE card_number='asi_ability_choice' AND deleted_at IS NULL
			 AND mechanics#>>'{effects,0,options,items,0,id}'='plus2'
			 AND mechanics#>>'{effects,0,options,items,1,id}'='plus1x2'
			 AND jsonb_typeof(support)='object' AND support->>'certification_version'=$1)`,
		generalFeatRuntimeIntegrityVersion).Scan(
		&actions, &runtimeActions, &effects, &feats, &additionalEffects, &additionalFeats,
		&resources, &piercer, &slasher, &sentinel, &asi, &asiEffect,
	); err != nil {
		t.Fatal(err)
	}
	if actions != 3 || runtimeActions != 6 || effects != 8 || feats != 8 ||
		additionalEffects != 6 || additionalFeats != 6 || resources != 1 ||
		piercer != 1 || slasher != 1 || sentinel != 1 || asi != 1 || asiEffect != 1 {
		t.Fatalf("actions=%d runtimeActions=%d effects=%d feats=%d additionalEffects=%d additionalFeats=%d resources=%d piercer=%d slasher=%d sentinel=%d asi=%d asiEffect=%d",
			actions, runtimeActions, effects, feats, additionalEffects, additionalFeats,
			resources, piercer, slasher, sentinel, asi, asiEffect)
	}
}
