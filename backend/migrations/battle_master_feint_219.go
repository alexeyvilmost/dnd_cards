package migrations

import (
	"database/sql"
	"fmt"
)

const battleMasterFeint219 = `{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"superiority_die"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":5,"requires_line_of_sight":false,"allowed_relations":["enemy"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"modifier","op":"advantage","scope":"target","consume":"next","applies_to":{"roll":"attack"},"when":[{"kind":"roller_is_condition_source"}],"duration":{"type":"until_end_of_source_turn"},"source":"Обманная атака","stack_id":"maneuver:feint-advantage"},{"kind":"damage_rider","trigger":"hit_by_attack_roll","dice":"superiority_die","type":"triggering_attack","scope":"target","source_actor_only":true,"consume":"next_attack","attack_maneuver":true,"duration":{"type":"until_end_of_source_turn"},"stack_id":"maneuver:feint-damage"}]}]}`

func materializeBattleMasterFeint(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO actions
      (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
      SELECT '21900000-0000-4000-8000-000000000001'::uuid,'Обманная атака','Feinting Attack',
      'Бонусным действием потратьте кость превосходства и выберите существо в пределах 5 футов. Следующая атака по этой цели в текущем ходу совершается с преимуществом; при попадании добавьте кость превосходства к урону. Эффект расходуется и при промахе.',
      image_url,'common','ACT-bm-feinting-attack','class_feature','class_feature','bonus_action',$1::jsonb,'System','PHB 2024',
      jsonb_build_object('status','untested','mechanics_locked',false,'note','Battle Master maneuver; learned choice is required')
      FROM actions WHERE card_number='action_help' AND deleted_at IS NULL
      ON CONFLICT(card_number) DO UPDATE SET deleted_at=NULL,mechanics=EXCLUDED.mechanics,
        description=EXCLUDED.description,image_url=EXCLUDED.image_url,updated_at=NOW()`, battleMasterFeint219)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Feinting Attack Attack action, got %d: %v", n, err)
	}

	_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,1,options,items}',
      (mechanics#>'{effects,1,options,items}') || $1::jsonb),updated_at=NOW()
      WHERE card_number='EFFECT-0041' AND deleted_at IS NULL
        AND NOT (mechanics#>'{effects,1,options,items}') @> '[{"id":"ACT-bm-feinting-attack"}]'::jsonb`,
		`[{"id":"ACT-bm-feinting-attack","name":"Обманная атака","grants":[{"kind":"grant_action","value":"ACT-bm-feinting-attack"}]}]`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
