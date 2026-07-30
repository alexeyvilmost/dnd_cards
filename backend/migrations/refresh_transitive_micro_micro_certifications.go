package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const transitiveMicroMicroCertificationVersion = "micro-micro-qa-2026-07-30"

var transitiveMicroMicroCertifications = []microMicroCertification{
	{Table: "classes", CardNumber: "CLASS-wizard", ContentHash: "sha256:ae59530ed6a1314b732b46dbfaeb0a024ac202aad2b45afb494f7e156ce74fd9", DependencyHash: "sha256:9cd56492e0140b2bb10f847803d562e13553a9e46032b193b525cb9c12fe93ca"},
	{Table: "races", CardNumber: "RACE-0002", ContentHash: "sha256:54c4684605c982d56e3bea86a165bcfbdcf7d07eaf987a581652f04aaab8a816", DependencyHash: "sha256:15edfee625f84b29a1b59849850c8f29f45525b4161a45b3c47e92215d6526bc"},
	{Table: "backgrounds", CardNumber: "BG-0012", ContentHash: "sha256:05a53cec2f71a1fa1dfa916cfd0c8af5c4782e08499853b2bc53bdf8c30bb83b", DependencyHash: "sha256:419bda9919f8f45280b04690b5069da5951c809edb7ab76c359c374d76f57a39"},
	{Table: "backgrounds", CardNumber: "BG-0008", ContentHash: "sha256:c5a1d556f955b905f388f62c475e9ff7cc12344ae639733f384691aa052151d7", DependencyHash: "sha256:b647f0f21f41e7c1c888115d7edab2832f55a7b7fffd6c875fe42db59d94d512"},
}

func refreshTransitiveMicroMicroCertifications(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, certification := range transitiveMicroMicroCertifications {
		support, err := json.Marshal(map[string]any{
			"status":                "verified_partial",
			"content_hash":          certification.ContentHash,
			"dependency_hash":       certification.DependencyHash,
			"certification_version": transitiveMicroMicroCertificationVersion,
			"certified_at":          "2026-07-30T00:00:00Z",
			"limitations":           []string{microMicroQaCommonLimitation},
			"note":                  "Транзитивная сертификация обновлена после исправления зависимостей.",
		})
		if err != nil {
			return err
		}
		result, err := tx.Exec(
			fmt.Sprintf("UPDATE %s SET support = $1::jsonb WHERE card_number = $2", certification.Table),
			string(support),
			certification.CardNumber,
		)
		if err != nil {
			return err
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if rows != 1 {
			return fmt.Errorf("expected one %s:%s row, updated %d", certification.Table, certification.CardNumber, rows)
		}
	}
	return tx.Commit()
}

func unrefreshTransitiveMicroMicroCertifications(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, certification := range transitiveMicroMicroCertifications {
		if _, err := tx.Exec(
			fmt.Sprintf(
				"UPDATE %s SET support = NULL WHERE card_number = $1 AND support->>'certification_version' = $2",
				certification.Table,
			),
			certification.CardNumber,
			transitiveMicroMicroCertificationVersion,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}
