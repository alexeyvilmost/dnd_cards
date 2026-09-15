package migrations

import (
	"database/sql"
	"dnd-cards-backend/passivepresentation"
)

func createPassivePresentations253(db *sql.DB) error {
	rows, err := passivepresentation.Defaults()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`CREATE TABLE IF NOT EXISTS passive_presentations (
    key varchar(100) PRIMARY KEY, name varchar(200) NOT NULL, description text NOT NULL DEFAULT '',
    image_url text NOT NULL DEFAULT '', enabled_description text NOT NULL DEFAULT '', disabled_description text NOT NULL DEFAULT '',
    version integer NOT NULL DEFAULT 1 CHECK(version > 0)
  )`); err != nil {
		return err
	}
	for _, row := range rows {
		if _, err = tx.Exec(`INSERT INTO passive_presentations(key,name,description,image_url,enabled_description,disabled_description)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(key) DO NOTHING`, row.Key, row.Name, row.Description, row.ImageURL, row.EnabledDescription, row.DisabledDescription); err != nil {
			return err
		}
	}
	return tx.Commit()
}
