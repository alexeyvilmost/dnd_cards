package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"reflect"
)

const (
	activeActionTargetingRevocationVersion = "revoked-active-targeting-contract-v1"
	activeActionTargetingRevocationReason  = "Сертификат отозван: механика получила явный actor-target контракт и должна быть повторно проверена через живой лист персонажа."
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

func applyActiveActionTargetingRepair(
	tx *sql.Tx,
	repair activeActionTargetingRepair,
	migrationVersion string,
) error {
	if repair.Table != "actions" && repair.Table != "cards" {
		return fmt.Errorf("unsupported targeting repair table %q", repair.Table)
	}
	query := fmt.Sprintf(`
			SELECT id::text, mechanics, COALESCE(support, 'null'::jsonb)
			FROM %s
			WHERE card_number = $1 AND deleted_at IS NULL
		`, repair.Table)
	var entityID string
	var beforeRaw, supportBeforeRaw []byte
	if err := tx.QueryRow(query, repair.CardNumber).Scan(
		&entityID,
		&beforeRaw,
		&supportBeforeRaw,
	); err != nil {
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
	var supportBefore any
	if err := json.Unmarshal(supportBeforeRaw, &supportBefore); err != nil {
		return fmt.Errorf("decode %s:%s support: %w", repair.Table, repair.CardNumber, err)
	}
	supportAfter := supportBefore
	if supportBefore != nil {
		supportAfter = map[string]any{
			"status":                "untested",
			"certification_version": activeActionTargetingRevocationVersion,
			"mechanics_locked":      false,
			"note":                  activeActionTargetingRevocationReason,
			"limitations":           []string{activeActionTargetingRevocationReason},
		}
		if _, err := tx.Exec(fmt.Sprintf(`
			INSERT INTO content_certification_revocations (
				entity_type, entity_id, card_number, prior_support, prior_mechanics,
				reason, migration_version
			)
			SELECT $2, id, card_number, support, mechanics, $3, $4
			FROM %s
			WHERE id = $1::uuid AND support IS NOT NULL
			ON CONFLICT (migration_version, entity_type, entity_id) DO NOTHING
		`, repair.Table),
			entityID,
			repair.Table[:len(repair.Table)-1],
			activeActionTargetingRevocationReason,
			migrationVersion,
		); err != nil {
			return fmt.Errorf("record %s:%s certification revocation: %w", repair.Table, repair.CardNumber, err)
		}
	}
	afterRaw, err = json.Marshal(after)
	if err != nil {
		return err
	}
	supportAfterRaw, err := json.Marshal(supportAfter)
	if err != nil {
		return err
	}
	update := fmt.Sprintf(`
			UPDATE %s
			SET mechanics = $2::jsonb,
				support = CASE
					WHEN $4::jsonb = 'null'::jsonb THEN NULL
					ELSE $4::jsonb
				END
			WHERE card_number = $1
			  AND deleted_at IS NULL
			  AND mechanics = $3::jsonb
			  AND COALESCE(support, 'null'::jsonb) = $5::jsonb
		`, repair.Table)
	result, err := tx.Exec(
		update,
		repair.CardNumber,
		afterRaw,
		beforeRaw,
		supportAfterRaw,
		supportBeforeRaw,
	)
	if err != nil {
		return fmt.Errorf("repair %s:%s targeting: %w", repair.Table, repair.CardNumber, err)
	}
	affected, err := result.RowsAffected()
	if err != nil || affected != 1 {
		return fmt.Errorf("repair %s:%s targeting affected %d rows: %w", repair.Table, repair.CardNumber, affected, err)
	}
	return nil
}

func repairActiveActionTargetingWithVersion(db *sql.DB, migrationVersion string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := createCertificationRevocationLedger(tx); err != nil {
		return fmt.Errorf("create certification revocation ledger: %w", err)
	}
	// Migration 096 intentionally makes certified rows immutable. Migration 105
	// is the exceptional, auditable path that revokes stale evidence before the
	// mechanics change. The DDL is transactional, so any failure restores the
	// guard together with every preimage.
	if _, err := tx.Exec(`DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions`); err != nil {
		return fmt.Errorf("temporarily disable action certification guard: %w", err)
	}
	for _, repair := range activeActionTargetingRepairs {
		if err := applyActiveActionTargetingRepair(tx, repair, migrationVersion); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`
		CREATE TRIGGER protect_actions_certified_mechanics
		BEFORE UPDATE OR DELETE ON actions
		FOR EACH ROW EXECUTE FUNCTION protect_certified_content_mechanics()
	`); err != nil {
		return fmt.Errorf("restore action certification guard: %w", err)
	}
	return tx.Commit()
}

func repairActiveActionTargeting(db *sql.DB) error {
	return repairActiveActionTargetingWithVersion(db, "105_repair_active_action_targeting")
}

// Migration 105 briefly existed in main with a preservation policy for locked
// legacy targeting. Some databases can therefore have 105 recorded while the
// locked Bardic Inspiration row still needs the strict audited repair.
func repairPreservedLockedActionTargeting(db *sql.DB) error {
	return repairActiveActionTargetingWithVersion(db, "106_repair_preserved_locked_action_targeting")
}
