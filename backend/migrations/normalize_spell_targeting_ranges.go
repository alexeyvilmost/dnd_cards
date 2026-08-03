package migrations

import (
	"database/sql"
	"fmt"
)

const spellTargetingCertificationVersion = "micro-micro-schema-2026-08-03"

type spellTargetingRepair struct {
	CardNumber string
	Range      string
}

// В правилах 2024 дистанции этих заклинаний — Касание, 30 футов и 60 футов.
// Механическая schema хранит дистанцию строкой, чтобы поддерживать как числа с
// единицами, так и специальные значения вроде Касания и На себя.
var spellTargetingRepairs = []spellTargetingRepair{
	{CardNumber: "SPELL-0230", Range: "Касание"},
	{CardNumber: "SPELL-0163", Range: "30 футов"},
	{CardNumber: "SPELL-0311", Range: "60 футов"},
}

// Изменение заклинаний меняет не только их content hash, но и транзитивный
// dependency hash сертифицированных сущностей, которые на них ссылаются.
var spellTargetingCertificationRepairs = []microMicroCertification{
	{Table: "classes", CardNumber: "CLASS-warrior", ContentHash: "sha256:a6afa44220f6e5c47d3b308fb43e2fe7f2b5c3b0213571eab213bc7d84f02601", DependencyHash: "sha256:2ae37a7c4b0c74fb0ac5d69c4f053647dd85b5965d0f2015e2f17ac2ea4e7e02"},
	{Table: "classes", CardNumber: "CLASS-wizard", ContentHash: "sha256:ae59530ed6a1314b732b46dbfaeb0a024ac202aad2b45afb494f7e156ce74fd9", DependencyHash: "sha256:080c8988a81269e817c7694c608708d9342c2803faa392d5da63736cad9bb2fc"},
	{Table: "classes", CardNumber: "CLASS-rogue", ContentHash: "sha256:aa211be85dec62a2934270ae8a2022ce18a6359b31a5a410031eb232ed8f935e", DependencyHash: "sha256:82a1f69971a299ebf6cea6d58b6150daa980016af3a315f065e0a5550dd32489"},
	{Table: "classes", CardNumber: "CLASS-cleric", ContentHash: "sha256:7844dbbf7894d443b3fca56ab86eb3888c303763c8d69ac03aab854464f460e6", DependencyHash: "sha256:eb043f6949db932e7aaa3ea9169ff7954e937104b72e53655abbeabb72167760"},
	{Table: "backgrounds", CardNumber: "BG-0012", ContentHash: "sha256:05a53cec2f71a1fa1dfa916cfd0c8af5c4782e08499853b2bc53bdf8c30bb83b", DependencyHash: "sha256:d3f2966d2f684e459421c265dcdacc5f4ed38c17f7f492f64cac2f441ace72cd"},
	{Table: "backgrounds", CardNumber: "BG-0008", ContentHash: "sha256:c5a1d556f955b905f388f62c475e9ff7cc12344ae639733f384691aa052151d7", DependencyHash: "sha256:63476695d5cae77fd3cc1a2bb1f81ea319bdec6cdc5aee7791c578d3a574736b"},
	{Table: "spells", CardNumber: "SPELL-0230", ContentHash: "sha256:b5478ba12d504f994ebb2b185db089c918a01d765c3833d41d52dd361b447f42", DependencyHash: "sha256:dd112fd4474c8cc83cc7228d8bbf059fcfdb43f424f171ccdb214ea6b86d7d7d"},
	{Table: "spells", CardNumber: "SPELL-0163", ContentHash: "sha256:883e65a6c9fedc62f82eb6ecf565fc0589e56df63943198767025245ea1f5ab1", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
	{Table: "spells", CardNumber: "SPELL-0311", ContentHash: "sha256:d7e30b1d36c71e6b481bd1425b38737f1017a655f26566bd85c9f5cb37f46a70", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
}

func normalizeSpellTargetingRanges(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, repair := range spellTargetingRepairs {
		result, err := tx.Exec(`
			UPDATE spells
			SET mechanics = jsonb_set(mechanics, '{targeting,range}', to_jsonb($2::text), true)
			WHERE card_number = $1 AND deleted_at IS NULL
		`, repair.CardNumber, repair.Range)
		if err != nil {
			return fmt.Errorf("normalize %s targeting range: %w", repair.CardNumber, err)
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if rows != 1 {
			return fmt.Errorf("expected one spell %s, updated %d", repair.CardNumber, rows)
		}
	}

	for _, certification := range spellTargetingCertificationRepairs {
		if !microMicroCertificationTables[certification.Table] {
			return fmt.Errorf("unsupported certification table %q", certification.Table)
		}
		result, err := tx.Exec(fmt.Sprintf(`
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
			return fmt.Errorf("refresh %s:%s certification: %w", certification.Table, certification.CardNumber, err)
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
