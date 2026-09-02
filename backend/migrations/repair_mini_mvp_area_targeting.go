package migrations

import (
	"database/sql"
	"fmt"
)

const miniMVPAreaTargetingMigrationVersion = "142_repair_mini_mvp_area_targeting"

const (
	armsOfHadarID   = "e75790cb-b03f-4a24-98a3-ef86a4756535"
	armsOfHadarCard = "SPELL-0283"
	colorSprayID    = "c5a6892f-d388-4075-9da6-6cfb0989ba26"
	colorSprayCard  = "SPELL-0284"
)

const armsOfHadarTargeting = `{
  "domain":"actor","actor_targets":true,"shape":"area",
  "min_targets":1,"max_targets":8,"range_ft":10,
  "requires_line_of_sight":false,"allowed_relations":["ally","enemy","neutral"],
  "area":{"kind":"emanation","radius_ft":10}
}`

const colorSprayTargeting = `{
  "domain":"actor","actor_targets":true,"shape":"area",
  "min_targets":1,"max_targets":8,"range_ft":15,
  "requires_line_of_sight":true,"allowed_relations":["ally","enemy","neutral"],
  "area":{"kind":"cone","size_ft":15}
}`

// repairMiniMVPAreaTargeting resolves the remaining real mismatches found by
// the full cantrip/level-1 description-versus-targeting audit. Presentation
// geometry and executable actor selection now share one declared authority.
func repairMiniMVPAreaTargeting(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells`); err != nil {
		return fmt.Errorf("disable certified spell guard: %w", err)
	}

	type target struct {
		id, card, area, targeting string
	}
	targets := []target{
		{armsOfHadarID, armsOfHadarCard, "10-футовая Эманация", armsOfHadarTargeting},
		{colorSprayID, colorSprayCard, "15-футовый Конус", colorSprayTargeting},
	}
	for _, spell := range targets {
		var matches, exact int
		if err = tx.QueryRow(`
			SELECT count(*), count(*) FILTER (WHERE id=$1::uuid AND card_number=$2)
			FROM spells WHERE deleted_at IS NULL AND (id=$1::uuid OR card_number=$2)
		`, spell.id, spell.card).Scan(&matches, &exact); err != nil {
			return fmt.Errorf("inspect %s identity: %w", spell.card, err)
		}
		if matches != 1 || exact != 1 {
			return fmt.Errorf("%s stable identity drifted: matching_rows=%d exact_rows=%d", spell.card, matches, exact)
		}
		if _, err = tx.Exec(`
			UPDATE spells SET
				mechanics=jsonb_set(COALESCE(mechanics,'{}'::jsonb),'{targeting}',$3::jsonb,true),
				area=$4,
				support=jsonb_build_object('status','untested','certification_version',$5::text,
				  'mechanics_locked',false,'note','Area targeting aligned with the spell description; browser retest required.'),
				updated_at=NOW()
			WHERE id=$1::uuid AND card_number=$2 AND deleted_at IS NULL
		`, spell.id, spell.card, spell.targeting, spell.area,
			miniMVPAreaTargetingMigrationVersion); err != nil {
			return fmt.Errorf("repair %s area targeting: %w", spell.card, err)
		}
	}

	var postconditions int
	if err = tx.QueryRow(`
		SELECT
		  (SELECT count(*) FROM spells WHERE id=$1::uuid AND card_number=$2
		    AND mechanics->'targeting'=$3::jsonb AND area=$4 AND deleted_at IS NULL)
		+ (SELECT count(*) FROM spells WHERE id=$5::uuid AND card_number=$6
		    AND mechanics->'targeting'=$7::jsonb AND area=$8 AND deleted_at IS NULL)
	`, armsOfHadarID, armsOfHadarCard, armsOfHadarTargeting, targets[0].area,
		colorSprayID, colorSprayCard, colorSprayTargeting, targets[1].area).Scan(&postconditions); err != nil {
		return fmt.Errorf("verify mini-MVP area targeting postconditions: %w", err)
	}
	if postconditions != 2 {
		return fmt.Errorf("mini-MVP area targeting postconditions failed: %d/2", postconditions)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
