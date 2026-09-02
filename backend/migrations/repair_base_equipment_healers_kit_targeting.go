package migrations

import "database/sql"

const baseEquipmentHealersKitTargetingMigrationVersion = "150_repair_base_equipment_healers_kit_targeting"

func repairBaseEquipmentHealersKitTargeting(db *sql.DB) error {
	return repairBaseEquipmentRuntime(db)
}
