package migrations

import (
	"database/sql"
	"fmt"
)

const tacticalShiftMechanics207 = `{"activation":{"mode":"triggered","cost":[],"trigger":{"events":["action_resolved"],"source_action_card_number":"ACT-second-wind"}},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"movement","value":"additional","speed_fraction":0.5,"provoke_opportunity_attacks":false}]}]}`

func repairFighterTacticalShift(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`UPDATE actions SET mechanics=$1::jsonb, updated_at=NOW()
        WHERE card_number='ACT-fighter-tactical-shift' AND deleted_at IS NULL`, tacticalShiftMechanics207)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Tactical Shift action, got %d: %v", n, err)
	}
	return tx.Commit()
}
