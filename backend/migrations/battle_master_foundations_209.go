package migrations

import (
	"database/sql"
	"fmt"
)

const battleMasterResources209 = `{"superiority_die":{"by_level":{"3":4,"7":5,"15":6},"level_source":"warrior","per":"short_rest"}}`

const studentOfWar209 = `{"activation":{"mode":"passive"},"effects":[{"kind":"choice","id":"student_of_war_tool","count":1,"context":"level_up","resolution":"on_acquire","prompt":"Ученик войны: ремесленные инструменты","options":{"source":"artisan_tool"},"grant":{"kind":"grant_proficiency","prof":"tool"}},{"kind":"choice","id":"student_of_war_skill","count":1,"context":"level_up","resolution":"on_acquire","prompt":"Ученик войны: навык воина","options":{"source":"explicit","items":[{"id":"acrobatics","name":"Акробатика"},{"id":"animal_handling","name":"Уход за животными"},{"id":"athletics","name":"Атлетика"},{"id":"history","name":"История"},{"id":"insight","name":"Проницательность"},{"id":"intimidation","name":"Запугивание"},{"id":"perception","name":"Восприятие"},{"id":"survival","name":"Выживание"}]},"grant":{"kind":"grant_proficiency","prof":"skill"}}]}`

func materializeBattleMasterFoundations(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`UPDATE classes SET resources=COALESCE(resources,'{}'::jsonb)||$1::jsonb,updated_at=NOW()
      WHERE id='a2039ecc-4989-4942-9210-fc315c365847' AND deleted_at IS NULL`, battleMasterResources209)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Battle Master, got %d: %v", n, err)
	}
	// The subclass owns the pool. Keeping the former passive grant would double it.
	result, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,0,result}',
      COALESCE((SELECT jsonb_agg(p) FROM jsonb_array_elements(mechanics#>'{effects,0,result}') p
        WHERE NOT (p->>'kind'='resource' AND p->>'op'='grant' AND p->>'id'='superiority_die')),'[]'::jsonb)),updated_at=NOW()
      WHERE card_number='EFFECT-0041' AND deleted_at IS NULL`)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Combat Superiority effect, got %d: %v", n, err)
	}
	result, err = tx.Exec(`UPDATE effects SET mechanics=$1::jsonb,updated_at=NOW()
      WHERE card_number='EFFECT-0042' AND deleted_at IS NULL`, studentOfWar209)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Student of War effect, got %d: %v", n, err)
	}
	_, err = tx.Exec(`INSERT INTO resources(resource_id,name,name_en,description,category,recharge,sort_order)
      VALUES('superiority_die','Кости превосходства','Superiority Dice','Кости превосходства Мастера боя. Восстанавливаются после короткого или долгого отдыха.','class','short_rest',2090)
      ON CONFLICT(resource_id) DO UPDATE SET name=EXCLUDED.name,name_en=EXCLUDED.name_en,description=EXCLUDED.description,
        recharge=EXCLUDED.recharge,deleted_at=NULL,updated_at=NOW()`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
