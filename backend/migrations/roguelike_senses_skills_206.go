package migrations

import (
	"database/sql"
	"fmt"
)

// SRD 5.2.1 monster stat blocks: proficiencies and senses. This does not
// certify climbing, sunlight, equipment or bonus-action traits.
func materializeRoguelikeSensesSkills(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, row := range []struct{ slug, traits string }{
		{"guard", `{"skill_proficiencies":["perception"]}`},
		{"giant-rat", `{"darkvision_ft":60,"save_proficiencies":["dex"],"skill_proficiencies":["perception"]}`},
		{"kobold-warrior", `{"darkvision_ft":60}`},
		{"goblin-warrior", `{"darkvision_ft":60,"skill_proficiencies":["stealth"],"skill_expertise":["stealth"]}`},
		{"wolf", `{"darkvision_ft":60,"skill_proficiencies":["perception","stealth"],"skill_expertise":["perception"]}`},
		{"giant-wolf-spider", `{"darkvision_ft":60,"blindsight_ft":10,"skill_proficiencies":["perception","stealth"],"skill_expertise":["stealth"]}`},
		{"hobgoblin-warrior", `{"darkvision_ft":60}`},
		{"dire-wolf", `{"darkvision_ft":60,"skill_proficiencies":["perception","stealth"],"skill_expertise":["perception"]}`},
		{"bugbear-warrior", `{"darkvision_ft":60,"skill_proficiencies":["stealth","survival"],"skill_expertise":["stealth"]}`},
		{"ogre", `{"darkvision_ft":60}`},
	} {
		result, err := tx.Exec(`UPDATE monsters SET ai=ai || $2::jsonb,updated_at=NOW() WHERE slug=$1 AND deleted_at IS NULL`, row.slug, row.traits)
		if err != nil {
			return err
		}
		if n, err := result.RowsAffected(); err != nil || n != 1 {
			return fmt.Errorf("missing monster senses/skills for %s: %v", row.slug, err)
		}
	}
	return tx.Commit()
}
