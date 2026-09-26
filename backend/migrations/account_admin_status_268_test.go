package migrations

import "testing"

func TestAccountAdminStatus268DefaultsExistingAndNewAccountsToNonAdmin(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "ACCOUNT_ADMIN_268_TEST_DSN")
	if _, err := db.Exec(`CREATE TABLE users (id text PRIMARY KEY, username text NOT NULL);
INSERT INTO users (id, username) VALUES ('existing', 'existing');`); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := addAccountAdminStatus268(db); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO users (id, username) VALUES ('new', 'new')`); err != nil {
		t.Fatal(err)
	}
	var admins int
	if err := db.QueryRow(`SELECT count(*) FROM users WHERE is_admin`).Scan(&admins); err != nil || admins != 0 {
		t.Fatalf("migration granted administrator access: count=%d err=%v", admins, err)
	}
	if err := refuseAccountAdminStatus268Down(db); err == nil {
		t.Fatal("rollback must not silently discard persistent administrator grants")
	}
}
