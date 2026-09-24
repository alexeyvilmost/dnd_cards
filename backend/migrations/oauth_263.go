package migrations

import "database/sql"

// OAuth263Migration is intentionally not registered in migrations.go: its
// position in the shared migration list must be coordinated separately.
func OAuth263Migration() Migration {
	return Migration{Version: "263_oauth_identities", Description: "Add provider identities and single-use OAuth login flows", Up: addOAuth263, Down: func(*sql.DB) error { return nil }}
}

func addOAuth263(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`
		-- OAuth does not require or infer an email address. Existing passwords,
		-- addresses and unique email constraints are preserved.
		ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
		CREATE TABLE IF NOT EXISTS oauth_identities (
			provider varchar(16) NOT NULL CHECK (provider IN ('google', 'yandex')),
			subject varchar(255) NOT NULL CHECK (length(subject) > 0),
			user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (provider, subject),
			UNIQUE (user_id, provider)
		);
		CREATE TABLE IF NOT EXISTS oauth_flows (
			state_hash varchar(64) PRIMARY KEY,
			provider varchar(16) NOT NULL CHECK (provider IN ('google', 'yandex')),
			browser_hash varchar(64) NOT NULL,
			verifier varchar(128) NOT NULL,
			client_challenge varchar(43) NOT NULL,
			return_path text NOT NULL,
			expires_at timestamptz NOT NULL
		);
		CREATE INDEX IF NOT EXISTS oauth_flows_expiry ON oauth_flows(expires_at);
		CREATE TABLE IF NOT EXISTS oauth_handoffs (
			code_hash varchar(64) PRIMARY KEY,
			user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			client_challenge varchar(43) NOT NULL,
			return_path text NOT NULL,
			expires_at timestamptz NOT NULL
		);
		CREATE INDEX IF NOT EXISTS oauth_handoffs_expiry ON oauth_handoffs(expires_at);
	`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
