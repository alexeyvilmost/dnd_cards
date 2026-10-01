package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestGenericSpellFreeuses297ReviewedManifestAndRegistration(t *testing.T) {
	manifest, err := loadGenericFreeuseManifest297()
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Entities) != 42 || len(manifest.Resources) != 1156 {
		t.Fatal("reviewed forward cleanup set changed")
	}
	for _, entity := range manifest.Entities {
		var root any
		if err := json.Unmarshal(entity.Mechanics, &root); err != nil {
			t.Fatal(err)
		}
		var visit func(any)
		visit = func(value any) {
			switch node := value.(type) {
			case []any:
				for _, child := range node {
					visit(child)
				}
			case map[string]any:
				if node["kind"] == "grant_spell" {
					if free, ok := node["freeuse"].(map[string]any); ok && (free["resource_id"] != nil || free["resource_id_prefix"] != nil) {
						t.Fatal("generic postimage contains authored resource binding", entity.CardNumber)
					}
				}
				for _, child := range node {
					visit(child)
				}
			}
		}
		visit(root)
	}
	count := 0
	for index, migration := range GetAllMigrations() {
		if migration.Version == genericSpellFreeuses297Version {
			count++
			if index == 0 || GetAllMigrations()[index-1].Version != spellGrantAbilities296Version {
				t.Fatal("297 must follow 296")
			}
		}
	}
	if count != 1 {
		t.Fatal("297 registration count", count)
	}
	for _, kind := range []string{"source identity", "resource identity", "postimage hash", "generic showcase"} {
		t.Run(kind, func(t *testing.T) {
			candidate, _ := loadGenericFreeuseManifest297()
			switch kind {
			case "source identity":
				candidate.Entities[0].Name = "Unreviewed source"
			case "resource identity":
				candidate.Resources[0].ResourceID = "freeuse-custom-authored"
			case "postimage hash":
				candidate.Entities[0].ExpectedAfter = "sha256:" + strings.Repeat("0", 64)
			case "generic showcase":
				candidate.Resources[0].ResourceID = "freeuse-spells"
			}
			if validateGenericFreeuseManifest297(candidate) == nil {
				t.Fatal("invalid cleanup manifest accepted")
			}
		})
	}
}

func genericFreeuseFixture297(t *testing.T, annotated bool) (*sql.DB, genericFreeuseManifest297) {
	t.Helper()
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, table := range resourceTables294 {
		if _, err := db.Exec("CREATE TABLE " + table + "(id uuid PRIMARY KEY,card_number text,name text,mechanics jsonb,support jsonb,updated_at timestamptz DEFAULT NOW(),deleted_at timestamptz)"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`CREATE TABLE resources(resource_id text PRIMARY KEY,name text,category text,image_url text,recharge text,sort_order int,support jsonb DEFAULT '{"status":"not_tested"}',updated_at timestamptz DEFAULT NOW(),deleted_at timestamptz);
		CREATE FUNCTION invalidate_resource_review() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.support='{"status":"not_verified"}'::jsonb;RETURN NEW;END$$;
		CREATE TRIGGER invalidate_resource_review BEFORE UPDATE ON resources FOR EACH ROW EXECUTE FUNCTION invalidate_resource_review();
		CREATE TABLE historical_archives(payload jsonb);INSERT INTO historical_archives VALUES('{"versions":[294,295,296],"receipts":[1,2]}');
		CREATE TABLE character_snapshots(resources jsonb,max_resources jsonb,combat_history jsonb);
		INSERT INTO character_snapshots VALUES('{"freeuse-alpha":0,"freeuse-beta":2}','{"freeuse-alpha":1,"freeuse-beta":3}','{"catalog":"old","events":[1,2]}');
		INSERT INTO resources(resource_id,name,category,image_url)VALUES('freeuse-spells','Generic showcase','spellcasting_resource','showcase.png'),('freeuse-manual','Authored custom resource','custom','custom.png')`); err != nil {
		t.Fatal(err)
	}
	manifest, err := loadGenericFreeuseManifest297()
	if err != nil {
		t.Fatal(err)
	}
	for index := range manifest.Entities {
		entity := &manifest.Entities[index]
		before := entity.Mechanics
		if annotated && index < 2 {
			var mechanics any
			if err := json.Unmarshal(before, &mechanics); err != nil {
				t.Fatal(err)
			}
			bound := false
			var annotate func(any)
			annotate = func(value any) {
				if bound {
					return
				}
				switch node := value.(type) {
				case []any:
					for _, child := range node {
						annotate(child)
					}
				case map[string]any:
					if node["kind"] == "grant_spell" && node["freeuse"] != nil {
						free, ok := node["freeuse"].(map[string]any)
						if !ok {
							count := node["freeuse"]
							if count == true {
								count = 1
							}
							free = map[string]any{"count": count, "recharge": "long_rest"}
						}
						if free["at_will"] != true {
							free["resource_id"] = fmt.Sprintf("freeuse-fixture-%d", index)
							node["freeuse"] = free
							bound = true
						}
					}
					for _, child := range node {
						annotate(child)
					}
				}
			}
			annotate(mechanics)
			if !bound {
				t.Fatal("fixture source has no finite free use", entity.CardNumber)
			}
			before, err = json.Marshal(mechanics)
			if err != nil {
				t.Fatal(err)
			}
			entity.ExpectedBefore, err = spellGrantAbilityHash296(before)
			if err != nil {
				t.Fatal(err)
			}
		}
		if _, err := db.Exec("INSERT INTO "+entity.Table+"(id,card_number,name,mechanics,support)VALUES($1::uuid,$2,$3,$4::jsonb,'{\"status\":\"not_verified\"}')", entity.ID, entity.CardNumber, entity.Name, string(before)); err != nil {
			t.Fatal(err)
		}
	}
	for index := 0; index < 2; index++ {
		resource := &manifest.Resources[index]
		if _, err := db.Exec(`INSERT INTO resources(resource_id,name,category,image_url,recharge,sort_order)VALUES($1,$2,'spellcasting_resource','spell.png','long_rest',600)`, resource.ResourceID, fmt.Sprintf("Created spell resource %d", index)); err != nil {
			t.Fatal(err)
		}
		if index == 0 {
			if _, err := db.Exec(`ALTER TABLE resources DISABLE TRIGGER invalidate_resource_review`); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`UPDATE resources SET support='{"status":"verified_partial","review_note":"Retained archive"}' WHERE resource_id=$1`, resource.ResourceID); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`ALTER TABLE resources ENABLE TRIGGER invalidate_resource_review`); err != nil {
				t.Fatal(err)
			}
		}
		var row []byte
		if err := db.QueryRow(`SELECT to_jsonb(r) FROM resources r WHERE resource_id=$1`, resource.ResourceID).Scan(&row); err != nil {
			t.Fatal(err)
		}
		resource.ExpectedHash, err = genericFreeuseResourceHash297(row)
		if err != nil {
			t.Fatal(err)
		}
	}
	return db, manifest
}

func TestGenericSpellFreeuses297ForwardCleanupPreservesChargesHistoryAndAuthoredDefinitions(t *testing.T) {
	db, manifest := genericFreeuseFixture297(t, true)
	for repeat := 0; repeat < 2; repeat++ {
		if err := applyGenericFreeuseManifest297(db, manifest); err != nil {
			t.Fatal(err)
		}
	}
	var entityArchives, resourceArchives, liveAuthored int
	db.QueryRow(`SELECT count(*) FROM generic_spell_freeuses_297_archive`).Scan(&entityArchives)
	db.QueryRow(`SELECT count(*) FROM generic_spell_freeuses_297_resource_archive`).Scan(&resourceArchives)
	db.QueryRow(`SELECT count(*) FROM resources WHERE resource_id IN ('freeuse-spells','freeuse-manual') AND deleted_at IS NULL`).Scan(&liveAuthored)
	if entityArchives != 2 || resourceArchives != 2 || liveAuthored != 2 {
		t.Fatal("incorrect cleanup archives/authored resources", entityArchives, resourceArchives, liveAuthored)
	}
	var unchanged bool
	if err := db.QueryRow(`SELECT resources='{"freeuse-alpha":0,"freeuse-beta":2}'::jsonb AND max_resources='{"freeuse-alpha":1,"freeuse-beta":3}'::jsonb AND combat_history='{"catalog":"old","events":[1,2]}'::jsonb FROM character_snapshots`).Scan(&unchanged); err != nil || !unchanged {
		t.Fatal("cleanup rewrote charges or historical artifact", err)
	}
	if err := db.QueryRow(`SELECT payload='{"versions":[294,295,296],"receipts":[1,2]}'::jsonb FROM historical_archives`).Scan(&unchanged); err != nil || !unchanged {
		t.Fatal("cleanup rewrote historical migration receipts", err)
	}
	if _, err := db.Exec(`UPDATE resources SET name='Authored after completion' WHERE resource_id=$1`, manifest.Resources[0].ResourceID); err != nil {
		t.Fatal(err)
	}
	if err := applyGenericFreeuseManifest297(db, manifest); err == nil || !strings.Contains(err.Error(), "closed generic free-use resource metadata drift") {
		t.Fatal("closed cleanup allowed metadata drift", err)
	}
	if _, err := db.Exec(`UPDATE resources r SET name=a.before_row->>'name' FROM generic_spell_freeuses_297_resource_archive a WHERE r.resource_id=a.resource_id AND r.resource_id=$1`, manifest.Resources[0].ResourceID); err != nil {
		t.Fatal(err)
	}
	if err := applyGenericFreeuseManifest297(db, manifest); err != nil {
		t.Fatal("restored exact postimage must repeat", err)
	}
	if _, err := db.Exec(`ALTER TABLE resources DISABLE TRIGGER invalidate_resource_review`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE resources SET support='{"status":"verified_partial"}' WHERE resource_id=$1`, manifest.Resources[1].ResourceID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`ALTER TABLE resources ENABLE TRIGGER invalidate_resource_review`); err != nil {
		t.Fatal(err)
	}
	if err := applyGenericFreeuseManifest297(db, manifest); err == nil || !strings.Contains(err.Error(), "closed generic free-use resource metadata drift") {
		t.Fatal("closed cleanup allowed review status drift", err)
	}
}

func TestGenericSpellFreeuses297FreshChainIsNoOpAndFailureRollsBack(t *testing.T) {
	t.Run("fresh chain retains all authored resource definitions", func(t *testing.T) {
		db, manifest := genericFreeuseFixture297(t, false)
		// Even an authored resource whose ID matches a former generated pool
		// stays unchanged on the fresh chain, which has no cleanup preimages.
		if _, err := db.Exec(`UPDATE resources SET name='Authored resource with matching ID' WHERE resource_id=$1`, manifest.Resources[0].ResourceID); err != nil {
			t.Fatal(err)
		}
		for repeat := 0; repeat < 2; repeat++ {
			if err := applyGenericFreeuseManifest297(db, manifest); err != nil {
				t.Fatal(err)
			}
		}
		var archives, live int
		db.QueryRow(`SELECT (SELECT count(*) FROM generic_spell_freeuses_297_archive)+(SELECT count(*) FROM generic_spell_freeuses_297_resource_archive)`).Scan(&archives)
		db.QueryRow(`SELECT count(*) FROM resources WHERE deleted_at IS NULL`).Scan(&live)
		if archives != 0 || live != 4 {
			t.Fatal("fresh no-op cleanup changed authored data", archives, live)
		}
	})
	t.Run("later resource drift rolls back earlier entity rewrites", func(t *testing.T) {
		db, manifest := genericFreeuseFixture297(t, true)
		if _, err := db.Exec(`UPDATE resources SET name='Changed before cleanup' WHERE resource_id=$1`, manifest.Resources[1].ResourceID); err != nil {
			t.Fatal(err)
		}
		if err := applyGenericFreeuseManifest297(db, manifest); err == nil || !strings.Contains(err.Error(), "resource metadata drift") {
			t.Fatal("drifted metadata accepted", err)
		}
		var raw []byte
		entity := manifest.Entities[0]
		if err := db.QueryRow("SELECT mechanics FROM "+entity.Table+" WHERE id=$1::uuid", entity.ID).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		hash, _ := spellGrantAbilityHash296(raw)
		if hash != entity.ExpectedBefore {
			t.Fatal("failed cleanup partially changed mechanics")
		}
	})
}
