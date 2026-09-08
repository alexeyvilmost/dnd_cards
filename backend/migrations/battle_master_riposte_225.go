package migrations

import (
	"database/sql"
	"fmt"
)

const battleMasterRiposte225 = `{"activation":{"mode":"triggered","cost":[{"resource":"reaction"},{"resource":"superiority_die"}],"trigger":{"events":["enemy_melee_miss"],"melee_counterattack":true}},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"narrative","description":"После промаха рукопашной атакой выберите ответный удар оружием в руке или безоружным ударом. При попадании добавьте кость превосходства к урону."}]}]}`

func materializeBattleMasterRiposte(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO actions
      (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
      SELECT '22500000-0000-4000-8000-000000000001'::uuid,'Ответный удар','Riposte',
      'Когда другое существо промахивается по вам рукопашной атакой, потратьте реакцию и кость превосходства, чтобы атаковать его рукопашным оружием или безоружным ударом. При попадании добавьте кость к урону; при промахе она также расходуется.',
      image_url,'common','ACT-bm-riposte','class_feature','class_feature','free_action',$1::jsonb,'System','PHB 2024',
      jsonb_build_object('status','untested','mechanics_locked',false,'note','Battle Master maneuver; learned choice is required')
      FROM actions WHERE card_number='action_help' AND deleted_at IS NULL
      ON CONFLICT(card_number) DO UPDATE SET deleted_at=NULL,mechanics=EXCLUDED.mechanics,
        description=EXCLUDED.description,image_url=EXCLUDED.image_url,updated_at=NOW()`, battleMasterRiposte225)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Riposte Attack action, got %d: %v", n, err)
	}

	_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,1,options,items}',
      (mechanics#>'{effects,1,options,items}') || $1::jsonb),updated_at=NOW()
      WHERE card_number='EFFECT-0041' AND deleted_at IS NULL
        AND NOT (mechanics#>'{effects,1,options,items}') @> '[{"id":"ACT-bm-riposte"}]'::jsonb`,
		`[{"id":"ACT-bm-riposte","name":"Ответный удар","grants":[{"kind":"grant_action","value":"ACT-bm-riposte"}]}]`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
