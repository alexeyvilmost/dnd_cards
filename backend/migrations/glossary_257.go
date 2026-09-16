package migrations

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed glossary_257.json
var glossary257JSON []byte

type glossaryConcept257 struct {
	ConceptID   string `json:"concept_id"`
	Name        string `json:"name"`
	NameEn      string `json:"name_en"`
	Description string `json:"description"`
	SortOrder   int    `json:"sort_order"`
}

func seedGlossaryConcepts257(db *sql.DB) error {
	var concepts []glossaryConcept257
	if err := json.Unmarshal(glossary257JSON, &concepts); err != nil {
		return fmt.Errorf("decode glossary concepts: %w", err)
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, concept := range concepts {
		// A manually edited concept with the same ID belongs to its owner.
		_, err = tx.Exec(`INSERT INTO concepts (concept_id, name, name_en, description, sort_order)
			VALUES ($1, $2, $3, $4, $5) ON CONFLICT (concept_id) DO NOTHING`,
			concept.ConceptID, concept.Name, concept.NameEn, concept.Description, concept.SortOrder)
		if err != nil {
			return fmt.Errorf("seed glossary concept %s: %w", concept.ConceptID, err)
		}
	}
	return tx.Commit()
}
