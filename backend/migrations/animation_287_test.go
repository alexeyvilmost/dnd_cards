package migrations

import (
	"encoding/json"
	"testing"
)

func TestAnimation287PreservesCustomPresentationAndDeletedAssignments(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "ANIMATION_TEST_DATABASE_URL")
	_, err := db.Exec(`CREATE TABLE spells(id text PRIMARY KEY,deleted_at timestamptz);
	 CREATE TABLE actions(id text PRIMARY KEY,deleted_at timestamptz);
	 CREATE TABLE animation_profiles(key text PRIMARY KEY,definition jsonb NOT NULL);
	 CREATE TABLE entity_animation_bindings(entity_type text,entity_id text,profile_key text REFERENCES animation_profiles(key),PRIMARY KEY(entity_type,entity_id));
	 INSERT INTO animation_profiles VALUES('custom', '{"key":"custom","primitive":"aura"}'),('natural.bite', '{"key":"natural.bite"}');
	 INSERT INTO actions VALUES('b2730000-0000-4000-8000-000000000003',NULL),('b2000000-0000-4000-8000-000000000010',NULL),('4720c0d0-6610-40e2-812b-4aa0a1bb8449',NULL);
	 INSERT INTO entity_animation_bindings VALUES('action','b2000000-0000-4000-8000-000000000010','custom');`)
	if err != nil {
		t.Fatal(err)
	}
	var delta animation287Delta
	if err := json.Unmarshal(animation287DeltaJSON, &delta); err != nil {
		t.Fatal(err)
	}
	for _, profile := range delta.Profiles {
		var identity struct {
			Key string `json:"key"`
		}
		if err := json.Unmarshal(profile.Definition, &identity); err != nil {
			t.Fatal(err)
		}
		if identity.Key == "spell.frost-ray" {
			_, err = db.Exec(`INSERT INTO animation_profiles VALUES($1,$2::jsonb)`, identity.Key, string(profile.PreviousDefinition))
		} else if identity.Key == "spell.eldritch-blast" {
			_, err = db.Exec(`INSERT INTO animation_profiles VALUES($1,'{"key":"spell.eldritch-blast","primitive":"aura","custom":true}')`, identity.Key)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		if err := expandCombatAnimation287(db); err != nil {
			t.Fatal(err)
		}
	}
	for _, check := range []struct{ sql, want string }{
		{`SELECT profile_key FROM entity_animation_bindings WHERE entity_id='b2730000-0000-4000-8000-000000000003'`, "natural.fire-bite"},
		{`SELECT profile_key FROM entity_animation_bindings WHERE entity_id='b2000000-0000-4000-8000-000000000010'`, "custom"},
		{`SELECT definition->>'primitive' FROM animation_profiles WHERE key='spell.frost-ray'`, "charged_beam"},
		{`SELECT definition->>'primitive' FROM animation_profiles WHERE key='spell.eldritch-blast'`, "aura"},
		{`SELECT count(*)::text FROM entity_animation_bindings WHERE entity_id='4720c0d0-6610-40e2-812b-4aa0a1bb8449'`, "0"},
		{`SELECT count(*)::text FROM entity_animation_bindings WHERE entity_type='spell'`, "0"},
	} {
		var got string
		if err := db.QueryRow(check.sql).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != check.want {
			t.Fatalf("%s: got %q, want %q", check.sql, got, check.want)
		}
	}
}

func TestAnimation287RepairsOnlyOriginalUnarmedAssignment(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "ANIMATION_TEST_DATABASE_URL")
	_, err := db.Exec(`CREATE TABLE spells(id text PRIMARY KEY,deleted_at timestamptz);
	 CREATE TABLE actions(id text PRIMARY KEY,deleted_at timestamptz);
	 CREATE TABLE animation_profiles(key text PRIMARY KEY,definition jsonb NOT NULL);
	 CREATE TABLE entity_animation_bindings(entity_type text,entity_id text,profile_key text REFERENCES animation_profiles(key),PRIMARY KEY(entity_type,entity_id));
	 INSERT INTO animation_profiles VALUES('weapon.bash', '{}');
	 INSERT INTO actions VALUES('4720c0d0-6610-40e2-812b-4aa0a1bb8449',NULL);
	 INSERT INTO entity_animation_bindings VALUES('action','4720c0d0-6610-40e2-812b-4aa0a1bb8449','weapon.bash');`)
	if err != nil {
		t.Fatal(err)
	}
	if err := expandCombatAnimation287(db); err != nil {
		t.Fatal(err)
	}
	var got string
	if err := db.QueryRow(`SELECT profile_key FROM entity_animation_bindings`).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != "natural.slam" {
		t.Fatalf("got %q", got)
	}
}
