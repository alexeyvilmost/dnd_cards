package migrations

import "testing"

func TestGoblinNimbleEscapePreservesCatalogAndIsIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	_, err := db.Exec(`CREATE TABLE actions(id uuid PRIMARY KEY,name text,name_en text,description text,image_url text,rarity text,card_number text UNIQUE,resource text,mechanics jsonb,action_type text,type text,author text,source text,deleted_at timestamptz,updated_at timestamptz DEFAULT NOW());
 CREATE TABLE effects(id uuid PRIMARY KEY,name text,name_en text,description text,rarity text,card_number text UNIQUE,effect_type text CHECK(effect_type IN ('feat_ability')),mechanics jsonb,repeatable boolean,author text,source text,deleted_at timestamptz,updated_at timestamptz DEFAULT NOW());
 CREATE TABLE monsters(slug text PRIMARY KEY,action_ids jsonb,effect_ids jsonb,deleted_at timestamptz,updated_at timestamptz DEFAULT NOW());
 INSERT INTO actions(id,card_number,image_url,mechanics) VALUES('00000000-0000-4000-8000-000000000001','action_basic_hide','hide.png','{}'),('00000000-0000-4000-8000-000000000002','action_basic_disengage','disengage.png','{}');
 INSERT INTO monsters(slug,action_ids,effect_ids) VALUES('goblin-warrior','["old-attack"]','["old-effect"]'),('other','[]','[]');`)
	if err != nil {
		t.Fatal(err)
	}
	if err = materializeGoblinNimbleEscape(db); err != nil {
		t.Fatal(err)
	}
	var valid bool
	if err = db.QueryRow(`SELECT action_ids @> '["old-attack","24500000-0000-4000-8000-000000000001","24500000-0000-4000-8000-000000000002"]'::jsonb AND jsonb_array_length(action_ids)=3 AND effect_ids @> '["old-effect","24500000-0000-4000-8000-000000000003"]'::jsonb FROM monsters WHERE slug='goblin-warrior'`).Scan(&valid); err != nil || !valid {
		t.Fatalf("lost existing graph: %v", err)
	}
	if err = db.QueryRow(`SELECT (SELECT image_url FROM actions WHERE card_number='RL-MA-GOBLIN-HIDE')='hide.png' AND (SELECT image_url FROM actions WHERE card_number='RL-MA-GOBLIN-DISENGAGE')='disengage.png'`).Scan(&valid); err != nil || !valid {
		t.Fatalf("lost visuals: %v", err)
	}
	snapshot := func() string {
		t.Helper()
		var value string
		if err := db.QueryRow(`SELECT jsonb_build_object('actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM actions a),'effects',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM effects e),'monsters',(SELECT jsonb_agg(to_jsonb(m) ORDER BY slug) FROM monsters m))::text`).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	before := snapshot()
	if err = materializeGoblinNimbleEscape(db); err != nil {
		t.Fatal(err)
	}
	if before != snapshot() {
		t.Fatal("repeated migration changed catalog")
	}
	if _, err = db.Exec(`UPDATE actions SET mechanics='{"unexpected":true}' WHERE card_number='RL-MA-GOBLIN-DISENGAGE'`); err != nil {
		t.Fatal(err)
	}
	before = snapshot()
	if err = materializeGoblinNimbleEscape(db); err == nil {
		t.Fatal("conflicting mechanics silently accepted")
	}
	if before != snapshot() {
		t.Fatal("rejected migration changed catalog")
	}
}
