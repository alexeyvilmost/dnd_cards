package migrations

import (
	"database/sql"
	"fmt"
)

const levelFiveSpellAreaRuntimeVersion = "191_repair_level_five_spell_area_runtime"

// repairLevelFiveSpellAreaRuntime closes two strict-runtime gaps discovered by
// the level-five catalog audit. Heat Metal's initial cast follows its card's
// Action casting time (the later repeat remains a separately adjudicated Bonus
// Action), and cylinders retain their real shape while projecting as circles
// on the two-dimensional combat board.
func repairLevelFiveSpellAreaRuntime(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells`); err != nil {
		return fmt.Errorf("unlock level-five spell area repairs: %w", err)
	}

	result, err := tx.Exec(`UPDATE spells SET
		mechanics=jsonb_set(
			COALESCE(mechanics,'{}'::jsonb),
			'{activation,cost}',
			'[{"resource":"action"},{"resource":"spell_slot","level":2,"amount":1}]'::jsonb,
			true),
		support=jsonb_build_object(
			'status','untested','certification_version',$2::text,
			'mechanics_locked',false,
			'note','Initial cast now spends an Action and a level-2 slot. The later same-object Bonus Action repeat remains explicit manual adjudication pending a concentration-linked target action.'),
		updated_at=NOW()
		WHERE card_number=$1 AND deleted_at IS NULL`, "SPELL-0279", levelFiveSpellAreaRuntimeVersion)
	if err != nil {
		return fmt.Errorf("repair Heat Metal initial casting cost: %w", err)
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		return fmt.Errorf("repair Heat Metal initial casting cost affected %d rows: %w", rows, rowsErr)
	}

	result, err = tx.Exec(`UPDATE spells SET
		mechanics=jsonb_set(COALESCE(mechanics,'{}'::jsonb),'{targeting,area,kind}','"cylinder"'::jsonb,true),
		support=jsonb_build_object(
			'status','untested','certification_version',$2::text,
			'mechanics_locked',false,
			'note','Cylinder targeting now has an executable circular 2D footprint; browser verification and remaining spell semantics are still pending.'),
		updated_at=NOW()
		WHERE card_number=ANY($1::text[]) AND deleted_at IS NULL`,
		[]string{"SPELL-0215", "sleet_storm"}, levelFiveSpellAreaRuntimeVersion)
	if err != nil {
		return fmt.Errorf("repair Moonbeam and Sleet Storm cylinder targeting: %w", err)
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 2 {
		return fmt.Errorf("repair cylinder targeting affected %d rows: %w", rows, rowsErr)
	}

	var heatMetalRows, cylinderRows int
	if err = tx.QueryRow(`SELECT count(*) FROM spells
		WHERE card_number='SPELL-0279' AND deleted_at IS NULL
		AND mechanics#>>'{activation,mode}'='active'
		AND jsonb_array_length(mechanics#>'{activation,cost}')=2
		AND mechanics#>'{activation,cost}' @> '[{"resource":"action"}]'::jsonb
		AND mechanics#>'{activation,cost}' @> '[{"resource":"spell_slot","level":2,"amount":1}]'::jsonb
		AND NOT (mechanics#>'{activation,cost}' @> '[{"resource":"bonus_action"}]'::jsonb)`).Scan(&heatMetalRows); err != nil {
		return fmt.Errorf("verify Heat Metal initial casting cost: %w", err)
	}
	if err = tx.QueryRow(`SELECT count(*) FROM spells
		WHERE card_number=ANY($1::text[]) AND deleted_at IS NULL
		AND mechanics#>>'{targeting,area,kind}'='cylinder'
		AND COALESCE((mechanics#>>'{targeting,area,radius_ft}')::numeric,0)>0
		AND EXISTS (
			SELECT 1 FROM jsonb_array_elements(mechanics->'effects') interaction,
				jsonb_array_elements(COALESCE(interaction->'result','[]'::jsonb)) payload
			WHERE payload->>'kind'='world_zone'
			AND payload#>>'{geometry,shape}'='cylinder'
			AND COALESCE((payload#>>'{geometry,size_ft}')::numeric,0)>0
		)`, []string{"SPELL-0215", "sleet_storm"}).Scan(&cylinderRows); err != nil {
		return fmt.Errorf("verify cylinder targeting: %w", err)
	}
	if heatMetalRows != 1 || cylinderRows != 2 {
		return fmt.Errorf("bad level-five spell area postimage heat_metal=%d cylinders=%d", heatMetalRows, cylinderRows)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
