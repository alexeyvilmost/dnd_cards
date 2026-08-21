package migrations

import (
	"database/sql"
	"fmt"
)

type goliathAncestryIdentity struct {
	AliasID       string
	AliasCard     string
	CanonicalCard string
	ActionCard    string
}

var goliathAncestryIdentities = []goliathAncestryIdentity{
	{AliasID: "c7d9a195-c230-462a-aed0-9b7c5bf5fd49", AliasCard: "RACE-GOLIATH-CLOUD", CanonicalCard: "RACE-0011-cloud", ActionCard: "ACT-goliath-cloud"},
	{AliasID: "06dece5f-241f-4469-b578-9cafb3336ad6", AliasCard: "RACE-GOLIATH-FIRE", CanonicalCard: "RACE-0011-fire", ActionCard: "ACT-goliath-fire"},
	{AliasID: "203cf3d8-f93b-403b-b6e6-bebe3ee55c68", AliasCard: "RACE-GOLIATH-FROST", CanonicalCard: "RACE-0011-frost", ActionCard: "ACT-goliath-frost"},
	{AliasID: "f36bbb07-411c-4444-91d4-98986a421165", AliasCard: "RACE-GOLIATH-HILL", CanonicalCard: "RACE-0011-hill", ActionCard: "ACT-goliath-hill"},
	{AliasID: "7a28d849-a2ea-4bf9-9b34-3824bb50211b", AliasCard: "RACE-GOLIATH-STONE", CanonicalCard: "RACE-0011-stone", ActionCard: "ACT-goliath-stone"},
	{AliasID: "15669e23-0649-4dde-8c86-643150bc3b61", AliasCard: "RACE-GOLIATH-STORM", CanonicalCard: "RACE-0011-storm", ActionCard: "ACT-goliath-storm"},
}

func bindGoliathCanonicalLineages(tx *sql.Tx) error {
	for _, identity := range goliathAncestryIdentities {
		if _, err := tx.Exec(`
			UPDATE races lineage
			SET related_actions = jsonb_build_array(action.id::text), updated_at = NOW()
			FROM actions action
			WHERE lineage.card_number = $1 AND lineage.deleted_at IS NULL
			  AND action.card_number = $2 AND action.deleted_at IS NULL
			  AND COALESCE(lineage.related_actions, '[]'::jsonb)
			      IS DISTINCT FROM jsonb_build_array(action.id::text)
		`, identity.CanonicalCard, identity.ActionCard); err != nil {
			return fmt.Errorf("bind %s to %s: %w", identity.CanonicalCard, identity.ActionCard, err)
		}
	}
	return nil
}

// deduplicateGoliathAncestry repairs the short-lived duplicate lineage set
// created by migration 109. Canonical lineage IDs were already established by
// migration 107, so character selections are moved before aliases are hidden.
func deduplicateGoliathAncestry(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err = bindGoliathCanonicalLineages(tx); err != nil {
		return err
	}
	for _, identity := range goliathAncestryIdentities {
		if _, err = tx.Exec(`
			UPDATE characters_v3 character
			SET lineage_id = canonical.id::text, updated_at = NOW()
			FROM races canonical
			WHERE canonical.card_number = $3 AND canonical.deleted_at IS NULL
			  AND character.lineage_id IN ($1, $2)
		`, identity.AliasID, identity.AliasCard, identity.CanonicalCard); err != nil {
			return fmt.Errorf("move character lineage %s: %w", identity.AliasCard, err)
		}
		if _, err = tx.Exec(`
			UPDATE races alias
			SET deleted_at = NOW(), updated_at = NOW()
			WHERE alias.id = $1::uuid AND alias.card_number = $2
			  AND alias.deleted_at IS NULL
			  AND EXISTS (
				SELECT 1 FROM races canonical
				WHERE canonical.card_number = $3 AND canonical.deleted_at IS NULL
			  )
		`, identity.AliasID, identity.AliasCard, identity.CanonicalCard); err != nil {
			return fmt.Errorf("hide duplicate lineage %s: %w", identity.AliasCard, err)
		}
	}
	return tx.Commit()
}
