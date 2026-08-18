package migrations

import (
	"database/sql"
	"fmt"
)

var liveMvpSelfUsesCardNumbers = map[string][]string{
	"actions": {
		"aasimar_healing_hands",
		"ACT-aasimar-revelation",
		"ACTION-0002",
	},
	"effects": {
		"RE-dragonborn-4",
		"RE-goliath-2",
		"RE-orc-2",
	},
}

func appendLiveMvpSelfUsesCost(tx *sql.Tx, table, cardNumber string) error {
	if table != "actions" && table != "effects" {
		return fmt.Errorf("unsupported content table %q", table)
	}
	query := fmt.Sprintf(`
		UPDATE %s
		SET mechanics = jsonb_set(
			mechanics,
			'{activation,cost}',
			COALESCE(mechanics #> '{activation,cost}', '[]'::jsonb)
				|| jsonb_build_array(jsonb_build_object('resource', 'self_uses')),
			true
		)
		WHERE card_number = $1
		  AND deleted_at IS NULL
		  AND mechanics->'uses' IS NOT NULL
		  AND mechanics #>> '{activation,mode}' = 'active'
		  AND NOT EXISTS (
			SELECT 1
			FROM jsonb_array_elements(COALESCE(mechanics #> '{activation,cost}', '[]'::jsonb)) AS cost
			WHERE cost->>'resource' = 'self_uses'
		  )
	`, table)
	if _, err := tx.Exec(query, cardNumber); err != nil {
		return fmt.Errorf("append self_uses to %s %s: %w", table, cardNumber, err)
	}
	return nil
}

func repairLiveMvpContentContracts(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Conditions are passive rules. Rows imported after migration 086 must obey
	// the same explicit activation contract as the original condition catalog.
	if _, err := tx.Exec(`
		UPDATE effects
		SET mechanics = jsonb_set(
			COALESCE(mechanics, '{}'::jsonb),
			'{activation}',
			'{"mode":"passive"}'::jsonb,
			true
		)
		WHERE effect_type = 'condition'
		  AND deleted_at IS NULL
		  AND COALESCE(mechanics #>> '{activation,mode}', '') = ''
	`); err != nil {
		return fmt.Errorf("repair live condition activation: %w", err)
	}

	// Defense is a reusable conditional modifier. Keep the typed filter for the
	// modifier query and restore the engine-evaluated equipment circumstance.
	if _, err := tx.Exec(`
		UPDATE effects
		SET mechanics = jsonb_set(
			jsonb_set(
				mechanics,
				'{effects,0,result,0,when}',
				'[{"kind":"wearing_armor"}]'::jsonb,
				true
			),
			'{effects,0,result,0,source}',
			to_jsonb('Боевой стиль: Оборона'::text),
			true
		)
		WHERE card_number = 'fs_defense'
		  AND deleted_at IS NULL
		  AND mechanics #>> '{effects,0,result,0,kind}' = 'modifier'
	`); err != nil {
		return fmt.Errorf("repair Defense fighting style: %w", err)
	}

	// Class/race links are UUID references. A late Rogue import accidentally
	// stored the effect card_number in the otherwise UUID-only level array.
	var thievesCantID string
	if err := tx.QueryRow(`
		SELECT id::text
		FROM effects
		WHERE card_number = 'EFF-rogue-thieves-cant' AND deleted_at IS NULL
	`).Scan(&thievesCantID); err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("resolve Thieves' Cant effect: %w", err)
	} else if err == nil {
		if _, err := tx.Exec(`
			UPDATE classes
			SET level_progression = jsonb_set(
				level_progression,
				'{1,effects}',
				(
					SELECT jsonb_agg(
						CASE WHEN item.value = to_jsonb($1::text)
							THEN to_jsonb($2::text)
							ELSE item.value
						END
						ORDER BY item.ordinality
					)
					FROM jsonb_array_elements(level_progression #> '{1,effects}')
						WITH ORDINALITY AS item(value, ordinality)
				),
				false
			)
			WHERE card_number = 'CLASS-rogue'
			  AND deleted_at IS NULL
			  AND level_progression #> '{1,effects}' @> jsonb_build_array($1::text)
		`, "EFF-rogue-thieves-cant", thievesCantID); err != nil {
			return fmt.Errorf("repair Rogue Thieves' Cant reference: %w", err)
		}
	}

	// mechanics.uses declares a pool, while self_uses explicitly declares its
	// spend. Without both halves the sheet correctly hides the malformed action.
	for table, cardNumbers := range liveMvpSelfUsesCardNumbers {
		for _, cardNumber := range cardNumbers {
			if err := appendLiveMvpSelfUsesCost(tx, table, cardNumber); err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}
