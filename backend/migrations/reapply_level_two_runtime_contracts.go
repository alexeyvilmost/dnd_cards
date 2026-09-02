package migrations

import "database/sql"

const levelTwoRuntimeReapplyMigrationVersion = "163_reapply_level_two_runtime_contracts"

// reapplyLevelTwoRuntimeContracts uses a fresh migration identity for every
// level-two runtime row. Migration 162 was exercised on a production-like
// database while it was still being developed, so changing that already-run
// migration could not repair those rows on deployment. Reusing the complete
// idempotent repair also guarantees the referenced effects and form actions
// exist before the action starts granting them.
func reapplyLevelTwoRuntimeContracts(db *sql.DB) error {
	return repairLevelTwoRuntimeContracts(db)
}
