package migrations

import (
	"database/sql"
	"fmt"
)

const battleMasterCommander227 = `{"activation":{"mode":"active","cost":[{"resource":"action"},{"resource":"superiority_die"}],"commanded_attack":true},"attack_replacement":{"replacement_key":"battle_master.commander","replaces_attacks":1,"total_attacks":1,"once_per_attack_action":false},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":600,"requires_line_of_sight":false,"requires_willing":true,"requires_target_perception":true,"allowed_relations":["ally"]},"effects":[{"resolution":"auto","result":[{"kind":"narrative","description":"Союзник может потратить реакцию на одну атаку оружием или безоружный удар, добавив кость превосходства к урону при попадании."}]}]}`

func materializeBattleMasterCommander(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO actions
      (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
      SELECT '22700000-0000-4000-8000-000000000001'::uuid,'Удар командующего','Commander’s Strike',
      'В свой ход замените одну атаку действия Атака и потратьте кость превосходства. Согласный союзник, который видит или слышит вас, может немедленно потратить реакцию на одну атаку оружием или безоружный удар, добавив кость превосходства к урону при попадании.',
      image_url,'common','ACT-bm-commanders-strike','class_feature','class_feature','free_action',$1::jsonb,'System','PHB 2024',
      jsonb_build_object('status','untested','mechanics_locked',false,'note','Battle Master maneuver; learned choice is required')
      FROM actions WHERE card_number='action_help' AND deleted_at IS NULL
      ON CONFLICT(card_number) DO UPDATE SET deleted_at=NULL,mechanics=EXCLUDED.mechanics,
        description=EXCLUDED.description,image_url=EXCLUDED.image_url,updated_at=NOW()`, battleMasterCommander227)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Commander Strike action, got %d: %v", n, err)
	}

	_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,1,options,items}',
      (mechanics#>'{effects,1,options,items}') || $1::jsonb),updated_at=NOW()
      WHERE card_number='EFFECT-0041' AND deleted_at IS NULL
        AND NOT (mechanics#>'{effects,1,options,items}') @> '[{"id":"ACT-bm-commanders-strike"}]'::jsonb`,
		`[{"id":"ACT-bm-commanders-strike","name":"Удар командующего","grants":[{"kind":"grant_action","value":"ACT-bm-commanders-strike"}]}]`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
