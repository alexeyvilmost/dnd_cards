package migrations

import (
	"database/sql"
	"strings"
	"testing"
)

func urvinMigrationFixture(t *testing.T) *sql.DB {
	t.Helper()
	db := openIsolatedPostgresSchema(t, "ROGUELIKE_MIGRATION_TEST_DSN")
	_, err := db.Exec(`
CREATE TABLE roguelike_runs(id text PRIMARY KEY, source_character_id text, character_id text UNIQUE, status text, checkpoint jsonb);
CREATE UNIQUE INDEX idx_roguelike_runs_one_active_character ON roguelike_runs(source_character_id) WHERE status='active';
INSERT INTO roguelike_runs VALUES('old-run','source','copy-1','active','{"history":"retained"}');
CREATE TABLE effects(id uuid PRIMARY KEY, name text, description text, detailed_description text, image_url text, rarity text, card_number text UNIQUE, effect_type text, mechanics jsonb, repeatable bool, author text, source text, support jsonb, deleted_at timestamptz);
CREATE TABLE actions(id uuid PRIMARY KEY, name text, description text, rarity text, card_number text UNIQUE, resource text, mechanics jsonb, action_type text, type text, author text, source text, support jsonb, deleted_at timestamptz);
CREATE TABLE monsters(id uuid PRIMARY KEY, slug text UNIQUE, name text, description text, size text, creature_type text, alignment text, challenge_rating text, armor_class int, max_hp int, speed int, initiative_bonus int, proficiency_bonus int, abilities jsonb, action_ids jsonb, effect_ids jsonb, ai jsonb, source text, support jsonb, deleted_at timestamptz);`)
	if err != nil {
		t.Fatal(err)
	}
	return db
}

func TestUrvinMigrationRegistrationAndSourceUpgrade(t *testing.T) {
	versions := []string{"273_urvin_run", manualContentReviewMigrationVersion, "275_seed_recommended_spell_choices", "276_reusable_run_sources"}
	previous := -1
	for _, want := range versions {
		found := -1
		for i, migration := range GetAllMigrations() {
			if migration.Version == want {
				found = i
			}
		}
		if found <= previous {
			t.Fatalf("migration %s absent or not after prior release migration", want)
		}
		previous = found
	}
	db := urvinMigrationFixture(t)
	if err := allowReusableRunSources276(db); err != nil {
		t.Fatal(err)
	}
	if err := allowReusableRunSources276(db); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO roguelike_runs VALUES('second-run','source','copy-2','active','{}')`); err != nil {
		t.Fatalf("a source template cannot create independent copies: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO roguelike_runs VALUES('invalid-run','other-source','copy-1','active','{}')`); err == nil {
		t.Fatal("one runtime character must not belong to multiple runs")
	}
}

func TestUrvinMigrationSeedsManualReviewAndPreservesExistingRunsAndEdits(t *testing.T) {
	db := urvinMigrationFixture(t)
	if err := addUrvinRun273(db); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"effects", "actions", "monsters"} {
		var count, pending int
		if err := db.QueryRow(`SELECT count(*), count(*) FILTER(WHERE support='{"status":"not_tested"}'::jsonb) FROM `+table).Scan(&count, &pending); err != nil || count != 5 || pending != 5 {
			t.Fatalf("%s count/status: %d/%d, %v", table, count, pending, err)
		}
	}
	var dangling int
	if err := db.QueryRow(`SELECT count(*) FROM monsters m CROSS JOIN LATERAL jsonb_array_elements_text(m.action_ids) ref LEFT JOIN actions a ON a.id::text=ref WHERE a.id IS NULL`).Scan(&dangling); err != nil || dangling != 0 {
		t.Fatalf("seeded monsters have dangling actions: %d %v", dangling, err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM roguelike_mode_definitions d CROSS JOIN LATERAL jsonb_array_elements(d.definition->'auras') ref LEFT JOIN effects e ON e.id::text=ref->>'id' WHERE e.id IS NULL`).Scan(&dangling); err != nil || dangling != 0 {
		t.Fatalf("mode has dangling auras: %d %v", dangling, err)
	}
	var unchanged bool
	if err := db.QueryRow(`SELECT mode='classic' AND journey='{}' AND journey_private='{}' AND mode_rules='{}' AND checkpoint='{"history":"retained"}' FROM roguelike_runs WHERE id='old-run'`).Scan(&unchanged); err != nil || !unchanged {
		t.Fatalf("historical run changed: %v %v", unchanged, err)
	}
	if _, err := db.Exec(`UPDATE effects SET name='Manually edited',support='{"status":"verified"}'; UPDATE roguelike_mode_definitions SET definition=jsonb_set(definition,'{name}','"Custom title"')`); err != nil {
		t.Fatal(err)
	}
	if err := addUrvinRun273(db); err != nil {
		t.Fatalf("repeat seed: %v", err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM effects WHERE name='Manually edited' AND support->>'status'='verified'`).Scan(&dangling); err != nil || dangling != 5 {
		t.Fatal("repeat seed overwrote live edits")
	}
	if err := db.QueryRow(`SELECT definition->>'name'='Custom title' FROM roguelike_mode_definitions`).Scan(&unchanged); err != nil || !unchanged {
		t.Fatal("repeat seed overwrote mode edits")
	}
}

func TestUrvinMigrationRejectsConflictingIdentityAtomically(t *testing.T) {
	db := urvinMigrationFixture(t)
	if _, err := db.Exec(`INSERT INTO actions(id,card_number) VALUES ('00000000-0000-4000-8000-000000000001','URVIN-ATTACK-urvin-goblin-warden')`); err != nil {
		t.Fatal(err)
	}
	if err := addUrvinRun273(db); err == nil || !strings.Contains(err.Error(), "conflicting identity") {
		t.Fatalf("identity collision was not rejected: %v", err)
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM effects`).Scan(&count); err != nil || count != 0 {
		t.Fatal("rejected seed partially wrote catalog entities")
	}
	if err := db.QueryRow(`SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='roguelike_runs' AND column_name='mode'`).Scan(&count); err != nil || count != 0 {
		t.Fatal("rejected seed partially changed schema")
	}
}
