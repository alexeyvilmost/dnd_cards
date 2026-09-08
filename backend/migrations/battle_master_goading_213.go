package migrations

import (
	"database/sql"
	"fmt"
)

const battleMasterGoading213 = `{"activation":{"mode":"triggered","cost":[{"resource":"superiority_die"}],"trigger":{"events":["hit"]}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":600,"requires_line_of_sight":false,"allowed_relations":["enemy"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"damage","amount":"superiority_die","type":"triggering_attack","suppress_damage_modifiers":true}]},{"resolution":"save","who":"target","ability":"wis","dc":"8 + prof + max(str, dex)","on_fail":[{"kind":"modifier","op":"disadvantage","applies_to":{"roll":"attack"},"when":[{"kind":"roll_target_is_not_condition_source"}],"source":"Провоцирующая атака","stack_id":"maneuver:goading-attack","duration":{"type":"until_end_of_source_next_turn"}}]}]}`

func materializeBattleMasterGoading(db *sql.DB) error {
	result, err := db.Exec(`INSERT INTO actions
      (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
      SELECT '21300000-0000-4000-8000-000000000001'::uuid,'Провоцирующая атака','Goading Attack',
      'После попадания: потратьте кость превосходства и добавьте её к урону атаки. При провале спасброска Мудрости цель получает помеху на атаки по всем, кроме вас, до конца вашего следующего хода. СЛ использует большую из Силы и Ловкости.',
      image_url,'common','ACT-bm-goading-attack','class_feature','class_feature','free_action',$1::jsonb,'System','PHB 2024',
      jsonb_build_object('status','untested','mechanics_locked',false,'note','Battle Master maneuver; learned choice is required')
      FROM effects WHERE card_number='COND-frightened' AND deleted_at IS NULL
      ON CONFLICT(card_number) DO UPDATE SET deleted_at=NULL,mechanics=EXCLUDED.mechanics,
        description=EXCLUDED.description,image_url=EXCLUDED.image_url,updated_at=NOW()`, battleMasterGoading213)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Goading Attack action, got %d: %v", n, err)
	}
	return nil
}
