package migrations

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

func audit278JSON(value string) json.RawMessage { return json.RawMessage(value) }

func audit278Fixture(t *testing.T) (*sql.DB, []catalogAudit278Manifest) {
	t.Helper()
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, table := range []string{"cards", "spells", "effects", "actions", "resources"} {
		ref := "card_number"
		if table == "resources" {
			ref = "resource_id"
		}
		if _, err := db.Exec(fmt.Sprintf(`CREATE TABLE %s(id uuid PRIMARY KEY,%s text UNIQUE,name text NOT NULL CHECK(name<>'Reject'),description text NOT NULL,detailed_description text,mechanics jsonb,related_actions text,support jsonb,image_url text,source text,updated_at timestamptz DEFAULT NOW(),deleted_at timestamptz)`, table, ref)); err != nil {
			t.Fatal(err)
		}
	}
	if err := extendManualContentReview277(db); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"cards", "spells", "effects", "actions", "resources"} {
		if _, err := db.Exec("CREATE TRIGGER invalidate_" + table + "_support BEFORE INSERT OR UPDATE ON " + table + " FOR EACH ROW EXECUTE FUNCTION invalidate_content_support()"); err != nil {
			t.Fatal(err)
		}
	}
	for index, table := range []string{"cards", "spells", "effects"} {
		if _, err := db.Exec(fmt.Sprintf(`INSERT INTO %s(id,card_number,name,description,mechanics,related_actions,image_url,source) VALUES('00000000-0000-4000-8000-%012d','REF-%d','Name-%d','Description','{"a":1,"b":[2]}','["old-ref"]','original.png','original source'); UPDATE %s SET support='{"status":"verified_partial","custom_metadata":{"keep":true},"evidence_id":"obsolete","mechanics_locked":true}'`, table, index+1, index+1, index+1, table)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`CREATE TABLE combat_history(snapshot jsonb); INSERT INTO combat_history VALUES ('{"support":{"status":"verified_mechanical"},"events":[1,2]}')`); err != nil {
		t.Fatal(err)
	}
	descriptionHash, err := catalogAudit278Description(map[string]json.RawMessage{"description": audit278JSON(`"Description"`)})
	if err != nil {
		t.Fatal(err)
	}
	entities := []catalogAudit278Entity{}
	for index, kind := range []string{"card", "spell"} {
		entities = append(entities, catalogAudit278Entity{EntityType: kind, ID: fmt.Sprintf("00000000-0000-4000-8000-%012d", index+1), CardNumber: fmt.Sprintf("REF-%d", index+1), Name: fmt.Sprintf("Name-%d", index+1), DescriptionSHA256: descriptionHash,
			Preimage: map[string]json.RawMessage{"mechanics": audit278JSON(`{"b":[2],"a":1.0}`)}, Patch: map[string]json.RawMessage{"mechanics": audit278JSON(`{"effects":[{"kind":"reviewed"}]}`)},
			Review: &catalogAudit278Review{Status: "partial_narrative_verified_partial", Summary: "Reviewed boundaries", Implemented: []string{"generic operation"}, Tested: []string{"two distinct entities"}, Limitations: []string{"narrative choice"}, Evidence: []string{"local fixture"}}})
	}
	entities[0].Preimage["related_actions"] = audit278JSON(`"[\"old-ref\"]"`)
	entities[0].Patch["related_actions"] = audit278JSON(`"[\"new-ref\"]"`)
	return db, []catalogAudit278Manifest{{SchemaVersion: 1, AuditID: "test-audit", SourceSnapshotSHA256: strings.Repeat("a", 64), Entities: entities}}
}

func audit278AssertOriginal(t *testing.T, db *sql.DB) {
	t.Helper()
	for _, table := range []string{"cards", "spells"} {
		var original bool
		if err := db.QueryRow("SELECT mechanics='{" + `"a":1,"b":[2]` + "}'::jsonb AND support->>'status'='verified_partial' AND related_actions='[\"old-ref\"]' FROM " + table).Scan(&original); err != nil || !original {
			t.Fatalf("%s changed on failed migration: %v", table, err)
		}
	}
}

func TestCatalogAudit278PreservesMetadataAndHistoryAndRepeatsWithoutReset(t *testing.T) {
	db, manifests := audit278Fixture(t)
	guard := manifests[0].Entities[1]
	guard.EntityType, guard.ID, guard.CardNumber, guard.Name = "effect", "00000000-0000-4000-8000-000000000003", "REF-3", "Name-3"
	guard.Patch, guard.Review = nil, nil
	manifests[0].Guards = []catalogAudit278Entity{guard}
	if err := applyCatalogAudit278(db, manifests); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"cards", "spells"} {
		var valid bool
		if err := db.QueryRow("SELECT support->>'status'='partial_narrative_verified_partial' AND support->>'note'='Reviewed boundaries' AND support->'custom_metadata'='{" + `"keep":true` + "}'::jsonb AND NOT(support?'evidence_id') AND NOT(support?'mechanics_locked') AND support?'reviewed_at' AND image_url='original.png' AND source='original source' AND name LIKE 'Name-%' FROM " + table).Scan(&valid); err != nil || !valid {
			t.Fatalf("lost support/metadata %s: %v", table, err)
		}
	}
	var refs string
	if err := db.QueryRow(`SELECT related_actions FROM cards`).Scan(&refs); err != nil || refs != `["new-ref"]` {
		t.Fatalf("TEXT JSON changed type: %s %v", refs, err)
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM catalog_mechanics_278_archive WHERE before_support->>'evidence_id'='obsolete'`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("archive missing: %d %v", count, err)
	}
	var unchanged bool
	if err := db.QueryRow(`SELECT snapshot='{"support":{"status":"verified_mechanical"},"events":[1,2]}'::jsonb FROM combat_history`).Scan(&unchanged); err != nil || !unchanged {
		t.Fatal("history changed", err)
	}
	if err := db.QueryRow(`SELECT support->>'status'='verified_partial' AND support->>'evidence_id'='obsolete' FROM effects`).Scan(&unchanged); err != nil || !unchanged {
		t.Fatal("guard-only dependency review changed", err)
	}
	if _, err := db.Exec(`UPDATE cards SET mechanics='{"later":true}'; UPDATE cards SET support='{"status":"narrative"}'`); err != nil {
		t.Fatal(err)
	}
	if err := applyCatalogAudit278(db, manifests); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT mechanics='{"later":true}'::jsonb AND support->>'status'='narrative' FROM cards`).Scan(&unchanged); err != nil || !unchanged {
		t.Fatal("repeat reset later edits", err)
	}
	manifests[0].Entities[0].Review.Summary = "changed manifest"
	if err := applyCatalogAudit278(db, manifests); err == nil {
		t.Fatal("changed completed manifest accepted")
	}
}

func TestCatalogAudit278RejectsStalePreimagesAndRollsBackLateFailure(t *testing.T) {
	for _, failure := range []string{"preimage", "description", "TEXT JSON type", "missing column", "late SQL constraint", "duplicate entity", "promoted review"} {
		t.Run(failure, func(t *testing.T) {
			db, manifests := audit278Fixture(t)
			e := &manifests[0].Entities[1]
			switch failure {
			case "preimage":
				e.Preimage["mechanics"] = audit278JSON(`{"a":3}`)
			case "description":
				e.DescriptionSHA256 = strings.Repeat("0", 64)
			case "TEXT JSON type":
				manifests[0].Entities[0].Patch["related_actions"] = audit278JSON(`["new-ref"]`)
			case "missing column":
				e.Preimage["heal_dice"] = audit278JSON("null")
				e.Patch["heal_dice"] = audit278JSON(`"1d4"`)
			case "late SQL constraint":
				e.Preimage["name"] = audit278JSON(`"Name-2"`)
				e.Patch["name"] = audit278JSON(`"Reject"`)
			case "duplicate entity":
				manifests[0].Entities = append(manifests[0].Entities, *e)
			case "promoted review":
				e.Review.Status = "partial_narrative_verified"
			}
			if err := applyCatalogAudit278(db, manifests); err == nil {
				t.Fatal("invalid migration succeeded")
			}
			audit278AssertOriginal(t, db)
			var exists bool
			if err := db.QueryRow(`SELECT to_regclass('catalog_mechanics_278_transition') IS NOT NULL`).Scan(&exists); err != nil || exists {
				t.Fatalf("failed transaction left transition table: %v %v", exists, err)
			}
		})
	}
}

func TestCatalogAudit278ConcurrentEditIsRecheckedUnderLock(t *testing.T) {
	db, manifests := audit278Fixture(t)
	writer, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Rollback()
	if _, err = writer.Exec(`UPDATE cards SET mechanics='{"concurrent":true}'`); err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() { finished <- applyCatalogAudit278(db, manifests) }()
	deadline := time.Now().Add(5 * time.Second)
	for {
		var waiting bool
		if err = db.QueryRow(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE relation='cards'::regclass AND mode='ShareRowExclusiveLock' AND NOT granted)`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("migration did not wait for concurrent writer")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err = writer.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case err = <-finished:
		if err == nil || !strings.Contains(err.Error(), "preimage drifted") {
			t.Fatalf("stale concurrent edit accepted: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("migration did not resume")
	}
	var preserved bool
	if err = db.QueryRow(`SELECT mechanics='{"concurrent":true}'::jsonb AND support->>'status'='not_verified' FROM cards`).Scan(&preserved); err != nil || !preserved {
		t.Fatal("concurrent edit overwritten", err)
	}
	if err = db.QueryRow(`SELECT support->>'status'='verified_partial' FROM spells`).Scan(&preserved); err != nil || !preserved {
		t.Fatal("other entity changed on conflict", err)
	}
}

func TestCatalogAudit278InsertsGuardIdentityAndDefaultReview(t *testing.T) {
	for _, collision := range []string{"none", "id", "reference", "deleted reference"} {
		t.Run(collision, func(t *testing.T) {
			db, manifests := audit278Fixture(t)
			entity := manifests[0].Entities[0]
			entity.EntityType, entity.ID, entity.CardNumber, entity.Name = "resource", "00000000-0000-4000-8000-000000000009", "new-resource", "New resource"
			entity.Preimage = nil
			entity.Patch = map[string]json.RawMessage{"description": audit278JSON(`"Description"`), "source": audit278JSON(`"Audit source"`)}
			manifests[0].Entities = append(manifests[0].Entities, entity)
			if collision != "none" {
				id, ref := "00000000-0000-4000-8000-000000000010", "different"
				if collision == "id" {
					id = entity.ID
				} else {
					ref = entity.CardNumber
				}
				if _, err := db.Exec(`INSERT INTO resources(id,resource_id,name,description,deleted_at) VALUES($1,$2,'Conflicting','Description',CASE WHEN $3 THEN NOW() ELSE NULL END)`, id, ref, collision == "deleted reference"); err != nil {
					t.Fatal(err)
				}
			}
			err := applyCatalogAudit278(db, manifests)
			if collision != "none" {
				if err == nil {
					t.Fatal("insert collision accepted")
				}
				audit278AssertOriginal(t, db)
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			var valid bool
			if err = db.QueryRow(`SELECT name='New resource' AND source='Audit source' AND support->>'status'='partial_narrative_verified_partial' FROM resources WHERE resource_id='new-resource'`).Scan(&valid); err != nil || !valid {
				t.Fatalf("resource insert lost fields/review: %v", err)
			}
		})
	}
}

func TestCatalogAudit278DescriptionHashMatchesJavaScriptAndValidation(t *testing.T) {
	description := "<>&\u2028 literal \\u2028"
	raw, _ := json.Marshal(description)
	actual, err := catalogAudit278Description(map[string]json.RawMessage{"description": raw, "detailed_description": audit278JSON(`"text\n"`)})
	expected := sha256.Sum256([]byte(`["<>&` + "\u2028" + ` literal \\u2028","text\n"]`))
	if err != nil || actual != hex.EncodeToString(expected[:]) {
		t.Fatalf("JS description hash mismatch: %s %v", actual, err)
	}
	for _, migration := range GetAllMigrations() {
		if migration.Version == catalogMechanics278Version {
			return
		}
	}
	t.Fatal("catalog audit migration not registered")
}
