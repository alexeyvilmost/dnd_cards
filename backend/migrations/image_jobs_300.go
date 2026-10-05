package migrations

import "database/sql"

func addImageJobs300(db *sql.DB) error {
	return addImageJobs300On(db)
}

func addImageJobs300On(db additiveExecer) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS image_jobs (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL, fingerprint varchar(64) NOT NULL,
 kind text NOT NULL CHECK(kind IN ('entity','card','standalone')),
 state text NOT NULL CHECK(state IN ('queued','running','succeeded','failed','unknown')),
 label text NOT NULL DEFAULT '',entity_type text NOT NULL DEFAULT '',entity_id text NOT NULL DEFAULT '',
 prompt text NOT NULL CHECK(octet_length(prompt) BETWEEN 1 AND 32768),quality text NOT NULL,size text NOT NULL,folder text NOT NULL,
 result jsonb,problem jsonb,lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT NOW(),updated_at timestamptz NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS idx_image_jobs_owner_created ON image_jobs(owner_id,created_at DESC);
 CREATE INDEX IF NOT EXISTS idx_image_jobs_state_created ON image_jobs(state,created_at);
 CREATE INDEX IF NOT EXISTS idx_image_jobs_created ON image_jobs(created_at);`)
	return err
}
