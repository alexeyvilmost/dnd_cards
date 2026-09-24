package migrations

import (
	"database/sql"
	"errors"
)

func RefuseOwnedItemGrants265Down(*sql.DB) error {
	return errors.New("migration 265 is an authorization baseline; restore an audited backup instead of deleting grants")
}

// AddOwnedItemGrants265 captures only actual saved normal-sheet ownership once.
// It never rewrites cards, characters, certified mechanics or combat artifacts.
func AddOwnedItemGrants265(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`
SELECT pg_advisory_xact_lock(265, 1);
CREATE TABLE IF NOT EXISTS owned_item_grant_snapshots (
 version integer PRIMARY KEY CHECK (version = 265), captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS owned_item_grants (
 character_id uuid NOT NULL REFERENCES characters_v3(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
 reason text NOT NULL CHECK (reason IN ('snapshot265','library','admin')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(character_id, user_id, card_id)
);
CREATE INDEX IF NOT EXISTS owned_item_grants_user_card ON owned_item_grants(user_id, card_id);
-- Exact storage shapes only; arbitrary JSON keys, bond/attunement/related IDs,
-- container_id pointers and nonpositive inventory rows are not ownership.
CREATE OR REPLACE FUNCTION saved_item_card_ids(equipment jsonb, inventory jsonb)
RETURNS TABLE(card_id text) LANGUAGE sql IMMUTABLE AS $$
 SELECT value #>> '{}' FROM jsonb_each(CASE WHEN jsonb_typeof(equipment)='object' THEN equipment ELSE '{}'::jsonb END)
 WHERE key IN ('head','body','main_hand','off_hand','gloves','boots','cloak','necklace','ring_1','ring_2')
 AND jsonb_typeof(value)='string'
 UNION
 SELECT row->>'card_id' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(inventory)='array' THEN inventory ELSE '[]'::jsonb END) row
 WHERE jsonb_typeof(row->'card_id')='string' AND
 CASE WHEN jsonb_typeof(row->'qty')='number' THEN (row->>'qty')::numeric > 0 AND trunc((row->>'qty')::numeric)=(row->>'qty')::numeric ELSE false END
$$;
-- Serialize the snapshot with ordinary writes. The receipt prevents a rerun
-- from grandfathering cards injected after the original deployment.
LOCK TABLE characters_v3 IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO owned_item_grants(character_id,user_id,card_id,reason)
SELECT ch.id,ch.user_id,c.id,'snapshot265'
FROM characters_v3 ch JOIN users u ON u.id=ch.user_id
CROSS JOIN LATERAL saved_item_card_ids(ch.equipment,ch.inventory_items) refs
JOIN cards c ON c.id::text=refs.card_id AND c.deleted_at IS NULL
WHERE ch.character_type IN ('free','campaign') AND u.username <> 'public'
AND NOT EXISTS(SELECT 1 FROM owned_item_grant_snapshots WHERE version=265)
ON CONFLICT DO NOTHING;
INSERT INTO owned_item_grant_snapshots(version) VALUES(265) ON CONFLICT DO NOTHING;
`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
