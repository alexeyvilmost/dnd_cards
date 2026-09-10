package migrations

import (
	"database/sql"
	"fmt"
)

const hideTargeting244 = `{"shape":"self","domain":"actor","actor_targets":false,"min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]}`
const legacyCunningHide244 = `[{"dc":15,"skill":"stealth","ability":"dex","on_success":[{"kind":"grant_effect","value":"COND-invisible","duration":{"type":"manual"}}],"resolution":"ability_check"}]`

// Alternate Hide actions own their cost; the canonical command owns eligibility,
// the check, and all conditions that end hiding.
func materializeHideAction(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`LOCK TABLE actions IN ACCESS EXCLUSIVE MODE`); err != nil {
		return err
	}
	var unexpected bool
	if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM actions WHERE card_number='ACT-cunning-hide'
 AND (COALESCE(mechanics->'effects','null'::jsonb) NOT IN ($1::jsonb,'[]'::jsonb)
 OR (mechanics->'activation') - 'counts_as' <> '{"mode":"active","cost":[{"resource":"bonus_action"}]}'::jsonb))`, legacyCunningHide244).Scan(&unexpected); err != nil {
		return err
	}
	if unexpected {
		return fmt.Errorf("Hide migration: unrecognized Cunning Action mechanics require review")
	}
	var guard string
	if err = tx.QueryRow(`SELECT COALESCE((SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='actions'::regclass AND tgname='protect_actions_certified_mechanics'),'')`).Scan(&guard); err != nil {
		return err
	}
	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions`); err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE actions SET mechanics=jsonb_set(jsonb_set(jsonb_set(mechanics,
 '{activation}',(mechanics->'activation') || '{"counts_as":"hide"}'::jsonb),'{effects}','[]'::jsonb),'{targeting}',$1::jsonb),
 support=NULL, updated_at=NOW() WHERE card_number='ACT-cunning-hide'
 AND (mechanics#>>'{activation,counts_as}' IS DISTINCT FROM 'hide' OR mechanics->'effects' IS DISTINCT FROM '[]'::jsonb OR mechanics->'targeting' IS DISTINCT FROM $1::jsonb)`, hideTargeting244)
	if err != nil {
		return err
	}
	result, err := tx.Exec(`INSERT INTO actions(id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source)
 SELECT '24400000-0000-4000-8000-000000000001'::uuid,'Засада','Hide',
 'Действие: проверка Ловкости (Скрытность) СЛ 15. Требуется сильная заслонённость или укрытие на три четверти либо полное; враги не должны видеть вас. Скрытность прекращается от шума громче шёпота, обнаружения врагом, броска атаки или Вербального компонента заклинания.',
 COALESCE(NULLIF(image_url,''),(SELECT image_url FROM actions WHERE card_number='ACT-bm-ambush' AND deleted_at IS NULL)),'common','action_basic_hide','base_action','basic','action',
 jsonb_build_object('name','Засада','activation','{"mode":"active","counts_as":"hide","cost":[{"resource":"action"}]}'::jsonb,'effects','[]'::jsonb,'targeting',$1::jsonb),
 'System','PHB 2024' FROM actions WHERE card_number='ACT-cunning-hide' AND deleted_at IS NULL
 ON CONFLICT(card_number) DO NOTHING`, hideTargeting244)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n > 1 {
		return fmt.Errorf("unexpected Hide rows: %d (%v)", n, err)
	}
	_, err = tx.Exec(`UPDATE actions SET image_url=(SELECT image_url FROM actions WHERE card_number='ACT-bm-ambush' AND deleted_at IS NULL), updated_at=NOW()
 WHERE card_number IN ('action_basic_hide','ACT-cunning-hide') AND NULLIF(image_url,'') IS NULL
 AND EXISTS(SELECT 1 FROM actions WHERE card_number='ACT-bm-ambush' AND deleted_at IS NULL AND NULLIF(image_url,'') IS NOT NULL)`)
	if err != nil {
		return err
	}
	var exists bool
	if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM actions WHERE card_number='action_basic_hide' AND deleted_at IS NULL AND mechanics#>>'{activation,counts_as}'='hide')`).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("Hide action requires an active Cunning Action image source")
	}
	if guard != "" {
		if _, err = tx.Exec(guard); err != nil {
			return err
		}
	}
	return tx.Commit()
}
