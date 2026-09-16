package migrations

import "testing"

func TestMerchantCopper259ArchivesAndPreservesHistory(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	_, err := db.Exec(`CREATE TABLE cards(id uuid PRIMARY KEY,card_number text,name text,price numeric,price_currency text,deleted_at timestamptz);
 CREATE TABLE roguelike_item_rules(card_id uuid,quantity integer,price integer);
 CREATE TABLE roguelike_runs(id uuid PRIMARY KEY,status text,shop jsonb,revision integer,checkpoint jsonb);
 INSERT INTO cards VALUES('00000000-0000-4000-8000-000000000001','CARD-0728','Стрела',5,'copper',NULL),('00000000-0000-4000-8000-000000000002','CARD-0749','Арбалетный болт',1,'gold',NULL);
 INSERT INTO roguelike_item_rules SELECT id,20,1 FROM cards;
 INSERT INTO roguelike_runs VALUES('00000000-0000-4000-8000-000000000010','active','{"generation":3,"staples":[{"card_id":"00000000-0000-4000-8000-000000000002","price":1,"quantity":20}],"offers":[{"card_id":"00000000-0000-4000-8000-000000000001","sold":true,"price":1,"quantity":20}]}',7,'{"old":"unchanged"}');`)
	if err != nil {
		t.Fatal(err)
	}
	if err = merchantCopper259(db); err != nil {
		t.Fatal(err)
	}
	var count int
	db.QueryRow(`SELECT count(*) FROM cards WHERE price=5 AND price_currency='copper'`).Scan(&count)
	if count != 2 {
		t.Fatal("price migration", count)
	}
	db.QueryRow(`SELECT count(*) FROM roguelike_item_rules WHERE quantity=1 AND price IS NULL`).Scan(&count)
	if count != 2 {
		t.Fatal("unit rules", count)
	}
	var correct bool
	err = db.QueryRow(`SELECT shop->'staples'->0->>'price_currency'='copper' AND shop->'staples'->0->>'quantity'='1' AND shop->'offers'->0->>'price'='1' AND checkpoint='{"old":"unchanged"}'::jsonb AND revision=8 FROM roguelike_runs`).Scan(&correct)
	if err != nil || !correct {
		t.Fatal("history/snapshot changed", err)
	}
	db.QueryRow(`SELECT count(*) FROM merchant_copper_259_archive`).Scan(&count)
	if count != 5 {
		t.Fatal("archive", count)
	}
}
