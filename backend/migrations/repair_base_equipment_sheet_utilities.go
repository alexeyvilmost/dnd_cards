package migrations

import "database/sql"

const baseEquipmentSheetUtilityMigrationVersion = "149_repair_base_equipment_sheet_utilities"

func repairBaseEquipmentSheetUtilities(db *sql.DB) error {
	return repairBaseEquipmentRuntime(db)
}
