package migrations

import "testing"

func TestHideActionPreservesCostAndGuard(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	_, err := db.Exec(`CREATE TABLE actions(id uuid, name text, name_en text, description text, image_url text, rarity text, card_number text PRIMARY KEY, action_type text, type text, resource text, mechanics jsonb, author text, source text, support jsonb, deleted_at timestamptz, updated_at timestamptz DEFAULT NOW());
 CREATE FUNCTION qa_hide_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'guard active'; END; $$;
 CREATE TRIGGER protect_actions_certified_mechanics BEFORE UPDATE ON actions FOR EACH ROW EXECUTE FUNCTION qa_hide_guard()`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO actions(card_number,mechanics,support) VALUES ('ACT-cunning-hide',jsonb_build_object('activation','{"mode":"active","cost":[{"resource":"bonus_action"}]}'::jsonb,'effects',$1::jsonb,'targeting','{"shape":"self"}'::jsonb),'{"mechanics_locked":true}'),('other','{}',NULL)`, legacyCunningHide244)
	if err != nil {
		t.Fatal(err)
	}
	var guard string
	if err = db.QueryRow(`SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='protect_actions_certified_mechanics' AND tgrelid='actions'::regclass`).Scan(&guard); err != nil {
		t.Fatal(err)
	}
	if err = materializeHideAction(db); err != nil {
		t.Fatal(err)
	}
	var valid bool
	if err = db.QueryRow(`SELECT mechanics='{"activation":{"mode":"active","counts_as":"hide","cost":[{"resource":"bonus_action"}]},"effects":[],"targeting":{"shape":"self","domain":"actor","actor_targets":false,"min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]}}'::jsonb AND support IS NULL FROM actions WHERE card_number='ACT-cunning-hide'`).Scan(&valid); err != nil || !valid {
		t.Fatalf("Unexpected Hide declaration: %v", err)
	}
	var before, after, restored string
	if err = db.QueryRow(`SELECT jsonb_agg(to_jsonb(actions) ORDER BY card_number)::text FROM actions`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err = materializeHideAction(db); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT jsonb_agg(to_jsonb(actions) ORDER BY card_number)::text FROM actions`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("Repeated migration changed data")
	}
	if err = db.QueryRow(`SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='protect_actions_certified_mechanics' AND tgrelid='actions'::regclass`).Scan(&restored); err != nil || restored != guard {
		t.Fatal("Guard definition changed")
	}
	if _, err = db.Exec(`UPDATE actions SET mechanics='{}' WHERE card_number='other'`); err == nil {
		t.Fatal("Guard not restored")
	}
}

func TestHideActionRejectsUnexpectedEffectsWithoutChanges(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	_, err := db.Exec(`CREATE TABLE actions(card_number text PRIMARY KEY,mechanics jsonb,support jsonb,updated_at timestamptz DEFAULT NOW()); INSERT INTO actions(card_number,mechanics) VALUES('ACT-cunning-hide','{"effects":[{"result":[{"kind":"healing","amount":1}]}]}')`)
	if err != nil {
		t.Fatal(err)
	}
	if err = materializeHideAction(db); err == nil {
		t.Fatal("Unrecognized action was silently overwritten")
	}
	var valid bool
	if err = db.QueryRow(`SELECT mechanics='{"effects":[{"result":[{"kind":"healing","amount":1}]}]}'::jsonb FROM actions`).Scan(&valid); err != nil || !valid {
		t.Fatal("Rejected migration changed data")
	}
}
