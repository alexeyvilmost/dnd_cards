package migrations

import (
	"database/sql"
	"fmt"
)

const battleMasterAmbush221 = `{"activation":{"mode":"triggered","cost":[{"resource":"superiority_die"}],"trigger":{"events":["ability_check_made","initiative_roll"],"eligible_checks":[{"ability":"dex","skills":["stealth"]}],"requires_not_incapacitated":true}},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":1,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"bonus_die","faces":8,"sign":1,"consume":"next","applies_to":{"roll":"d20"},"duration":{"type":"until_end_of_turn"},"source":"Засада"}]}]}`

func materializeBattleMasterAmbush(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO actions
      (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
      SELECT '22100000-0000-4000-8000-000000000001'::uuid,'Засада','Ambush',
      'При проверке Ловкости (Скрытность) или броске инициативы можно потратить кость превосходства и добавить её к результату. Нельзя использовать в состоянии недееспособности.',
      image_url,'common','ACT-bm-ambush','class_feature','class_feature','free_action',$1::jsonb,'System','PHB 2024',
      jsonb_build_object('status','untested','mechanics_locked',false,'note','Battle Master maneuver; learned choice is required')
      FROM actions WHERE card_number='action_help' AND deleted_at IS NULL
      ON CONFLICT(card_number) DO UPDATE SET deleted_at=NULL,mechanics=EXCLUDED.mechanics,
        description=EXCLUDED.description,image_url=EXCLUDED.image_url,updated_at=NOW()`, battleMasterAmbush221)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Ambush Attack action, got %d: %v", n, err)
	}

	_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,1,options,items}',
      (mechanics#>'{effects,1,options,items}') || $1::jsonb),updated_at=NOW()
      WHERE card_number='EFFECT-0041' AND deleted_at IS NULL
        AND NOT (mechanics#>'{effects,1,options,items}') @> '[{"id":"ACT-bm-ambush"}]'::jsonb`,
		`[{"id":"ACT-bm-ambush","name":"Засада","grants":[{"kind":"grant_action","value":"ACT-bm-ambush"}]}]`)
	if err != nil {
		return err
	}
	// Self actions do not ask for an explicit actor target in canonical combat.
	_, err = tx.Exec(`UPDATE actions SET mechanics=jsonb_set(mechanics,'{targeting,actor_targets}','false'::jsonb),updated_at=NOW()
      WHERE card_number IN ('ACT-bm-commanding-presence','ACT-bm-tactical-assessment') AND deleted_at IS NULL`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
