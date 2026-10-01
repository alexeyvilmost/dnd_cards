package migrations

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func resourceFixtureEntity294(table, id, ref, name, mechanics string) resourceEntity294 {
	return resourceEntity294{Table: table, ID: id, CardNumber: ref, Name: name, ImageURL: "/icons/" + id + ".png", Mechanics: json.RawMessage(mechanics)}
}
func resourceRows294(rows []resourceMetadata294) map[string]resourceMetadata294 {
	out := map[string]resourceMetadata294{}
	for _, row := range rows {
		out[row.ResourceID] = row
	}
	return out
}
func TestResourceDeclarations294KeepBindingsAndRegisterDifferentEntities(t *testing.T) {
	entities := []resourceEntity294{
		resourceFixtureEntity294("actions", "a", "ACT-alpha", "Alpha", `{"uses":{"count":"prof_bonus","per":"long_rest","by_level":{"3":4}},"activation":{"cost":[{"resource":"self_uses"}]}}`),
		resourceFixtureEntity294("actions", "b", "ACT-bravo", "Bravo", `{"uses":{"pool":"gadget","count":6,"per":"day","recovery":{"short_rest":{"mode":"none"},"long_rest":{"mode":"dice","dice":"1d6"}}}}`),
		resourceFixtureEntity294("actions", "c", "ACT-charlie", "Charlie", `{"uses":{"pool":"gadget","count":6,"per":"day"}}`),
		resourceFixtureEntity294("cards", "item", "CARD-gadget", "Gadget", `{"effects":[{"result":[{"kind":"grant_action","value":"ACT-bravo"},{"kind":"grant_action","value":"ACT-charlie"}]}]}`),
		resourceFixtureEntity294("spells", "spell-a", "SPELL-A", "Solar Ray", `{}`),
		resourceFixtureEntity294("spells", "spell-b", "SPELL-B", "River Touch", `{}`),
		resourceFixtureEntity294("effects", "grant-a", "EFF-A", "Grant Alpha", `{"effects":[{"result":[{"kind":"grant_spell","value":"SPELL-A","freeuse":3},{"kind":"grant_spell","value":"spell-b","freeuse":{"count":"prof_bonus","per":"short_rest","level":2}}]}]}`),
		resourceFixtureEntity294("effects", "choice", "EFF-choice", "Choice", `{"effects":[{"grant":{"kind":"grant_spell","freeuse":true}},{"grant":{"kind":"grant_spell","value":"SPELL-B","freeuse":{"at_will":true}}}]}`),
	}
	entities[4].NameEn = "Solar Ray"
	entities[5].NameEn = "River Touch"
	rewrites, rows, err := planResourceDeclarations294(entities)
	if err != nil {
		t.Fatal(err)
	}
	if len(rewrites) != 3 {
		t.Fatalf("changed entities=%d want 3", len(rewrites))
	}
	metadata := resourceRows294(rows)
	for _, id := range []string{"uses_ACT-alpha", "uses_shared_gadget", "freeuse-spells", "hit_dice_d8", "spell_slot_1"} {
		if metadata[id].Name == "" {
			t.Fatalf("missing declared metadata %s", id)
		}
	}
	if metadata["uses_shared_gadget"].Name != "Заряды: Gadget" || metadata["uses_shared_gadget"].ImageURL != "/icons/item.png" {
		t.Fatalf("shared pool named for arbitrary action: %#v", metadata["uses_shared_gadget"])
	}
	for id := range metadata {
		if strings.HasPrefix(id, "freeuse-") && id != "freeuse-spells" {
			t.Fatalf("generic spell free use registered as a catalog resource: %s", id)
		}
	}
	for _, change := range rewrites {
		root, err := resourceObject294(change.After)
		if err != nil {
			t.Fatal(err)
		}
		if uses, ok := root["uses"].(map[string]any); ok {
			delete(uses, "resource_id")
		}
		before, _ := resourceObject294(change.Before)
		left, _ := json.Marshal(before)
		right, _ := json.Marshal(root)
		if !bytes.Equal(left, right) {
			t.Fatalf("binding conversion changed gameplay values %s: %s != %s", change.Entity.ref(), left, right)
		}
	}
	for _, change := range rewrites {
		for i := range entities {
			if entities[i].Table == change.Entity.Table && entities[i].ID == change.Entity.ID {
				entities[i].Mechanics = change.After
			}
		}
	}
	repeated, repeatedRows, err := planResourceDeclarations294(entities)
	if err != nil || len(repeated) != 0 {
		t.Fatalf("declaration normalization not idempotent: %v %d", err, len(repeated))
	}
	a, _ := json.Marshal(rows)
	b, _ := json.Marshal(repeatedRows)
	if !bytes.Equal(a, b) {
		t.Fatal("metadata depends on mutation or iteration order")
	}
}

func TestResourceDeclarations294RejectConflictingOrUnpreservableIDs(t *testing.T) {
	for _, mechanics := range []string{`{"uses":{"count":2,"pool":""}}`, `{"uses":{"count":2,"pool":"bad:pool"}}`, `{"uses":{"count":2,"resource_id":""}}`} {
		if _, _, err := rewriteResourceMechanics294(resourceFixtureEntity294("actions", "a", "A", "Alpha", mechanics)); err == nil {
			t.Fatalf("invalid binding accepted %s", mechanics)
		}
	}
}

func TestResourceDeclarations294LeavesGenericFreeuseAndKeepsResourceImages(t *testing.T) {
	grant := resourceFixtureEntity294("effects", "e", "E", "Grant", `{"effects":[{"kind":"grant_spell","value":"SPELL-A","freeuse":{"count":1,"per":"short_rest"}}]}`)
	after, decls, err := rewriteResourceMechanics294(grant)
	if err != nil || len(decls) != 0 {
		t.Fatalf("free uses entered data-owned resource declarations: %#v %v", decls, err)
	}
	beforeObject, _ := resourceObject294(grant.Mechanics)
	afterObject, _ := resourceObject294(after)
	beforeJSON, _ := json.Marshal(beforeObject)
	afterJSON, _ := json.Marshal(afterObject)
	if !bytes.Equal(beforeJSON, afterJSON) {
		t.Fatal("generic freeuse changed")
	}
	spell := resourceFixtureEntity294("spells", "spell-id", "SPELL-A", "Spell", "{}")
	spell.ImageURL = ""
	spell.ImageCloudinaryURL = "https://cdn.example/image.png"
	if got := resourceImage294(spell); got != "/api/content-images/spells/spell-id" {
		t.Fatalf("cloud art omitted: %s", got)
	}

}

func TestResourceDeclarations294MigrationAtomicReplayAndAuthoredMetadata(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, table := range resourceTables294 {
		if _, err := db.Exec("CREATE TABLE " + table + "(id uuid PRIMARY KEY,card_number text,name text,name_en text,description text,image_url text,mechanics jsonb,resources jsonb,updated_at timestamptz DEFAULT NOW(),deleted_at timestamptz)"); err != nil {
			t.Fatal(err)
		}
	}
	// Classes declare their pools in resources and have no mechanics column
	// in the production schema. Empty closed archives must still be checked.
	if _, err := db.Exec("ALTER TABLE classes DROP COLUMN mechanics"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE resources(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),resource_id text UNIQUE,name text,name_en text,description text,category text,image_url text,recharge text,sort_order int,updated_at timestamptz DEFAULT NOW(),deleted_at timestamptz);CREATE TABLE characters_v3(snapshot jsonb);INSERT INTO characters_v3 VALUES('{"resources":{"uses_ACT-alpha":0,"freeuse-SPELL-A":0},"turn_state":{"old_history":[1,2]}}');CREATE TABLE roguelike_runs(snapshot jsonb);INSERT INTO roguelike_runs VALUES('{"envelope":{"artifact":"old","events":[1,2]},"receipts":[3]}');INSERT INTO resources(resource_id,name,category,image_url)VALUES('spell_slot_1','Custom slots','old-class','custom-enamel.png');INSERT INTO actions(id,card_number,name,mechanics)VALUES('a0000000-0000-4000-8000-000000000001','ACT-alpha','Alpha','{"uses":{"count":2,"per":"short_rest"}}'),('a0000000-0000-4000-8000-000000000002','ACT-beta','Beta','{"uses":{"count":"prof_bonus","per":"long_rest"}}');INSERT INTO effects(id,card_number,name,mechanics)VALUES('e0000000-0000-4000-8000-000000000001','EFF-a','Grant','{"effects":[{"kind":"grant_spell","value":"SPELL-A","freeuse":true}]}');INSERT INTO spells(id,card_number,name,name_en,mechanics)VALUES('b0000000-0000-4000-8000-000000000001','SPELL-A','A Spell','A Spell','{}');`); err != nil {
		t.Fatal(err)
	}
	var beforeCharacters, beforeRuns string
	db.QueryRow("SELECT snapshot::text FROM characters_v3").Scan(&beforeCharacters)
	db.QueryRow("SELECT snapshot::text FROM roguelike_runs").Scan(&beforeRuns)
	for repeat := 0; repeat < 2; repeat++ {
		if err := applyResourceDeclarations294(db); err != nil {
			t.Fatal(err)
		}
	}
	var metadataCount, archiveCount int
	if err := db.QueryRow(`SELECT count(*) FROM resource_declarations_294_archive`).Scan(&archiveCount); err != nil || archiveCount != 2 {
		t.Fatalf("archive=%d %v", archiveCount, err)
	}
	var name, image, category string
	if err := db.QueryRow(`SELECT name,image_url,category FROM resources WHERE resource_id='spell_slot_1'`).Scan(&name, &image, &category); err != nil || name != "Custom slots" || image != "custom-enamel.png" || category != "spellcasting_resource" {
		t.Fatalf("authored metadata changed %s %s %s %v", name, image, category, err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM resource_declarations_294_metadata_archive`).Scan(&metadataCount); err != nil || metadataCount != 1 {
		t.Fatalf("metadata preimage=%d %v", metadataCount, err)
	}
	var afterCharacters, afterRuns string
	db.QueryRow("SELECT snapshot::text FROM characters_v3").Scan(&afterCharacters)
	db.QueryRow("SELECT snapshot::text FROM roguelike_runs").Scan(&afterRuns)
	if beforeCharacters != afterCharacters || beforeRuns != afterRuns {
		t.Fatal("declarations rewrote charges/history")
	}
	if _, err := db.Exec(`UPDATE actions SET mechanics='{"uses":{"count":8}}' WHERE card_number='ACT-alpha'`); err != nil {
		t.Fatal(err)
	}
	if err := applyResourceDeclarations294(db); err == nil || !strings.Contains(err.Error(), "closed resource declaration archive drift") {
		t.Fatalf("closed mechanics preimage was silently rewritten: %v", err)
	}
	if _, err := db.Exec(`UPDATE actions a SET mechanics=r.after_mechanics FROM resource_declarations_294_archive r WHERE r.entity_table='actions' AND r.entity_id=a.id;UPDATE resources SET category='other' WHERE resource_id='spell_slot_1'`); err != nil {
		t.Fatal(err)
	}
	if err := applyResourceDeclarations294(db); err == nil || !strings.Contains(err.Error(), "closed resource metadata archive drift") {
		t.Fatalf("closed authored metadata was silently corrected again: %v", err)
	}
	if _, err := db.Exec(`UPDATE resources SET category='spellcasting_resource' WHERE resource_id='spell_slot_1'`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO actions(id,card_number,name,mechanics)VALUES('a0000000-0000-4000-8000-000000000003','ACT-new','New','{"uses":{"count":1}}'),('a0000000-0000-4000-8000-000000000004','ACT-invalid','Invalid','{"uses":{"resource_id":"bad:pool","count":1}}')`); err != nil {
		t.Fatal(err)
	}
	if err := applyResourceDeclarations294(db); err == nil {
		t.Fatal("invalid declarations must reject atomically")
	}
	var declared bool
	if err := db.QueryRow(`SELECT mechanics->'uses' ? 'resource_id' FROM actions WHERE card_number='ACT-new'`).Scan(&declared); err != nil || declared {
		t.Fatalf("invalid batch partially rewrote another entity: %v %v", declared, err)
	}
}

func TestResourceDeclarations294ReadOnlySnapshotPlan(t *testing.T) {
	file := os.Getenv("RESOURCE_DECLARATIONS_294_AUDIT_FILE")
	if file == "" {
		t.Skip("local read-only audit file required")
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var entities []resourceEntity294
	if err = json.Unmarshal(raw, &entities); err != nil {
		t.Fatal(err)
	}
	rewrites, rows, err := planResourceDeclarations294(entities)
	if err != nil {
		t.Fatal(err)
	}
	changed := map[string][]byte{}
	for _, change := range rewrites {
		changed[change.Entity.Table+"/"+change.Entity.ID] = change.After
	}
	for i := range entities {
		if next, ok := changed[entities[i].Table+"/"+entities[i].ID]; ok {
			entities[i].Mechanics = next
		}
	}
	if output := os.Getenv("RESOURCE_DECLARATIONS_294_PLAN_DIR"); output != "" {
		for name, value := range map[string]any{"planned-entities.json": entities, "planned-resources.json": rows} {
			encoded, _ := json.Marshal(value)
			if err = os.WriteFile(filepath.Join(output, name), encoded, 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	t.Logf("snapshot plan: %d entities, %d declaration rewrites, %d metadata rows", len(entities), len(rewrites), len(rows))
}

func TestResourceDeclarations294FrozenSeedAndRegistration(t *testing.T) {
	current, err := os.ReadFile("../../frontend/src/engine/data/resources.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(current, resourceDeclarations294JSON) {
		t.Fatal("resource metadata seed differs from reviewed source")
	}
	count := 0
	for i, migration := range GetAllMigrations() {
		if strings.HasPrefix(migration.Version, "294_") {
			count++
			if migration.Version != resourceDeclarations294Version || i == 0 || GetAllMigrations()[i-1].Version != combatSpellRepairs293Version {
				t.Fatal("294 must follow 293")
			}
		}
	}
	if count != 1 {
		t.Fatal(fmt.Sprintf("294 registrations=%d", count))
	}
}
