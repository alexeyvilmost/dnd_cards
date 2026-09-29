package migrations

import (
	"database/sql"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestEffectClassification278ManifestCoversReviewedInventory(t *testing.T) {
	manifest, hash, err := reviewedEffectClassification278()
	if err != nil || len(hash) != 64 {
		t.Fatalf("manifest: %s %v", hash, err)
	}
	counts, changed := map[string]int{}, 0
	byNumber := map[string]effectClassification278Row{}
	for _, row := range manifest.Effects {
		counts[row.After]++
		byNumber[row.CardNumber] = row
		if row.Before != row.After {
			changed++
		}
	}
	want := map[string]int{"class_ability": 388, "species_ability": 75, "feat_ability": 63, "eldritch_invocation": 21, "fighting_style": 15, "weapon_mastery": 8, "run_aura": 5, "spell_effect": 95, "item_effect": 8, "condition": 16, "passive": 3, "maneuver_variant": 10}
	if !reflect.DeepEqual(counts, want) || changed != 238 {
		t.Fatalf("counts=%v changed=%d", counts, changed)
	}
	for number, wantType := range map[string]string{"EFF-eldritch-invocations": "class_ability", "EFF-pact-blade": "eldritch_invocation", "EFF-metamagic": "class_ability", "EFFECT-metamagic-careful": "maneuver_variant", "EFF-druidic-warrior": "class_ability", "RL-ME-GOBLIN-ADVANTAGE": "passive", "EFFECT-0259": "passive", "EFFECT-wild-shape-rat": "class_ability"} {
		if byNumber[number].After != wantType {
			t.Fatalf("%s: got %s want %s", number, byNumber[number].After, wantType)
		}
	}
}

func effectClassification278Fixture(t *testing.T) (*sql.DB, map[string]effectClassification278Row) {
	t.Helper()
	db := openIsolatedPostgresSchema(t, "EFFECT_CLASSIFICATION_TEST_DATABASE_URL")
	for _, table := range manualContentReviewTables {
		identity := "id uuid PRIMARY KEY"
		if table == "passive_presentations" {
			identity = "key text PRIMARY KEY"
		}
		extra := ""
		if table == "effects" {
			extra = fmt.Sprintf(",card_number text UNIQUE,effect_type text CONSTRAINT effects_effect_type_check CHECK (effect_type IN (%s)),type text,script text,legacy_tags jsonb", effectTypeCheckValues)
		}
		if _, err := db.Exec(fmt.Sprintf(`CREATE TABLE %s (%s,name text,mechanics jsonb,description text,support jsonb,deleted_at timestamptz,updated_at timestamptz DEFAULT now()%s)`, table, identity, extra)); err != nil {
			t.Fatal(err)
		}
	}
	if err := enableManualContentReview274(db); err != nil {
		t.Fatal(err)
	}
	if err := enableEntityReferences277(db); err != nil {
		t.Fatal(err)
	}
	manifest, _, err := reviewedEffectClassification278()
	if err != nil {
		t.Fatal(err)
	}
	byNumber := map[string]effectClassification278Row{}
	for _, row := range manifest.Effects {
		byNumber[row.CardNumber] = row
	}
	for _, number := range []string{"asi_ability_choice", "EFF-invoc-agonizing_blast", "EFFECT-0248", "COND-blinded", "effect_style_archery"} {
		row := byNumber[number]
		if _, err := db.Exec(`INSERT INTO effects(id,card_number,effect_type,name,type,script,legacy_tags,mechanics,description)
			VALUES($1,$2,$3,$4,'Legacy selector','unchanged script','["frozen"]','{"effects":[{"kind":"grant_action","value":"ACTION-preserved"}]}','Original description')`, row.ID, row.CardNumber, row.Before, row.Name); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`UPDATE effects SET support='{"status":"verified","note":"Human review"}' WHERE card_number IN ('asi_ability_choice','EFFECT-0248');
		UPDATE effects SET support=NULL WHERE card_number='EFF-invoc-agonizing_blast';
		UPDATE effects SET deleted_at=now() WHERE card_number='effect_style_archery';
		INSERT INTO effects(id,card_number,effect_type,name,mechanics) VALUES('27800000-0000-4000-8000-000000000001','FUTURE-UNKNOWN','passive','Unreviewed future record','{}');
		CREATE TABLE effect278_history(id integer PRIMARY KEY,payload jsonb);
		INSERT INTO effect278_history VALUES(1,'{"effect_type":"passive","support":{"content_hash":"historical"}}')`); err != nil {
		t.Fatal(err)
	}
	// Production's newer validator preserves pre-existing legacy NULL support
	// but rejects explicitly assigning it during an ordinary update.
	if err := extendManualContentReview277(db); err != nil {
		t.Fatal(err)
	}
	return db, byNumber
}

func effect278Snapshot(t *testing.T, db *sql.DB, query string) string {
	t.Helper()
	var result string
	if err := db.QueryRow(query).Scan(&result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestEffectClassification278PreservesMechanicsReviewHistoryAndFutureEdits(t *testing.T) {
	db, _ := effectClassification278Fixture(t)
	protected := `SELECT jsonb_agg(to_jsonb(e)-ARRAY['effect_type','updated_at']::text[] ORDER BY card_number)::text FROM effects e`
	before := effect278Snapshot(t, db, protected)
	indexBefore := effect278Snapshot(t, db, `SELECT jsonb_agg(to_jsonb(e) ORDER BY source_id)::text FROM entity_reference_edges e`)
	historyBefore := effect278Snapshot(t, db, `SELECT payload::text FROM effect278_history`)
	if err := classifyLibraryEffects278(db); err != nil {
		t.Fatal(err)
	}
	if after := effect278Snapshot(t, db, protected); after != before {
		t.Fatal("mechanics, identity, manual review, freeform type or legacy tags changed")
	}
	if effect278Snapshot(t, db, `SELECT jsonb_agg(to_jsonb(e) ORDER BY source_id)::text FROM entity_reference_edges e`) != indexBefore || effect278Snapshot(t, db, `SELECT payload::text FROM effect278_history`) != historyBefore {
		t.Fatal("reference mechanics or historical artifacts changed")
	}
	var reviewed, matched, changed, skipped int
	if err := db.QueryRow(`SELECT reviewed_count,matched_count,changed_count,skipped_count FROM effect_classification_278_runs`).Scan(&reviewed, &matched, &changed, &skipped); err != nil || reviewed != 707 || matched != 4 || changed != 3 || skipped != 703 {
		t.Fatalf("run=%d/%d/%d/%d: %v", reviewed, matched, changed, skipped, err)
	}
	for number, want := range map[string]string{"asi_ability_choice": "feat_ability", "EFF-invoc-agonizing_blast": "eldritch_invocation", "EFFECT-0248": "weapon_mastery", "COND-blinded": "condition", "effect_style_archery": "passive", "FUTURE-UNKNOWN": "passive"} {
		var got string
		if err := db.QueryRow(`SELECT effect_type FROM effects WHERE card_number=$1`, number).Scan(&got); err != nil || got != want {
			t.Fatalf("%s: got %s want %s: %v", number, got, want, err)
		}
	}
	if _, err := db.Exec(`UPDATE effects SET effect_type='unregistered_category' WHERE card_number='FUTURE-UNKNOWN'`); err == nil {
		t.Fatal("new enum must continue to reject unknown categories")
	}
	if _, err := db.Exec(`UPDATE effects SET effect_type='conditional' WHERE card_number='EFFECT-0248'`); err != nil {
		t.Fatal(err)
	}
	beforeReplay := effect278Snapshot(t, db, `SELECT jsonb_agg(to_jsonb(e) ORDER BY card_number)::text FROM effects e`)
	if err := classifyLibraryEffects278(db); err != nil {
		t.Fatal(err)
	}
	if effect278Snapshot(t, db, `SELECT jsonb_agg(to_jsonb(e) ORDER BY card_number)::text FROM effects e`) != beforeReplay {
		t.Fatal("replay overwrote a later editorial decision")
	}
}

func TestEffectClassification278RejectsConflictsAtomically(t *testing.T) {
	for _, conflict := range []string{"type", "identity"} {
		t.Run(conflict, func(t *testing.T) {
			db, _ := effectClassification278Fixture(t)
			query := `UPDATE effects SET effect_type='item_effect' WHERE card_number='EFF-invoc-agonizing_blast'`
			if conflict == "identity" {
				query = `UPDATE effects SET card_number='CHANGED-IDENTITY' WHERE card_number='EFF-invoc-agonizing_blast'`
			}
			if _, err := db.Exec(query); err != nil {
				t.Fatal(err)
			}
			before := effect278Snapshot(t, db, `SELECT jsonb_agg(to_jsonb(e) ORDER BY card_number)::text FROM effects e`)
			if err := classifyLibraryEffects278(db); err == nil || !strings.Contains(err.Error(), "migration 278") {
				t.Fatalf("expected guarded conflict, got %v", err)
			}
			if effect278Snapshot(t, db, `SELECT jsonb_agg(to_jsonb(e) ORDER BY card_number)::text FROM effects e`) != before {
				t.Fatal("failed classification partially changed earlier entities")
			}
			if state := effect278Snapshot(t, db, `SELECT tgenabled::text FROM pg_trigger WHERE tgrelid='effects'::regclass AND tgname='invalidate_effects_support'`); state != "O" {
				t.Fatalf("rollback changed review trigger state: %s", state)
			}
		})
	}
}

func TestEffectClassification278PreservesExactReviewTriggerState(t *testing.T) {
	for state, statement := range map[string]string{
		"O": `ALTER TABLE effects ENABLE TRIGGER invalidate_effects_support`,
		"D": `ALTER TABLE effects DISABLE TRIGGER invalidate_effects_support`,
		"R": `ALTER TABLE effects ENABLE REPLICA TRIGGER invalidate_effects_support`,
		"A": `ALTER TABLE effects ENABLE ALWAYS TRIGGER invalidate_effects_support`,
	} {
		t.Run(state, func(t *testing.T) {
			db, _ := effectClassification278Fixture(t)
			if _, err := db.Exec(statement); err != nil {
				t.Fatal(err)
			}
			before := effect278Snapshot(t, db, `SELECT jsonb_agg(support ORDER BY card_number)::text FROM effects`)
			if err := classifyLibraryEffects278(db); err != nil {
				t.Fatal(err)
			}
			if got := effect278Snapshot(t, db, `SELECT tgenabled::text FROM pg_trigger WHERE tgrelid='effects'::regclass AND tgname='invalidate_effects_support'`); got != state {
				t.Fatalf("trigger state %s, want %s", got, state)
			}
			if got := effect278Snapshot(t, db, `SELECT jsonb_agg(support ORDER BY card_number)::text FROM effects`); got != before {
				t.Fatal("classification changed manual review metadata")
			}
		})
	}
}
