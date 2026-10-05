// Explicit local fixture producer. It never calls the historical migrator or
// changes its ledger: existing migration seeds run only in an empty owned schema.
package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"

	"dnd-cards-backend/migrations"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type fixture struct {
	SchemaVersion int                          `json:"schemaVersion"`
	Kind          string                       `json:"kind"`
	SeedVersions  []string                     `json:"seedVersions"`
	Mode          json.RawMessage              `json:"mode"`
	Collections   map[string][]json.RawMessage `json:"collections"`
}

func fail(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "Owned Urvin fixture export failed; database details omitted")
		os.Exit(1)
	}
}

func export() (result fixture, returned error) {
	runID := os.Getenv("TEST_RUN_ID")
	if !regexp.MustCompile(`^test_[a-f0-9]{24}$`).MatchString(runID) {
		return result, fmt.Errorf("invalid run id")
	}
	parsed, err := url.Parse(os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		return result, err
	}
	if (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") || parsed.Hostname() != "127.0.0.1" || parsed.Path != "/"+runID || parsed.Port() == "" || parsed.User == nil || parsed.User.Username() != "test_runner" || parsed.Query().Get("sslmode") != "disable" {
		return result, fmt.Errorf("unowned target")
	}
	if len(parsed.Query()) != 1 || parsed.Fragment != "" {
		return result, fmt.Errorf("unexpected database options")
	}
	db, err := sql.Open("pgx", parsed.String())
	if err != nil {
		return result, err
	}
	defer db.Close()
	var marker string
	if err = db.QueryRow(`SELECT current_database()||':'||run_id FROM public.test_run_ownership`).Scan(&marker); err != nil || marker != runID+":"+runID {
		return result, fmt.Errorf("ownership marker mismatch")
	}
	var entropy [8]byte
	if _, err = rand.Read(entropy[:]); err != nil {
		return result, err
	}
	schema := "urvin_fixture_" + hex.EncodeToString(entropy[:])
	if _, err = db.Exec(`CREATE SCHEMA ` + schema); err != nil {
		return result, err
	}
	defer func() {
		if _, err := db.Exec(`DROP SCHEMA ` + schema + ` CASCADE`); err != nil && returned == nil {
			returned = fmt.Errorf("fixture cleanup failed")
		}
	}()
	for _, table := range []string{"actions", "effects", "monsters", "roguelike_runs", "roguelike_mode_definitions"} {
		if _, err = db.Exec(`CREATE TABLE ` + schema + `.` + table + ` (LIKE public.` + table + ` INCLUDING ALL)`); err != nil {
			return result, err
		}
	}
	query := parsed.Query()
	query.Set("search_path", schema+",public")
	parsed.RawQuery = query.Encode()
	isolated, err := sql.Open("pgx", parsed.String())
	if err != nil {
		return result, err
	}
	defer isolated.Close()
	wanted := []string{"199_materialize_roguelike_monsters", "273_urvin_run"}
	for _, version := range wanted {
		found := false
		for _, migration := range migrations.GetAllMigrations() {
			if migration.Version == version {
				found = true
				if err = migration.Up(isolated); err != nil {
					return result, err
				}
				break
			}
		}
		if !found {
			return result, fmt.Errorf("seed missing")
		}
	}
	var raw []byte
	if err = isolated.QueryRow(`SELECT definition FROM roguelike_mode_definitions WHERE id='urvin'`).Scan(&raw); err != nil {
		return result, err
	}
	result = fixture{SchemaVersion: 1, Kind: "generated-public-seed-only", SeedVersions: wanted, Mode: raw, Collections: map[string][]json.RawMessage{}}
	var mode struct {
		Version int `json:"version"`
		Auras   []struct {
			ID string `json:"id"`
		} `json:"auras"`
		Encounters []struct {
			Monsters []struct {
				Slug string `json:"slug"`
			} `json:"monsters"`
		} `json:"encounters"`
	}
	if err = json.Unmarshal(raw, &mode); err != nil {
		return result, err
	}
	if mode.Version != 1 || len(mode.Auras) != 5 {
		return result, fmt.Errorf("unsupported mode seed")
	}
	slugSet := map[string]bool{}
	for _, encounter := range mode.Encounters {
		for _, monster := range encounter.Monsters {
			slugSet[monster.Slug] = true
		}
	}
	slugs := []string{}
	for slug := range slugSet {
		slugs = append(slugs, slug)
	}
	sort.Strings(slugs)
	uuid := regexp.MustCompile(`^[a-f0-9-]{36}$`)
	selectRow := func(table, key, value string) (json.RawMessage, error) {
		var row []byte
		err := isolated.QueryRow(`SELECT to_jsonb(row) FROM `+table+` row WHERE `+key+`=$1 AND deleted_at IS NULL`, value).Scan(&row)
		return row, err
	}
	actionSet := map[string]bool{}
	effectSet := map[string]bool{}
	for _, aura := range mode.Auras {
		if !uuid.MatchString(aura.ID) {
			return result, fmt.Errorf("invalid aura id")
		}
		effectSet[aura.ID] = true
	}
	for _, slug := range slugs {
		row, err := selectRow("monsters", "slug", slug)
		if err != nil {
			return result, err
		}
		result.Collections["monsters"] = append(result.Collections["monsters"], row)
		var monster struct {
			Actions []string `json:"action_ids"`
			Effects []string `json:"effect_ids"`
		}
		if err = json.Unmarshal(row, &monster); err != nil {
			return result, err
		}
		for _, id := range monster.Actions {
			if !uuid.MatchString(id) {
				return result, fmt.Errorf("invalid action id")
			}
			actionSet[id] = true
		}
		for _, id := range monster.Effects {
			if !uuid.MatchString(id) {
				return result, fmt.Errorf("invalid effect id")
			}
			effectSet[id] = true
		}
	}
	for table, ids := range map[string]map[string]bool{"actions": actionSet, "effects": effectSet} {
		keys := []string{}
		for id := range ids {
			keys = append(keys, id)
		}
		sort.Strings(keys)
		for _, id := range keys {
			row, err := selectRow(table, "id", id)
			if err != nil {
				return result, err
			}
			result.Collections[table] = append(result.Collections[table], row)
		}
	}
	// No owner data can enter this exporter: every selected row was generated in
	// an initially empty schema. The JS loader still rejects private fields before
	// dropping source metadata and replacing automatic historic support statuses.
	if len(result.Collections["monsters"]) != len(slugs) || len(slugs) == 0 {
		return result, fmt.Errorf("empty closure")
	}
	return result, nil
}
func main() {
	result, err := export()
	fail(err)
	raw, err := json.Marshal(result)
	fail(err)
	fmt.Println(strings.TrimSpace(string(raw)))
}
