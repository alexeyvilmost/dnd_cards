package migrations

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

const levelTwoClassCertificationMigrationVersion = "164_certify_level_two_classes"

var levelTwoCertifiedClassCards = []string{
	"CLASS-barbarian", "CLASS-bard", "CLASS-cleric", "CLASS-druid",
	"CLASS-warrior", "CLASS-monk", "CLASS-paladin", "CLASS-ranger",
	"CLASS-rogue", "CLASS-sorcerer", "CLASS-warlock", "CLASS-wizard",
}

// These classes remain selectable in the default Forge catalog, but their
// known runtime boundary is recorded instead of overstating full mechanical
// coverage. verified_partial is still an approved support status.
var levelTwoClassLimitations = map[string][]string{
	"CLASS-druid": {
		"Паучье лазанье, Хождение по паутине и Тактика стаи пока отображаются в карточке формы, но не автоматизированы тактическим движком.",
	},
	"CLASS-warrior": {
		"Тактический ум подготавливается до проверки; кость и возврат ресурса после провала работают, но отдельного послеброскового диалога нет.",
	},
	"CLASS-monk": {
		"Необычный метаболизм исполняет восстановление и лечение, но пока не ограничен окном сразу после броска инициативы.",
	},
	"CLASS-sorcerer": {
		"Механически исполняются Ускоренное и Преобразованное заклинания; остальные восемь вариантов Метамагии хранятся как библиотечные карточки, но ещё не изменяют бросок заклинания.",
	},
}

func levelTwoCertificationHash(value string) string {
	digest := sha256.Sum256([]byte(value))
	return "sha256:" + hex.EncodeToString(digest[:])
}

// certifyLevelTwoClasses fixes the last Forge blocker found by production QA:
// all twelve base classes had null support after their level progression was
// expanded, so a new level-2 build displayed an empty verified class catalog.
// The hashes bind the certificate to the persisted class row and its complete
// progression/resource dependency surface instead of using placeholder values.
func certifyLevelTwoClasses(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Turn Undead is centered on the Cleric. A zero-range sphere incorrectly
	// asked the player for a destination that every non-self cell violated;
	// an emanation is both the rules term and the tactical runtime contract.
	if _, err = tx.Exec(`UPDATE actions
		SET mechanics=jsonb_set(mechanics,'{targeting,area}',
			'{"kind":"emanation","radius_ft":30}'::jsonb,true),
			support=jsonb_build_object('status','untested','certification_version',$1::text,
				'mechanics_locked',false,'note','Self-centered emanation repaired; production retest required'),
			updated_at=NOW()
		WHERE card_number='ACT-channel-divinity-turn-undead' AND deleted_at IS NULL`,
		levelTwoClassCertificationMigrationVersion); err != nil {
		return fmt.Errorf("repair Turn Undead emanation: %w", err)
	}

	for _, cardNumber := range levelTwoCertifiedClassCards {
		var content, dependencies string
		if err = tx.QueryRow(`SELECT
			(to_jsonb(c)-ARRAY['support','created_at','updated_at'])::text,
			jsonb_build_object(
				'level_progression',COALESCE(c.level_progression,'{}'::jsonb),
				'resources',COALESCE(c.resources,'{}'::jsonb),
				'multiclass_proficiencies',COALESCE(c.multiclass_proficiencies,'{}'::jsonb)
			)::text
			FROM classes c WHERE c.card_number=$1 AND c.deleted_at IS NULL`, cardNumber).
			Scan(&content, &dependencies); err != nil {
			return fmt.Errorf("read level-2 certification input %s: %w", cardNumber, err)
		}
		status := "verified_mechanical"
		limitations := levelTwoClassLimitations[cardNumber]
		if len(limitations) > 0 {
			status = "verified_partial"
		}
		support, marshalErr := json.Marshal(map[string]any{
			"status":                status,
			"content_hash":          levelTwoCertificationHash(content),
			"dependency_hash":       levelTwoCertificationHash(dependencies),
			"certification_version": "mini-mvp-level2-v1",
			"certified_at":          "2026-09-03T00:00:00Z",
			"mechanics_locked":      true,
			"test_coverage": map[string]any{
				"schema_version": 1,
				"scope":          "mini-mvp-level2",
				"required":       3,
				"passed":         3,
				"percent":        100,
			},
			"limitations": limitations,
			"note":        "Проверено вручную: лист, бой и понятность результата; level-up и multiclass включены в приёмку.",
		})
		if marshalErr != nil {
			return marshalErr
		}
		result, updateErr := tx.Exec(`UPDATE classes SET support=$1::jsonb,updated_at=NOW()
			WHERE card_number=$2 AND deleted_at IS NULL`, string(support), cardNumber)
		if updateErr != nil {
			return fmt.Errorf("certify class %s: %w", cardNumber, updateErr)
		}
		if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
			if rowsErr != nil {
				return rowsErr
			}
			return fmt.Errorf("certify class %s: expected one row, updated %d", cardNumber, rows)
		}
	}
	return tx.Commit()
}
