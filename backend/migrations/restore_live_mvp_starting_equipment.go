package migrations

import (
	"database/sql"
	"fmt"
)

var liveMvpStartingEquipmentCardIDs = []string{
	"0e678d76-70ba-4036-b55b-60532f18e2e8", // Leather Armor
	"40f34fed-b99a-47e5-8dc0-a07a809ac1c2", // Studded Leather Armor
	"155f2780-87d3-462a-bfb1-fa885ac1d58a", // Chain Shirt
	"3d4a5854-ac9f-4fc4-b545-8d5c32a08e58", // Chain Mail
}

// restoreLiveMvpStartingEquipment revives only soft-deleted cards which are
// still referenced by an active class equipment option. Keeping the original
// UUID preserves the data-driven class graph and avoids silently substituting
// one of several same-name equipment duplicates.
func restoreLiveMvpStartingEquipment(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, cardID := range liveMvpStartingEquipmentCardIDs {
		if _, err := tx.Exec(`
			UPDATE cards AS card
			SET deleted_at = NULL
			WHERE card.id = $1::uuid
			  AND card.deleted_at IS NOT NULL
			  AND EXISTS (
				SELECT 1
				FROM classes AS class
				CROSS JOIN LATERAL jsonb_each(
					COALESCE(class.equipment_options, '{}'::jsonb)
				) AS option_entry
				CROSS JOIN LATERAL jsonb_array_elements(
					COALESCE(option_entry.value->'items', '[]'::jsonb)
				) AS item
				WHERE class.deleted_at IS NULL
				  AND item->>'card_id' = card.id::text
			  )
		`, cardID); err != nil {
			return fmt.Errorf("restore live MVP starting equipment %s: %w", cardID, err)
		}
	}

	return tx.Commit()
}
