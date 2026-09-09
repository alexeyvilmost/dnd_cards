package migrations

import (
	"database/sql"
	"fmt"
)

const psiWarriorResources230 = `{"psi_warrior_energy_die":{"by_level":{"3":4,"5":6,"9":8,"13":10,"17":12},"level_source":"warrior","per":"long_rest","recovery":{"short_rest":{"mode":"fixed","amount":1},"long_rest":{"mode":"full"}}}}`
const psiWarriorDie230 = `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"variable","op":"set","id":"psi_warrior_energy_die","value":"1d8"}]}]}`

func materializePsiWarriorFoundations(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`UPDATE classes SET resources=COALESCE(resources,'{}'::jsonb)||$1::jsonb,updated_at=NOW() WHERE id='a72db803-1dc0-4535-9f31-a55eb016658b' AND deleted_at IS NULL`, psiWarriorResources230)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Psi Warrior, got %d: %v", n, err)
	}
	// Keep the warrior's pool distinct from Soulknife dice. Remove the old shared grant.
	_, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,0,result}',
 COALESCE((SELECT jsonb_agg(p) FROM jsonb_array_elements(mechanics#>'{effects,0,result}') p WHERE NOT(p->>'kind'='resource' AND p->>'op'='grant' AND p->>'id'='psionic_energy_die')),'[]'::jsonb)
 || '[{"kind":"variable","op":"set","id":"psi_warrior_energy_die","value":"1d6"}]'::jsonb),updated_at=NOW()
 WHERE card_number='EFFECT-0053' AND deleted_at IS NULL`)
	if err != nil {
		return err
	}
	result, err = tx.Exec(`INSERT INTO effects(id,name,name_en,description,card_number,mechanics,source,effect_type)
 VALUES('23000000-0000-4000-8000-000000000001','Псионическая энергия: к8','Psionic Energy: d8','На 5-м уровне воина кость псионической энергии становится к8.','EFFECT-psi-warrior-d8',$1::jsonb,'PHB 2024','class_ability')
 ON CONFLICT(card_number) DO UPDATE SET mechanics=EXCLUDED.mechanics,deleted_at=NULL,updated_at=NOW()`, psiWarriorDie230)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one psionic die upgrade, got %d: %v", n, err)
	}
	_, err = tx.Exec(`UPDATE classes SET level_progression=jsonb_set(level_progression,'{5}',COALESCE(level_progression->'5','{}'::jsonb)||jsonb_build_object('effects',COALESCE(level_progression#>'{5,effects}','[]'::jsonb)||'["23000000-0000-4000-8000-000000000001"]'::jsonb)),updated_at=NOW()
 WHERE id='a72db803-1dc0-4535-9f31-a55eb016658b' AND NOT COALESCE(level_progression#>'{5,effects}','[]'::jsonb) @> '["23000000-0000-4000-8000-000000000001"]'::jsonb`)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO resources(resource_id,name,name_en,description,category,recharge,sort_order)
 VALUES('psi_warrior_energy_die','Кости псионической энергии воина','Psi Warrior Energy Dice','Короткий отдых восстанавливает одну кость, долгий — все. Кости Пси-воина не расходуются на способности других подклассов.','class','long_rest',2300)
 ON CONFLICT(resource_id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,recharge=EXCLUDED.recharge,deleted_at=NULL,updated_at=NOW()`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
