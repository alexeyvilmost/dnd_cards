package migrations

import (
	"database/sql"
	"fmt"
)

const battleMasterParry216 = `{"activation":{"mode":"reaction","cost":[{"resource":"reaction"},{"resource":"superiority_die"}],"trigger":{"event":"damage_taken","timing":"before","circumstances":[{"kind":"event_data_equals","key":"delivery","value":"attack"},{"kind":"event_data_equals","key":"melee_attack","value":true}]}},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"reduce_damage","amount":"superiority_die + max(str, dex)"}]}]}`

func materializeBattleMasterParry(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO actions
      (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
      SELECT '21600000-0000-4000-8000-000000000001'::uuid,'Парирование','Parry',
      'Когда другое существо наносит вам урон рукопашной атакой, потратьте реакцию и кость превосходства. Уменьшите урон на результат кости плюс большую из модификаторов Силы и Ловкости.',
      image_url,'common','ACT-bm-parry','class_feature','class_feature','reaction',$1::jsonb,'System','PHB 2024',
      jsonb_build_object('status','untested','mechanics_locked',false,'note','Battle Master maneuver; learned choice is required')
      FROM actions WHERE card_number='action_basic_dodge' AND deleted_at IS NULL
      ON CONFLICT(card_number) DO UPDATE SET deleted_at=NULL,mechanics=EXCLUDED.mechanics,
        description=EXCLUDED.description,image_url=EXCLUDED.image_url,updated_at=NOW()`, battleMasterParry216)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Parry Attack action, got %d: %v", n, err)
	}

	_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,1,options,items}',
      (mechanics#>'{effects,1,options,items}') || $1::jsonb),updated_at=NOW()
      WHERE card_number='EFFECT-0041' AND deleted_at IS NULL
        AND NOT (mechanics#>'{effects,1,options,items}') @> '[{"id":"ACT-bm-parry"}]'::jsonb`,
		`[{"id":"ACT-bm-parry","name":"Парирование","grants":[{"kind":"grant_action","value":"ACT-bm-parry"}]}]`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
