package migrations

import (
	"database/sql"
	"fmt"
)

// SRD 5.2.1 Bugbear Warrior: Grab applies an escape-DC 12 grapple to a
// Medium-or-smaller target, Light Hammer has Advantage against that exact
// grapple, and Abduct removes the usual extra movement cost while dragging it.
func materializeBugbearGrab(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	const ai = `{"grasping_parts":["long_arm"],"free_grapple_drag":true}`
	var valid bool
	if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM monsters WHERE slug='bugbear-warrior' AND deleted_at IS NULL
 AND armor_class=14 AND max_hp=33 AND speed=30
 AND (NOT ai ? 'grasping_parts' OR ai->'grasping_parts'=$1::jsonb->'grasping_parts')
 AND (NOT ai ? 'free_grapple_drag' OR ai->'free_grapple_drag'='true'::jsonb))`, ai).Scan(&valid); err != nil {
		return err
	}
	if !valid {
		return fmt.Errorf("bugbear-warrior stat block or Abduct declaration is missing, changed, or conflicting")
	}

	type actionPatch struct {
		cardNumber string
		key        string
		value      string
	}
	patches := []actionPatch{
		{"RL-MA-BUG-GRAB", "npc_grapple_on_hit", `{"source_part":"long_arm","escape_dc":12,"max_target_size":2}`},
		{"RL-MA-BUG-HAMMER", "npc_advantage_if_target_grappled_by_source", `true`},
		{"RL-MA-BUG-HAMMER-MELEE", "npc_advantage_if_target_grappled_by_source", `true`},
	}
	for _, patch := range patches {
		if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM actions WHERE card_number=$1 AND deleted_at IS NULL
 AND (NOT mechanics ? $2 OR mechanics->$2=$3::jsonb))`, patch.cardNumber, patch.key, patch.value).Scan(&valid); err != nil {
			return err
		}
		if !valid {
			return fmt.Errorf("%s declaration is missing or conflicting", patch.cardNumber)
		}
		result, updateErr := tx.Exec(`UPDATE actions SET mechanics=mechanics || jsonb_build_object($2::text, $3::jsonb),updated_at=NOW()
	WHERE card_number=$1 AND deleted_at IS NULL AND NOT mechanics @> jsonb_build_object($2::text, $3::jsonb)`, patch.cardNumber, patch.key, patch.value)
		if updateErr != nil {
			return updateErr
		}
		if n, rowsErr := result.RowsAffected(); rowsErr != nil || n > 1 {
			return fmt.Errorf("unexpected %s updates: %d (%v)", patch.cardNumber, n, rowsErr)
		}
	}
	// The legacy melee projection used the default 5-foot reach. The SRD
	// stat block gives both of the bugbear's long-arm melee attacks 10 feet.
	if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM actions WHERE card_number='RL-MA-BUG-HAMMER-MELEE' AND deleted_at IS NULL
 AND mechanics#>>'{targeting,range_ft}' IN ('5','10'))`).Scan(&valid); err != nil {
		return err
	}
	if !valid {
		return fmt.Errorf("RL-MA-BUG-HAMMER-MELEE reach is missing or conflicting")
	}
	result, err := tx.Exec(`UPDATE actions SET mechanics=jsonb_set(mechanics,'{targeting,range_ft}','10'::jsonb),updated_at=NOW()
 WHERE card_number='RL-MA-BUG-HAMMER-MELEE' AND deleted_at IS NULL AND mechanics#>>'{targeting,range_ft}'='5'`)
	if err != nil {
		return err
	}
	if n, rowsErr := result.RowsAffected(); rowsErr != nil || n > 1 {
		return fmt.Errorf("unexpected RL-MA-BUG-HAMMER-MELEE reach updates: %d (%v)", n, rowsErr)
	}
	result, err = tx.Exec(`UPDATE monsters SET ai=ai || $1::jsonb,updated_at=NOW()
 WHERE slug='bugbear-warrior' AND deleted_at IS NULL AND NOT ai @> $1::jsonb`, ai)
	if err != nil {
		return err
	}
	if n, rowsErr := result.RowsAffected(); rowsErr != nil || n > 1 {
		return fmt.Errorf("unexpected bugbear-warrior updates: %d (%v)", n, rowsErr)
	}
	return tx.Commit()
}
