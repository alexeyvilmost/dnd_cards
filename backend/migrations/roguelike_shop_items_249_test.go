package migrations

import (
	"database/sql"
	"dnd-cards-backend/roguelikecontent"
	"encoding/json"
	"testing"
)

func seedMerchantMigration(t *testing.T) *sql.DB {
	t.Helper()
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	_, err := db.Exec(`CREATE TABLE cards(id uuid PRIMARY KEY,card_number varchar(20) UNIQUE,name text,description text,
		rarity text CHECK (rarity IN ('common','uncommon','rare','very_rare','artifact','relic','custom')),
		price integer,price_currency text,source text,mechanics jsonb,support jsonb,image_url text,
		created_at timestamptz DEFAULT NOW(),updated_at timestamptz DEFAULT NOW(),deleted_at timestamptz)`)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range roguelikecontent.ShopItems() {
		s := item.Source
		_, err = db.Exec(`INSERT INTO cards(id,card_number,name,description,rarity,price,mechanics,image_url)
			VALUES($1,$2,$3,$4,$5,123,NULLIF($6::jsonb,'null'::jsonb),'original-art.png')`, s.ID, s.CardNumber, s.Name, s.Description, s.Rarity, string(s.Mechanics))
		if err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func TestMerchantMigrationCopiesPricesRepairsAndIsIdempotent(t *testing.T) {
	db := seedMerchantMigration(t)
	if err := materializeRoguelikeShopItems(db); err != nil {
		t.Fatal(err)
	}
	for _, item := range roguelikecontent.ShopItems() {
		var price int
		var rarity, image string
		var valid bool
		if err := db.QueryRow(`SELECT price,rarity,image_url,mechanics=$2::jsonb FROM cards WHERE id=$1`, item.ID, string(item.Mechanics)).Scan(&price, &rarity, &image, &valid); err != nil {
			t.Fatal(err)
		}
		if price != item.Price || rarity != item.Rarity || image != "original-art.png" || !valid {
			t.Fatalf("bad copy %s", item.CardNumber)
		}
		if err := db.QueryRow(`SELECT price FROM cards WHERE id=$1`, item.Source.ID).Scan(&price); err != nil || price != 123 {
			t.Fatal("original price changed", err)
		}
	}
	var before, after string
	db.QueryRow(`SELECT jsonb_agg(to_jsonb(c) ORDER BY id)::text FROM cards c`).Scan(&before)
	if err := materializeRoguelikeShopItems(db); err != nil {
		t.Fatal(err)
	}
	db.QueryRow(`SELECT jsonb_agg(to_jsonb(c) ORDER BY id)::text FROM cards c`).Scan(&after)
	if before != after {
		t.Fatal("repeat migration changed rows")
	}
	if err := rollbackRoguelikeShopItems(db); err != nil {
		t.Fatal(err)
	}
	var retired int
	db.QueryRow(`SELECT count(*) FROM cards WHERE deleted_at IS NOT NULL`).Scan(&retired)
	if retired != 0 {
		t.Fatalf("rollback made %d owned copies unreadable", retired)
	}
	for _, item := range roguelikecontent.ShopItems() {
		var same bool
		db.QueryRow(`SELECT COALESCE(mechanics,'null'::jsonb)=$2::jsonb FROM cards WHERE id=$1`, item.Source.ID, string(item.Source.Mechanics)).Scan(&same)
		if !same {
			t.Fatal("source not restored", item.Source.CardNumber)
		}
	}
}

func TestMerchantMigrationRejectsDriftAtomically(t *testing.T) {
	db := seedMerchantMigration(t)
	items := roguelikecontent.ShopItems()
	last := items[len(items)-1]
	if _, err := db.Exec(`UPDATE cards SET mechanics='{"unreviewed":true}' WHERE id=$1`, last.Source.ID); err != nil {
		t.Fatal(err)
	}
	if err := materializeRoguelikeShopItems(db); err == nil {
		t.Fatal("must reject drift")
	}
	var count int
	db.QueryRow(`SELECT count(*) FROM cards`).Scan(&count)
	if count != len(items) {
		t.Fatal("partial copies survived rollback")
	}
	var first []byte
	db.QueryRow(`SELECT COALESCE(mechanics,'null') FROM cards WHERE id=$1`, items[0].Source.ID).Scan(&first)
	var a, b any
	json.Unmarshal(first, &a)
	json.Unmarshal(items[0].Source.Mechanics, &b)
	aa, _ := json.Marshal(a)
	bb, _ := json.Marshal(b)
	if string(aa) != string(bb) {
		t.Fatal("earlier original changed despite rollback")
	}
}
