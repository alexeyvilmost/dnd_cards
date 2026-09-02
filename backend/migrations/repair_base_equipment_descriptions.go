package migrations

import (
	"database/sql"
	"fmt"
	"strings"
)

const baseEquipmentDescriptionMigrationVersion = "147_repair_base_equipment_descriptions"

func armorDescription2024(row baseArmor2024) string {
	category := map[string]string{
		"light":  "лёгкий доспех",
		"medium": "средний доспех",
		"heavy":  "тяжёлый доспех",
		"shield": "щит",
	}[row.Category]
	parts := []string{fmt.Sprintf("Категория: %s. КЗ: %s.", category, row.Formula)}
	if row.StrengthRequirement > 0 {
		parts = append(parts, fmt.Sprintf("При Силе ниже %d скорость снижается на 10 футов.", row.StrengthRequirement))
	}
	if row.StealthDisadvantage {
		parts = append(parts, "Помеха на проверки Скрытности.")
	}
	parts = append(parts, "Без владения: помеха на проверки d20, связанные с Силой или Ловкостью, и нельзя сотворять заклинания.")
	return strings.Join(parts, " ")
}

func repairBaseEquipmentDescriptions(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, row := range baseArmors2024 {
		result, err := tx.Exec(`UPDATE cards SET description=$2, updated_at=NOW()
			WHERE card_number=$1 AND deleted_at IS NULL`, row.CardNumber, armorDescription2024(row))
		if err != nil {
			return fmt.Errorf("repair armor description %s: %w", row.CardNumber, err)
		}
		if n, _ := result.RowsAffected(); n != 1 {
			return fmt.Errorf("repair armor description %s affected %d rows", row.CardNumber, n)
		}
	}
	return tx.Commit()
}
