package migrations

import (
	"database/sql"
	"fmt"
)

const subclassPrimaryRuntimeVersion = "194_repair_subclass_primary_runtime"

// Level 3-5 Berserkers always roll two Frenzy dice. The predicates are
// deliberately machine-observable: Rage is the exact stack emitted by the
// shared Rage action, and Reckless Attack contributes the hit's Advantage.
const berserkerFrenzyMechanics = `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"damage_rider","trigger":"hit_by_attack_roll","dice":"2d6","type":"weapon","scope":"self","filter":{"attackKind":"weapon","ability":"str"},"once_per_turn":"berserker:frenzy","duration":{"type":"manual"},"when":[{"kind":"you_have_effect_stack","value":"class:barbarian:rage:damage"},{"kind":"attack_advantage_state","value":"advantage"}]},{"kind":"damage_rider","trigger":"hit_by_attack_roll","dice":"2d6","type":"bludgeoning","scope":"self","filter":{"attackKind":"unarmed","ability":"str"},"once_per_turn":"berserker:frenzy","duration":{"type":"manual"},"when":[{"kind":"you_have_effect_stack","value":"class:barbarian:rage:damage"},{"kind":"attack_advantage_state","value":"advantage"}]}]}]}`

// The once-per-rest refresh/wild-surge coupling remains explicit narrative;
// the primary player-facing use now arms a real consumable d20 modifier.
const tidesOfChaosActionMechanics = `{"activation":{"mode":"active","cost":[{"resource":"self_uses"}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"advantage","applies_to":{"roll":"d20"},"consume":"next","duration":{"type":"until_long_rest"},"stack_id":"wild-magic:tides-of-chaos","stack_type":"overwrite"},{"kind":"narrative","description":"Преимущество подготовлено для следующего Теста к20. Возможное восстановление при сотворении заклинания и Волна дикой магии остаются отдельным решением ведущего."}]}],"uses":{"count":1,"per":"long_rest"}}`

func repairSubclassPrimaryRuntime(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
	`); err != nil {
		return fmt.Errorf("unlock subclass primary runtime repairs: %w", err)
	}

	result, err := tx.Exec(`UPDATE effects SET mechanics=$2::jsonb,
		support=jsonb_build_object(
			'status','untested','certification_version',$3::text,
			'mechanics_locked',false,
			'note','Frenzy level 3-5 weapon and Unarmed Strike riders are gated by exact Rage/Reckless runtime facts and once per turn; sheet/combat/clarity browser verification pending.'),
		updated_at=NOW() WHERE card_number=$1 AND deleted_at IS NULL`,
		"EFFECT-0023", berserkerFrenzyMechanics, subclassPrimaryRuntimeVersion)
	if err != nil {
		return fmt.Errorf("repair Berserker Frenzy: %w", err)
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		return fmt.Errorf("repair Berserker Frenzy affected %d rows: %w", rows, rowsErr)
	}

	result, err = tx.Exec(`UPDATE actions SET action_type='class_feature',resource='free_action',
		mechanics=$2::jsonb,
		support=jsonb_build_object(
			'status','untested','certification_version',$3::text,
			'mechanics_locked',false,
			'note','Primary Tides of Chaos use arms a visible, consumable Advantage modifier and spends its bounded use; spell-cast refresh coupling and browser verification remain.'),
		updated_at=NOW() WHERE card_number=$1 AND deleted_at IS NULL`,
		"ACT-subclass-EFFECT-0244", tidesOfChaosActionMechanics, subclassPrimaryRuntimeVersion)
	if err != nil {
		return fmt.Errorf("repair Tides of Chaos action: %w", err)
	}
	if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
		return fmt.Errorf("repair Tides of Chaos action affected %d rows: %w", rows, rowsErr)
	}

	var frenzy, tides int
	if err = tx.QueryRow(`SELECT
		(SELECT count(*) FROM effects WHERE card_number='EFFECT-0023' AND deleted_at IS NULL
		 AND mechanics=$1::jsonb),
		(SELECT count(*) FROM actions WHERE card_number='ACT-subclass-EFFECT-0244' AND deleted_at IS NULL
		 AND mechanics=$2::jsonb)`, berserkerFrenzyMechanics, tidesOfChaosActionMechanics).Scan(&frenzy, &tides); err != nil {
		return fmt.Errorf("verify subclass primary runtime repairs: %w", err)
	}
	if frenzy != 1 || tides != 1 {
		return fmt.Errorf("bad subclass primary postimage frenzy=%d tides=%d", frenzy, tides)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
