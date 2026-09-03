package migrations

import (
	"database/sql"
	"fmt"
)

const generalFeatEffectClarityMigrationVersion = "174_clarify_general_feat_effect_cards"

// clarifyGeneralFeatEffectCards makes the sheet-facing linked effect explain
// the whole feat instead of showing only its mandatory +1 ability choice.
// Mechanics stay on the same data-owned effect; this migration changes only
// user-facing catalog text and deliberately leaves every feat untested.
func clarifyGeneralFeatEffectCards(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	result, err := tx.Exec(`UPDATE effects e SET
		name=f.name||' — правила',
		name_en=CASE WHEN COALESCE(f.name_en,'')='' THEN e.name_en ELSE f.name_en||' — rules' END,
		description=CASE WHEN f.card_number='FEAT-0049' THEN f.description ELSE
			f.description||E'\n\nПовышение характеристики: увеличьте одну допустимую характеристику на 1, максимум до 20.' END,
		detailed_description=CASE WHEN f.card_number='FEAT-0049' THEN
			COALESCE(NULLIF(f.detailed_description,''),f.description) ELSE
			COALESCE(NULLIF(f.detailed_description,''),f.description)||E'\n\nПовышение характеристики: увеличьте одну допустимую характеристику на 1, максимум до 20.' END,
		support=jsonb_build_object(
			'status','untested',
			'certification_version',$1::text,
			'mechanics_locked',false,
			'note','Full General-feat rules are visible on the linked effect card; browser verification pending'
		),
		updated_at=NOW()
	FROM feats f
	WHERE e.id::text IN (
		SELECT jsonb_array_elements_text(COALESCE(f.related_effects,'[]'::jsonb))
	)
		AND f.card_number ~ '^FEAT-00(1[1-9]|[2-4][0-9]|5[0-3])$'
		AND f.deleted_at IS NULL
		AND e.deleted_at IS NULL`, generalFeatEffectClarityMigrationVersion)
	if err != nil {
		return fmt.Errorf("clarify General-feat effect cards: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows != 43 {
		return fmt.Errorf("clarified General-feat effect rows=%d, want 43", rows)
	}

	var total, clear, untested int
	if err = tx.QueryRow(`SELECT count(*),
		count(*) FILTER (WHERE e.name=f.name||' — правила'
			AND e.description=CASE WHEN f.card_number='FEAT-0049' THEN f.description ELSE
				f.description||E'\n\nПовышение характеристики: увеличьте одну допустимую характеристику на 1, максимум до 20.' END
			AND e.detailed_description=CASE WHEN f.card_number='FEAT-0049' THEN
				COALESCE(NULLIF(f.detailed_description,''),f.description) ELSE
				COALESCE(NULLIF(f.detailed_description,''),f.description)||E'\n\nПовышение характеристики: увеличьте одну допустимую характеристику на 1, максимум до 20.' END),
		count(*) FILTER (WHERE e.support->>'status'='untested'
			AND e.support->>'certification_version'=$1)
	FROM feats f JOIN effects e ON e.id::text IN (
		SELECT jsonb_array_elements_text(COALESCE(f.related_effects,'[]'::jsonb))
	)
	WHERE f.card_number ~ '^FEAT-00(1[1-9]|[2-4][0-9]|5[0-3])$'
		AND f.deleted_at IS NULL AND e.deleted_at IS NULL`, generalFeatEffectClarityMigrationVersion).
		Scan(&total, &clear, &untested); err != nil {
		return fmt.Errorf("verify General-feat effect clarity: %w", err)
	}
	if total != 43 || clear != 43 || untested != 43 {
		return fmt.Errorf("General-feat effect clarity total=%d clear=%d untested=%d, want 43/43/43", total, clear, untested)
	}

	return tx.Commit()
}
