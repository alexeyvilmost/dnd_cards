package migrations

import (
	"database/sql"
	"fmt"
)

const battleMasterManeuvering228 = `{"activation":{"mode":"triggered","cost":[{"resource":"superiority_die"}],"trigger":{"events":["hit"],"secondary_target":true,"maneuvering_movement":true}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":600,"requires_line_of_sight":false,"allowed_relations":["enemy","ally"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"damage","amount":"superiority_die","type":"triggering_attack","suppress_damage_modifiers":true}]}]}`

func materializeBattleMasterManeuvering(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO actions
      (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
      SELECT '22800000-0000-4000-8000-000000000001'::uuid,'Маневрирующая атака','Maneuvering Attack',
      'После попадания броском атаки потратьте кость превосходства и добавьте её к урону. Выберите согласного союзника, который видит или слышит вас. Он может потратить реакцию, чтобы переместиться на расстояние до половины своей скорости, не провоцируя атак от цели вашего попадания.',
      image_url,'common','ACT-bm-maneuvering-attack','class_feature','class_feature','free_action',$1::jsonb,'System','PHB 2024',
      jsonb_build_object('status','untested','mechanics_locked',false,'note','Battle Master maneuver; learned choice is required')
      FROM actions WHERE card_number='action_help' AND deleted_at IS NULL
      ON CONFLICT(card_number) DO UPDATE SET deleted_at=NULL,mechanics=EXCLUDED.mechanics,
        description=EXCLUDED.description,image_url=EXCLUDED.image_url,updated_at=NOW()`, battleMasterManeuvering228)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Maneuvering Attack action, got %d: %v", n, err)
	}

	_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,1,options,items}',
      (mechanics#>'{effects,1,options,items}') || $1::jsonb),updated_at=NOW()
      WHERE card_number='EFFECT-0041' AND deleted_at IS NULL
        AND NOT (mechanics#>'{effects,1,options,items}') @> '[{"id":"ACT-bm-maneuvering-attack"}]'::jsonb`,
		`[{"id":"ACT-bm-maneuvering-attack","name":"Маневрирующая атака","grants":[{"kind":"grant_action","value":"ACT-bm-maneuvering-attack"}]}]`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
