package migrations

import (
	"database/sql"
	"fmt"
)

const goblinHide245 = `{"activation":{"mode":"active","counts_as":"hide","cost":[{"resource":"bonus_action"}]},"effects":[],"targeting":{"shape":"self","domain":"actor","actor_targets":false,"min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]}}`
const goblinDisengage245 = `{"activation":{"mode":"active","counts_as":"disengage","cost":[{"resource":"bonus_action"}]},"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"deny","applies_to":{"interaction":"opportunity_attack","trigger":"self_movement"},"duration":{"type":"until_end_of_turn"},"stack_id":"basic-action:disengage"}]}],"targeting":{"shape":"self","domain":"actor","actor_targets":false,"min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]}}`
const goblinAdvantage245 = `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"damage_rider","trigger":"hit_by_attack_roll","dice":"1d4","type":"slashing","scope":"self","filter":{"attackKind":"weapon","attackRange":"melee"},"duration":{"type":"manual"},"when":[{"kind":"attack_advantage_state","value":"advantage"}]},{"kind":"damage_rider","trigger":"hit_by_attack_roll","dice":"1d4","type":"piercing","scope":"self","filter":{"attackKind":"weapon","attackRange":"ranged"},"duration":{"type":"manual"},"when":[{"kind":"attack_advantage_state","value":"advantage"}]}]}]}`

// SRD 5.2.1 Goblin Warrior: both Nimble Escape options and the attack's
// advantage-only damage. Generator eligibility is accepted separately.
func materializeGoblinNimbleEscape(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, row := range []struct{ id, card, name, imageSource, mechanics string }{
		{"24500000-0000-4000-8000-000000000001", "RL-MA-GOBLIN-HIDE", "Ловкий побег: Засада", "action_basic_hide", goblinHide245},
		{"24500000-0000-4000-8000-000000000002", "RL-MA-GOBLIN-DISENGAGE", "Ловкий побег: Отход", "action_basic_disengage", goblinDisengage245},
	} {
		_, err = tx.Exec(`INSERT INTO actions(id,name,name_en,description,image_url,rarity,card_number,resource,mechanics,action_type,type,author,source)
   SELECT $1::uuid,$3,'Nimble Escape','Гоблин совершает Засаду или Отход бонусным действием.',image_url,'common',$2,'bonus_action',$5::jsonb,'base_action','monster','System','SRD 5.2.1'
   FROM actions WHERE card_number=$4 AND deleted_at IS NULL ON CONFLICT(card_number) DO NOTHING`, row.id, row.card, row.name, row.imageSource, row.mechanics)
		if err != nil {
			return err
		}
		var valid bool
		if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM actions WHERE id=$1::uuid AND card_number=$2 AND mechanics=$3::jsonb AND deleted_at IS NULL)`, row.id, row.card, row.mechanics).Scan(&valid); err != nil {
			return err
		}
		if !valid {
			return fmt.Errorf("missing or conflicting Nimble Escape action %s", row.card)
		}
	}
	_, err = tx.Exec(`INSERT INTO effects(id,name,name_en,description,rarity,card_number,effect_type,mechanics,repeatable,author,source)
 VALUES('24500000-0000-4000-8000-000000000003','Дополнительный урон при преимуществе','Goblin Warrior: Advantage Damage','При попадании с преимуществом Скимитар или Короткий лук наносит ещё 1к4 урона того же типа.','common','RL-ME-GOBLIN-ADVANTAGE','feat_ability',$1::jsonb,false,'System','SRD 5.2.1') ON CONFLICT(card_number) DO NOTHING`, goblinAdvantage245)
	if err != nil {
		return err
	}
	var valid bool
	if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM effects WHERE id='24500000-0000-4000-8000-000000000003' AND card_number='RL-ME-GOBLIN-ADVANTAGE' AND mechanics=$1::jsonb AND deleted_at IS NULL)`, goblinAdvantage245).Scan(&valid); err != nil {
		return err
	}
	if !valid {
		return fmt.Errorf("missing or conflicting Goblin advantage damage")
	}
	result, err := tx.Exec(`UPDATE monsters SET action_ids=(SELECT jsonb_agg(id ORDER BY id) FROM (SELECT DISTINCT value AS id FROM jsonb_array_elements(COALESCE(action_ids,'[]'::jsonb)||'["24500000-0000-4000-8000-000000000001","24500000-0000-4000-8000-000000000002"]'::jsonb)) ids),
 effect_ids=(SELECT jsonb_agg(id ORDER BY id) FROM (SELECT DISTINCT value AS id FROM jsonb_array_elements(COALESCE(effect_ids,'[]'::jsonb)||'["24500000-0000-4000-8000-000000000003"]'::jsonb)) ids),updated_at=NOW()
 WHERE slug='goblin-warrior' AND deleted_at IS NULL AND (NOT COALESCE(action_ids,'[]'::jsonb) @> '["24500000-0000-4000-8000-000000000001","24500000-0000-4000-8000-000000000002"]'::jsonb OR NOT COALESCE(effect_ids,'[]'::jsonb) @> '["24500000-0000-4000-8000-000000000003"]'::jsonb)`)
	if err != nil {
		return err
	}
	if n, e := result.RowsAffected(); e != nil || n > 1 {
		return fmt.Errorf("unexpected Goblin updates: %d (%v)", n, e)
	}
	if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM monsters WHERE slug='goblin-warrior' AND deleted_at IS NULL AND action_ids @> '["24500000-0000-4000-8000-000000000001","24500000-0000-4000-8000-000000000002"]'::jsonb AND effect_ids @> '["24500000-0000-4000-8000-000000000003"]'::jsonb)`).Scan(&valid); err != nil {
		return err
	}
	if !valid {
		return fmt.Errorf("Goblin Warrior not found")
	}
	return tx.Commit()
}
