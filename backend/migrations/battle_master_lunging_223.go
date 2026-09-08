package migrations

import (
	"database/sql"
	"fmt"
)

const battleMasterLunging223 = `{"activation":{"mode":"active","counts_as":"dash","cost":[{"resource":"bonus_action"},{"resource":"superiority_die"}]},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"damage_rider","trigger":"hit_by_attack_roll","dice":"superiority_die","type":"triggering_attack","scope":"self","attack_maneuver":true,"attack_maneuver_id":"ACT-bm-lunging","requires_attack_action_approach_ft":5,"duration":{"type":"until_end_of_source_turn"}}]}]}`

func materializeBattleMasterLunging(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO actions
      (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
      SELECT '22300000-0000-4000-8000-000000000001'::uuid,'Атака с выпадом','Lunging',
      'Бонусным действием потратьте кость превосходства и совершите Рывок. В этот ход, пройдя не менее 5 футов по прямой непосредственно перед попаданием рукопашной атакой в составе действия Атака, добавьте кость превосходства к урону.',
      image_url,'common','ACT-bm-lunging','class_feature','class_feature','free_action',$1::jsonb,'System','PHB 2024',
      jsonb_build_object('status','untested','mechanics_locked',false,'note','Battle Master maneuver; learned choice is required')
      FROM actions WHERE card_number='action_help' AND deleted_at IS NULL
      ON CONFLICT(card_number) DO UPDATE SET deleted_at=NULL,mechanics=EXCLUDED.mechanics,
        description=EXCLUDED.description,image_url=EXCLUDED.image_url,updated_at=NOW()`, battleMasterLunging223)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Lunging Attack action, got %d: %v", n, err)
	}

	_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,1,options,items}',
      (mechanics#>'{effects,1,options,items}') || $1::jsonb),updated_at=NOW()
      WHERE card_number='EFFECT-0041' AND deleted_at IS NULL
        AND NOT (mechanics#>'{effects,1,options,items}') @> '[{"id":"ACT-bm-lunging"}]'::jsonb`,
		`[{"id":"ACT-bm-lunging","name":"Атака с выпадом","grants":[{"kind":"grant_action","value":"ACT-bm-lunging"}]}]`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
