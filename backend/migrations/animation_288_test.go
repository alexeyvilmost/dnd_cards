package migrations

import (
	"encoding/json"
	"testing"
)

func TestAnimation288UpdatesAuthoredForceButPreservesCustomProfiles(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "ANIMATION_TEST_DATABASE_URL")
	if _, err := db.Exec(`CREATE TABLE animation_profiles(key text PRIMARY KEY,definition jsonb NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	var delta animation287Delta
	if err := json.Unmarshal(animation288DeltaJSON, &delta); err != nil {
		t.Fatal(err)
	}
	for _, profile := range delta.Profiles {
		var identity struct {
			Key string `json:"key"`
		}
		if err := json.Unmarshal(profile.Definition, &identity); err != nil {
			t.Fatal(err)
		}
		if identity.Key == "spell.eldritch-blast" || identity.Key == "spell.force" {
			if _, err := db.Exec(`INSERT INTO animation_profiles VALUES($1,$2::jsonb)`, identity.Key, string(profile.PreviousDefinition)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, err := db.Exec(`INSERT INTO animation_profiles VALUES('spell.shield','{"key":"spell.shield","palette":{"primary":"#123456"},"custom":true}'),('spell.fire','{"key":"spell.fire","palette":{"primary":"#ff7a29"}}')`); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := updateForceAnimation288(db); err != nil {
			t.Fatal(err)
		}
	}
	for _, check := range []struct{ key, want string }{
		{"spell.eldritch-blast", "#ef4444"}, {"spell.force", "#ef4444"}, {"spell.shield", "#123456"}, {"spell.fire", "#ff7a29"},
	} {
		var got string
		if err := db.QueryRow(`SELECT definition->'palette'->>'primary' FROM animation_profiles WHERE key=$1`, check.key).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != check.want {
			t.Fatalf("%s: got %s, want %s", check.key, got, check.want)
		}
	}
}
