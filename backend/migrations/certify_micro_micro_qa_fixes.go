package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const microMicroQaCertificationVersion = "micro-micro-qa-2026-07-30"

const microMicroQaCommonLimitation = "Проверены данные, зависимости и исполнение механики в пределах текущего micro-micro-MVP; полноценный encounter остаётся за границей этапа."

var microMicroQaCertifications = []microMicroCertification{
	{Table: "classes", CardNumber: "CLASS-cleric", ContentHash: "sha256:7844dbbf7894d443b3fca56ab86eb3888c303763c8d69ac03aab854464f460e6", DependencyHash: "sha256:fb8f324c8440b49bc991938e7b11264b7331602ebc399f9ccc336bfcb9782898"},
	{Table: "races", CardNumber: "RACE-0008", ContentHash: "sha256:dd20ef3a9054d95ac908cb0b8e1af9140a79ce8ede7904199af3b6ae83685287", DependencyHash: "sha256:86827e11c29fbc700ce6aba412c3747a700265966eb23b8cd2ae48d1539c1235", Limitations: []string{"Оружие дыхания пока расходует действие и использует только конус; Драконий полёт доступен с 5 уровня, но ещё не меняет runtime-скорость после нажатия."}},
	{Table: "feats", CardNumber: "FEAT-0001", ContentHash: "sha256:19f1216d6e103eff632a9889104f0ea31b3d03d9709a971fd94329d502e52752", DependencyHash: "sha256:c114c869d2a4d9fa2284b13849885b5b3c56b26167e3b74532443d68b1fbc96f", Limitations: []string{"Обмен инициативой с союзником остаётся подтверждаемым вручную."}},
	{Table: "feats", CardNumber: "FEAT-0056", ContentHash: "sha256:05b304a6ab4a547df6369ab0b496e44167a8184d0c3c4f0de58503586d047189", DependencyHash: "sha256:fddc32d83c28b994c9dd1dc16e0d4f8108443696e386edd49f36dcbd625fc601"},
	{Table: "spells", CardNumber: "SPELL-0230", ContentHash: "sha256:1cf1f4d8c348e1805082c558751d305ed7f2db80a3335a57ed8080f6cc3048a7", DependencyHash: "sha256:dd112fd4474c8cc83cc7228d8bbf059fcfdb43f424f171ccdb214ea6b86d7d7d"},
	{Table: "spells", CardNumber: "SPELL-0163", ContentHash: "sha256:0b28a72f5ebc4362d3fbf45ba878c2245e9c8a62d27acc212fce7fcaaadc32a9", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", Limitations: []string{"Текущий лист применяет Благословение к одной выбранной цели за действие; одновременный выбор трёх целей появится с encounter."}},
	{Table: "spells", CardNumber: "SPELL-0311", ContentHash: "sha256:ad68b4ccff5f14479fa095282c2b97142a7afc4ab1e4158fe2d739bd1890fa9a", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", Limitations: []string{"Автоматизированы первичный спасбросок и Бессознательность; повторный спасбросок, иммунитет не нуждающихся во сне существ и пробуждение уроном пока требуют ручного решения."}},
	{Table: "spells", CardNumber: "SPELL-0242", ContentHash: "sha256:0886e069bc07d296b0e76b88693459cec6e1d4ef02289c48fa59dec81ada3a95", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
	{Table: "spells", CardNumber: "SPELL-0171", ContentHash: "sha256:f16e1cc21be207005b194065b37e3f73c7ee941e078bc6e533e6d2ccca8975dd", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},

	{Table: "races", CardNumber: "sub-white", ContentHash: "sha256:9ceeaa032262a7f60e8545344f261acc8233c5c1fb50c52d2a426688ea2bd056", DependencyHash: "sha256:17265038f928e69e92c75bea4682bce72ae0659b6b920490ad38d0a86e065a04"},
	{Table: "races", CardNumber: "sub-bronze", ContentHash: "sha256:2f50a760becf5381cb4008bb648426c5d3dcdb84ce04db8d574416a742eab78e", DependencyHash: "sha256:5f12d8383a63f0572cd5c09aa44ea6426a97607095dbe28d9339b60a364f7c55"},
	{Table: "races", CardNumber: "sub-green", ContentHash: "sha256:fb88adbe469fc58b9b8d6af13a2b83bcfb7a45e68c07783eb618f91a9776b7ff", DependencyHash: "sha256:dbe645d3b0ace8eb869c960cd005a42b6e0c02e254044046c6afcfa7ab513e4c"},
	{Table: "races", CardNumber: "sub-gold", ContentHash: "sha256:eb4a004da4303802bf266cf0205a4fe1d7ba2b8a4681218ea7a9264eda0a9c90", DependencyHash: "sha256:7e4f6ed7b91e73cde1958683a82956f676c7aa2e856e126e59c3fb74a48b3072"},
	{Table: "races", CardNumber: "sub-red", ContentHash: "sha256:f6d5f0ab6476a5cf16f61930a58fbf4bbf13ee177dcebc026fecf92ab86a2292", DependencyHash: "sha256:7e4f6ed7b91e73cde1958683a82956f676c7aa2e856e126e59c3fb74a48b3072"},
	{Table: "races", CardNumber: "sub-brass", ContentHash: "sha256:eed7c94e96ce2039e7a4779f149b343f25cff8ce96b6edafcad3df1b8dc3a731", DependencyHash: "sha256:7e4f6ed7b91e73cde1958683a82956f676c7aa2e856e126e59c3fb74a48b3072"},
	{Table: "races", CardNumber: "sub-copper", ContentHash: "sha256:35c0ab844188f2bf6e2f4b75aece609911a42d2d1823f92d0305be3baf162933", DependencyHash: "sha256:b96963427891c9f7690efa40f77efcb81d68122b5c8183e26a5d6a35a010b209"},
	{Table: "races", CardNumber: "sub-silver", ContentHash: "sha256:eda618b240a0edbe4acce572ca4162cf19b85688d62ac67dc85a14d84640a113", DependencyHash: "sha256:17265038f928e69e92c75bea4682bce72ae0659b6b920490ad38d0a86e065a04"},
	{Table: "races", CardNumber: "sub-blue", ContentHash: "sha256:49b155a54549024cfc3803602e8d891ae663c4a9469cff7c8ada3b54c2cea88f", DependencyHash: "sha256:5f12d8383a63f0572cd5c09aa44ea6426a97607095dbe28d9339b60a364f7c55"},
	{Table: "races", CardNumber: "sub-black", ContentHash: "sha256:f1748f3813d0c17bd2c848903be20b5c836de493e3153e1085dc62b888fef497", DependencyHash: "sha256:b96963427891c9f7690efa40f77efcb81d68122b5c8183e26a5d6a35a010b209"},

	{Table: "races", CardNumber: "sub-high_elf", ContentHash: "sha256:fb3a693877724cad8e3acdb4c9bc4b21128c65cf2ed8d2c353ad0e0e5f3b0e65", DependencyHash: "sha256:9c676e137a3df1b356c0f20cf6ecbb2b25190fe03a99b3092c754ada6a8991f5"},
	{Table: "races", CardNumber: "sub-drow", ContentHash: "sha256:0dfae55a7499a7d13cdf4fc452ff5c7c224c6cfd726f4c0e5d19a30d4d75b892", DependencyHash: "sha256:b9653bdebc1709b98afa3468e66c011e66c5dde006394b9d454e52511cc735df"},
	{Table: "races", CardNumber: "sub-wood_elf", ContentHash: "sha256:ba0d3596dc81a3d712edab03f493f4b1b8ecc8420f9f801eea77c283178eff37", DependencyHash: "sha256:2b0a37b4c6a03dd1c0aa4edd90058bc7d6014a860f9a8883b4dec00137bfb88b"},
}

func certifyMicroMicroQaFixes(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, certification := range microMicroQaCertifications {
		if !microMicroCertificationTables[certification.Table] {
			return fmt.Errorf("unsupported certification table %q", certification.Table)
		}
		limitations := append([]string{microMicroQaCommonLimitation}, certification.Limitations...)
		support, err := json.Marshal(map[string]any{
			"status":                "verified_partial",
			"content_hash":          certification.ContentHash,
			"dependency_hash":       certification.DependencyHash,
			"certification_version": microMicroQaCertificationVersion,
			"certified_at":          "2026-07-30T00:00:00Z",
			"limitations":           limitations,
			"note":                  "Проверено после ручной приёмки micro-micro-MVP.",
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
			return fmt.Errorf("failed to certify %s:%s: %w", certification.Table, certification.CardNumber, err)
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

func uncertifyMicroMicroQaFixes(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, certification := range microMicroQaCertifications {
		if _, err := tx.Exec(
			fmt.Sprintf(
				"UPDATE %s SET support = NULL WHERE card_number = $1 AND support->>'certification_version' = $2",
				certification.Table,
			),
			certification.CardNumber,
			microMicroQaCertificationVersion,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}
