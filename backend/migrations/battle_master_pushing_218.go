package migrations

import (
	"database/sql"
	"fmt"
)

const battleMasterPushing218 = `{"activation":{"mode":"triggered","cost":[{"resource":"superiority_die"}],"trigger":{"events":["hit"],"requires_weapon_or_unarmed_hit":true}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":600,"requires_line_of_sight":false,"allowed_relations":["enemy"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"damage","amount":"superiority_die","type":"triggering_attack","suppress_damage_modifiers":true}]},{"resolution":"save","who":"target","ability":"str","dc":"8 + prof + max(str, dex)","automatic_success":{"if_target_size_greater_than":3},"on_fail":[{"kind":"choice","id":"pushing_attack_distance","prompt":"Расстояние отталкивания","context":"in_play","count":1,"options":{"source":"explicit","items":[{"id":"0","name":"Не отталкивать","grants":[{"kind":"movement","value":"push","distance":0}]},{"id":"5","name":"5 фт.","grants":[{"kind":"movement","value":"push","distance":5}]},{"id":"10","name":"10 фт.","grants":[{"kind":"movement","value":"push","distance":10}]},{"id":"15","name":"15 фт.","grants":[{"kind":"movement","value":"push","distance":15}]}]}}]}]}`

func materializeBattleMasterPushing(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO actions
      (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
      SELECT '21800000-0000-4000-8000-000000000001'::uuid,'Толкающая атака','Pushing Attack',
      'После попадания оружием или безоружным ударом потратьте кость превосходства и добавьте её к урону атаки. Цель Большого размера или меньше совершает спасбросок Силы; при провале оттолкните её по прямой от себя на выбранное расстояние до 15 футов. СЛ использует большую из Силы и Ловкости.',
      image_url,'common','ACT-bm-pushing-attack','class_feature','class_feature','free_action',$1::jsonb,'System','PHB 2024',
      jsonb_build_object('status','untested','mechanics_locked',false,'note','Battle Master maneuver; learned choice is required')
      FROM actions WHERE card_number='action_help' AND deleted_at IS NULL
      ON CONFLICT(card_number) DO UPDATE SET deleted_at=NULL,mechanics=EXCLUDED.mechanics,
        description=EXCLUDED.description,image_url=EXCLUDED.image_url,updated_at=NOW()`, battleMasterPushing218)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Pushing Attack Attack action, got %d: %v", n, err)
	}

	_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,1,options,items}',
      (mechanics#>'{effects,1,options,items}') || $1::jsonb),updated_at=NOW()
      WHERE card_number='EFFECT-0041' AND deleted_at IS NULL
        AND NOT (mechanics#>'{effects,1,options,items}') @> '[{"id":"ACT-bm-pushing-attack"}]'::jsonb`,
		`[{"id":"ACT-bm-pushing-attack","name":"Толкающая атака","grants":[{"kind":"grant_action","value":"ACT-bm-pushing-attack"}]}]`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
