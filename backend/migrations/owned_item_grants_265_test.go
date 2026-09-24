package migrations

import "testing"

func TestOwnedItemGrants265SnapshotIsOneTimeAndNarrow(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "OWNED_ITEM_265_TEST_DSN")
	_, err := db.Exec(`
CREATE TABLE users(id uuid PRIMARY KEY,username text);
CREATE TABLE cards(id uuid PRIMARY KEY,deleted_at timestamptz,mechanics jsonb);
CREATE TABLE characters_v3(id uuid PRIMARY KEY,user_id uuid,character_type text,equipment jsonb,inventory_items jsonb);
INSERT INTO users VALUES('26500000-0000-4000-8000-000000000001','owner'),('26500000-0000-4000-8000-000000000002','public');
INSERT INTO cards VALUES
 ('26500000-0000-4000-8000-000000000010',null,'{"damage":"2d6"}'),
 ('26500000-0000-4000-8000-000000000011',null,'{"armor":15}'),
 ('26500000-0000-4000-8000-000000000012',null,'{}'),
 ('26500000-0000-4000-8000-000000000013',now(),'{}');
INSERT INTO characters_v3 VALUES
 ('26500000-0000-4000-8000-000000000020','26500000-0000-4000-8000-000000000001','free',
 '{"main_hand":"26500000-0000-4000-8000-000000000010","unrecognized":"26500000-0000-4000-8000-000000000012"}',
 '[{"card_id":"26500000-0000-4000-8000-000000000011","qty":2},{"card_id":"26500000-0000-4000-8000-000000000013","qty":1},{"card_id":"26500000-0000-4000-8000-000000000012","qty":0},{"card_id":"invalid","qty":1}]'),
 ('26500000-0000-4000-8000-000000000021','26500000-0000-4000-8000-000000000001','dungeon_crawl','{"body":"26500000-0000-4000-8000-000000000012"}','[]'),
 ('26500000-0000-4000-8000-000000000022','26500000-0000-4000-8000-000000000002','free','{"body":"26500000-0000-4000-8000-000000000012"}','[]'),
 ('26500000-0000-4000-8000-000000000023','26500000-0000-4000-8000-000000000001','campaign','[]','{"not":"inventory"}');
`)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := func() string {
		var data string
		if err := db.QueryRow(`SELECT jsonb_build_object('cards',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM cards c),'characters',(SELECT jsonb_agg(to_jsonb(ch) ORDER BY id) FROM characters_v3 ch))::text`).Scan(&data); err != nil {
			t.Fatal(err)
		}
		return data
	}
	before := snapshot()
	if err := AddOwnedItemGrants265(db); err != nil {
		t.Fatal(err)
	}
	if snapshot() != before {
		t.Fatal("snapshot migration rewrote canonical data")
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM owned_item_grants WHERE reason='snapshot265'`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("snapshot count=%d %v", count, err)
	}
	// Later injected ownership MUST NOT be snapshotted on any rerun.
	if _, err := db.Exec(`UPDATE characters_v3 SET inventory_items='[{"card_id":"26500000-0000-4000-8000-000000000012","qty":1}]' WHERE id='26500000-0000-4000-8000-000000000020'`); err != nil {
		t.Fatal(err)
	}
	if err := AddOwnedItemGrants265(db); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM owned_item_grants`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("rerun minted grants: %d %v", count, err)
	}
	// Malformed quantities do not throw or become ownership, nor do container IDs.
	if err := db.QueryRow(`SELECT count(*) FROM saved_item_card_ids('null',
 '[{"card_id":"one","qty":"9"},{"card_id":"two","qty":0.5},{"card_id":"three","qty":-1},{"container_id":"four","qty":1}]')`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("bad shapes: %d %v", count, err)
	}
	// Character deletion removes authority without touching canonical items.
	if _, err := db.Exec(`DELETE FROM characters_v3 WHERE id='26500000-0000-4000-8000-000000000020'`); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM owned_item_grants`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("orphan grants: %d %v", count, err)
	}
}
