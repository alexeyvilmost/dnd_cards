package migrations

import "testing"

func TestFighterStyleReplacementPreservesOtherChoicesAndIsIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	_, err := db.Exec(`CREATE TABLE effects(card_number text PRIMARY KEY, mechanics jsonb, updated_at timestamptz DEFAULT NOW());
 INSERT INTO effects VALUES ('EFF-fighting-style','{"activation":{"mode":"passive"},"effects":[{"id":"fighter_fighting_style","kind":"choice","count":1,"options":{"source":"feat","filter":"fighting_style"}},{"id":"other","count":2}]}',NOW()),
 ('other','{"effects":[{"id":"fighter_fighting_style"}]}',NOW())`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`ALTER TABLE effects ADD COLUMN support jsonb DEFAULT '{"mechanics_locked":true}';
 CREATE FUNCTION qa_protect_style() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'guard active'; END; $$;
 CREATE TRIGGER protect_effects_certified_mechanics BEFORE UPDATE ON effects FOR EACH ROW EXECUTE FUNCTION qa_protect_style()`); err != nil {
		t.Fatal(err)
	}
	if err = materializeFighterStyleReplacement(db); err != nil {
		t.Fatal(err)
	}
	var valid bool
	err = db.QueryRow(`SELECT mechanics = '{"activation":{"mode":"passive"},"effects":[{"id":"fighter_fighting_style","kind":"choice","count":1,"options":{"source":"feat","filter":"fighting_style"},"replace_on_level_up":1},{"id":"other","count":2}]}'::jsonb FROM effects WHERE card_number='EFF-fighting-style'`).Scan(&valid)
	if err != nil || !valid {
		t.Fatalf("style replacement declaration: %v", err)
	}
	var before, after string
	if err = db.QueryRow(`SELECT jsonb_agg(to_jsonb(effects) ORDER BY card_number)::text FROM effects`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err = materializeFighterStyleReplacement(db); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT jsonb_agg(to_jsonb(effects) ORDER BY card_number)::text FROM effects`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("repeat migration changed rows")
	}
	if _, err = db.Exec(`UPDATE effects SET mechanics='{}' WHERE card_number='other'`); err == nil {
		t.Fatal("mechanics guard was not restored")
	}
	if err = db.QueryRow(`SELECT mechanics = '{"effects":[{"id":"fighter_fighting_style"}]}'::jsonb FROM effects WHERE card_number='other'`).Scan(&valid); err != nil || !valid {
		t.Fatal("unrelated effect changed")
	}
}
