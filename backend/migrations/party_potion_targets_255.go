package migrations

import "database/sql"

// The recipient belongs to the potion declaration, never to a camp-only button.
// Only fill missing targeting; retain authored variants and immutable catalogs.
const partyPotionTargeting255 = `{"domain":"actor","actor_targets":true,"shape":"single","range_ft":5,"min_targets":1,"max_targets":1,"allowed_relations":["self","ally"],"requires_line_of_sight":false}`

func materializePartyPotionTargets255(db *sql.DB) error {
	_, err := db.Exec(`UPDATE cards SET mechanics=jsonb_set(jsonb_set(mechanics,'{targeting}',$1::jsonb),'{effects}',
 (SELECT jsonb_agg(CASE WHEN e->'result' @> '[{"kind":"healing"}]'::jsonb THEN e || '{"who":"target"}'::jsonb ELSE e END)
 FROM jsonb_array_elements(mechanics->'effects') e)),updated_at=NOW()
 WHERE card_number IN ('CARD-0039','CARD-0839','CARD-0840','CARD-0841','CARD-0842')
 AND deleted_at IS NULL AND NOT (mechanics ? 'targeting')
 AND mechanics::text LIKE '%"healing"%'`, partyPotionTargeting255)
	return err
}
