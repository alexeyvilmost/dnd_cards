package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestCombatSpellRepairs293ManifestMatchesReviewedSourceAndRegistration(t *testing.T) {
	manifest, err := loadCombatSpellRepairManifest293()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../scripts/content/data/combat-spell-repairs-20260930.json")
	if err != nil {
		t.Fatal(err)
	}
	var source []combatSpellRepair293
	if err := json.Unmarshal(raw, &source); err != nil {
		t.Fatal(err)
	}
	if len(source) != 4 || len(manifest.Entities) != len(source) {
		t.Fatal("reviewed source/embedded repair count differs")
	}
	for index, entity := range manifest.Entities {
		reviewed := source[index]
		actual, err := combatSpellRepairCanonical293(entity.Mechanics)
		if err != nil {
			t.Fatal(err)
		}
		expected, err := combatSpellRepairCanonical293(reviewed.Mechanics)
		if err != nil || string(actual) != string(expected) || entity.ID != reviewed.ID || entity.CardNumber != reviewed.CardNumber || entity.Name != reviewed.Name || entity.ExpectedBefore != reviewed.ExpectedBefore {
			t.Fatalf("embedded/source combat repair drift: %s: %v", entity.CardNumber, err)
		}
		if got := levelTwoCertificationHash(string(actual)); got != entity.ExpectedAfter {
			t.Fatalf("JavaScript generated postimage hash differs: %s %s", entity.CardNumber, got)
		}
	}
	registered := GetAllMigrations()
	count := 0
	for index, migration := range registered {
		if strings.HasPrefix(migration.Version, "293_") {
			count++
			if migration.Version != combatSpellRepairs293Version || index == 0 || registered[index-1].Version != "292_critical_spell_animations" {
				t.Fatal("combat repairs must own 293 directly after 292")
			}
		}
	}
	if count != 1 {
		t.Fatalf("293 registrations: %d", count)
	}
}

func TestCombatSpellRepairs293CanonicalJSONAndValidation(t *testing.T) {
	canonical, err := combatSpellRepairCanonical293([]byte(`{"\uffff":1,"😀":2,"n":-0,"html":"<>&","separator":"\u2028","literal":"\\u2028","b":1.0,"a":[true,null,"\n"]}`))
	want := "{\"a\":[true,null,\"\\n\"],\"b\":1,\"html\":\"<>&\",\"literal\":\"\\\\u2028\",\"n\":0,\"separator\":\"\u2028\",\"😀\":2,\"\uffff\":1}"
	if err != nil || string(canonical) != want {
		t.Fatalf("canonical JSON does not match JSON.stringify sorted UTF-16: %s %v", canonical, err)
	}
	for _, failure := range []string{"duplicate", "extra", "name", "preimage", "postimage", "mechanics"} {
		t.Run(failure, func(t *testing.T) {
			manifest, err := loadCombatSpellRepairManifest293()
			if err != nil {
				t.Fatal(err)
			}
			switch failure {
			case "duplicate":
				manifest.Entities[1] = manifest.Entities[0]
			case "extra":
				manifest.Entities = append(manifest.Entities, manifest.Entities[0])
			case "name":
				manifest.Entities[0].Name = "Unreviewed replacement"
			case "preimage":
				manifest.Entities[0].ExpectedBefore = "not-a-hash"
			case "postimage":
				manifest.Entities[0].ExpectedAfter = "sha256:" + strings.Repeat("0", 64)
			case "mechanics":
				manifest.Entities[0].Mechanics = json.RawMessage(`[]`)
			}
			if err := validateCombatSpellRepairManifest293(manifest); err == nil {
				t.Fatal("invalid combat repair manifest accepted")
			}
		})
	}
}

func combatSpellRepairFixture293(t *testing.T) (*sql.DB, combatSpellRepairManifest293) {
	t.Helper()
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	if _, err := db.Exec(`CREATE TABLE spells (
		id uuid PRIMARY KEY,card_number text,name text NOT NULL,name_en text,description text,source text,image_url text,
		mechanics jsonb,support jsonb,updated_at timestamptz NOT NULL DEFAULT NOW(),deleted_at timestamptz);
		CREATE TABLE combat_history(snapshot jsonb);
		INSERT INTO combat_history VALUES ('{"archived_catalog":{"mechanics":{"old":true},"support":{"status":"verified"}},"events":[1,2]}');`); err != nil {
		t.Fatal(err)
	}
	if err := extendManualContentReview277(db); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TRIGGER invalidate_spells_support BEFORE INSERT OR UPDATE ON spells
		FOR EACH ROW EXECUTE FUNCTION invalidate_content_support()`); err != nil {
		t.Fatal(err)
	}
	manifest, err := loadCombatSpellRepairManifest293()
	if err != nil {
		t.Fatal(err)
	}
	for index := range manifest.Entities {
		entity := &manifest.Entities[index]
		before := fmt.Sprintf(`{"activation":{"mode":"active"},"effects":[],"legacy_source":%d}`, index)
		entity.ExpectedBefore, err = combatSpellRepairHash293([]byte(before))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`INSERT INTO spells(id,card_number,name,name_en,description,source,image_url,mechanics)
			VALUES($1::uuid,$2,$3,'Original English','Original description','Original source','original.png',$4::jsonb)`, entity.ID, entity.CardNumber, entity.Name, before); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`UPDATE spells SET support='{"status":"verified_partial","evidence_id":"obsolete","custom_metadata":{"keep":true}}'::jsonb
			WHERE id=$1::uuid`, entity.ID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO spells(id,card_number,name,mechanics) VALUES
		('00000000-0000-4000-8000-000000000005','unrelated','Unrelated spell','{"untouched":true}');
		UPDATE spells SET support='{"status":"verified_partial"}' WHERE card_number='unrelated'`); err != nil {
		t.Fatal(err)
	}
	return db, manifest
}

func combatSpellRepairRows293(t *testing.T, db *sql.DB) string {
	t.Helper()
	var result string
	if err := db.QueryRow(`SELECT jsonb_agg(to_jsonb(s) ORDER BY id)::text FROM spells s`).Scan(&result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestCombatSpellRepairs293AppliesAtomicallyArchivesAndRepeatsWithoutReviewReset(t *testing.T) {
	db, manifest := combatSpellRepairFixture293(t)
	for _, entity := range manifest.Entities {
		if entity.CardNumber == "SPELL-0260" {
			// Already applied by an authorized earlier workflow: preserve its
			// later manual assessment rather than falsely invalidate it again.
			if _, err := db.Exec(`UPDATE spells SET mechanics=$1::jsonb WHERE id=$2::uuid`, string(entity.Mechanics), entity.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`UPDATE spells SET support='{"status":"partial_narrative_verified_partial"}' WHERE id=$1::uuid`, entity.ID); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := applyCombatSpellRepairManifest293(db, manifest); err != nil {
		t.Fatal(err)
	}
	for _, entity := range manifest.Entities {
		var raw []byte
		var status string
		var retained bool
		if err := db.QueryRow(`SELECT mechanics,support->>'status',name_en='Original English' AND description='Original description'
			AND source='Original source' AND image_url='original.png' FROM spells WHERE id=$1::uuid`, entity.ID).Scan(&raw, &status, &retained); err != nil {
			t.Fatal(err)
		}
		got, err := combatSpellRepairHash293(raw)
		if err != nil || got != entity.ExpectedAfter || !retained {
			t.Fatalf("wrong postimage or presentation metadata %s %s %v", entity.CardNumber, got, err)
		}
		want := "not_verified"
		if entity.CardNumber == "SPELL-0260" {
			want = "partial_narrative_verified_partial"
		}
		if status != want {
			t.Fatalf("invalid automatic review %s: %s", entity.CardNumber, status)
		}
	}
	var count, changed int
	if err := db.QueryRow(`SELECT count(*),count(*) FILTER(WHERE changed) FROM combat_spell_repairs_293_archive`).Scan(&count, &changed); err != nil || count != 4 || changed != 3 {
		t.Fatalf("wrong archive count %d changed %d: %v", count, changed, err)
	}
	var valid bool
	if err := db.QueryRow(`SELECT bool_and(before_row->'mechanics'=before_mechanics AND before_row->'support'=before_support
		AND before_row->>'image_url'='original.png' AND before_row->>'description'='Original description')
		FROM combat_spell_repairs_293_archive`).Scan(&valid); err != nil || !valid {
		t.Fatal("full prior row/mechanics/support were not archived", err)
	}
	if err := db.QueryRow(`SELECT snapshot='{"archived_catalog":{"mechanics":{"old":true},"support":{"status":"verified"}},"events":[1,2]}'::jsonb
		FROM combat_history`).Scan(&valid); err != nil || !valid {
		t.Fatal("historical combat snapshot changed", err)
	}
	if err := db.QueryRow(`SELECT mechanics='{"untouched":true}'::jsonb AND support->>'status'='verified_partial'
		FROM spells WHERE card_number='unrelated'`).Scan(&valid); err != nil || !valid {
		t.Fatal("unrelated spell changed", err)
	}
	if _, err := db.Exec(`UPDATE spells SET support='{"status":"verified_partial","human_note":"retained"}' WHERE card_number='SPELL-0164'`); err != nil {
		t.Fatal(err)
	}
	beforeRepeat := combatSpellRepairRows293(t, db)
	if err := applyCombatSpellRepairManifest293(db, manifest); err != nil {
		t.Fatal(err)
	}
	if combatSpellRepairRows293(t, db) != beforeRepeat {
		t.Fatal("repeat changed committed mechanics, timestamps or later manual review")
	}
	if err := db.QueryRow(`SELECT count(*) FROM combat_spell_repairs_293_transition`).Scan(&count); err != nil || count != 1 {
		t.Fatal("repeat duplicated transition receipt", count, err)
	}
	modifiedManifest := manifest
	modifiedManifest.Entities = append([]combatSpellRepair293(nil), manifest.Entities...)
	modifiedManifest.Entities[0].ExpectedBefore = "sha256:" + strings.Repeat("0", 64)
	if err := applyCombatSpellRepairManifest293(db, modifiedManifest); err == nil || !strings.Contains(err.Error(), "manifest changed") {
		t.Fatal("changed completed manifest accepted", err)
	}
	if combatSpellRepairRows293(t, db) != beforeRepeat {
		t.Fatal("changed manifest mutated committed rows")
	}
	if _, err := db.Exec(`UPDATE spells SET mechanics='{"later_manual_edit":true}' WHERE card_number='SPELL-0164'`); err != nil {
		t.Fatal(err)
	}
	beforeDrift := combatSpellRepairRows293(t, db)
	if err := applyCombatSpellRepairManifest293(db, manifest); err == nil || !strings.Contains(err.Error(), "mechanics drift") {
		t.Fatal("completed migration silently accepted later mechanics drift", err)
	}
	if combatSpellRepairRows293(t, db) != beforeDrift {
		t.Fatal("completed migration overwrote later manual edits")
	}
}

func TestCombatSpellRepairs293RejectsPreimageIdentityAndLateFailuresWithoutPartialWrites(t *testing.T) {
	for _, failure := range []string{"preimage", "name", "deleted", "duplicate card", "missing", "late SQL failure"} {
		t.Run(failure, func(t *testing.T) {
			db, manifest := combatSpellRepairFixture293(t)
			var query string
			switch failure {
			case "preimage":
				query = `UPDATE spells SET mechanics='{"drift":true}' WHERE card_number='SPELL-0164'`
			case "name":
				query = `UPDATE spells SET name='Renamed without reviewed manifest' WHERE card_number='SPELL-0164'`
			case "deleted":
				query = `UPDATE spells SET deleted_at=NOW() WHERE card_number='SPELL-0164'`
			case "duplicate card":
				query = `UPDATE spells SET card_number='SPELL-0164' WHERE card_number='unrelated'`
			case "missing":
				query = `DELETE FROM spells WHERE card_number='SPELL-0164'`
			case "late SQL failure":
				query = `CREATE FUNCTION reject_late_combat_repair293() RETURNS trigger AS $$ BEGIN
					IF NEW.card_number='SPELL-0164' AND NEW.mechanics IS DISTINCT FROM OLD.mechanics THEN
						RAISE EXCEPTION 'deliberate last row failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
					CREATE TRIGGER reject_last_repair BEFORE UPDATE ON spells FOR EACH ROW EXECUTE FUNCTION reject_late_combat_repair293()`
			}
			if _, err := db.Exec(query); err != nil {
				t.Fatal(err)
			}
			before := combatSpellRepairRows293(t, db)
			if err := applyCombatSpellRepairManifest293(db, manifest); err == nil {
				t.Fatal("invalid/failed repair succeeded")
			}
			if after := combatSpellRepairRows293(t, db); before != after {
				t.Fatal("failed repair left partial mechanical/review changes")
			}
			var leftover bool
			if err := db.QueryRow(`SELECT to_regclass('combat_spell_repairs_293_archive') IS NOT NULL
				OR to_regclass('combat_spell_repairs_293_transition') IS NOT NULL`).Scan(&leftover); err != nil || leftover {
				t.Fatal("failed repair left archive/receipt changes", err)
			}
		})
	}
}
