package migrations

import (
	"database/sql"
	"fmt"
)

const battleMasterPrecision222 = `{"activation":{"mode":"triggered","cost":[{"resource":"superiority_die"}],"trigger":{"events":["attack_missed"],"attack_roll_bonus_die":8}},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":1,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"narrative","description":"Добавьте кость превосходства к уже выпавшему промаху."}]}]}`

func materializeBattleMasterPrecision(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO actions
      (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
      SELECT '22200000-0000-4000-8000-000000000001'::uuid,'Точная атака','Precision',
      'После промаха атакой можно потратить кость превосходства и добавить её к результату атаки, чтобы превратить промах в попадание. Исходный к20 не перебрасывается.',
      image_url,'common','ACT-bm-precision','class_feature','class_feature','free_action',$1::jsonb,'System','PHB 2024',
      jsonb_build_object('status','untested','mechanics_locked',false,'note','Battle Master maneuver; learned choice is required')
      FROM actions WHERE card_number='action_help' AND deleted_at IS NULL
      ON CONFLICT(card_number) DO UPDATE SET deleted_at=NULL,mechanics=EXCLUDED.mechanics,
        description=EXCLUDED.description,image_url=EXCLUDED.image_url,updated_at=NOW()`, battleMasterPrecision222)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Precision Attack action, got %d: %v", n, err)
	}

	_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,1,options,items}',
      (mechanics#>'{effects,1,options,items}') || $1::jsonb),updated_at=NOW()
      WHERE card_number='EFFECT-0041' AND deleted_at IS NULL
        AND NOT (mechanics#>'{effects,1,options,items}') @> '[{"id":"ACT-bm-precision"}]'::jsonb`,
		`[{"id":"ACT-bm-precision","name":"Точная атака","grants":[{"kind":"grant_action","value":"ACT-bm-precision"}]}]`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
