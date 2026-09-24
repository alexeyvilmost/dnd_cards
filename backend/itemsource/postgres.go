package itemsource

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// Fixed structural fields only. Price/weight/presentation/identity/certificates
// are intentionally absent. No input names or IDs are interpolated into SQL.
var rulesFields = []string{
	"properties", "bonus_type", "bonus_value", "damage_type", "defense_type", "type",
	"related_cards", "related_actions", "related_effects", "attunement", "slot", "effects",
	"weapon_type", "requires_attunement", "range", "elemental_damage_value", "elemental_damage_type",
	"battle_profile", "container_mode", "contents", "mechanics", "enchant_bonus", "mastery",
}

// RulesFingerprintSQL uses the fixed table alias c. Missing historical columns
// become JSON null; PostgreSQL's jsonb text serialization gives stable ordering.
func RulesFingerprintSQL() string {
	parts := make([]string, 0, len(rulesFields)*2)
	for _, field := range rulesFields {
		parts = append(parts, "'"+field+"'", "to_jsonb(c)->'"+field+"'")
	}
	return "encode(sha256(convert_to(jsonb_build_object(" + strings.Join(parts, ",") + ")::text,'UTF8')),'hex')"
}

type InventoryRow struct {
	Card
	PreviousSource *string `json:"previous_source"`
	Deleted        bool    `json:"deleted"`
	Certified      bool    `json:"certified"`
	// Used only for the transaction invariant, never exported to audit output.
	BeforeJSON string `json:"-"`
}

// Inventory reads the caller's transaction; it performs no writes. The caller
// chooses read-only repeatable-read for audits and a table lock for migration.
func Inventory(ctx context.Context, tx *sql.Tx) ([]InventoryRow, error) {
	rows, err := tx.QueryContext(ctx, `SELECT c.id::text,c.card_number,COALESCE(c.name,''),COALESCE(c.name_en,''),
		COALESCE(c.description,''),COALESCE(c.detailed_description,''),`+RulesFingerprintSQL()+`,c.source,
		c.deleted_at IS NOT NULL,c.support IS NOT NULL,(to_jsonb(c)-ARRAY['source','updated_at']::text[])::text
		FROM cards c ORDER BY c.card_number,c.id`)
	if err != nil {
		return nil, fmt.Errorf("read item source inventory: %w", err)
	}
	defer rows.Close()
	result := []InventoryRow{}
	for rows.Next() {
		var row InventoryRow
		if err := rows.Scan(&row.ID, &row.CardNumber, &row.Name, &row.NameEN, &row.Description, &row.DetailedDescription, &row.RulesFingerprint, &row.PreviousSource, &row.Deleted, &row.Certified, &row.BeforeJSON); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}
