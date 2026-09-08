package migrations

import (
	"database/sql"
	"fmt"
)

const championCriticalMovement208 = `{"activation":{"mode":"triggered","cost":[],"trigger":{"events":["crit"]}},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"movement","value":"additional","speed_fraction":0.5,"provoke_opportunity_attacks":false}]}]}`

func materializeChampionCriticalMovement(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO actions
      (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
      SELECT '20800000-0000-4000-8000-000000000001'::uuid,'Выдающийся атлет: перемещение','Remarkable Athlete: Movement',
      'Сразу после критического попадания можно переместиться на расстояние до половины скорости, не провоцируя атаки.',
      image_url,'common','ACT-champion-critical-movement','class_feature','class_feature','free_action',$1::jsonb,'System','PHB 2024',
      jsonb_build_object('status','untested','mechanics_locked',false,'note','Champion critical movement runtime')
      FROM effects WHERE card_number='EFFECT-0059' AND deleted_at IS NULL
      ON CONFLICT (card_number) DO UPDATE SET deleted_at=NULL,mechanics=EXCLUDED.mechanics,
        description=EXCLUDED.description,image_url=EXCLUDED.image_url,updated_at=NOW()`, championCriticalMovement208)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Champion action, got %d: %v", n, err)
	}
	result, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,0,result}',
      COALESCE((SELECT jsonb_agg(p) FROM jsonb_array_elements(mechanics#>'{effects,0,result}') p
        WHERE p->>'kind'<>'narrative' AND NOT (p->>'kind'='grant_action' AND p->>'value'='ACT-champion-critical-movement')),'[]'::jsonb)
      || '[{"kind":"grant_action","value":"ACT-champion-critical-movement"}]'::jsonb),updated_at=NOW()
      WHERE card_number='EFFECT-0059' AND deleted_at IS NULL`)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Remarkable Athlete effect, got %d: %v", n, err)
	}
	return tx.Commit()
}
