package migrations

import "testing"

func TestDashMovementPreservesCostAndGuard(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	_, err := db.Exec(`CREATE TABLE actions(card_number text PRIMARY KEY, mechanics jsonb, support jsonb, updated_at timestamptz DEFAULT NOW());
 CREATE FUNCTION qa_dash_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'guard active'; END; $$;
 CREATE TRIGGER protect_actions_certified_mechanics BEFORE UPDATE ON actions FOR EACH ROW EXECUTE FUNCTION qa_dash_guard()`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO actions(card_number,mechanics,support) VALUES ('action_basic_dash',jsonb_build_object('activation','{"mode":"active","cost":[{"resource":"action"}]}'::jsonb,'effects',$1::jsonb,'targeting','{"shape":"self"}'::jsonb),'{"mechanics_locked":true}'),('other','{}',NULL)`, legacyDashSpeed243)
	if err != nil {
		t.Fatal(err)
	}
	var guard string
	if err = db.QueryRow(`SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='protect_actions_certified_mechanics' AND tgrelid='actions'::regclass`).Scan(&guard); err != nil {
		t.Fatal(err)
	}
	if err = materializeDashMovement(db); err != nil {
		t.Fatal(err)
	}
	var valid bool
	if err = db.QueryRow(`SELECT mechanics='{"activation":{"mode":"active","counts_as":"dash","cost":[{"resource":"action"}]},"effects":[],"targeting":{"shape":"self"}}'::jsonb AND support IS NULL FROM actions WHERE card_number='action_basic_dash'`).Scan(&valid); err != nil || !valid {
		t.Fatalf("Unexpected Dash declaration: %v", err)
	}
	var before, after, restored string
	if err = db.QueryRow(`SELECT jsonb_agg(to_jsonb(actions) ORDER BY card_number)::text FROM actions`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err = materializeDashMovement(db); err != nil {
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

func TestDashMovementRejectsUnexpectedEffectsWithoutChanges(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	_, err := db.Exec(`CREATE TABLE actions(card_number text PRIMARY KEY,mechanics jsonb,support jsonb,updated_at timestamptz DEFAULT NOW()); INSERT INTO actions(card_number,mechanics) VALUES('action_basic_dash','{"effects":[{"result":[{"kind":"healing","amount":1}]}]}')`)
	if err != nil {
		t.Fatal(err)
	}
	if err = materializeDashMovement(db); err == nil {
		t.Fatal("Unrecognized action was silently overwritten")
	}
	var valid bool
	if err = db.QueryRow(`SELECT mechanics='{"effects":[{"result":[{"kind":"healing","amount":1}]}]}'::jsonb FROM actions`).Scan(&valid); err != nil || !valid {
		t.Fatal("Rejected migration changed data")
	}
}
