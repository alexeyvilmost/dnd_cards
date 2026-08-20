package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"reflect"
)

type activeActionTargetingRepair struct {
	Table                   string
	CardNumber              string
	Targeting               map[string]any
	ExpectedLegacyTargeting map[string]any
	EnsureWhoTarget         bool
}

func actorTargeting(rangeFt float64, relations []string, touch bool) map[string]any {
	result := map[string]any{
		"domain":                 "actor",
		"actor_targets":          true,
		"shape":                  "single",
		"min_targets":            1,
		"max_targets":            1,
		"range_ft":               rangeFt,
		"requires_line_of_sight": true,
		"allowed_relations":      relations,
	}
	if touch {
		result["requires_touch"] = true
	}
	return result
}

var activeActionTargetingRepairs = []activeActionTargetingRepair{
	{
		Table: "actions", CardNumber: "action_help",
		ExpectedLegacyTargeting: map[string]any{
			"filter": "ally", "range": "5 feet", "shape": "single",
		},
		Targeting: actorTargeting(5, []string{"ally"}, false),
	},
	{
		Table: "actions", CardNumber: "action_basic_unarmed",
		ExpectedLegacyTargeting: map[string]any{
			"filter": "enemy", "range": "5 feet", "shape": "single",
		},
		Targeting: actorTargeting(5, []string{"enemy"}, false),
	},
	{
		Table: "actions", CardNumber: "ACT-bardic-inspiration",
		ExpectedLegacyTargeting: map[string]any{
			"filter": "ally", "range": "60 feet", "shape": "single",
		},
		Targeting: actorTargeting(60, []string{"ally"}, false),
	},
	{
		Table: "actions", CardNumber: "aasimar_healing_hands", EnsureWhoTarget: true,
		Targeting: actorTargeting(5, []string{"self", "ally", "enemy", "neutral"}, true),
	},
	// These legacy Giant Ancestry rows model an effect applied to the creature
	// involved in the triggering attack. Until the trigger pipeline owns that
	// prior target, the explicit long weapon range keeps manual combat testing
	// possible without baking an identity exception into the engine.
	{
		Table: "actions", CardNumber: "ACT-goliath-fire",
		Targeting: actorTargeting(600, []string{"enemy"}, false),
	},
	{
		Table: "actions", CardNumber: "ACT-goliath-frost",
		Targeting: actorTargeting(600, []string{"enemy"}, false),
	},
	{
		Table: "actions", CardNumber: "ACT-goliath-hill",
		Targeting: actorTargeting(600, []string{"enemy"}, false),
	},
	{
		Table: "actions", CardNumber: "ACT-goliath-storm",
		Targeting: actorTargeting(60, []string{"enemy"}, false),
	},
	{
		Table: "cards", CardNumber: "CARD-0450",
		Targeting: actorTargeting(600, []string{"enemy"}, false),
	},
}

func applyActiveActionTargetingRepair(tx *sql.Tx, repair activeActionTargetingRepair) error {
	if repair.Table != "actions" && repair.Table != "cards" {
		return fmt.Errorf("unsupported targeting repair table %q", repair.Table)
	}
	query := fmt.Sprintf(`
		SELECT mechanics
		FROM %s
		WHERE card_number = $1 AND deleted_at IS NULL
	`, repair.Table)
	var beforeRaw []byte
	if err := tx.QueryRow(query, repair.CardNumber).Scan(&beforeRaw); err != nil {
		return fmt.Errorf("read %s:%s targeting preimage: %w", repair.Table, repair.CardNumber, err)
	}
	var before map[string]any
	if err := json.Unmarshal(beforeRaw, &before); err != nil {
		return fmt.Errorf("decode %s:%s mechanics: %w", repair.Table, repair.CardNumber, err)
	}
	activation, _ := before["activation"].(map[string]any)
	if activation["mode"] != "active" {
		return fmt.Errorf("%s:%s is not an active action", repair.Table, repair.CardNumber)
	}

	afterRaw, err := json.Marshal(before)
	if err != nil {
		return err
	}
	var after map[string]any
	if err := json.Unmarshal(afterRaw, &after); err != nil {
		return err
	}
	if existing, exists := after["targeting"]; exists && !reflect.DeepEqual(existing, repair.Targeting) {
		if repair.ExpectedLegacyTargeting == nil || !reflect.DeepEqual(existing, repair.ExpectedLegacyTargeting) {
			return fmt.Errorf("%s:%s already has a different targeting contract", repair.Table, repair.CardNumber)
		}
	}
	after["targeting"] = repair.Targeting
	if repair.EnsureWhoTarget {
		effects, ok := after["effects"].([]any)
		if !ok || len(effects) == 0 {
			return fmt.Errorf("%s:%s has no effect to target", repair.Table, repair.CardNumber)
		}
		first, ok := effects[0].(map[string]any)
		if !ok {
			return fmt.Errorf("%s:%s first effect is malformed", repair.Table, repair.CardNumber)
		}
		if who, exists := first["who"]; exists && who != "target" {
			return fmt.Errorf("%s:%s first effect has incompatible who=%v", repair.Table, repair.CardNumber, who)
		}
		first["who"] = "target"
	}
	if reflect.DeepEqual(before, after) {
		return nil
	}
	afterRaw, err = json.Marshal(after)
	if err != nil {
		return err
	}
	update := fmt.Sprintf(`
		UPDATE %s
		SET mechanics = $2::jsonb
		WHERE card_number = $1
		  AND deleted_at IS NULL
		  AND mechanics = $3::jsonb
	`, repair.Table)
	result, err := tx.Exec(update, repair.CardNumber, afterRaw, beforeRaw)
	if err != nil {
		return fmt.Errorf("repair %s:%s targeting: %w", repair.Table, repair.CardNumber, err)
	}
	affected, err := result.RowsAffected()
	if err != nil || affected != 1 {
		return fmt.Errorf("repair %s:%s targeting affected %d rows: %w", repair.Table, repair.CardNumber, affected, err)
	}
	return nil
}

func repairActiveActionTargeting(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, repair := range activeActionTargetingRepairs {
		if err := applyActiveActionTargetingRepair(tx, repair); err != nil {
			return err
		}
	}
	return tx.Commit()
}
