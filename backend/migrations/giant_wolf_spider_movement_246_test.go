package migrations

import "testing"

func TestGiantWolfSpiderMovementPreservesAIAndIsIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	_, err := db.Exec(`CREATE TABLE monsters(slug text PRIMARY KEY,armor_class int,max_hp int,speed int,ai jsonb NOT NULL DEFAULT '{}',deleted_at timestamptz,updated_at timestamptz DEFAULT NOW());
 INSERT INTO monsters(slug,armor_class,max_hp,speed,ai) VALUES
 ('giant-wolf-spider',13,11,40,'{"darkvision_ft":60,"custom":"keep"}'),('other',1,1,10,'{}');`)
	if err != nil {
		t.Fatal(err)
	}
	if err = materializeGiantWolfSpiderMovement(db); err != nil {
		t.Fatal(err)
	}
	var snapshot string
	if err = db.QueryRow(`SELECT jsonb_agg(to_jsonb(m) ORDER BY slug)::text FROM monsters m`).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	var valid bool
	if err = db.QueryRow(`SELECT ai->>'custom'='keep' AND ai->>'darkvision_ft'='60' AND ai @> $1::jsonb
 FROM monsters WHERE slug='giant-wolf-spider'`, giantWolfSpiderMovement246).Scan(&valid); err != nil || !valid {
		t.Fatalf("movement declaration or prior AI lost: %v", err)
	}
	if err = materializeGiantWolfSpiderMovement(db); err != nil {
		t.Fatal(err)
	}
	var repeated string
	if err = db.QueryRow(`SELECT jsonb_agg(to_jsonb(m) ORDER BY slug)::text FROM monsters m`).Scan(&repeated); err != nil {
		t.Fatal(err)
	}
	if snapshot != repeated {
		t.Fatal("repeated migration changed catalog")
	}
	if _, err = db.Exec(`UPDATE monsters SET speed=30 WHERE slug='giant-wolf-spider'`); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT jsonb_agg(to_jsonb(m) ORDER BY slug)::text FROM monsters m`).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	if err = materializeGiantWolfSpiderMovement(db); err == nil {
		t.Fatal("changed stat block silently accepted")
	}
	if err = db.QueryRow(`SELECT jsonb_agg(to_jsonb(m) ORDER BY slug)::text FROM monsters m`).Scan(&repeated); err != nil {
		t.Fatal(err)
	}
	if snapshot != repeated {
		t.Fatal("rejected migration changed catalog")
	}
	var speed int
	if err = db.QueryRow(`SELECT speed FROM monsters WHERE slug='giant-wolf-spider'`).Scan(&speed); err != nil || speed != 30 {
		t.Fatalf("rejected migration changed catalog: %d (%v)", speed, err)
	}
	if _, err = db.Exec(`UPDATE monsters SET speed=40,ai=jsonb_set(ai,'{movement_speeds}','{"walk":30,"climb":40}') WHERE slug='giant-wolf-spider'`); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT jsonb_agg(to_jsonb(m) ORDER BY slug)::text FROM monsters m`).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	if err = materializeGiantWolfSpiderMovement(db); err == nil {
		t.Fatal("conflicting movement declaration silently accepted")
	}
	if err = db.QueryRow(`SELECT jsonb_agg(to_jsonb(m) ORDER BY slug)::text FROM monsters m`).Scan(&repeated); err != nil {
		t.Fatal(err)
	}
	if snapshot != repeated {
		t.Fatal("rejected conflicting declaration changed catalog")
	}
}
