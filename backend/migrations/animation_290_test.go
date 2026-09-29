package migrations

import "testing"

func TestAnimation290AddsCriticalProfilesWithoutChangingCustomPresentation(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "ANIMATION_TEST_DATABASE_URL")
	_, err := db.Exec(`CREATE TABLE animation_profiles(key text PRIMARY KEY,definition jsonb NOT NULL);
	 CREATE TABLE entity_animation_bindings(entity_type text,entity_id text,profile_key text REFERENCES animation_profiles(key),PRIMARY KEY(entity_type,entity_id));
	 INSERT INTO animation_profiles VALUES
	 ('weapon.slash','{"key":"weapon.slash","custom":true}'),
	 ('weapon.arrow','{"key":"weapon.arrow","custom":true}'),
	 ('weapon.slash.critical','{"key":"weapon.slash.critical","custom":true,"motion":{"durationMs":1900}}');
	 INSERT INTO entity_animation_bindings VALUES('action','first-entity','weapon.slash'),('action','second-entity','weapon.arrow');`)
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := addCriticalWeaponAnimations290(db); err != nil {
			t.Fatal(err)
		}
	}
	for _, check := range []struct{ query, want string }{
		{`SELECT count(*)::text FROM animation_profiles WHERE definition->>'strikeStyle'='critical'`, "15"},
		{`SELECT definition->'motion'->>'durationMs' FROM animation_profiles WHERE key='weapon.slash.critical'`, "1900"},
		{`SELECT count(*)::text FROM animation_profiles WHERE definition->>'custom'='true'`, "3"},
		{`SELECT profile_key FROM entity_animation_bindings WHERE entity_id='first-entity'`, "weapon.slash"},
		{`SELECT profile_key FROM entity_animation_bindings WHERE entity_id='second-entity'`, "weapon.arrow"},
		{`SELECT definition->>'primitive' FROM animation_profiles WHERE key='weapon.arrow.critical'`, "ranged_arrow"},
		{`SELECT definition->>'weaponShape' FROM animation_profiles WHERE key='weapon.throw-hammer.critical'`, "hammer"},
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
