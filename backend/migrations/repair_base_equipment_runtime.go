package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const baseEquipmentRuntimeMigrationVersion = "148_repair_base_equipment_runtime"

// repairBaseEquipmentRuntime reapplies the canonical utility-item declarations
// after the browser QA pass exposed invalid world-zone geometry and remaining
// narrative-only consumable outcomes.
func repairBaseEquipmentRuntime(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, row := range utilityItems2024() {
		encoded, err := json.Marshal(row.Mechanics)
		if err != nil {
			return fmt.Errorf("encode utility item %s: %w", row.CardNumber, err)
		}
		result, err := tx.Exec(`UPDATE cards SET mechanics=$2::jsonb, support=NULL, updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL`, row.CardNumber, encoded)
		if err != nil {
			return fmt.Errorf("repair utility item %s: %w", row.CardNumber, err)
		}
		if n, _ := result.RowsAffected(); n != 1 {
			return fmt.Errorf("repair utility item %s affected %d rows", row.CardNumber, n)
		}
	}
	return tx.Commit()
}
