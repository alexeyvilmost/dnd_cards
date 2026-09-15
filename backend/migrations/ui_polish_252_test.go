package migrations

import "testing"

func TestPortrait252PreservesCustomArtAndIsIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	if err := createCharacterTemplates250(db); err != nil {
		t.Fatal(err)
	}
	_, err := db.Exec(`CREATE TABLE characters_v3(id uuid PRIMARY KEY, avatar_url text, race_id uuid, class_id uuid,lineage_id text,resolved_choices jsonb,updated_at timestamptz);
 CREATE TABLE roguelike_runs(character_id uuid,source_character_id uuid);
 UPDATE character_templates SET character=character-'avatar_url';
 INSERT INTO characters_v3(id,avatar_url,race_id,class_id,lineage_id,resolved_choices)
 SELECT id,'',(character->>'race_id')::uuid,(character->>'class_id')::uuid,character->>'lineage_id',character->'resolved_choices' FROM character_templates;
 UPDATE characters_v3 SET avatar_url='/my-own.png' WHERE id='d2500000-0000-4000-8000-000000000003';
 INSERT INTO characters_v3(id,avatar_url,race_id,class_id,lineage_id,resolved_choices)
 SELECT 'd2520000-0000-4000-8000-000000000001','',race_id,class_id,lineage_id,'{}'::jsonb FROM characters_v3 LIMIT 1;`)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err = updateTemplatePortraits252(db); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err = db.QueryRow(`SELECT count(*) FROM characters_v3 WHERE avatar_url LIKE '/portraits/presets/%'`).Scan(&count); err != nil || count != 2 {
		t.Fatal(count, err)
	}
	var avatar string
	if err = db.QueryRow(`SELECT avatar_url FROM characters_v3 WHERE id='d2500000-0000-4000-8000-000000000003'`).Scan(&avatar); err != nil || avatar != "/my-own.png" {
		t.Fatal(avatar, err)
	}
	if err = db.QueryRow(`SELECT avatar_url FROM characters_v3 WHERE id='d2520000-0000-4000-8000-000000000001'`).Scan(&avatar); err != nil || avatar != "" {
		t.Fatal(avatar, err)
	}
	if err = db.QueryRow(`SELECT count(*) FROM character_templates WHERE version=2`).Scan(&count); err != nil || count != 3 {
		t.Fatal(count, err)
	}
	if err = db.QueryRow(`SELECT count(*) FROM migration_252_portrait_preimages`).Scan(&count); err != nil || count != 5 {
		t.Fatal(count, err)
	}
}

func TestPassive253PreservesAdministratorPresentation(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	if err := createPassivePresentations253(db); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE passive_presentations SET name='Edited',version=2 WHERE key='mastery.slow'`); err != nil {
		t.Fatal(err)
	}
	if err := createPassivePresentations253(db); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM passive_presentations`).Scan(&count); err != nil || count != 6 {
		t.Fatal(count, err)
	}
	var name string
	if err := db.QueryRow(`SELECT name FROM passive_presentations WHERE key='mastery.slow' AND version=2`).Scan(&name); err != nil || name != "Edited" {
		t.Fatal(name, err)
	}
}
