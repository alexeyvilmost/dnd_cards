package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

const levelFiveStrictConditionsMigrationVersion = "177_repair_level_five_strict_conditions"

const (
	levelFiveStrictSpellRows           = 115
	levelFiveStrictProjectedActionRows = 23
	levelFiveStrictProjectedSourceRows = 23
	levelFiveStrictConditionAuditRows  = levelFiveStrictSpellRows + levelFiveStrictProjectedActionRows + levelFiveStrictProjectedSourceRows
)

type levelFiveStrictConditionRow struct {
	table, id, cardNumber string
	mechanics             map[string]any
}

func loadLevelFiveStrictConditionRows(tx *sql.Tx) ([]levelFiveStrictConditionRow, error) {
	rows, err := tx.Query(`
		SELECT 'spells',id::text,card_number,mechanics
		FROM spells WHERE deleted_at IS NULL AND `+levelFivePHBSpellPredicate+`
		UNION ALL
		SELECT 'actions',id::text,card_number,mechanics
		FROM actions WHERE deleted_at IS NULL AND card_number LIKE 'ACT-subclass-EFFECT-%'
		UNION ALL
		SELECT 'effects',id::text,card_number,mechanics
		FROM effects WHERE deleted_at IS NULL AND card_number=ANY($1::text[])
		ORDER BY 1,3,2
	`, func() []string {
		cards := make([]string, 0, len(levelFiveActiveSubclassTargets))
		for _, projection := range levelFiveActiveSubclassTargets {
			cards = append(cards, projection.effectCard)
		}
		return cards
	}())
	if err != nil {
		return nil, fmt.Errorf("load level-five strict-condition scope: %w", err)
	}
	defer rows.Close()
	result := make([]levelFiveStrictConditionRow, 0, levelFiveStrictConditionAuditRows)
	for rows.Next() {
		var row levelFiveStrictConditionRow
		var raw []byte
		if err = rows.Scan(&row.table, &row.id, &row.cardNumber, &raw); err != nil {
			return nil, fmt.Errorf("scan level-five strict-condition row: %w", err)
		}
		if err = json.Unmarshal(raw, &row.mechanics); err != nil {
			return nil, fmt.Errorf("decode %s %s mechanics: %w", row.table, row.cardNumber, err)
		}
		result = append(result, row)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate level-five strict-condition rows: %w", err)
	}
	if len(result) != levelFiveStrictConditionAuditRows {
		return nil, fmt.Errorf("level-five strict-condition denominator drifted: got %d, want %d (spells=%d projected_actions=%d projected_sources=%d)",
			len(result), levelFiveStrictConditionAuditRows, levelFiveStrictSpellRows,
			levelFiveStrictProjectedActionRows, levelFiveStrictProjectedSourceRows)
	}
	return result, nil
}

func storeLevelFiveStrictConditionRow(tx *sql.Tx, row levelFiveStrictConditionRow) error {
	encoded, err := json.Marshal(row.mechanics)
	if err != nil {
		return fmt.Errorf("encode %s %s strict condition mechanics: %w", row.table, row.cardNumber, err)
	}
	var query string
	switch row.table {
	case "spells":
		query = `UPDATE spells SET mechanics=$2::jsonb,
			support=jsonb_build_object('status','untested','certification_version',$3::text,
			'mechanics_locked',false,'note','Condition applications use effect-library identities; browser verification pending.'),
			updated_at=NOW() WHERE id=$1::uuid AND deleted_at IS NULL`
	case "actions":
		query = `UPDATE actions SET mechanics=$2::jsonb,
			support=jsonb_build_object('status','untested','certification_version',$3::text,
			'mechanics_locked',false,'note','Condition applications use effect-library identities; browser verification pending.'),
			updated_at=NOW() WHERE id=$1::uuid AND deleted_at IS NULL`
	case "effects":
		query = `UPDATE effects SET mechanics=$2::jsonb,
			support=jsonb_build_object('status','untested','certification_version',$3::text,
			'mechanics_locked',false,'note','Condition applications use effect-library identities; browser verification pending.'),
			updated_at=NOW() WHERE id=$1::uuid AND deleted_at IS NULL`
	default:
		return fmt.Errorf("unsupported level-five strict-condition table %q", row.table)
	}
	result, err := tx.Exec(query, row.id, string(encoded), levelFiveStrictConditionsMigrationVersion)
	if err != nil {
		return fmt.Errorf("store %s %s strict condition mechanics: %w", row.table, row.cardNumber, err)
	}
	if affected, rowsErr := result.RowsAffected(); rowsErr != nil || affected != 1 {
		return fmt.Errorf("store %s %s strict condition mechanics affected %d rows: %w", row.table, row.cardNumber, affected, rowsErr)
	}
	return nil
}

func auditLevelFiveStrictConditionMechanics(value any, path string, references map[string]bool) error {
	switch typed := value.(type) {
	case []any:
		for index, nested := range typed {
			if err := auditLevelFiveStrictConditionMechanics(nested, fmt.Sprintf("%s[%d]", path, index), references); err != nil {
				return err
			}
		}
	case map[string]any:
		if typed["kind"] == "condition" {
			return fmt.Errorf("%s retains a generic condition payload", path)
		}
		if _, exists := typed["inside_condition"]; exists {
			return fmt.Errorf("%s retains a bare inside_condition id", path)
		}
		if typed["kind"] == "grant_effect" {
			if card, ok := typed["value"].(string); ok && strings.HasPrefix(card, "COND-") {
				references[card] = true
			}
			if cards, ok := typed["values"].([]any); ok {
				for _, raw := range cards {
					if card, ok := raw.(string); ok && strings.HasPrefix(card, "COND-") {
						references[card] = true
					}
				}
			}
		}
		if typed["kind"] == "remove_effect" {
			if card, ok := typed["card_number"].(string); ok && strings.HasPrefix(card, "COND-") {
				references[card] = true
			}
		}
		for key, nested := range typed {
			if err := auditLevelFiveStrictConditionMechanics(nested, path+"."+key, references); err != nil {
				return err
			}
		}
	}
	return nil
}

// repairLevelFiveStrictConditions upgrades already-migrated level-2/3 spell
// and subclass rows. Fresh installs are already strict at migrations 166/167;
// this migration remains an idempotent audit of the exact 161-row surface.
func repairLevelFiveStrictConditions(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells;
		DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
	`); err != nil {
		return fmt.Errorf("disable certified condition repair guards: %w", err)
	}

	rows, err := loadLevelFiveStrictConditionRows(tx)
	if err != nil {
		return err
	}
	for index := range rows {
		rewritten, changed, rewriteErr := rewriteLevelFiveConditionReferences(rows[index].mechanics)
		if rewriteErr != nil {
			return fmt.Errorf("rewrite %s %s condition references: %w", rows[index].table, rows[index].cardNumber, rewriteErr)
		}
		rows[index].mechanics = rewritten.(map[string]any)
		if rows[index].cardNumber == "EFFECT-0170" || rows[index].cardNumber == "ACT-subclass-EFFECT-0170" {
			addNatureWrathDuration(rows[index].mechanics)
		}
		if changed > 0 || rows[index].cardNumber == "EFFECT-0170" || rows[index].cardNumber == "ACT-subclass-EFFECT-0170" {
			if err = storeLevelFiveStrictConditionRow(tx, rows[index]); err != nil {
				return err
			}
		}
	}

	// Reload the database postimage instead of trusting the in-memory rewrite.
	rows, err = loadLevelFiveStrictConditionRows(tx)
	if err != nil {
		return err
	}
	references := map[string]bool{}
	for _, row := range rows {
		if err = auditLevelFiveStrictConditionMechanics(row.mechanics, row.table+"["+row.cardNumber+"]", references); err != nil {
			return err
		}
	}
	conditionCards := make([]string, 0, len(references))
	for card := range references {
		conditionCards = append(conditionCards, card)
	}
	sort.Strings(conditionCards)
	for _, card := range conditionCards {
		var count int
		if err = tx.QueryRow(`SELECT count(*) FROM effects WHERE card_number=$1
			AND effect_type='condition' AND deleted_at IS NULL`, card).Scan(&count); err != nil {
			return fmt.Errorf("resolve condition effect %s: %w", card, err)
		}
		if count != 1 {
			return fmt.Errorf("condition effect reference %s resolves to %d active library rows, want 1", card, count)
		}
	}
	if len(conditionCards) == 0 {
		return fmt.Errorf("level-five strict-condition audit found no COND-* library references")
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
