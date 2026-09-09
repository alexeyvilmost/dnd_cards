package migrations

import (
	"database/sql"
	"fmt"
)

const battleMasterBaitSwitch226 = `{"activation":{"mode":"active","cost":[{"resource":"superiority_die"}],"position_exchange_ft":5},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":5,"requires_line_of_sight":false,"requires_willing":true,"allowed_relations":["ally"]},"effects":[{"resolution":"auto","result":[{"kind":"choice","id":"bait_ac_recipient","prompt":"Кто получает бонус к КЗ?","context":"in_play","count":1,"options":{"source":"explicit","items":[{"id":"self","name":"Я","grants":[{"kind":"narrative","description":"Защитный бонус получает исполнитель."}]},{"id":"target","name":"Союзник","grants":[{"kind":"narrative","description":"Защитный бонус получает союзник."}]}]}}]},{"resolution":"auto","who":"target","who_choice_id":"bait_ac_recipient","result":[{"kind":"modifier","op":"add","value":"superiority_die","value_timing":"on_apply","applies_to":{"roll":"ac"},"duration":{"type":"until_start_of_source_next_turn"},"stack_id":"maneuver:bait-switch"}]}]}`

func materializeBattleMasterBaitSwitch(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO actions
      (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
      SELECT '22600000-0000-4000-8000-000000000001'::uuid,'Приманка и подмена','Bait and Switch',
      'В свой ход потратьте кость превосходства и не менее 5 футов перемещения, чтобы поменяться местами с согласным существом в 5 футах, которое не Недееспособно. Это перемещение не провоцирует атак. Вы или союзник получаете бонус к КЗ, равный броску кости, до начала вашего следующего хода.',
      image_url,'common','ACT-bm-bait-switch','class_feature','class_feature','free_action',$1::jsonb,'System','PHB 2024',
      jsonb_build_object('status','untested','mechanics_locked',false,'note','Battle Master maneuver; learned choice is required')
      FROM actions WHERE card_number='action_help' AND deleted_at IS NULL
      ON CONFLICT(card_number) DO UPDATE SET deleted_at=NULL,mechanics=EXCLUDED.mechanics,
        description=EXCLUDED.description,image_url=EXCLUDED.image_url,updated_at=NOW()`, battleMasterBaitSwitch226)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one BaitSwitch Attack action, got %d: %v", n, err)
	}

	_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,1,options,items}',
      (mechanics#>'{effects,1,options,items}') || $1::jsonb),updated_at=NOW()
      WHERE card_number='EFFECT-0041' AND deleted_at IS NULL
        AND NOT (mechanics#>'{effects,1,options,items}') @> '[{"id":"ACT-bm-bait-switch"}]'::jsonb`,
		`[{"id":"ACT-bm-bait-switch","name":"Приманка и подмена","grants":[{"kind":"grant_action","value":"ACT-bm-bait-switch"}]}]`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
