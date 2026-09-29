package migrations

import (
	"database/sql"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

const spellBond285 = "EFFECT-item-completion-0627-spell-bond"

func TestEffectClassification285ReviewedProductionInventory(t *testing.T) {
	manifest, hash, err := reviewedEffectClassification285()
	if err != nil || len(hash) != 64 {
		t.Fatalf("manifest: %s %v", hash, err)
	}
	counts, changed := map[string]int{}, 0
	for _, row := range manifest.Effects {
		counts[row.After]++
		if row.Before != row.After {
			changed++
			if row.CardNumber != spellBond285 || row.ID != "6644784a-127a-5ed6-ab95-55ff9456ec37" || row.Before != "item_effect" || row.After != "spell_effect" {
				t.Fatalf("unexpected production correction: %+v", row)
			}
		}
	}
	if changed != 1 || !reflect.DeepEqual(counts, map[string]int{"feat_ability": 12, "item_effect": 31, "spell_effect": 11}) {
		t.Fatalf("counts=%v changed=%d", counts, changed)
	}
	var audit struct {
		BaselineHash string `json:"baseline_manifest_sha256"`
		Effects      []struct {
			MechanicalEvidence []json.RawMessage `json:"mechanical_evidence"`
			OriginEvidence     []json.RawMessage `json:"origin_evidence"`
		} `json:"effects"`
	}
	if err := json.Unmarshal(effectClassification285ManifestJSON, &audit); err != nil {
		t.Fatal(err)
	}
	_, baselineHash, err := reviewedEffectClassification278()
	if err != nil || baselineHash != audit.BaselineHash {
		t.Fatalf("original 707-row manifest changed: %s %s %v", baselineHash, audit.BaselineHash, err)
	}
	for index, row := range audit.Effects {
		if len(row.MechanicalEvidence) == 0 || len(row.OriginEvidence) == 0 {
			t.Fatalf("missing mechanical provenance for reviewed effect %d", index)
		}
	}
}

func effectClassification285Fixture(t *testing.T) *sql.DB {
	t.Helper()
	db, _ := effectClassification278Fixture(t)
	manifest, _, err := reviewedEffectClassification285()
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range manifest.Effects {
		if _, err := db.Exec(`INSERT INTO effects(id,card_number,effect_type,name,type,script,legacy_tags,mechanics,description)
			VALUES($1,$2,$3,$4,'Preserved selector','Preserved script','["frozen"]',
			'{"effects":[{"kind":"grant_action","value":"ACTION-preserved"}]}','Preserved description')`, row.ID, row.CardNumber, row.Before, row.Name); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`UPDATE effects SET support='{"status":"partial_narrative_verified","note":"Manual review preserved"}';
		ALTER TABLE effects DISABLE TRIGGER invalidate_effects_support;
		UPDATE effects SET support=NULL WHERE card_number='EFFECT-item-completion-0627-spell-bond';
		ALTER TABLE effects ENABLE TRIGGER invalidate_effects_support`); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestEffectClassification285PreservesDataAndFutureEdits(t *testing.T) {
	db := effectClassification285Fixture(t)
	protected := `SELECT jsonb_agg(to_jsonb(e)-ARRAY['effect_type','updated_at']::text[] ORDER BY card_number)::text FROM effects e`
	before := effect278Snapshot(t, db, protected)
	edges := `SELECT jsonb_agg(to_jsonb(e) ORDER BY source_id,path)::text FROM entity_reference_edges e`
	indexBefore := effect278Snapshot(t, db, edges)
	historyBefore := effect278Snapshot(t, db, `SELECT payload::text FROM effect278_history`)
	if err := classifyProductionEffects285(db); err != nil {
		t.Fatal(err)
	}
	if effect278Snapshot(t, db, protected) != before || effect278Snapshot(t, db, edges) != indexBefore || effect278Snapshot(t, db, `SELECT payload::text FROM effect278_history`) != historyBefore {
		t.Fatal("classification changed protected catalog data, reference mechanics, manual review or history")
	}
	if got := effect278Snapshot(t, db, `SELECT effect_type FROM effects WHERE card_number='EFFECT-item-completion-0627-spell-bond'`); got != "spell_effect" {
		t.Fatalf("spell bond type=%s", got)
	}
	if got := effect278Snapshot(t, db, `SELECT effect_type FROM effects WHERE card_number='EFFECT-item-completion-0627-ring-bond'`); got != "item_effect" {
		t.Fatalf("ring bond type=%s", got)
	}
	if got := effect278Snapshot(t, db, `SELECT concat_ws('/',reviewed_count,matched_count,changed_count,skipped_count) FROM effect_classification_285_runs`); got != "54/54/1/0" {
		t.Fatalf("receipt=%s", got)
	}
	if got := effect278Snapshot(t, db, `SELECT count(*)::text FROM effect_classification_285_audit`); got != "54" {
		t.Fatalf("audit count=%s", got)
	}
	if got := effect278Snapshot(t, db, `SELECT tgenabled::text FROM pg_trigger WHERE tgrelid='effects'::regclass AND tgname='invalidate_effects_support'`); got != "O" {
		t.Fatalf("review trigger was not restored: %s", got)
	}
	if _, err := db.Exec(`UPDATE effects SET effect_type='conditional' WHERE card_number='EFFECT-item-completion-0627-spell-bond'`); err != nil {
		t.Fatal(err)
	}
	allFields := `SELECT jsonb_agg(to_jsonb(e) ORDER BY card_number)::text FROM effects e`
	beforeReplay := effect278Snapshot(t, db, allFields)
	if err := classifyProductionEffects285(db); err != nil {
		t.Fatal(err)
	}
	if effect278Snapshot(t, db, allFields) != beforeReplay {
		t.Fatal("repeat overwrote later classification")
	}
}

func TestEffectClassification285RollsBackConflicts(t *testing.T) {
	for _, conflict := range []string{"type", "identity", "protected_data"} {
		t.Run(conflict, func(t *testing.T) {
			db := effectClassification285Fixture(t)
			query := `UPDATE effects SET effect_type='passive' WHERE card_number='EFFECT-spell-audit-witch-bolt'`
			if conflict == "identity" {
				query = `UPDATE effects SET card_number='WRONG-IDENTITY' WHERE card_number='EFFECT-spell-audit-witch-bolt'`
			} else if conflict == "protected_data" {
				query = `CREATE FUNCTION mutate_effect285() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.description='Unexpected mutation'; RETURN NEW; END $$;
				CREATE TRIGGER mutate_effect285 BEFORE UPDATE OF effect_type ON effects FOR EACH ROW EXECUTE FUNCTION mutate_effect285()`
			}
			if _, err := db.Exec(query); err != nil {
				t.Fatal(err)
			}
			allFields := `SELECT jsonb_agg(to_jsonb(e) ORDER BY card_number)::text FROM effects e`
			before := effect278Snapshot(t, db, allFields)
			if err := classifyProductionEffects285(db); err == nil || !strings.Contains(err.Error(), "migration 285") {
				t.Fatalf("expected reviewed classification failure, got %v", err)
			}
			if effect278Snapshot(t, db, allFields) != before {
				t.Fatal("failed migration changed catalog data")
			}
			if got := effect278Snapshot(t, db, `SELECT tgenabled::text FROM pg_trigger WHERE tgrelid='effects'::regclass AND tgname='invalidate_effects_support'`); got != "O" {
				t.Fatalf("rollback did not restore trigger: %s", got)
			}
			if got := effect278Snapshot(t, db, `SELECT (to_regclass('effect_classification_285_runs') IS NULL)::text`); got != "true" {
				t.Fatal("failed migration left a receipt")
			}
		})
	}
}

func TestEffectClassification285SkipsAbsentAndRemovedEffects(t *testing.T) {
	db := effectClassification285Fixture(t)
	if _, err := db.Exec(`DELETE FROM effects WHERE card_number='EFF-audit-FEAT-0064';
		UPDATE effects SET deleted_at=now() WHERE card_number='EFFECT-item-completion-0627-ring-bond'`); err != nil {
		t.Fatal(err)
	}
	if err := classifyProductionEffects285(db); err != nil {
		t.Fatal(err)
	}
	if got := effect278Snapshot(t, db, `SELECT concat_ws('/',reviewed_count,matched_count,changed_count,skipped_count) FROM effect_classification_285_runs`); got != "54/52/1/2" {
		t.Fatalf("receipt=%s", got)
	}
}
