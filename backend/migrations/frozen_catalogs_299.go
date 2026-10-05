package migrations

import (
	"database/sql"
	"fmt"
)

const frozenCatalogs299Version = "299_frozen_combat_catalogs"

func addFrozenCatalogs299(db *sql.DB) error {
	return addFrozenCatalogs299On(db)
}

func addFrozenCatalogs299On(db additiveExecer) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS frozen_combat_catalogs (
		user_id uuid NOT NULL,content_hash varchar(64) NOT NULL,serializer_version integer NOT NULL CHECK(serializer_version=1),
		protocol_version integer NOT NULL CHECK(protocol_version=1),artifact_hash varchar(71) NOT NULL CHECK(artifact_hash ~ '^sha256:[a-f0-9]{64}$'),
		payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),created_at timestamptz NOT NULL DEFAULT NOW(),
		PRIMARY KEY(user_id,content_hash),CHECK(content_hash ~ '^[a-f0-9]{64}$'));
		ALTER TABLE roguelike_runs ADD COLUMN IF NOT EXISTS combat_catalog_ref varchar(64);
		DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='roguelike_frozen_catalog_ref' AND conrelid='roguelike_runs'::regclass) THEN
		ALTER TABLE roguelike_runs ADD CONSTRAINT roguelike_frozen_catalog_ref FOREIGN KEY(user_id,combat_catalog_ref) REFERENCES frozen_combat_catalogs(user_id,content_hash);
		END IF; END $$;
		CREATE OR REPLACE FUNCTION reject_frozen_catalog_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'frozen combat catalogs are immutable' USING ERRCODE='55000'; END; $$ LANGUAGE plpgsql;
		DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='frozen_catalog_immutable' AND tgrelid='frozen_combat_catalogs'::regclass) THEN
		CREATE TRIGGER frozen_catalog_immutable BEFORE UPDATE OR DELETE ON frozen_combat_catalogs FOR EACH ROW EXECUTE FUNCTION reject_frozen_catalog_mutation();
		END IF; END $$;`)
	if err != nil {
		return fmt.Errorf("add frozen catalog storage: %w", err)
	}
	return nil
}
