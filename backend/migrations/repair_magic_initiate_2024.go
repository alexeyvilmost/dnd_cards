package migrations

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
)

// repairMagicInitiate2024Document is a reviewed, exact-preimage content repair.
// The interpreter remains generic: spellcasting ability, spell grants and free
// uses are all declared by Effect mechanics stored in PostgreSQL.
//
//go:embed data/repair_magic_initiate_2024.v1.json
var repairMagicInitiate2024Document []byte

type magicInitiateEntityIdentity struct {
	ID         string `json:"id"`
	CardNumber string `json:"cardNumber"`
}

type magicInitiate2024Variant struct {
	Feat                    magicInitiateEntityIdentity `json:"feat"`
	Effect                  magicInitiateEntityIdentity `json:"effect"`
	SpellList               string                      `json:"spellList"`
	ExpectedBeforeMechanics json.RawMessage             `json:"expectedBeforeMechanics"`
	Mechanics               json.RawMessage             `json:"mechanics"`
}

type magicInitiate2024Repair struct {
	SchemaVersion int                        `json:"schemaVersion"`
	RepairID      string                     `json:"repairId"`
	Variants      []magicInitiate2024Variant `json:"variants"`
}

func parseMagicInitiate2024Repair() (magicInitiate2024Repair, error) {
	var document magicInitiate2024Repair
	if err := json.Unmarshal(repairMagicInitiate2024Document, &document); err != nil {
		return document, fmt.Errorf("decode Magic Initiate repair: %w", err)
	}
	if document.SchemaVersion != 1 || document.RepairID == "" || len(document.Variants) != 2 {
		return document, fmt.Errorf("invalid Magic Initiate repair document header")
	}

	seenFeats := map[string]bool{}
	seenEffects := map[string]bool{}
	for _, variant := range document.Variants {
		if variant.Feat.ID == "" || variant.Feat.CardNumber == "" ||
			variant.Effect.ID == "" || variant.Effect.CardNumber == "" ||
			variant.SpellList == "" ||
			len(variant.ExpectedBeforeMechanics) == 0 || len(variant.Mechanics) == 0 {
			return document, fmt.Errorf("incomplete Magic Initiate variant %q", variant.Effect.CardNumber)
		}
		if seenFeats[variant.Feat.ID] || seenEffects[variant.Effect.ID] {
			return document, fmt.Errorf("duplicate Magic Initiate identity %q", variant.Effect.ID)
		}
		seenFeats[variant.Feat.ID] = true
		seenEffects[variant.Effect.ID] = true
	}
	return document, nil
}

func repairMagicInitiate2024(db *sql.DB) error {
	document, err := parseMagicInitiate2024Repair()
	if err != nil {
		return err
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, variant := range document.Variants {
		var linkedEffectIDs []byte
		if err := tx.QueryRow(`
			SELECT related_effects
			FROM feats
			WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
			FOR UPDATE
		`, variant.Feat.ID, variant.Feat.CardNumber).Scan(&linkedEffectIDs); err != nil {
			return fmt.Errorf("lock feat %s: %w", variant.Feat.CardNumber, err)
		}
		var relatedEffects []string
		if err := json.Unmarshal(linkedEffectIDs, &relatedEffects); err != nil {
			return fmt.Errorf("decode %s related_effects: %w", variant.Feat.CardNumber, err)
		}
		if len(relatedEffects) != 1 || relatedEffects[0] != variant.Effect.ID {
			return fmt.Errorf("%s does not exclusively own effect %s", variant.Feat.CardNumber, variant.Effect.ID)
		}

		result, err := tx.Exec(`
			UPDATE effects
			SET mechanics = $3::jsonb,
				updated_at = CURRENT_TIMESTAMP
			WHERE id = $1::uuid
				AND card_number = $2
				AND deleted_at IS NULL
				AND mechanics = $4::jsonb
		`, variant.Effect.ID, variant.Effect.CardNumber, string(variant.Mechanics), string(variant.ExpectedBeforeMechanics))
		if err != nil {
			return fmt.Errorf("repair %s mechanics: %w", variant.Effect.CardNumber, err)
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if rows == 1 {
			continue
		}

		var current []byte
		if err := tx.QueryRow(`
			SELECT mechanics
			FROM effects
			WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
			FOR UPDATE
		`, variant.Effect.ID, variant.Effect.CardNumber).Scan(&current); err != nil {
			return fmt.Errorf("read current %s mechanics: %w", variant.Effect.CardNumber, err)
		}
		var alreadyApplied bool
		if err := tx.QueryRow(`SELECT $1::jsonb = $2::jsonb`, string(current), string(variant.Mechanics)).Scan(&alreadyApplied); err != nil {
			return fmt.Errorf("compare current %s mechanics: %w", variant.Effect.CardNumber, err)
		}
		if !alreadyApplied {
			return fmt.Errorf("%s mechanics differ from both reviewed preimage and target", variant.Effect.CardNumber)
		}
	}

	return tx.Commit()
}
