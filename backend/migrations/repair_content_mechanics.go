package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

type contentMechanicSpec struct {
	CardNumber string
	Activation map[string]any
	Uses       map[string]any
}

func passivePugilistFeature(cardNumber string) contentMechanicSpec {
	return contentMechanicSpec{
		CardNumber: cardNumber,
		Activation: map[string]any{"mode": "passive"},
	}
}

// Кулачник — неофициальный класс. По приоритету источников проекта его
// текст — источник истины. Пока движок не умеет без искажений выразить сложные
// комбинированные фичи, они хранятся как narrative, а не как ложно «полная» механика.
// Точно выразимые активации получают кнопку/реакцию и лимит использований.
var pugilistMechanicSpecs = []contentMechanicSpec{
	passivePugilistFeature("PUG-F01"),
	passivePugilistFeature("PUG-F02"),
	passivePugilistFeature("PUG-F03"),
	{
		CardNumber: "PUG-F04",
		Activation: map[string]any{
			"mode":    "reaction",
			"cost":    []map[string]any{{"resource": "reaction"}},
			"trigger": map[string]any{"event": "damage_taken", "timing": "after"},
		},
		Uses: map[string]any{"count": 1, "per": "short_rest"},
	},
	passivePugilistFeature("PUG-F05"),
	passivePugilistFeature("PUG-F06"),
	passivePugilistFeature("PUG-F07"),
	{
		CardNumber: "PUG-F08",
		Activation: map[string]any{
			"mode": "active",
			"cost": []map[string]any{{"resource": "bonus_action"}},
		},
		Uses: map[string]any{"count": 1, "per": "long_rest"},
	},
	passivePugilistFeature("PUG-F09"),
	passivePugilistFeature("PUG-F10"),
	passivePugilistFeature("PUG-F11"),
	passivePugilistFeature("PUG-F12"),
	passivePugilistFeature("PUG-F13"),
	passivePugilistFeature("PUG-F14"),
	passivePugilistFeature("PUG-F15"),
	{
		CardNumber: "PUG-F16",
		Activation: map[string]any{
			"mode": "active",
			"cost": []map[string]any{{"resource": "bonus_action"}},
		},
		// На 20-м уровне текст даёт второе использование; до поддержки stepped uses
		// движком интерфейс показывает консервативный лимит 1, а точный текст остаётся в narrative.
		Uses: map[string]any{"count": 1, "per": "long_rest"},
	},
	passivePugilistFeature("PUG-F17"),
	passivePugilistFeature("PUG-F18"),
	passivePugilistFeature("PUG-F19"),
	passivePugilistFeature("PUG-F20"),
	passivePugilistFeature("PUG-SS01"),
	{
		CardNumber: "PUG-SS02",
		Activation: map[string]any{
			"mode": "reaction",
			"cost": []map[string]any{
				{"resource": "reaction"},
				{"resource": "moxie", "amount": 1},
			},
			"trigger": map[string]any{"event": "damage_taken", "timing": "after"},
		},
	},
	passivePugilistFeature("PUG-SS03"),
	passivePugilistFeature("PUG-SS04"),
	passivePugilistFeature("PUG-SS05"),
}

func repairContentMechanics(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Состояния не нажимаются и не тратят ресурс: их модификаторы всегда пассивны.
	if _, err := tx.Exec(`
		UPDATE effects
		SET mechanics = jsonb_set(COALESCE(mechanics, '{}'::jsonb), '{activation}', '{"mode":"passive"}'::jsonb, true)
		WHERE effect_type = 'condition'
		  AND deleted_at IS NULL
		  AND (mechanics IS NULL OR NOT (mechanics ? 'activation'))
	`); err != nil {
		return fmt.Errorf("repair condition activation: %w", err)
	}

	for _, spec := range pugilistMechanicSpecs {
		var description string
		err := tx.QueryRow(`
			SELECT description
			FROM effects
			WHERE card_number = $1 AND deleted_at IS NULL
		`, spec.CardNumber).Scan(&description)
		if err == sql.ErrNoRows {
			// Миграция остаётся применимой к чистой БД, куда неофициальный класс ещё не импортирован.
			continue
		}
		if err != nil {
			return fmt.Errorf("read %s description: %w", spec.CardNumber, err)
		}

		mechanics := map[string]any{
			"activation": spec.Activation,
			"effects": []map[string]any{{
				"resolution": "auto",
				"result": []map[string]any{{
					"kind":        "narrative",
					"description": description,
				}},
			}},
		}
		if spec.Uses != nil {
			mechanics["uses"] = spec.Uses
		}
		payload, err := json.Marshal(mechanics)
		if err != nil {
			return fmt.Errorf("marshal %s mechanics: %w", spec.CardNumber, err)
		}
		if _, err := tx.Exec(`
			UPDATE effects
			SET mechanics = $2::jsonb
			WHERE card_number = $1
			  AND deleted_at IS NULL
			  AND (mechanics IS NULL OR mechanics = '{}'::jsonb)
		`, spec.CardNumber, string(payload)); err != nil {
			return fmt.Errorf("repair %s mechanics: %w", spec.CardNumber, err)
		}
	}

	return tx.Commit()
}
