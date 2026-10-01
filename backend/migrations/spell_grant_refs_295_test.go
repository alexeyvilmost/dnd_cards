package migrations

import (
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestSpellGrantRefs295ReviewedManifestMatchesSource(t *testing.T) {
	manifest, err := loadSpellGrantManifest295()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../scripts/content/data/spell-grant-refs-20261001.json")
	if err != nil {
		t.Fatal(err)
	}
	actual, err := combatSpellRepairCanonical293(spellGrantRefs295JSON)
	if err != nil {
		t.Fatal(err)
	}
	expected, err := combatSpellRepairCanonical293(raw)
	if err != nil || string(actual) != string(expected) {
		t.Fatal("reviewed source/embedded grant repair drift", err)
	}
	count := 0
	for _, migration := range GetAllMigrations() {
		if migration.Version == spellGrantRefs295Version {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("expected one 295 registry entry, got %d", count)
	}
	for _, entity := range manifest.Entities {
		if entity.ExpectedBefore == entity.ExpectedAfter {
			t.Fatal("empty source repair", entity.CardNumber)
		}
	}
	for _, kind := range []string{"source identity", "duplicate source", "postimage hash", "unresolved reference"} {
		t.Run(kind, func(t *testing.T) {
			candidate, err := loadSpellGrantManifest295()
			if err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "source identity":
				candidate.Entities[0].Name = "Unreviewed source"
			case "duplicate source":
				candidate.Entities[1] = candidate.Entities[0]
			case "postimage hash":
				candidate.Entities[0].ExpectedAfter = "sha256:" + strings.Repeat("0", 64)
			case "unresolved reference":
				candidate.Entities[0].Mechanics = []byte(`{"effects":[{"kind":"grant_spell","value":"unresolved-old-alias"}]}`)
				candidate.Entities[0].ExpectedAfter, _ = combatSpellRepairHash293(candidate.Entities[0].Mechanics)
			}
			if validateSpellGrantManifest295(candidate) == nil {
				t.Fatal("invalid reviewed repair accepted")
			}
		})
	}
}

func spellGrantFixture295(t *testing.T) (*sql.DB, spellGrantManifest295) {
	t.Helper()
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	if _, err := db.Exec(`CREATE TABLE effects(id uuid PRIMARY KEY,card_number text,name text,description text,mechanics jsonb,support jsonb,updated_at timestamptz DEFAULT NOW(),deleted_at timestamptz);
		CREATE TABLE spells(id uuid PRIMARY KEY,card_number text,name_en text,mechanics jsonb,deleted_at timestamptz);
		CREATE TABLE character_snapshots(resources jsonb,max_resources jsonb,combat_history jsonb);
		INSERT INTO character_snapshots VALUES ('{"freeuse-hunters_mark":0,"uses_ACT-old":2}','{"freeuse-hunters_mark":1,"uses_ACT-old":3}','{"catalog":{"old_slug":"hunters_mark"},"commands":[1,2]}');`); err != nil {
		t.Fatal(err)
	}
	manifest, err := loadSpellGrantManifest295()
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range manifest.Targets {
		if _, err := db.Exec(`INSERT INTO spells(id,card_number,name_en,mechanics) VALUES($1,$2,$3,'{}')`, target.ID, target.CardNumber, target.NameEn); err != nil {
			t.Fatal(err)
		}
	}
	for index := range manifest.Entities {
		entity := &manifest.Entities[index]
		before := fmt.Sprintf(`{"original":%d}`, index)
		entity.ExpectedBefore, err = combatSpellRepairHash293([]byte(before))
		if err != nil {
			t.Fatal(err)
		}
		entity.ExpectedDescription, _ = combatSpellRepairHash293([]byte(`"Original source description"`))
		if _, err := db.Exec(`INSERT INTO effects(id,card_number,name,description,mechanics,support) VALUES($1,$2,$3,'Original source description',$4::jsonb,'{"status":"verified_partial","manual_note":"retained in archive"}')`, entity.ID, entity.CardNumber, entity.Name, before); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO effects(id,card_number,name,mechanics,support) VALUES('00000000-0000-4000-8000-000000000005','unrelated','Other','{"unrelated":true}','{"status":"verified_partial"}')`); err != nil {
		t.Fatal(err)
	}
	return db, manifest
}

func spellGrantRows295(t *testing.T, db *sql.DB) string {
	t.Helper()
	var rows string
	if err := db.QueryRow(`SELECT jsonb_agg(to_jsonb(e) ORDER BY id)::text FROM effects e`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestSpellGrantRefs295AtomicArchiveRepeatPreservesChargesAndHistory(t *testing.T) {
	db, manifest := spellGrantFixture295(t)
	if err := applySpellGrantManifest295(db, manifest); err != nil {
		t.Fatal(err)
	}
	var count int
	var valid bool
	if err := db.QueryRow(`SELECT count(*),bool_and(before_row->'mechanics'=before_mechanics AND before_row->'support'=before_support AND before_row->>'description'='Original source description') FROM spell_grant_refs_295_archive`).Scan(&count, &valid); err != nil || count != 26 || !valid {
		t.Fatal("full source archive differs", count, valid, err)
	}
	if err := db.QueryRow(`SELECT bool_and(support->>'status'='not_verified' AND description='Original source description') FROM effects WHERE card_number<>'unrelated'`).Scan(&valid); err != nil || !valid {
		t.Fatal("source review/description changed incorrectly", err)
	}
	if err := db.QueryRow(`SELECT resources='{"freeuse-hunters_mark":0,"uses_ACT-old":2}'::jsonb AND max_resources='{"freeuse-hunters_mark":1,"uses_ACT-old":3}'::jsonb AND combat_history='{"catalog":{"old_slug":"hunters_mark"},"commands":[1,2]}'::jsonb FROM character_snapshots`).Scan(&valid); err != nil || !valid {
		t.Fatal("charges/history were modified", err)
	}
	if _, err := db.Exec(`UPDATE effects SET support='{"status":"verified_partial","later_review":true}' WHERE id=$1`, manifest.Entities[0].ID); err != nil {
		t.Fatal(err)
	}
	before := spellGrantRows295(t, db)
	if err := applySpellGrantManifest295(db, manifest); err != nil {
		t.Fatal(err)
	}
	if before != spellGrantRows295(t, db) {
		t.Fatal("repeat changed data, timestamp or later review")
	}
	changed := manifest
	changed.Entities = append([]spellGrantRepair295(nil), manifest.Entities...)
	changed.Entities[0].ExpectedBefore = "sha256:" + strings.Repeat("0", 64)
	if err := applySpellGrantManifest295(db, changed); err == nil || !strings.Contains(err.Error(), "manifest changed") {
		t.Fatal("changed receipt manifest accepted", err)
	}
	if _, err := db.Exec(`UPDATE effects SET mechanics='{"later_manual_edit":true}' WHERE id=$1`, manifest.Entities[0].ID); err != nil {
		t.Fatal(err)
	}
	before = spellGrantRows295(t, db)
	if err := applySpellGrantManifest295(db, manifest); err == nil || !strings.Contains(err.Error(), "mechanics drift") {
		t.Fatal("later manual edit silently overwritten", err)
	}
	if before != spellGrantRows295(t, db) {
		t.Fatal("repeat drift check mutated data")
	}
}

func TestSpellGrantRefs295RejectsDriftAndLateFailureWithoutPartialChanges(t *testing.T) {
	for _, failure := range []string{"source drift", "source description", "target variant", "ambiguous target", "late failure"} {
		t.Run(failure, func(t *testing.T) {
			db, manifest := spellGrantFixture295(t)
			switch failure {
			case "source drift":
				if _, err := db.Exec(`UPDATE effects SET mechanics='{"unreviewed":true}' WHERE id=$1`, manifest.Entities[0].ID); err != nil {
					t.Fatal(err)
				}
			case "source description":
				if _, err := db.Exec(`UPDATE effects SET description='Changed reviewed semantics' WHERE id=$1`, manifest.Entities[0].ID); err != nil {
					t.Fatal(err)
				}
			case "target variant":
				if _, err := db.Exec(`UPDATE spells SET mechanics='{"variant_of_spell_id":"parent"}' WHERE id=$1`, manifest.Targets[0].ID); err != nil {
					t.Fatal(err)
				}
			case "ambiguous target":
				if _, err := db.Exec(`INSERT INTO spells(id,card_number,name_en,mechanics) VALUES('00000000-0000-4000-8000-000000000007',$1,'Alias duplicate','{}')`, manifest.Targets[0].CardNumber); err != nil {
					t.Fatal(err)
				}
			case "late failure":
				if _, err := db.Exec(`CREATE FUNCTION reject_spell_grant295() RETURNS trigger AS $$ BEGIN IF NEW.card_number='EFFECT-0175' THEN RAISE EXCEPTION 'deliberate late failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
			CREATE TRIGGER reject_grant295 BEFORE UPDATE ON effects FOR EACH ROW EXECUTE FUNCTION reject_spell_grant295()`); err != nil {
					t.Fatal(err)
				}
			}
			before := spellGrantRows295(t, db)
			if err := applySpellGrantManifest295(db, manifest); err == nil {
				t.Fatal("invalid source/target transition accepted")
			}
			if before != spellGrantRows295(t, db) {
				t.Fatal("failed transition left partial writes")
			}
			var exists bool
			if err := db.QueryRow(`SELECT to_regclass('spell_grant_refs_295_archive') IS NOT NULL OR to_regclass('spell_grant_refs_295_transition') IS NOT NULL`).Scan(&exists); err != nil || exists {
				t.Fatal("failed transition left archive/receipt", err)
			}
		})
	}
}
