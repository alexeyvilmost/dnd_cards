package migrations

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
)

func TestCatalogPresentation307TransactionAndReplay(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, table := range []string{"actions", "effects", "spells"} {
		_, err := db.Exec(fmt.Sprintf(`CREATE TABLE %s(id uuid PRIMARY KEY,card_number text UNIQUE,name text DEFAULT '',description text DEFAULT '',mechanics jsonb,support jsonb,effect_type text,rarity text,image_url text,author text,source text,created_at timestamptz,updated_at timestamptz,deleted_at timestamptz)`, table))
		if err != nil {
			t.Fatal(err)
		}
	}
	var m struct {
		Actions []struct {
			ID          string
			CardNumber  string `json:"card_number"`
			IsNarrative bool   `json:"is_narrative"`
		}
		TechnicalEffects []struct {
			ID         string
			CardNumber string `json:"card_number"`
		} `json:"technical_effects"`
		Spells []struct {
			ID          string
			CardNumber  string `json:"card_number"`
			IsNarrative bool   `json:"is_narrative"`
		}
		Parents []struct {
			ID         string
			CardNumber string `json:"card_number"`
			Before     json.RawMessage
		}
		ActionUpdates []struct {
			ID         string
			CardNumber string `json:"card_number"`
			Before     json.RawMessage
		} `json:"action_updates"`
		Effects []struct {
			ID         string
			CardNumber string `json:"card_number"`
		}
	}
	if err := json.Unmarshal(catalogPresentation307JSON, &m); err != nil {
		t.Fatal(err)
	}
	insert := func(table, id, slug, mechanics string) {
		t.Helper()
		_, err := db.Exec(fmt.Sprintf(`INSERT INTO %s(id,card_number,mechanics,support) VALUES($1,$2,$3::jsonb,'{"status":"not_verified"}') ON CONFLICT(id) DO UPDATE SET mechanics=excluded.mechanics`, table), id, slug, mechanics)
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, a := range m.Actions {
		if a.IsNarrative {
			insert("actions", a.ID, a.CardNumber, "{}")
		}
	}
	for _, spell := range m.Spells {
		if spell.IsNarrative {
			insert("spells", spell.ID, spell.CardNumber, "{}")
		}
	}
	for _, e := range m.TechnicalEffects {
		insert("effects", e.ID, e.CardNumber, "{}")
	}
	for _, e := range m.Parents {
		insert("effects", e.ID, e.CardNumber, string(e.Before))
	}
	for _, a := range m.ActionUpdates {
		insert("actions", a.ID, a.CardNumber, string(a.Before))
	}
	if _, err := db.Exec(`CREATE TABLE saved_combat(snapshot jsonb); INSERT INTO saved_combat VALUES('{"choices":{"revelation":["wings"]}}')`); err != nil {
		t.Fatal(err)
	}
	_, schemaRequest := releaseFixtureOn(t, db)
	migrator := NewMigrator(db)
	if _, err := migrator.RunReleaseAdditive(context.Background(), schemaRequest); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TRIGGER invalidate_effect_support BEFORE INSERT OR UPDATE ON effects FOR EACH ROW EXECUTE FUNCTION invalidate_content_support()`); err != nil {
		t.Fatal(err)
	}
	apply := func() error {
		return migrator.ApplyCatalogPresentation(context.Background(), CatalogPresentationRequest{SchemaVersion: 1, ManifestHash: CatalogPresentationManifestHash()})
	}
	if err := apply(); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM effects WHERE card_number LIKE 'CHOICE-%'`).Scan(&count); err != nil || count != len(m.Effects) {
		t.Fatalf("expanded effects=%d, error=%v", count, err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM effects WHERE card_number LIKE 'CHOICE-%' AND support->>'status'='not_verified'`).Scan(&count); err != nil || count != len(m.Effects) {
		t.Fatalf("insert invalidator removed child review status: %d, %v", count, err)
	}
	expectedNarrative := 0
	for _, action := range m.Actions {
		if action.IsNarrative {
			expectedNarrative++
		}
	}
	if err := db.QueryRow(`SELECT count(*) FROM actions WHERE is_narrative`).Scan(&count); err != nil || count != expectedNarrative {
		t.Fatalf("narrative=%d, error=%v", count, err)
	}
	expectedNarrativeSpells := 0
	for _, spell := range m.Spells {
		if spell.IsNarrative {
			expectedNarrativeSpells++
		}
	}
	if err := db.QueryRow(`SELECT count(*) FROM spells WHERE is_narrative`).Scan(&count); err != nil || count != expectedNarrativeSpells {
		t.Fatalf("narrative spells=%d, error=%v", count, err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM effects WHERE is_technical`).Scan(&count); err != nil || count != len(m.TechnicalEffects) {
		t.Fatalf("technical=%d, error=%v", count, err)
	}
	var snapshot string
	if err := db.QueryRow(`SELECT snapshot->'choices'->'revelation'->>0 FROM saved_combat`).Scan(&snapshot); err != nil || snapshot != "wings" {
		t.Fatalf("saved combat changed: %s, %v", snapshot, err)
	}
	// Replaying a completed migration must retain a subsequent manual annotation.
	if _, err := db.Exec(`UPDATE actions SET is_narrative=false WHERE id=$1`, m.ActionUpdates[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE effects SET support='{"status":"verified_partial"}' WHERE id=$1`, m.Parents[0].ID); err != nil {
		t.Fatal(err)
	}
	if err := apply(); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := db.QueryRow(`SELECT support->>'status' FROM effects WHERE id=$1`, m.Parents[0].ID).Scan(&status); err != nil || status != "verified_partial" {
		t.Fatalf("replay erased review: %s, %v", status, err)
	}
	// A changed source fails atomically, including receipt and newly inserted rows.
	if _, err := db.Exec(`DELETE FROM entity_presentation_307_receipt`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE effects SET mechanics='{"changed":true}' WHERE id=$1`, m.Parents[0].ID); err != nil {
		t.Fatal(err)
	}
	if err := apply(); err == nil {
		t.Fatal("changed source accepted")
	}
	if err := db.QueryRow(`SELECT count(*) FROM entity_presentation_307_receipt`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("failed migration left receipt: %d, %v", count, err)
	}
}

func TestCatalogPresentation307RetainsManualReviewSemantics(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, table := range []string{"actions", "effects", "spells"} {
		if _, err := db.Exec(fmt.Sprintf(`CREATE TABLE %s(id uuid PRIMARY KEY,mechanics jsonb,support jsonb,version int DEFAULT 1,name text)`, table)); err != nil {
			t.Fatal(err)
		}
	}
	if err := addCatalogPresentation307(db); err != nil {
		t.Fatal(err)
	}
	var locks int
	if err := db.QueryRow(`SELECT count(*) FROM pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname='protect_certified_content_mechanics'`).Scan(&locks); err != nil || locks != 0 {
		t.Fatal("catalog lock restored", err)
	}
	for _, row := range []struct{ table, flag, id string }{
		{"actions", "is_narrative", "10000000-0000-4000-8000-000000000001"},
		{"effects", "is_technical", "20000000-0000-4000-8000-000000000002"},
	} {
		t.Run(row.table, func(t *testing.T) {
			if _, err := db.Exec(fmt.Sprintf(`CREATE TRIGGER review BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION invalidate_content_support()`, row.table)); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(fmt.Sprintf(`INSERT INTO %s(id,mechanics,support) VALUES($1,'{"value":1}','{"status":"verified"}')`, row.table), row.id); err != nil {
				t.Fatal(err)
			}
			check := func(expected string) {
				t.Helper()
				var actual string
				if err := db.QueryRow(fmt.Sprintf(`SELECT support->>'status' FROM %s WHERE id=$1`, row.table), row.id).Scan(&actual); err != nil || actual != expected {
					t.Fatalf("review=%s want=%s: %v", actual, expected, err)
				}
			}
			check("not_tested")
			if _, err := db.Exec(fmt.Sprintf(`UPDATE %s SET support='{"status":"verified_partial","mechanics_locked":true}' WHERE id=$1`, row.table), row.id); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(fmt.Sprintf(`UPDATE %s SET %s=true,name='presentation',version=version+1 WHERE id=$1`, row.table, row.flag), row.id); err != nil {
				t.Fatal(err)
			}
			check("verified_partial")
			if _, err := db.Exec(fmt.Sprintf(`UPDATE %s SET mechanics='{"value":2}' WHERE id=$1`, row.table), row.id); err != nil {
				t.Fatal("mechanics must stay editable", err)
			}
			check("not_verified")
			if _, err := db.Exec(fmt.Sprintf(`UPDATE %s SET support='{"status":"unknown"}' WHERE id=$1`, row.table), row.id); err == nil {
				t.Fatal("invalid review accepted")
			}
			check("not_verified")
		})
	}
}
