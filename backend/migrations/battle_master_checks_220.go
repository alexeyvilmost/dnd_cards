package migrations

import (
	"database/sql"
	"fmt"
)

const commandingPresence220 = `{"activation":{"mode":"triggered","cost":[{"resource":"superiority_die"}],"trigger":{"events":["ability_check_made"],"eligible_checks":[{"ability":"cha","skills":["intimidation","performance","persuasion"]}]}},"targeting":{"domain":"actor","actor_targets":true,"shape":"self","min_targets":1,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"bonus_die","faces":8,"sign":1,"consume":"next","applies_to":{"roll":"ability_check"},"duration":{"type":"until_end_of_turn"},"source":"Командное присутствие"}]}]}`
const tacticalAssessment220 = `{"activation":{"mode":"triggered","cost":[{"resource":"superiority_die"}],"trigger":{"events":["ability_check_made"],"eligible_checks":[{"ability":"int","skills":["history","investigation"]},{"ability":"wis","skills":["insight"]}]}},"targeting":{"domain":"actor","actor_targets":true,"shape":"self","min_targets":1,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"bonus_die","faces":8,"sign":1,"consume":"next","applies_to":{"roll":"ability_check"},"duration":{"type":"until_end_of_turn"},"source":"Тактическая оценка"}]}]}`

func materializeBattleMasterChecks(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, row := range []struct{ id, card, name, nameEn, description, mechanics string }{
		{"22000000-0000-4000-8000-000000000001", "ACT-bm-commanding-presence", "Командное присутствие", "Commanding Presence", "При проверке Харизмы (Запугивание, Выступление или Убеждение) можно потратить кость превосходства и добавить её к результату.", commandingPresence220},
		{"22000000-0000-4000-8000-000000000002", "ACT-bm-tactical-assessment", "Тактическая оценка", "Tactical Assessment", "При проверке Интеллекта (История или Расследование) либо Мудрости (Проницательность) можно потратить кость превосходства и добавить её к результату.", tacticalAssessment220},
	} {
		result, err := tx.Exec(`INSERT INTO actions (id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
 SELECT $1::uuid,$2,$3,$4,image_url,'common',$5,'class_feature','class_feature','free_action',$6::jsonb,'System','PHB 2024',jsonb_build_object('status','untested','mechanics_locked',false,'note','Battle Master check maneuver; learned choice required') FROM actions WHERE card_number='action_help' AND deleted_at IS NULL
 ON CONFLICT(card_number) DO UPDATE SET deleted_at=NULL,mechanics=EXCLUDED.mechanics,description=EXCLUDED.description,image_url=EXCLUDED.image_url,updated_at=NOW()`, row.id, row.name, row.nameEn, row.description, row.card, row.mechanics)
		if err != nil {
			return err
		}
		if n, err := result.RowsAffected(); err != nil || n != 1 {
			return fmt.Errorf("expected one check maneuver %s, got %d: %v", row.card, n, err)
		}
		_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,1,options,items}',(mechanics#>'{effects,1,options,items}') || jsonb_build_array(jsonb_build_object('id',$1::text,'name',$2::text,'grants',jsonb_build_array(jsonb_build_object('kind','grant_action','value',$1::text))))),updated_at=NOW() WHERE card_number='EFFECT-0041' AND deleted_at IS NULL AND NOT (mechanics#>'{effects,1,options,items}') @> jsonb_build_array(jsonb_build_object('id',$1::text))`, row.card, row.name)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}
