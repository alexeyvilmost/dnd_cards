package migrations

import (
	"strings"
	"testing"
)

func TestFrozenCatalogMigrationKeepsLegacyAndReferences(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CANONICAL_RUNTIME_TEST_DSN")
	if _, err := db.Exec(`CREATE TABLE roguelike_runs(id uuid PRIMARY KEY,user_id uuid NOT NULL,combat_catalog jsonb NOT NULL); INSERT INTO roguelike_runs VALUES(gen_random_uuid(),gen_random_uuid(),'{"old":"untouched"}');`); err != nil {
		t.Fatal(err)
	}
	if err := addFrozenCatalogs299(db); err != nil {
		t.Fatal(err)
	}
	if err := addFrozenCatalogs299(db); err != nil {
		t.Fatal(err)
	}
	var legacy string
	db.QueryRow("SELECT combat_catalog::text FROM roguelike_runs").Scan(&legacy)
	if legacy != `{"old": "untouched"}` {
		t.Fatal("historical catalog changed")
	}
	const owner = "00000000-0000-0000-0000-000000000001"
	hash := strings.Repeat("a", 64)
	if _, err := db.Exec(`INSERT INTO frozen_combat_catalogs(user_id,content_hash,serializer_version,protocol_version,artifact_hash,payload) VALUES($1,$2,1,1,$3,'{}')`, owner, hash, "sha256:"+hash); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{"DELETE FROM frozen_combat_catalogs", `UPDATE frozen_combat_catalogs SET payload='{"changed":true}'`} {
		if _, err := db.Exec(sql); err == nil {
			t.Fatal("immutable catalog changed")
		}
	}
	if _, err := db.Exec(`UPDATE roguelike_runs SET combat_catalog_ref=$1`, hash); err == nil {
		t.Fatal("foreign owner catalog reference accepted")
	}
	if _, err := db.Exec(`INSERT INTO roguelike_runs(id,user_id,combat_catalog,combat_catalog_ref) VALUES(gen_random_uuid(),$1,'{}',$2)`, owner, hash); err != nil {
		t.Fatal(err)
	}
}
