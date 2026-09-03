package migrations

import (
	"database/sql"
	"encoding/json"
	"os"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestAasimarMobileRadianceContract(t *testing.T) {
	if mobileEmanationsMigrationVersion != "196_materialize_mobile_emanations" {
		t.Fatalf("unexpected migration version %q", mobileEmanationsMigrationVersion)
	}
	var mechanics map[string]any
	if err := json.Unmarshal([]byte(aasimarMobileRadianceActionMechanics), &mechanics); err != nil {
		t.Fatalf("parse mechanics: %v", err)
	}
	effects := mechanics["effects"].([]any)
	choice := effects[0].(map[string]any)
	options := choice["options"].(map[string]any)["items"].([]any)
	radiance := options[1].(map[string]any)
	grants := radiance["grants"].([]any)
	zone := grants[1].(map[string]any)
	tactical := zone["tactical"].(map[string]any)
	geometry := zone["geometry"].(map[string]any)
	if zone["kind"] != "world_zone" || tactical["anchor"] != "source" ||
		geometry["shape"] != "emanation" || geometry["size_ft"] != float64(10) {
		t.Fatalf("mobile radiance contract drifted: %#v", zone)
	}
	if tactical["triggers"].([]any)[0] != "end_turn" {
		t.Fatalf("mobile radiance trigger drifted: %#v", tactical)
	}
	if tactical["trigger_scope"] != "source_turn_all_inside" {
		t.Fatalf("mobile radiance trigger scope drifted: %#v", tactical)
	}
	damage := tactical["auto_effects"].([]any)[0].(map[string]any)
	if damage["dice"] != "prof_bonus" || damage["type"] != "radiant" {
		t.Fatalf("mobile radiance damage drifted: %#v", damage)
	}
}

func TestAasimarMobileRadianceAgainstPostgres(t *testing.T) {
	dsn := os.Getenv("MOBILE_EMANATIONS_196_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("MOBILE_EMANATIONS_196_TEST_DATABASE_URL is not configured")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = materializeMobileEmanations(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}
}
