package migrations

import "testing"

func TestAlignCardPriceContract261(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	if _, err := db.Exec(`
		CREATE TABLE cards (
			id uuid PRIMARY KEY,
			price numeric,
			CONSTRAINT cards_price_check CHECK (price >= 1 AND price <= 50000)
		)
	`); err != nil {
		t.Fatal(err)
	}

	if err := alignCardPriceContract261(db); err != nil {
		t.Fatal(err)
	}
	// A migration replay must preserve the same contract.
	if err := alignCardPriceContract261(db); err != nil {
		t.Fatalf("second migration run: %v", err)
	}

	for _, price := range []any{nil, 0.1, 1, 50000, 1000000} {
		if _, err := db.Exec(`INSERT INTO cards(id, price) VALUES (gen_random_uuid(), $1)`, price); err != nil {
			t.Errorf("price %v must be accepted: %v", price, err)
		}
	}
	for _, price := range []any{0, -0.1, 1000000.01} {
		if _, err := db.Exec(`INSERT INTO cards(id, price) VALUES (gen_random_uuid(), $1)`, price); err == nil {
			t.Errorf("price %v must be rejected", price)
		}
	}
}
