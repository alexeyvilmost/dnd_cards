package migrations

import (
	"database/sql"
	"fmt"
)

const battleMasterEvasive210 = `{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"superiority_die"}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"deny","applies_to":{"interaction":"opportunity_attack","trigger":"self_movement"},"duration":{"type":"until_end_of_turn"},"stack_id":"basic-action:disengage"},{"kind":"modifier","op":"add","value":"superiority_die","value_timing":"on_apply","applies_to":{"roll":"ac"},"duration":{"type":"until_start_of_next_turn"},"stack_id":"maneuver:evasive-footwork"}]}]}`

const battleMasterDie210 = `{"kind":"variable","op":"set","id":"superiority_die","value":"1d8"}`

// Catalog materialization is separate from learned maneuvers; owning the
// subclass must not grant every maneuver automatically.
func materializeBattleMasterEvasive(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO actions
      (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
      SELECT '21000000-0000-4000-8000-000000000001'::uuid,'Уклоняющийся шаг','Evasive Footwork',
      'Бонусное действие и кость превосходства: Отход до конца хода; результат кости добавляется к КЗ до начала следующего хода.',
      image_url,'common','ACT-bm-evasive-footwork','class_feature','class_feature','bonus_action',$1::jsonb,'System','PHB 2024',
      jsonb_build_object('status','untested','mechanics_locked',false,'note','Battle Master maneuver; learned choice is required')
      FROM actions WHERE card_number='action_basic_dodge' AND deleted_at IS NULL
      ON CONFLICT (card_number) DO UPDATE SET deleted_at=NULL,mechanics=EXCLUDED.mechanics,
        description=EXCLUDED.description,image_url=EXCLUDED.image_url,updated_at=NOW()`, battleMasterEvasive210)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Evasive Footwork action, got %d: %v", n, err)
	}
	result, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,0,result}',
      COALESCE((SELECT jsonb_agg(p) FROM jsonb_array_elements(mechanics#>'{effects,0,result}') p
        WHERE NOT (p->>'kind'='variable' AND p->>'id'='superiority_die')),'[]'::jsonb)||jsonb_build_array($1::jsonb)),updated_at=NOW()
      WHERE card_number='EFFECT-0041' AND deleted_at IS NULL`, battleMasterDie210)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Combat Superiority variable declaration, got %d: %v", n, err)
	}
	return tx.Commit()
}
