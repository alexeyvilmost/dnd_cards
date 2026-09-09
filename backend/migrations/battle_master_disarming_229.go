package migrations

import (
	"database/sql"
	"fmt"
)

const battleMasterDisarming229 = `{"activation":{"mode":"triggered","cost":[{"resource":"superiority_die"}],"trigger":{"events":["hit"],"disarm_held_item":true}},"targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":600,"requires_line_of_sight":false,"allowed_relations":["enemy","ally"]},"effects":[{"resolution":"auto","who":"target","result":[{"kind":"damage","amount":"superiority_die","type":"triggering_attack","suppress_damage_modifiers":true}]},{"resolution":"save","who":"target","ability":"str","dc":"8 + prof + max(str, dex)","on_fail":[{"kind":"world_interaction","operation":"drop_held_item","parameters":{"choice_id":"disarm_held_item"}}]}]}`

func materializeBattleMasterDisarming(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO actions
      (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
      SELECT '22900000-0000-4000-8000-000000000001'::uuid,'Обезоруживающая атака','Disarming Attack',
      'После попадания броском атаки потратьте кость превосходства и добавьте её к урону. Выберите один предмет в руках цели. При провале спасброска Силы цель роняет его в своей клетке.',
      image_url,'common','ACT-bm-disarming-attack','class_feature','class_feature','free_action',$1::jsonb,'System','PHB 2024',
      jsonb_build_object('status','untested','mechanics_locked',false,'note','Battle Master maneuver; learned choice is required')
      FROM actions WHERE card_number='action_help' AND deleted_at IS NULL
      ON CONFLICT(card_number) DO UPDATE SET deleted_at=NULL,mechanics=EXCLUDED.mechanics,
        description=EXCLUDED.description,image_url=EXCLUDED.image_url,updated_at=NOW()`, battleMasterDisarming229)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Disarming Attack action, got %d: %v", n, err)
	}

	_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,1,options,items}',
      (mechanics#>'{effects,1,options,items}') || $1::jsonb),updated_at=NOW()
      WHERE card_number='EFFECT-0041' AND deleted_at IS NULL
        AND NOT (mechanics#>'{effects,1,options,items}') @> '[{"id":"ACT-bm-disarming-attack"}]'::jsonb`,
		`[{"id":"ACT-bm-disarming-attack","name":"Обезоруживающая атака","grants":[{"kind":"grant_action","value":"ACT-bm-disarming-attack"}]}]`)
	if err != nil {
		return err
	}
	// Berserker has a single weapon. Freeze that physical card and bind its
	// stat-block attack to it; disarming cannot leave a phantom greataxe attack.
	result, err = tx.Exec(`UPDATE monsters m SET ai=m.ai || jsonb_build_object('held_weapon_card',to_jsonb(c)-'created_at'-'updated_at'-'deleted_at'),updated_at=NOW()
      FROM cards c WHERE m.slug='berserker' AND m.deleted_at IS NULL AND c.card_number='CARD-0312' AND c.deleted_at IS NULL`)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("missing Berserker/greataxe: %v", err)
	}
	_, err = tx.Exec(`UPDATE actions a SET mechanics=a.mechanics || jsonb_build_object('requires_held_item',c.id::text),updated_at=NOW()
      FROM cards c WHERE a.card_number='RL-MA-BERSERKER-AXE' AND a.deleted_at IS NULL AND c.card_number='CARD-0312' AND c.deleted_at IS NULL`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
