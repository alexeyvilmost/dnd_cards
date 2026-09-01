package migrations

import (
	"database/sql"
	"fmt"
)

const cloudGoliathTeleportMigrationVersion = "132_repair_cloud_goliath_teleport"

const (
	cloudGoliathActionID   = "8295a341-92ef-485b-b1de-7a5d7712fe4e"
	cloudGoliathActionCard = "ACT-goliath-cloud"
)

// repairCloudGoliathTeleport normalizes the movement payload to the canonical
// schema field. The runtime keeps a legacy alias for audited preimages, while
// the live postimage remains valid for the editor and schema validator.
func repairCloudGoliathTeleport(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions`); err != nil {
		return fmt.Errorf("temporarily disable certified action mechanics guard: %w", err)
	}

	var matches, exact int
	if err := tx.QueryRow(`
		SELECT count(*), count(*) FILTER (WHERE id = $1::uuid AND card_number = $2)
		FROM actions WHERE deleted_at IS NULL AND (id = $1::uuid OR card_number = $2)
	`, cloudGoliathActionID, cloudGoliathActionCard).Scan(&matches, &exact); err != nil {
		return fmt.Errorf("inspect Cloud Goliath action identity: %w", err)
	}
	if matches != 1 || exact != 1 {
		return fmt.Errorf("%s stable identity drifted: matching_rows=%d exact_rows=%d", cloudGoliathActionCard, matches, exact)
	}

	result, err := tx.Exec(`
		UPDATE actions
		SET mechanics = jsonb_set(
		      mechanics #- '{effects,0,result,0,mode}',
		      '{effects,0,result,0,value}',
		      '"teleport"'::jsonb,
		      true
		    ),
		    support = NULL,
		    updated_at = NOW()
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		  AND mechanics #>> '{effects,0,result,0,kind}' = 'movement'
		  AND COALESCE(
		    mechanics #>> '{effects,0,result,0,value}',
		    mechanics #>> '{effects,0,result,0,mode}'
		  ) = 'teleport'
	`, cloudGoliathActionID, cloudGoliathActionCard)
	if err != nil {
		return fmt.Errorf("repair Cloud Goliath teleport declaration: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read Cloud Goliath teleport update count: %w", err)
	}
	if updated != 1 {
		return fmt.Errorf("Cloud Goliath teleport declaration is incompatible: updated_rows=%d", updated)
	}

	var compatible int
	if err := tx.QueryRow(`
		SELECT count(*) FROM actions
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		  AND mechanics #>> '{effects,0,result,0,kind}' = 'movement'
		  AND mechanics #>> '{effects,0,result,0,value}' = 'teleport'
		  AND mechanics #> '{effects,0,result,0,mode}' IS NULL
	`, cloudGoliathActionID, cloudGoliathActionCard).Scan(&compatible); err != nil {
		return fmt.Errorf("verify Cloud Goliath teleport postcondition: %w", err)
	}
	if compatible != 1 {
		return fmt.Errorf("Cloud Goliath teleport postcondition failed: compatible_records=%d", compatible)
	}

	if _, err := tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
