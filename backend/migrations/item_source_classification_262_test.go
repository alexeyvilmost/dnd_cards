package migrations

import (
	"database/sql"
	"dnd-cards-backend/itemsource"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func source262Fixture(t *testing.T) *sql.DB {
	t.Helper()
	db := openIsolatedPostgresSchema(t, "ITEM_SOURCE_262_TEST_DSN")
	_, err := db.Exec(`CREATE TABLE cards (
		id uuid PRIMARY KEY,card_number text UNIQUE,name text,name_en text,description text,detailed_description text,
		source text,deleted_at timestamptz,updated_at timestamptz DEFAULT now(),price numeric,
		support jsonb,legacy_tags jsonb,
		properties text,bonus_type text,bonus_value text,damage_type text,defense_type text,type text,
		related_cards text,related_actions text,related_effects text,attunement text,slot text,effects jsonb,
		weapon_type text,requires_attunement boolean,range text,elemental_damage_value text,elemental_damage_type text,
		battle_profile jsonb,container_mode text,contents jsonb,mechanics jsonb,enchant_bonus integer,mastery text
	);
	CREATE TABLE entity_tag_definitions(id uuid PRIMARY KEY,name text NOT NULL,description text NOT NULL DEFAULT '');
	CREATE UNIQUE INDEX tags262_name ON entity_tag_definitions(lower(name));
	CREATE TABLE entity_tag_assignments(entity_type text,entity_id text,tag_id uuid);
	INSERT INTO entity_tag_definitions VALUES('d2580000-0000-4000-8000-000000000001','Existing tag','Keep');
	INSERT INTO entity_tag_assignments VALUES('card','another-card','d2580000-0000-4000-8000-000000000001');
	CREATE TABLE encounter_events(id integer PRIMARY KEY,artifact_hash text,payload jsonb);
	INSERT INTO encounter_events VALUES(1,'sha256:historical-artifact','{"card":{"source":"Old","support":{"content_hash":"old"}}}');`)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("../itemsource/testdata/migration_rows.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []json.RawMessage
	if err = json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		if _, err = db.Exec(`INSERT INTO cards SELECT * FROM jsonb_populate_record(NULL::cards,$1::jsonb)`, string(fixture)); err != nil {
			t.Fatal(err)
		}
	}
	// A historical duplicate must remain completely untouched.
	if _, err = db.Exec(`INSERT INTO cards SELECT * FROM jsonb_populate_record(NULL::cards,
		$1::jsonb || '{"id":"26200000-0000-4000-8000-000000000099","card_number":"DELETED-262","source":"Historical source","deleted_at":"2020-01-01T00:00:00Z"}')`, string(fixtures[0])); err != nil {
		t.Fatal(err)
	}
	if err = alignCertifiedMetadataProjection(db); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`
		CREATE TRIGGER invalidate_cards_support BEFORE UPDATE ON cards FOR EACH ROW EXECUTE FUNCTION invalidate_content_support();
		CREATE TRIGGER protect_cards_mechanics BEFORE UPDATE OR DELETE ON cards FOR EACH ROW EXECUTE FUNCTION protect_certified_content_mechanics();
		CREATE FUNCTION stamp262() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=clock_timestamp();RETURN NEW;END $$;
		CREATE TRIGGER update_cards_updated_at BEFORE UPDATE ON cards FOR EACH ROW EXECUTE FUNCTION stamp262();`); err != nil {
		t.Fatal(err)
	}
	return db
}

func source262Snapshot(t *testing.T, db *sql.DB, sqlText string) string {
	t.Helper()
	var value string
	if err := db.QueryRow(sqlText).Scan(&value); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestItemSource262TransactionalAndIdempotent(t *testing.T) {
	db := source262Fixture(t)
	protected := `SELECT jsonb_agg(to_jsonb(c)-ARRAY['source','updated_at']::text[] ORDER BY card_number)::text FROM cards c`
	before := source262Snapshot(t, db, protected)
	historySQL := `SELECT jsonb_agg(to_jsonb(e))::text FROM encounter_events e`
	history := source262Snapshot(t, db, historySQL)
	deletedSQL := `SELECT to_jsonb(c)::text FROM cards c WHERE card_number='DELETED-262'`
	deleted := source262Snapshot(t, db, deletedSQL)
	if err := classifyItemSources262(db); err != nil {
		t.Fatal(err)
	}
	if source262Snapshot(t, db, protected) != before {
		t.Fatal("mechanics, identity, prices, frozen tags or certificates changed")
	}
	if source262Snapshot(t, db, historySQL) != history || source262Snapshot(t, db, deletedSQL) != deleted {
		t.Fatal("history or deleted data changed")
	}
	for number, want := range map[string]string{"CARD-0297": itemsource.PlayersHandbook, "CARD-0492": itemsource.PlayersHandbook, "CARD-0706": itemsource.PlayersHandbook, "CARD-0400": itemsource.PlayersHandbook, "CARD-0839": itemsource.PlayersHandbook, "CARD-0249": itemsource.BagOfHolding, "CARD-0778": itemsource.PlayersHandbook, "CARD-0548": itemsource.BagOfHolding} {
		var source string
		if err := db.QueryRow(`SELECT source FROM cards WHERE card_number=$1`, number).Scan(&source); err != nil || source != want {
			t.Fatalf("%s: %q %v", number, source, err)
		}
	}
	var active, ph, review, receipts, tags int
	if err := db.QueryRow(`SELECT active_count,ph_count,review_count FROM item_source_classification_262_runs`).Scan(&active, &ph, &review); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM item_source_classification_262_audit`).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	if active != 8 || ph != 6 || review != 0 || receipts != 8 {
		t.Fatalf("counts %d/%d/%d/%d", active, ph, review, receipts)
	}
	if err := db.QueryRow(`SELECT count(*) FROM entity_tag_assignments`).Scan(&tags); err != nil || tags != 1 {
		t.Fatal("availability assignments changed", err)
	}
	var tagName string
	if err := db.QueryRow(`SELECT name FROM entity_tag_definitions WHERE id=$1`, itemsource.AvailableForPlayersTagID).Scan(&tagName); err != nil || tagName != itemsource.AvailableForPlayersTagName {
		t.Fatal("stable tag missing", err)
	}
	var oldSource *string
	if err := db.QueryRow(`SELECT previous_source FROM item_source_classification_262_audit WHERE card_number='CARD-0706'`).Scan(&oldSource); err != nil || oldSource != nil {
		t.Fatal("audit must preserve SQL NULL", err)
	}
	// Simulate a subsequent authorized metadata edit; replay must not undo it.
	if _, err := db.Exec(`UPDATE cards SET source='Later editorial source' WHERE card_number='CARD-0297'`); err != nil {
		t.Fatal(err)
	}
	allSQL := `SELECT jsonb_agg(to_jsonb(c) ORDER BY card_number)::text FROM cards c`
	first := source262Snapshot(t, db, allSQL)
	if err := classifyItemSources262(db); err != nil {
		t.Fatal(err)
	}
	if source262Snapshot(t, db, allSQL) != first {
		t.Fatal("repeat rewrote data/timestamps")
	}
	var defaultSource string
	if err := db.QueryRow(`INSERT INTO cards(id,card_number) VALUES('26200000-0000-4000-8000-000000000088','NEW-262') RETURNING source`).Scan(&defaultSource); err != nil || defaultSource != itemsource.BagOfHolding {
		t.Fatal("future omitted source default", err)
	}
	if err := refuseItemSourceClassification262Down(db); err == nil {
		t.Fatal("destructive automatic downgrade allowed")
	}
}

func TestItemSource262RollsBackUnexpectedTriggerChanges(t *testing.T) {
	for _, change := range []string{"NEW.support=NULL;", "NEW.price=1;"} {
		t.Run(change, func(t *testing.T) {
			db := source262Fixture(t)
			before := source262Snapshot(t, db, `SELECT jsonb_agg(to_jsonb(c) ORDER BY card_number)::text FROM cards c`)
			// This runs after the certificate lock, reproducing an old or broken
			// metadata trigger. The migration must detect the actual final row.
			if _, err := db.Exec(`CREATE FUNCTION corrupt262() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ` + change + ` RETURN NEW;END $$;
			CREATE TRIGGER z_corrupt262 BEFORE UPDATE ON cards FOR EACH ROW EXECUTE FUNCTION corrupt262();`); err != nil {
				t.Fatal(err)
			}
			if err := classifyItemSources262(db); err == nil {
				t.Fatal("unsafe trigger silently changed protected data")
			}
			if source262Snapshot(t, db, `SELECT jsonb_agg(to_jsonb(c) ORDER BY card_number)::text FROM cards c`) != before {
				t.Fatal("partial update escaped rollback")
			}
			var count int
			if err := db.QueryRow(`SELECT count(*) FROM entity_tag_definitions WHERE id=$1`, itemsource.AvailableForPlayersTagID).Scan(&count); err != nil || count != 0 {
				t.Fatal("partial tag seed escaped rollback", err)
			}
			var receiptTable *string
			if err := db.QueryRow(`SELECT to_regclass('item_source_classification_262_runs')::text`).Scan(&receiptTable); err != nil || receiptTable != nil {
				t.Fatal("receipt escaped rollback", err)
			}
		})
	}
}

func TestItemSource262TagConflictsAndCatalogDrift(t *testing.T) {
	t.Run("same name other ID", func(t *testing.T) {
		db := source262Fixture(t)
		if _, err := db.Exec(`INSERT INTO entity_tag_definitions VALUES('26200000-0000-4000-8000-000000000077',$1,'User-owned')`, itemsource.AvailableForPlayersTagName); err != nil {
			t.Fatal(err)
		}
		if err := classifyItemSources262(db); err == nil || !strings.Contains(err.Error(), "tag name/ID conflict") {
			t.Fatal("tag conflict was not refused", err)
		}
	})
	t.Run("same ID other name", func(t *testing.T) {
		db := source262Fixture(t)
		if _, err := db.Exec(`INSERT INTO entity_tag_definitions VALUES($1,'Other meaning','User-owned')`, itemsource.AvailableForPlayersTagID); err != nil {
			t.Fatal(err)
		}
		if err := classifyItemSources262(db); err == nil {
			t.Fatal("reserved ID stolen")
		}
	})
	t.Run("changed catalog after application", func(t *testing.T) {
		db := source262Fixture(t)
		if err := classifyItemSources262(db); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`UPDATE item_source_classification_262_runs SET catalog_sha256='other-reviewed-version'`); err != nil {
			t.Fatal(err)
		}
		if err := classifyItemSources262(db); err == nil {
			t.Fatal("changed catalog silently reapplied")
		}
	})
}

// The old manifest is a candidate inventory, not a classification shortcut.
// Every member must have an explicit review, including rejected/unclear rows.
func TestItemSource262BaseManifestCoverage(t *testing.T) {
	data, err := os.ReadFile("../itemsource/reviewed_equipment.v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var catalog itemsource.Catalog
	if err = json.Unmarshal(data, &catalog); err != nil {
		t.Fatal(err)
	}
	reviews := map[string]itemsource.Review{}
	for _, e := range catalog.Entries {
		for _, r := range e.Reviews {
			reviews[r.CardNumber] = r
		}
	}
	base := map[string]bool{}
	for _, w := range baseWeapons2024 {
		base[w.CardNumber] = true
	}
	for _, a := range baseArmors2024 {
		base[a.CardNumber] = true
	}
	for _, u := range utilityItems2024() {
		base[u.CardNumber] = true
	}
	counts := map[string]int{}
	for number := range base {
		r, ok := reviews[number]
		if !ok {
			t.Errorf("manifest candidate has no explicit review: %s", number)
			continue
		}
		counts[r.Decision]++
	}
	t.Logf("base-manifest candidates=%d decisions=%v", len(base), counts)
}
