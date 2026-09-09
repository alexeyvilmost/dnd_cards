package migrations

import "database/sql"

const eldritchKnightCasting236 = `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"spellcasting_ability","role":"primary","ability":"int"},{"kind":"narrative","description":"Заклинания волшебника: 2 заговора; 3 подготовленных заклинания на 3-м уровне воина и 4 на 4–5-м. Характеристика заклинаний — Интеллект."}]},{"id":"ek_cantrips","kind":"choice","count":2,"resolution":"on_acquire","prompt":"Выберите 2 заговора волшебника","options":{"source":"spell","filter":{"levels":[0],"classes":["волшебник"]}},"grant":{"kind":"grant_spell","label":"cantrip"}},{"id":"ek_spells_l1","kind":"choice","count":3,"count_by_level":{"3":3,"4":4},"resolution":"on_acquire","prompt":"Подготовленные заклинания волшебника 1-го круга","options":{"source":"spell","filter":{"levels":[1],"classes":["волшебник"]}},"grant":{"kind":"grant_spell","label":"prepared"}}]}`

func materializeEldritchKnightCasting(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`UPDATE effects SET mechanics=$1::jsonb,updated_at=NOW() WHERE card_number='EFFECT-0047'`, eldritchKnightCasting236)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE classes SET resources=jsonb_set((SELECT jsonb_object_agg(key,value||'{"level_source":"warrior"}'::jsonb) FROM jsonb_each(resources)),'{spell_slot_1,multiclass_divisor}','3'::jsonb),updated_at=NOW() WHERE id='08bbd860-2492-49bb-b31a-17f920d1e35a'`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
