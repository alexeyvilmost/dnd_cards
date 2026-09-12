package migrations

import "testing"

func TestBugbearGrabPreservesCatalogAndRejectsConflicts(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	_, err := db.Exec(`CREATE TABLE actions(id uuid PRIMARY KEY,card_number text UNIQUE,mechanics jsonb NOT NULL DEFAULT '{}',deleted_at timestamptz,updated_at timestamptz DEFAULT NOW());
 CREATE TABLE monsters(slug text PRIMARY KEY,armor_class int,max_hp int,speed int,ai jsonb NOT NULL DEFAULT '{}',deleted_at timestamptz,updated_at timestamptz DEFAULT NOW());
 INSERT INTO actions(id,card_number,mechanics) VALUES
 ('24810000-0000-4000-8000-000000000001','RL-MA-BUG-GRAB','{"custom":"grab"}'),
 ('24810000-0000-4000-8000-000000000002','RL-MA-BUG-HAMMER','{"custom":"ranged"}'),
 ('24810000-0000-4000-8000-000000000003','RL-MA-BUG-HAMMER-MELEE','{"custom":"melee","targeting":{"range_ft":5,"sentinel":"keep"}}');
 INSERT INTO monsters(slug,armor_class,max_hp,speed,ai) VALUES
 ('bugbear-warrior',14,33,30,'{"custom":"bugbear"}'),('other',1,1,10,'{}');`)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := func() string {
		t.Helper()
		var value string
		if err := db.QueryRow(`SELECT jsonb_build_object('actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM actions a),'monsters',(SELECT jsonb_agg(to_jsonb(m) ORDER BY slug) FROM monsters m))::text`).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	if err = materializeBugbearGrab(db); err != nil {
		t.Fatal(err)
	}
	var valid bool
	if err = db.QueryRow(`SELECT ai @> '{"grasping_parts":["long_arm"],"free_grapple_drag":true,"custom":"bugbear"}'::jsonb FROM monsters WHERE slug='bugbear-warrior'`).Scan(&valid); err != nil || !valid {
		t.Fatalf("Bugbear Abduct profile was not declared: %v", err)
	}
	if err = db.QueryRow(`SELECT bool_and(mechanics ? 'custom') AND
 bool_and(CASE WHEN card_number='RL-MA-BUG-GRAB' THEN mechanics->'npc_grapple_on_hit'='{"source_part":"long_arm","escape_dc":12,"max_target_size":2}'::jsonb
 ELSE mechanics->'npc_advantage_if_target_grappled_by_source'='true'::jsonb END) FROM actions`).Scan(&valid); err != nil || !valid {
		t.Fatalf("Bugbear action policies were not declared: %v", err)
	}
	if err = db.QueryRow(`SELECT mechanics#>>'{targeting,range_ft}'='10' AND mechanics#>>'{targeting,sentinel}'='keep'
 FROM actions WHERE card_number='RL-MA-BUG-HAMMER-MELEE'`).Scan(&valid); err != nil || !valid {
		t.Fatalf("Bugbear Light Hammer melee reach was not corrected: %v", err)
	}
	before := snapshot()
	if err = materializeBugbearGrab(db); err != nil {
		t.Fatal(err)
	}
	if before != snapshot() {
		t.Fatal("repeated migration changed catalog")
	}
	if _, err = db.Exec(`UPDATE actions SET mechanics=jsonb_set(mechanics,'{npc_grapple_on_hit}','{"escape_dc":99}') WHERE card_number='RL-MA-BUG-GRAB'`); err != nil {
		t.Fatal(err)
	}
	before = snapshot()
	if err = materializeBugbearGrab(db); err == nil {
		t.Fatal("conflicting Grab declaration silently accepted")
	}
	if before != snapshot() {
		t.Fatal("rejected action conflict changed catalog")
	}
	if _, err = db.Exec(`UPDATE actions SET mechanics=jsonb_set(mechanics,'{npc_grapple_on_hit}','{"source_part":"long_arm","escape_dc":12,"max_target_size":2}') WHERE card_number='RL-MA-BUG-GRAB';
 UPDATE monsters SET ai=jsonb_set(ai,'{free_grapple_drag}','false') WHERE slug='bugbear-warrior'`); err != nil {
		t.Fatal(err)
	}
	before = snapshot()
	if err = materializeBugbearGrab(db); err == nil {
		t.Fatal("conflicting Abduct declaration silently accepted")
	}
	if before != snapshot() {
		t.Fatal("rejected monster conflict changed catalog")
	}
	if _, err = db.Exec(`UPDATE monsters SET ai=jsonb_set(ai,'{free_grapple_drag}','true') WHERE slug='bugbear-warrior';
 UPDATE actions SET mechanics=jsonb_set(mechanics,'{targeting,range_ft}','15') WHERE card_number='RL-MA-BUG-HAMMER-MELEE'`); err != nil {
		t.Fatal(err)
	}
	before = snapshot()
	if err = materializeBugbearGrab(db); err == nil {
		t.Fatal("conflicting Light Hammer reach silently accepted")
	}
	if before != snapshot() {
		t.Fatal("rejected Light Hammer conflict changed catalog")
	}
}
