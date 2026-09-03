package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const speciesLevelledSpellAccessMigrationVersion = "173_repair_species_levelled_spell_access"

type speciesLevelledSpellAccessSeed struct {
	effectCard      string
	levelThreeSpell string
	levelFiveSpell  string
}

var speciesLevelledSpellAccessSeeds = []speciesLevelledSpellAccessSeed{
	{"RE-sub-drow", "faerie_fire", "darkness"},
	{"RE-sub-high_elf", "detect_magic", "misty_step"},
	{"RE-sub-wood_elf", "longstrider", "pass_without_trace"},
	{"RE-sub-abyssal", "ray_of_sickness", "hold_person"},
	{"RE-sub-chthonic", "false_life", "ray_of_enfeeblement"},
	{"RE-sub-infernal", "hellish_rebuke", "darkness"},
}

// repairSpeciesLevelledSpellAccess makes the 2024 lineage spells explicit
// always-prepared grants. Their existing one-per-long-rest free cast remains
// available, while the access label also permits casting them with spell slots.
func repairSpeciesLevelledSpellAccess(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, seed := range speciesLevelledSpellAccessSeeds {
		result, execErr := tx.Exec(`UPDATE effects SET mechanics=jsonb_set(
			mechanics,'{effects,0,result}',(
				SELECT jsonb_agg(
					CASE WHEN item->>'kind'='grant_spell'
						AND COALESCE((item->>'level_gate')::int,1) IN (3,5)
					THEN item || jsonb_build_object('label','always_prepared')
					ELSE item END
					ORDER BY ordinal)
				FROM jsonb_array_elements(mechanics#>'{effects,0,result}')
					WITH ORDINALITY AS entries(item,ordinal)
			),true),updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL
			AND jsonb_typeof(mechanics#>'{effects,0,result}')='array'`, seed.effectCard)
		if execErr != nil {
			return fmt.Errorf("repair species spell access %s: %w", seed.effectCard, execErr)
		}
		if rows, _ := result.RowsAffected(); rows != 1 {
			return fmt.Errorf("repair species spell access %s updated %d rows, want 1", seed.effectCard, rows)
		}

		// The structural update above intentionally revokes stale support through
		// the content invalidator. Restore only an untested marker afterward.
		if _, err = tx.Exec(`UPDATE effects SET support=jsonb_build_object(
			'status','untested','certification_version',$1::text,'mechanics_locked',false,
			'note','Level-3/5 species spell access repaired; browser verification pending'),updated_at=NOW()
			WHERE card_number=$2 AND deleted_at IS NULL`, speciesLevelledSpellAccessMigrationVersion, seed.effectCard); err != nil {
			return fmt.Errorf("mark species spell access %s untested: %w", seed.effectCard, err)
		}

		var total, labelled, freeUses int
		if err = tx.QueryRow(`SELECT count(*),
			count(*) FILTER (WHERE item->>'label'='always_prepared'),
			count(*) FILTER (WHERE item#>>'{freeuse,count}'='1' AND item#>>'{freeuse,recharge}'='long_rest')
			FROM effects e CROSS JOIN LATERAL jsonb_array_elements(e.mechanics#>'{effects,0,result}') item
			WHERE e.card_number=$1 AND e.deleted_at IS NULL AND item->>'kind'='grant_spell'
			AND COALESCE((item->>'level_gate')::int,1) IN (3,5)`, seed.effectCard).Scan(&total, &labelled, &freeUses); err != nil {
			return fmt.Errorf("verify species spell access %s: %w", seed.effectCard, err)
		}
		if total != 2 || labelled != 2 || freeUses != 2 {
			return fmt.Errorf("species spell access %s total=%d labelled=%d freeuses=%d, want 2/2/2", seed.effectCard, total, labelled, freeUses)
		}
		for level, spell := range map[int]string{3: seed.levelThreeSpell, 5: seed.levelFiveSpell} {
			var matches int
			if err = tx.QueryRow(`SELECT count(*) FROM effects e
				CROSS JOIN LATERAL jsonb_array_elements(e.mechanics#>'{effects,0,result}') item
				WHERE e.card_number=$1 AND e.deleted_at IS NULL AND item->>'kind'='grant_spell'
				AND item->>'value'=$2 AND (item->>'level_gate')::int=$3
				AND item->>'label'='always_prepared'`, seed.effectCard, spell, level).Scan(&matches); err != nil {
				return fmt.Errorf("verify species spell %s/%s: %w", seed.effectCard, spell, err)
			}
			if matches != 1 {
				return fmt.Errorf("species spell %s/%s level %d matched %d rows, want 1", seed.effectCard, spell, level, matches)
			}
		}
	}

	// Backfill databases where migration 171 ran before Spell Sniper's required
	// attack-roll cantrip choice was added to its canonical effect seed.
	spellSniperChoice, marshalErr := json.Marshal(spellSniperCantripChoice())
	if marshalErr != nil {
		return fmt.Errorf("marshal Spell Sniper cantrip choice: %w", marshalErr)
	}
	result, execErr := tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects}',
		CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(mechanics->'effects','[]'::jsonb)) entry
			WHERE entry->>'kind'='choice' AND entry->>'id'='spell_sniper_cantrip')
		THEN mechanics->'effects' ELSE COALESCE(mechanics->'effects','[]'::jsonb)||jsonb_build_array($1::jsonb) END,true),
		updated_at=NOW() WHERE card_number='EFF-general-FEAT-0033' AND deleted_at IS NULL`, string(spellSniperChoice))
	if execErr != nil {
		return fmt.Errorf("backfill Spell Sniper cantrip choice: %w", execErr)
	}
	if rows, _ := result.RowsAffected(); rows != 1 {
		return fmt.Errorf("backfill Spell Sniper cantrip choice updated %d rows, want 1", rows)
	}
	if _, err = tx.Exec(`UPDATE effects SET support=jsonb_build_object(
		'status','untested','certification_version',$1::text,'mechanics_locked',false,
		'note','Spell Sniper attack-roll cantrip choice materialized; browser verification pending'),updated_at=NOW()
		WHERE card_number='EFF-general-FEAT-0033' AND deleted_at IS NULL`, speciesLevelledSpellAccessMigrationVersion); err != nil {
		return fmt.Errorf("mark Spell Sniper cantrip choice untested: %w", err)
	}
	var spellSniperChoices int
	if err = tx.QueryRow(`SELECT count(*) FROM effects e
		CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.mechanics->'effects','[]'::jsonb)) entry
		WHERE e.card_number='EFF-general-FEAT-0033' AND e.deleted_at IS NULL
		AND entry->>'kind'='choice' AND entry->>'id'='spell_sniper_cantrip'
		AND entry#>>'{options,filter,requires_attack_roll}'='true'
		AND entry#>>'{grant,label}'='cantrip'`).Scan(&spellSniperChoices); err != nil {
		return fmt.Errorf("verify Spell Sniper cantrip choice: %w", err)
	}
	if spellSniperChoices != 1 {
		return fmt.Errorf("Spell Sniper cantrip choices=%d, want 1", spellSniperChoices)
	}

	var untested int
	if err = tx.QueryRow(`SELECT count(*) FROM effects WHERE card_number IN
		('RE-sub-drow','RE-sub-high_elf','RE-sub-wood_elf','RE-sub-abyssal','RE-sub-chthonic','RE-sub-infernal')
		AND deleted_at IS NULL AND support->>'status'='untested'
		AND support->>'certification_version'=$1`, speciesLevelledSpellAccessMigrationVersion).Scan(&untested); err != nil {
		return fmt.Errorf("verify species spell support: %w", err)
	}
	if untested != len(speciesLevelledSpellAccessSeeds) {
		return fmt.Errorf("species spell support rows=%d, want %d", untested, len(speciesLevelledSpellAccessSeeds))
	}

	return tx.Commit()
}
