package migrations

import "testing"

func TestTacticalMindTimingPreservesCostAndBoonAndRestoresGuard(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	_, err := db.Exec(`CREATE TABLE actions(card_number text PRIMARY KEY, mechanics jsonb, support jsonb, updated_at timestamptz DEFAULT NOW());
 INSERT INTO actions(card_number, mechanics, support) VALUES
 ('ACT-tactical-mind','{"activation":{"mode":"active","cost":[{"resource":"uses_ACT-second-wind"}]},"targeting":{"shape":"self"},"effects":[{"resolution":"auto","result":[{"kind":"grant_effect","value":"EFFECT-tactical-mind-die"}]}]}','{"mechanics_locked":true}'),
 ('other','{"activation":{"mode":"active"}}',NULL);
 CREATE FUNCTION qa_protect_tactical() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'guard active'; END; $$;
 CREATE TRIGGER protect_actions_certified_mechanics BEFORE UPDATE ON actions FOR EACH ROW EXECUTE FUNCTION qa_protect_tactical()`)
	if err != nil {
		t.Fatal(err)
	}
	var beforeGuard string
	if err = db.QueryRow(`SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='protect_actions_certified_mechanics' AND tgrelid='actions'::regclass`).Scan(&beforeGuard); err != nil {
		t.Fatal(err)
	}
	if err = materializeFighterTacticalMindTiming(db); err != nil {
		t.Fatal(err)
	}
	var valid bool
	err = db.QueryRow(`SELECT mechanics = '{"activation":{"mode":"triggered","trigger":{"events":["ability_check_failed"]},"cost":[{"resource":"uses_ACT-second-wind"}]},"targeting":{"shape":"self"},"effects":[{"resolution":"auto","result":[{"kind":"grant_effect","value":"EFFECT-tactical-mind-die"}]}]}'::jsonb AND support IS NULL FROM actions WHERE card_number='ACT-tactical-mind'`).Scan(&valid)
	if err != nil || !valid {
		t.Fatalf("Incorrect timing migration: %v", err)
	}
	var before, after, afterGuard string
	if err = db.QueryRow(`SELECT jsonb_agg(to_jsonb(actions) ORDER BY card_number)::text FROM actions`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err = materializeFighterTacticalMindTiming(db); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT jsonb_agg(to_jsonb(actions) ORDER BY card_number)::text FROM actions`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("Repeated migration changed rows")
	}
	if err = db.QueryRow(`SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='protect_actions_certified_mechanics' AND tgrelid='actions'::regclass`).Scan(&afterGuard); err != nil {
		t.Fatal(err)
	}
	if beforeGuard != afterGuard {
		t.Fatal("Installed guard definition changed")
	}
	if _, err = db.Exec(`UPDATE actions SET mechanics='{}' WHERE card_number='other'`); err == nil {
		t.Fatal("Guard not restored")
	}
	if err = db.QueryRow(`SELECT mechanics = '{"activation":{"mode":"active"}}'::jsonb FROM actions WHERE card_number='other'`).Scan(&valid); err != nil || !valid {
		t.Fatal("Unrelated action changed")
	}
}
