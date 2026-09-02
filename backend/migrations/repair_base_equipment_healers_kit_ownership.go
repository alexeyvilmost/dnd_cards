package migrations

import "database/sql"

const baseEquipmentHealersKitOwnershipMigrationVersion = "151_repair_base_equipment_healers_kit_ownership"

func repairBaseEquipmentHealersKitOwnership(db *sql.DB) error {
	return repairBaseEquipmentRuntime(db)
}
