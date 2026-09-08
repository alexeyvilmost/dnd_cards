package migrations

import (
	"database/sql"
	"fmt"
)

const battleMasterTrip212 = `{"activation":{"mode":"triggered","cost":[{"resource":"superiority_die"}],"trigger":{"events":["hit"],"requires_weapon_or_unarmed_hit":true}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":600,"requires_line_of_sight":false,"allowed_relations":["enemy"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"damage","amount":"superiority_die","type":"triggering_attack","suppress_damage_modifiers":true}]},{"resolution":"save","who":"target","ability":"str","dc":"8 + prof + max(str, dex)","automatic_success":{"if_target_size_greater_than":3},"on_fail":[{"kind":"condition","op":"apply","value":"prone","max_target_size":3}]}]}`

func materializeBattleMasterTrip(db *sql.DB) error {
	result, err := db.Exec(`INSERT INTO actions
      (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
      SELECT '21200000-0000-4000-8000-000000000001'::uuid,'Опрокидывающая атака','Trip Attack',
      'После попадания оружием или безоружным ударом: потратьте кость превосходства и добавьте её к урону атаки. Цель Большого размера или меньше совершает спасбросок Силы; при провале она сбита с ног. СЛ использует большую из Силы и Ловкости.',
      image_url,'common','ACT-bm-trip-attack','class_feature','class_feature','free_action',$1::jsonb,'System','PHB 2024',
      jsonb_build_object('status','untested','mechanics_locked',false,'note','Battle Master maneuver; learned choice is required')
      FROM effects WHERE card_number='COND-prone' AND deleted_at IS NULL
      ON CONFLICT(card_number) DO UPDATE SET deleted_at=NULL,mechanics=EXCLUDED.mechanics,
        description=EXCLUDED.description,image_url=EXCLUDED.image_url,updated_at=NOW()`, battleMasterTrip212)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Trip Attack action, got %d: %v", n, err)
	}
	return nil
}
