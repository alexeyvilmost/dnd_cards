package migrations

import (
	"database/sql"
	"fmt"
)

const speciesLevelFiveIntegrityVersion = "183_repair_species_level_five_integrity"

type speciesLevelFiveEffectRepair struct {
	card, mechanics, note string
}

var aasimarRevelationEffectRepairs = []speciesLevelFiveEffectRepair{
	{
		"RE-sub-wings",
		`{"activation":{"mode":"passive"},"duration":{"type":"minutes","amount":1},"stack_id":"aasimar:celestial-revelation","stack_type":"overwrite","effects":[{"resolution":"auto","result":[{"kind":"grant_speed","mode":"fly","value":"character_speed"},{"kind":"damage_rider","trigger":"hit_by_attack_roll","dice":"prof_bonus","type":"radiant","scope":"self","once_per_turn":"aasimar:celestial-revelation:damage","duration":{"type":"minutes","amount":1}}]}]}`,
		"Library-owned one-minute transformation and once-per-turn Radiant attack-roll rider are executable. The current 2D board does not distinguish flight from walking, so aerial traversal still needs manual adjudication.",
	},
	{
		"RE-sub-radiance",
		`{"activation":{"mode":"passive"},"duration":{"type":"minutes","amount":1},"stack_id":"aasimar:celestial-revelation","stack_type":"overwrite","light":{"bright_ft":10,"dim_ft":20},"effects":[{"resolution":"auto","result":[{"kind":"damage_rider","trigger":"hit_by_attack_roll","dice":"prof_bonus","type":"radiant","scope":"self","once_per_turn":"aasimar:celestial-revelation:damage","duration":{"type":"minutes","amount":1}}]}]}`,
		"Library-owned light state, one-minute lifecycle and once-per-turn Radiant attack-roll rider are executable. End-of-turn damage to every creature in a moving 10-foot emanation still needs a source-following area runtime.",
	},
	{
		"RE-sub-necrotic",
		`{"activation":{"mode":"passive"},"duration":{"type":"minutes","amount":1},"stack_id":"aasimar:celestial-revelation","stack_type":"overwrite","effects":[{"resolution":"auto","result":[{"kind":"damage_rider","trigger":"hit_by_attack_roll","dice":"prof_bonus","type":"necrotic","scope":"self","once_per_turn":"aasimar:celestial-revelation:damage","duration":{"type":"minutes","amount":1}}]}]}`,
		"Library-owned one-minute transformation and once-per-turn Necrotic attack-roll rider are executable. The initial Charisma-save fear emanation and non-attack spell damage trigger still need multi-actor runtime support.",
	},
}

const aasimarRevelationActionMechanics = `{"uses":{"per":"long_rest","count":1},"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"self_uses"}],"requirements":[{"type":"level","min_level":3}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"kind":"choice","id":"revelation","count":1,"prompt":"Выберите проявление Небесного откровения (на 1 минуту)","context":"in_play","options":{"source":"explicit","items":[{"id":"wings","name":"Небесные крылья","grants":[{"kind":"grant_effect","value":"RE-sub-wings"}]},{"id":"radiance","name":"Внутренний свет","grants":[{"kind":"grant_effect","value":"RE-sub-radiance"}]},{"id":"shroud","name":"Некротический покров","grants":[{"kind":"grant_effect","value":"RE-sub-necrotic"}]}]}}]}`

const goliathLargeFormEffectMechanics = `{"activation":{"mode":"passive"},"duration":{"type":"minutes","amount":10},"stack_id":"goliath:large-form","stack_type":"overwrite","effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"set","value":3,"applies_to":{"roll":"size"}},{"kind":"modifier","op":"add","value":10,"applies_to":{"roll":"speed"}},{"kind":"modifier","op":"advantage","applies_to":{"roll":"ability_check","filter":{"ability":"str"}}}]}]}`

func updateSpeciesLevelFiveEffect(tx *sql.Tx, repair speciesLevelFiveEffectRepair) error {
	result, err := tx.Exec(`UPDATE effects SET mechanics=$2::jsonb,updated_at=NOW()
		WHERE card_number=$1 AND deleted_at IS NULL`,
		repair.card, repair.mechanics)
	if err != nil {
		return fmt.Errorf("repair species effect %s: %w", repair.card, err)
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		return fmt.Errorf("repair species effect %s affected %d rows: %w", repair.card, rows, rowsErr)
	}
	if _, err = tx.Exec(`UPDATE effects SET support=jsonb_build_object(
		'status','untested','certification_version',$2::text,
		'mechanics_locked',false,'note',$3::text),updated_at=NOW()
		WHERE card_number=$1 AND deleted_at IS NULL`,
		repair.card, speciesLevelFiveIntegrityVersion, repair.note); err != nil {
		return fmt.Errorf("mark species effect %s untested: %w", repair.card, err)
	}
	return nil
}

func repairSpeciesLevelFiveIntegrity(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
	`); err != nil {
		return fmt.Errorf("unlock species repairs: %w", err)
	}

	for _, repair := range aasimarRevelationEffectRepairs {
		if err = updateSpeciesLevelFiveEffect(tx, repair); err != nil {
			return err
		}
	}

	result, err := tx.Exec(`UPDATE actions SET mechanics=$2::jsonb,updated_at=NOW()
		WHERE card_number=$1 AND deleted_at IS NULL`,
		"ACT-aasimar-revelation", aasimarRevelationActionMechanics)
	if err != nil {
		return fmt.Errorf("repair Aasimar revelation action: %w", err)
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		return fmt.Errorf("repair Aasimar revelation action affected %d rows: %w", rows, rowsErr)
	}
	if _, err = tx.Exec(`UPDATE actions SET support=jsonb_build_object(
		'status','untested','certification_version',$1::text,
		'mechanics_locked',false,
		'note','All three choices now attach exact library effects with visible identity and a one-minute lifecycle. Flight traversal, the moving Radiance aura, the Shroud fear save and non-attack spell riders remain disclosed manual-test blockers.'),updated_at=NOW()
		WHERE card_number='ACT-aasimar-revelation' AND deleted_at IS NULL`,
		speciesLevelFiveIntegrityVersion); err != nil {
		return fmt.Errorf("mark Aasimar revelation action untested: %w", err)
	}

	result, err = tx.Exec(`UPDATE effects SET mechanics=$2::jsonb,updated_at=NOW()
		WHERE card_number=$1 AND deleted_at IS NULL`,
		"EFFECT-goliath-large-form", goliathLargeFormEffectMechanics)
	if err != nil {
		return fmt.Errorf("repair Goliath Large Form effect: %w", err)
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		return fmt.Errorf("repair Goliath Large Form effect affected %d rows: %w", rows, rowsErr)
	}
	if _, err = tx.Exec(`UPDATE effects SET support=jsonb_build_object(
		'status','untested','certification_version',$1::text,
		'mechanics_locked',false,
		'note','Ten-minute Large size, +10 Speed and Strength-check Advantage are data-driven; browser verification pending.'),updated_at=NOW()
		WHERE card_number='EFFECT-goliath-large-form' AND deleted_at IS NULL`,
		speciesLevelFiveIntegrityVersion); err != nil {
		return fmt.Errorf("mark Goliath Large Form effect untested: %w", err)
	}

	// These legacy feature rows were left attached after their actual action or
	// explicit lineage became the canonical owner. Keeping both paths exposed a
	// duplicate Large Form button and falsely certified empty on-acquire effects.
	if _, err = tx.Exec(`WITH obsolete AS (
		SELECT id::text AS id FROM effects
		WHERE card_number=ANY(ARRAY['RE-aasimar-5','RE-tiefling-3','RE-goliath-2'])
		AND deleted_at IS NULL
	)
	UPDATE races r SET related_effects=COALESCE((
		SELECT jsonb_agg(entry.value ORDER BY entry.ordinality)
		FROM jsonb_array_elements(COALESCE(r.related_effects,'[]'::jsonb))
		WITH ORDINALITY AS entry(value,ordinality)
		WHERE entry.value#>>'{}' NOT IN (SELECT id FROM obsolete)
	),'[]'::jsonb),updated_at=NOW()
	WHERE EXISTS (
		SELECT 1 FROM jsonb_array_elements_text(COALESCE(r.related_effects,'[]'::jsonb)) ref
		WHERE ref IN (SELECT id FROM obsolete)
	)`); err != nil {
		return fmt.Errorf("detach superseded species feature rows: %w", err)
	}

	// Giant Ancestry actions are already direct lineage-owned action references.
	// Remove the duplicate narrative wrappers instead of surfacing two buttons.
	if _, err = tx.Exec(`WITH wrappers AS (
		SELECT id::text AS id FROM effects
		WHERE card_number=ANY(ARRAY['RE-sub-cloud','RE-sub-fire','RE-sub-frost','RE-sub-hill','RE-sub-storm'])
		AND deleted_at IS NULL
	)
	UPDATE races r SET related_effects=COALESCE((
		SELECT jsonb_agg(entry.value ORDER BY entry.ordinality)
		FROM jsonb_array_elements(COALESCE(r.related_effects,'[]'::jsonb))
		WITH ORDINALITY AS entry(value,ordinality)
		WHERE entry.value#>>'{}' NOT IN (SELECT id FROM wrappers)
	),'[]'::jsonb),updated_at=NOW()
	WHERE EXISTS (
		SELECT 1 FROM jsonb_array_elements_text(COALESCE(r.related_effects,'[]'::jsonb)) ref
		WHERE ref IN (SELECT id FROM wrappers)
	)`); err != nil {
		return fmt.Errorf("detach narrative Giant Ancestry wrappers: %w", err)
	}

	// Never retain a mechanical certification for an entity whose remaining
	// behavior is narrative-only or whose canonical owner has superseded it.
	if _, err = tx.Exec(`UPDATE effects SET support=jsonb_build_object(
		'status','untested','certification_version',$1::text,
		'mechanics_locked',false,
		'note',CASE
			WHEN card_number IN ('RE-aasimar-5','RE-tiefling-3','RE-goliath-2')
				THEN 'Superseded legacy wrapper detached from its species; canonical action or lineage owns the feature.'
			WHEN card_number IN ('RE-sub-cloud','RE-sub-fire','RE-sub-frost','RE-sub-hill','RE-sub-storm')
				THEN 'Narrative duplicate detached; the lineage-owned action is the canonical executable entity and requires browser retest.'
			ELSE 'Narrative-only rule is not mechanically certified; dedicated tactical runtime and browser evidence are required.'
		END),updated_at=NOW()
		WHERE card_number=ANY(ARRAY[
			'RE-aasimar-5','RE-tiefling-3','RE-goliath-2',
			'RE-sub-cloud','RE-sub-fire','RE-sub-frost','RE-sub-hill','RE-sub-storm',
			'RE-halfling-2','RE-halfling-4','RE-sub-rock'
		]) AND deleted_at IS NULL`, speciesLevelFiveIntegrityVersion); err != nil {
		return fmt.Errorf("revoke false species certifications: %w", err)
	}

	var revelationOptions, revelationNarrative, repairedEffects, staleCertified int
	if err = tx.QueryRow(`SELECT
		jsonb_array_length(mechanics#>'{effects,0,options,items}'),
		count(*) FILTER (WHERE mechanics::text LIKE '%"kind": "narrative"%') OVER ()
		FROM actions WHERE card_number='ACT-aasimar-revelation' AND deleted_at IS NULL`).
		Scan(&revelationOptions, &revelationNarrative); err != nil {
		return fmt.Errorf("verify Aasimar action postimage: %w", err)
	}
	if err = tx.QueryRow(`SELECT count(*) FROM effects
		WHERE card_number=ANY(ARRAY['RE-sub-wings','RE-sub-radiance','RE-sub-necrotic'])
		AND deleted_at IS NULL AND support->>'status'='untested'
		AND support->>'certification_version'=$1
		AND mechanics::text LIKE '%"kind": "damage_rider"%'`, speciesLevelFiveIntegrityVersion).
		Scan(&repairedEffects); err != nil {
		return fmt.Errorf("verify Aasimar effect postimages: %w", err)
	}
	if err = tx.QueryRow(`SELECT count(*) FROM effects
		WHERE card_number=ANY(ARRAY[
			'RE-aasimar-5','RE-tiefling-3','RE-goliath-2',
			'RE-sub-cloud','RE-sub-fire','RE-sub-frost','RE-sub-hill','RE-sub-storm',
			'RE-halfling-2','RE-halfling-4','RE-sub-rock'
		]) AND deleted_at IS NULL AND support->>'status' LIKE 'verified%'`).Scan(&staleCertified); err != nil {
		return fmt.Errorf("verify false certification revocation: %w", err)
	}
	if revelationOptions != 3 || revelationNarrative != 0 || repairedEffects != 3 || staleCertified != 0 {
		return fmt.Errorf("bad species postimage options=%d narrative=%d effects=%d stale_certified=%d",
			revelationOptions, revelationNarrative, repairedEffects, staleCertified)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
