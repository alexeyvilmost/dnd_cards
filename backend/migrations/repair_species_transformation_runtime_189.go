package migrations

import (
	"database/sql"
	"fmt"
)

const speciesTransformationRuntimeVersion = "189_repair_species_transformation_runtime"

type speciesTransformationRuntimeRepair struct {
	card, mechanics, note string
}

var aasimarTransformationRuntimeRepairs = []speciesTransformationRuntimeRepair{
	{
		"RE-sub-wings",
		`{"activation":{"mode":"passive"},"duration":{"type":"minutes","amount":1},"stack_id":"aasimar:celestial-revelation","stack_type":"overwrite","effects":[{"resolution":"auto","result":[{"kind":"grant_speed","mode":"fly","value":"character_speed"},{"kind":"damage_rider","trigger":"damage_by_attack_or_spell","dice":"prof_bonus","type":"radiant","scope":"self","once_per_turn":"aasimar:celestial-revelation:damage","duration":{"type":"minutes","amount":1}}]}]}`,
		"Library-owned one-minute transformation and its once-per-turn Radiant rider execute for damaging attacks and spells. The 2D board still does not distinguish aerial traversal, so flight path adjudication and browser evidence remain pending.",
	},
	{
		"RE-sub-radiance",
		`{"activation":{"mode":"passive"},"duration":{"type":"minutes","amount":1},"stack_id":"aasimar:celestial-revelation","stack_type":"overwrite","light":{"bright_ft":10,"dim_ft":20},"effects":[{"resolution":"auto","result":[{"kind":"damage_rider","trigger":"damage_by_attack_or_spell","dice":"prof_bonus","type":"radiant","scope":"self","once_per_turn":"aasimar:celestial-revelation:damage","duration":{"type":"minutes","amount":1}}]}]}`,
		"Library-owned light state, one-minute lifecycle and once-per-turn Radiant rider execute for damaging attacks and spells. End-of-turn damage to every creature in a moving 10-foot emanation and browser evidence remain pending.",
	},
	{
		"RE-sub-necrotic",
		`{"activation":{"mode":"passive"},"duration":{"type":"minutes","amount":1},"stack_id":"aasimar:celestial-revelation","stack_type":"overwrite","effects":[{"resolution":"auto","result":[{"kind":"damage_rider","trigger":"damage_by_attack_or_spell","dice":"prof_bonus","type":"necrotic","scope":"self","once_per_turn":"aasimar:celestial-revelation:damage","duration":{"type":"minutes","amount":1}}]}]}`,
		"Library-owned one-minute transformation and its once-per-turn Necrotic rider execute for damaging attacks and spells. The initial Charisma-save fear emanation and browser evidence remain pending.",
	},
}

// repairSpeciesTransformationRuntime deliberately leaves every changed entity
// untested. Focused runtime tests are not a substitute for the required browser
// evidence, and the two Aasimar emanations still have disclosed tactical gaps.
func repairSpeciesTransformationRuntime(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, repair := range aasimarTransformationRuntimeRepairs {
		result, execErr := tx.Exec(`UPDATE effects SET
			mechanics=$2::jsonb,
			support=jsonb_build_object(
				'status','untested',
				'certification_version',$3::text,
				'mechanics_locked',false,
				'note',$4::text),
			updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL`,
			repair.card, repair.mechanics, speciesTransformationRuntimeVersion, repair.note)
		if execErr != nil {
			return fmt.Errorf("repair species transformation %s: %w", repair.card, execErr)
		}
		rows, rowsErr := result.RowsAffected()
		if rowsErr != nil || rows != 1 {
			return fmt.Errorf("repair species transformation %s affected %d rows: %w", repair.card, rows, rowsErr)
		}
	}

	if _, err = tx.Exec(`UPDATE actions SET support=jsonb_build_object(
		'status','untested',
		'certification_version',$1::text,
		'mechanics_locked',false,
		'note','All three choices attach exact library effects with a visible one-minute lifecycle. Attack and spell damage riders execute; flight traversal and the Radiance/Shroud emanations remain disclosed browser-test blockers.'),updated_at=NOW()
		WHERE card_number='ACT-aasimar-revelation' AND deleted_at IS NULL`,
		speciesTransformationRuntimeVersion); err != nil {
		return fmt.Errorf("mark Aasimar revelation action untested: %w", err)
	}

	if _, err = tx.Exec(`UPDATE effects SET support=jsonb_build_object(
		'status','untested',
		'certification_version',$1::text,
		'mechanics_locked',false,
		'note','Large size, +10 Speed and Strength-check Advantage are data-driven for ten minutes. Transformed size now reaches grapple/shove and relative-size feat gates; spatial footprint, manual ending and browser evidence remain pending.'),updated_at=NOW()
		WHERE card_number='EFFECT-goliath-large-form' AND deleted_at IS NULL`,
		speciesTransformationRuntimeVersion); err != nil {
		return fmt.Errorf("mark Goliath Large Form untested: %w", err)
	}

	var triggerCount, certifiedCount int
	if err = tx.QueryRow(`SELECT
		count(*) FILTER (WHERE mechanics::text LIKE '%"trigger": "damage_by_attack_or_spell"%'),
		count(*) FILTER (WHERE support->>'status' LIKE 'verified%')
		FROM effects
		WHERE card_number=ANY(ARRAY['RE-sub-wings','RE-sub-radiance','RE-sub-necrotic'])
		AND deleted_at IS NULL`).Scan(&triggerCount, &certifiedCount); err != nil {
		return fmt.Errorf("verify Aasimar transformation postimage: %w", err)
	}
	if triggerCount != 3 || certifiedCount != 0 {
		return fmt.Errorf("bad Aasimar transformation postimage triggers=%d certified=%d", triggerCount, certifiedCount)
	}

	return tx.Commit()
}
