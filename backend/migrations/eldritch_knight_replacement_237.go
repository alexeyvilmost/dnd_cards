package migrations

import "database/sql"

func materializeEldritchKnightReplacement(db *sql.DB) error {
	_, err := db.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects}',
 (SELECT jsonb_agg(CASE WHEN e->>'id' IN ('ek_cantrips','ek_spells_l1')
 THEN e||'{"replace_on_level_up":1}'::jsonb ELSE e END ORDER BY ord)
 FROM jsonb_array_elements(mechanics->'effects') WITH ORDINALITY AS entries(e,ord))),
 updated_at=NOW() WHERE card_number='EFFECT-0047'`)
	return err
}
