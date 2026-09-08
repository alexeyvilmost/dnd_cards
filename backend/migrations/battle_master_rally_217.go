package migrations

import (
	"database/sql"
	"fmt"
)

const battleMasterRally217 = `{"activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"superiority_die"}]},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":30,"requires_line_of_sight":false,"requires_target_perception":true,"allowed_relations":["ally"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"temp_hp","amount":"superiority_die + floor(class_level:warrior / 2)"}]}]}`

func materializeBattleMasterRally(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO actions
      (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
      SELECT '21700000-0000-4000-8000-000000000001'::uuid,'Сплочение','Rally',
      'Бонусным действием потратьте кость превосходства. Союзник в пределах 30 футов, который видит или слышит вас, получает временные хиты: результат кости плюс половина уровня воина с округлением вниз.',
      image_url,'common','ACT-bm-rally','class_feature','class_feature','bonus_action',$1::jsonb,'System','PHB 2024',
      jsonb_build_object('status','untested','mechanics_locked',false,'note','Battle Master maneuver; learned choice is required')
      FROM actions WHERE card_number='action_help' AND deleted_at IS NULL
      ON CONFLICT(card_number) DO UPDATE SET deleted_at=NULL,mechanics=EXCLUDED.mechanics,
        description=EXCLUDED.description,image_url=EXCLUDED.image_url,updated_at=NOW()`, battleMasterRally217)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Rally Attack action, got %d: %v", n, err)
	}

	_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,1,options,items}',
      (mechanics#>'{effects,1,options,items}') || $1::jsonb),updated_at=NOW()
      WHERE card_number='EFFECT-0041' AND deleted_at IS NULL
        AND NOT (mechanics#>'{effects,1,options,items}') @> '[{"id":"ACT-bm-rally"}]'::jsonb`,
		`[{"id":"ACT-bm-rally","name":"Сплочение","grants":[{"kind":"grant_action","value":"ACT-bm-rally"}]}]`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
