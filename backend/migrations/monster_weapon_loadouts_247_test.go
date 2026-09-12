package migrations

import "testing"

func TestMonsterWeaponLoadoutsPreserveCatalogAndRejectConflicts(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	_, err := db.Exec(`CREATE TABLE cards(id uuid PRIMARY KEY,card_number text UNIQUE,name text,type text,slot text,properties jsonb,mechanics jsonb,deleted_at timestamptz,created_at timestamptz,updated_at timestamptz DEFAULT NOW());
 CREATE TABLE actions(id uuid PRIMARY KEY,card_number text UNIQUE,mechanics jsonb NOT NULL DEFAULT '{}',deleted_at timestamptz,updated_at timestamptz DEFAULT NOW());
 CREATE TABLE monsters(slug text PRIMARY KEY,armor_class int,max_hp int,speed int,ai jsonb NOT NULL DEFAULT '{}',deleted_at timestamptz,updated_at timestamptz DEFAULT NOW());
 INSERT INTO cards(id,card_number,name,type,slot,properties,mechanics) VALUES
 ('24700000-0000-4000-8000-000000000001','CARD-0311','Scimitar','weapon','one_hand','["light"]','{"weapon_profile":{"properties":["light"]}}'),
 ('24700000-0000-4000-8000-000000000002','CARD-0838','Pistol','weapon','one_hand','["ammunition"]','{"weapon_profile":{"properties":["ammunition"]}}'),
 ('24700000-0000-4000-8000-000000000003','CARD-0317','Greatsword','weapon','two_hands','["two-handed"]','{"weapon_profile":{"properties":["two_handed"]}}'),
 ('24700000-0000-4000-8000-000000000004','CARD-0328','Heavy Crossbow','weapon','two_hands','["two-handed"]','{"weapon_profile":{"properties":["two_handed"]}}');
 INSERT INTO actions(id,card_number) VALUES
 ('24710000-0000-4000-8000-000000000001','RL-MA-CAPTAIN-SCIM'),('24710000-0000-4000-8000-000000000002','RL-MA-CAPTAIN-PISTOL'),
 ('24710000-0000-4000-8000-000000000003','RL-MA-VETERAN-SWORD'),('24710000-0000-4000-8000-000000000004','RL-MA-VETERAN-XBOW');
 INSERT INTO monsters(slug,armor_class,max_hp,speed,ai) VALUES
 ('bandit-captain',15,52,30,'{"custom":"captain"}'),('warrior-veteran',17,65,30,'{"custom":"veteran"}'),('other',1,1,10,'{}');`)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := func() string {
		t.Helper()
		var value string
		if err := db.QueryRow(`SELECT jsonb_build_object('cards',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM cards c),'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM actions a),'monsters',(SELECT jsonb_agg(to_jsonb(m) ORDER BY slug) FROM monsters m))::text`).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	if err = materializeMonsterWeaponLoadouts(db); err != nil {
		t.Fatal(err)
	}
	var valid bool
	if err = db.QueryRow(`SELECT bool_and(jsonb_array_length(ai->'held_weapon_cards')=2
 AND (SELECT count(*) FROM jsonb_object_keys(ai->'action_weapon_ids'))=2 AND ai ? 'custom')
 FROM monsters WHERE slug IN ('bandit-captain','warrior-veteran')`).Scan(&valid); err != nil || !valid {
		t.Fatalf("loadouts were not frozen: %v", err)
	}
	if err = db.QueryRow(`SELECT bool_and(mechanics ? 'requires_held_item') FROM actions`).Scan(&valid); err != nil || !valid {
		t.Fatalf("actions were not bound: %v", err)
	}
	before := snapshot()
	if err = materializeMonsterWeaponLoadouts(db); err != nil {
		t.Fatal(err)
	}
	if before != snapshot() {
		t.Fatal("repeated migration changed catalog")
	}
	if _, err = db.Exec(`UPDATE actions SET mechanics=jsonb_set(mechanics,'{requires_held_item}','"wrong"') WHERE card_number='RL-MA-VETERAN-XBOW'`); err != nil {
		t.Fatal(err)
	}
	before = snapshot()
	if err = materializeMonsterWeaponLoadouts(db); err == nil {
		t.Fatal("conflicting action binding silently accepted")
	}
	if before != snapshot() {
		t.Fatal("rejected action conflict changed catalog")
	}
	if _, err = db.Exec(`UPDATE actions SET mechanics=jsonb_set(mechanics,'{requires_held_item}','"24700000-0000-4000-8000-000000000004"') WHERE card_number='RL-MA-VETERAN-XBOW';
 UPDATE monsters SET ai=jsonb_set(ai,'{action_weapon_ids}','{}') WHERE slug='bandit-captain'`); err != nil {
		t.Fatal(err)
	}
	before = snapshot()
	if err = materializeMonsterWeaponLoadouts(db); err == nil {
		t.Fatal("conflicting monster loadout silently accepted")
	}
	if before != snapshot() {
		t.Fatal("rejected monster conflict changed catalog")
	}
}
