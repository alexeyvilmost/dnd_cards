package migrations

import "database/sql"

// Replays the now-idempotent materialization for databases where 172 was
// already recorded before its action payloads were aligned with the executor.
const generalFeatActionPayloadRepairVersion = "175_repair_general_feat_action_payloads"

func repairGeneralFeatActionPayloads(db *sql.DB) error {
	return materializeGeneralFeatSignatures(db)
}
