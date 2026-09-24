package migrations

import "database/sql"

// Documents are intentionally separate from authoritative, rules-driven characters.
// An anonymous document's random ID is its edit capability; owned documents require JWT.
func addPaperDocuments264(db *sql.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS paper_documents (
   id uuid PRIMARY KEY,
   owner_id uuid REFERENCES users(id) ON DELETE RESTRICT,
   document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
   revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
   created_at timestamptz NOT NULL DEFAULT now(),
   updated_at timestamptz NOT NULL DEFAULT now()
 );
 CREATE INDEX IF NOT EXISTS paper_documents_owner_updated ON paper_documents(owner_id, updated_at DESC) WHERE owner_id IS NOT NULL;`)
	return err
}
