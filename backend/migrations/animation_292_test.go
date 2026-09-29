package migrations

import "testing"

func TestAnimation292AddsMagicCriticalProfilesWithoutChangingCustomPresentation(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "ANIMATION_TEST_DATABASE_URL")
	_, err := db.Exec(`CREATE TABLE animation_profiles(key text PRIMARY KEY,definition jsonb NOT NULL);
	 CREATE TABLE entity_animation_bindings(entity_type text,entity_id text,profile_key text REFERENCES animation_profiles(key),PRIMARY KEY(entity_type,entity_id));
	 INSERT INTO animation_profiles VALUES
	 ('spell.eldritch-blast','{"key":"spell.eldritch-blast","custom":true}'),
	 ('spell.fire-bolt','{"key":"spell.fire-bolt","custom":true}'),
	 ('spell.eldritch-blast.critical','{"key":"spell.eldritch-blast.critical","custom":true,"motion":{"durationMs":2100}}');
	 INSERT INTO entity_animation_bindings VALUES('spell','first-entity','spell.eldritch-blast'),('spell','second-entity','spell.fire-bolt');`)
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := addCriticalSpellAnimations292(db); err != nil {
			t.Fatal(err)
		}
	}
	for _, check := range []struct{ query, want string }{
		{`SELECT count(*)::text FROM animation_profiles WHERE definition->>'criticalEffect'='magic'`, "28"},
		{`SELECT definition->'motion'->>'durationMs' FROM animation_profiles WHERE key='spell.eldritch-blast.critical'`, "2100"},
		{`SELECT count(*)::text FROM animation_profiles WHERE definition->>'custom'='true'`, "3"},
		{`SELECT profile_key FROM entity_animation_bindings WHERE entity_id='first-entity'`, "spell.eldritch-blast"},
		{`SELECT profile_key FROM entity_animation_bindings WHERE entity_id='second-entity'`, "spell.fire-bolt"},
		{`SELECT definition->>'primitive' FROM animation_profiles WHERE key='spell.frost-ray.critical'`, "charged_beam"},
		{`SELECT definition->>'primitive' FROM animation_profiles WHERE key='spell.fire-bolt.critical'`, "projectile"},
		{`SELECT definition->>'weaponShape' FROM animation_profiles WHERE key='spell.ice-knife.critical'`, "blade"},
	} {
		var got string
		if err := db.QueryRow(check.query).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != check.want {
			t.Fatalf("%s: got %q, want %q", check.query, got, check.want)
		}
	}
}
