package migrations

import (
	"database/sql"
	"fmt"
)

const battleMasterDistracting215 = `{"activation":{"mode":"triggered","cost":[{"resource":"superiority_die"}],"trigger":{"events":["hit"]}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":600,"requires_line_of_sight":false,"allowed_relations":["enemy"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"damage","amount":"superiority_die","type":"triggering_attack","suppress_damage_modifiers":true},{"kind":"modifier","op":"advantage","scope":"target","consume":"next","applies_to":{"roll":"attack"},"when":[{"kind":"roller_is_not_condition_source"}],"duration":{"type":"until_start_of_source_next_turn"},"source":"Отвлекающий удар","stack_id":"maneuver:distracting-strike"}]}]}`

func materializeBattleMasterDistracting(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO actions
      (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
      SELECT '21500000-0000-4000-8000-000000000001'::uuid,'Отвлекающий удар','Distracting Strike',
      'После попадания: потратьте кость превосходства и добавьте её к урону атаки. Следующая атака другого атакующего по этой цели получает преимущество, если совершена до начала вашего следующего хода.',
      image_url,'common','ACT-bm-distracting-strike','class_feature','class_feature','free_action',$1::jsonb,'System','PHB 2024',
      jsonb_build_object('status','untested','mechanics_locked',false,'note','Battle Master maneuver; learned choice is required')
      FROM effects WHERE card_number='COND-blinded' AND deleted_at IS NULL
      ON CONFLICT(card_number) DO UPDATE SET deleted_at=NULL,mechanics=EXCLUDED.mechanics,
        description=EXCLUDED.description,image_url=EXCLUDED.image_url,updated_at=NOW()`, battleMasterDistracting215)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Distracting Attack action, got %d: %v", n, err)
	}

	_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,1,options,items}',
      (mechanics#>'{effects,1,options,items}') || $1::jsonb),updated_at=NOW()
      WHERE card_number='EFFECT-0041' AND deleted_at IS NULL
        AND NOT (mechanics#>'{effects,1,options,items}') @> '[{"id":"ACT-bm-distracting-strike"}]'::jsonb`,
		`[{"id":"ACT-bm-distracting-strike","name":"Отвлекающий удар","grants":[{"kind":"grant_action","value":"ACT-bm-distracting-strike"}]}]`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
