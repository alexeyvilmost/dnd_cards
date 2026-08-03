package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

// Хэши рассчитаны из production-каталога после 088. Большинство транзитивных
// хэшей не изменились: механики трёх заклинаний уже входили в старые снимки как
// числа. Исключение — Волшебник, чья текущая зависимость действительно изменилась.
var repairedSpellTargetingCertifications = []microMicroCertification{
	{Table: "classes", CardNumber: "CLASS-warrior", ContentHash: "sha256:a6afa44220f6e5c47d3b308fb43e2fe7f2b5c3b0213571eab213bc7d84f02601", DependencyHash: "sha256:f0a373bf91cdc218c4ef604c474d47ea20cec0a5ea3e4d20d628f08ab70e5eb8"},
	{Table: "classes", CardNumber: "CLASS-wizard", ContentHash: "sha256:ae59530ed6a1314b732b46dbfaeb0a024ac202aad2b45afb494f7e156ce74fd9", DependencyHash: "sha256:c9a36dc5e72f6acd43dd33c86cd85814fc05b30631e151068ef1b95f596f6d11"},
	{Table: "classes", CardNumber: "CLASS-rogue", ContentHash: "sha256:aa211be85dec62a2934270ae8a2022ce18a6359b31a5a410031eb232ed8f935e", DependencyHash: "sha256:0e785b7e7ccb338a52e67a8c808789e190b0b27c5b3027b6d16acf9ede69e7c6"},
	{Table: "classes", CardNumber: "CLASS-cleric", ContentHash: "sha256:7844dbbf7894d443b3fca56ab86eb3888c303763c8d69ac03aab854464f460e6", DependencyHash: "sha256:fb8f324c8440b49bc991938e7b11264b7331602ebc399f9ccc336bfcb9782898"},
	{Table: "backgrounds", CardNumber: "BG-0012", ContentHash: "sha256:05a53cec2f71a1fa1dfa916cfd0c8af5c4782e08499853b2bc53bdf8c30bb83b", DependencyHash: "sha256:419bda9919f8f45280b04690b5069da5951c809edb7ab76c359c374d76f57a39"},
	{Table: "backgrounds", CardNumber: "BG-0008", ContentHash: "sha256:c5a1d556f955b905f388f62c475e9ff7cc12344ae639733f384691aa052151d7", DependencyHash: "sha256:b647f0f21f41e7c1c888115d7edab2832f55a7b7fffd6c875fe42db59d94d512"},
	{Table: "spells", CardNumber: "SPELL-0230", ContentHash: "sha256:b5478ba12d504f994ebb2b185db089c918a01d765c3833d41d52dd361b447f42", DependencyHash: "sha256:dd112fd4474c8cc83cc7228d8bbf059fcfdb43f424f171ccdb214ea6b86d7d7d"},
	{Table: "spells", CardNumber: "SPELL-0163", ContentHash: "sha256:883e65a6c9fedc62f82eb6ecf565fc0589e56df63943198767025245ea1f5ab1", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
	{Table: "spells", CardNumber: "SPELL-0311", ContentHash: "sha256:d7e30b1d36c71e6b481bd1425b38737f1017a655f26566bd85c9f5cb37f46a70", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
}

var repairedSpellTargetingLimitations = map[string][]string{
	"SPELL-0230": {microMicroQaCommonLimitation},
	"SPELL-0163": {
		microMicroQaCommonLimitation,
		"Текущий лист применяет Благословение к одной выбранной цели за действие; одновременный выбор трёх целей появится с encounter.",
	},
	"SPELL-0311": {
		microMicroQaCommonLimitation,
		"Автоматизированы первичный спасбросок и Бессознательность; повторный спасбросок, иммунитет не нуждающихся во сне существ и пробуждение уроном пока требуют ручного решения.",
	},
}

func repairSpellTargetingCertifications(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, certification := range repairedSpellTargetingCertifications {
		var result sql.Result
		if limitations, isSpell := repairedSpellTargetingLimitations[certification.CardNumber]; isSpell {
			support, err := json.Marshal(map[string]any{
				"status":                "verified_partial",
				"content_hash":          certification.ContentHash,
				"dependency_hash":       certification.DependencyHash,
				"certification_version": spellTargetingCertificationVersion,
				"certified_at":          "2026-08-03T00:00:00Z",
				"limitations":           limitations,
				"note":                  "Повторно проверено после нормализации дистанции по правилам 2024.",
			})
			if err != nil {
				return err
			}
			result, err = tx.Exec(`
				UPDATE spells SET support = $2::jsonb
				WHERE card_number = $1 AND deleted_at IS NULL
			`, certification.CardNumber, string(support))
			if err != nil {
				return fmt.Errorf("restore %s certification: %w", certification.CardNumber, err)
			}
		} else {
			result, err = tx.Exec(fmt.Sprintf(`
				UPDATE %s
				SET support = COALESCE(support, '{}'::jsonb) || jsonb_build_object(
					'content_hash', $2::text,
					'dependency_hash', $3::text,
					'certification_version', $4::text,
					'certified_at', '2026-08-03T00:00:00Z'
				)
				WHERE card_number = $1 AND deleted_at IS NULL
			`, certification.Table), certification.CardNumber, certification.ContentHash, certification.DependencyHash, spellTargetingCertificationVersion)
			if err != nil {
				return fmt.Errorf("repair %s:%s certification: %w", certification.Table, certification.CardNumber, err)
			}
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
