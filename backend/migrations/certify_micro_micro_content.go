package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const microMicroCertificationVersion = "micro-micro-v1"

const microMicroCommonLimitation = "Проверены сущность, зависимости, сборка первого уровня и базовое исполнение в пределах micro-micro-MVP; encounter и граничные сценарии покрыты не полностью."

type microMicroCertification struct {
	Table          string
	CardNumber     string
	ContentHash    string
	DependencyHash string
	Limitations    []string
}

var microMicroCertifications = []microMicroCertification{
	{Table: "classes", CardNumber: "CLASS-warrior", ContentHash: "sha256:a6afa44220f6e5c47d3b308fb43e2fe7f2b5c3b0213571eab213bc7d84f02601", DependencyHash: "sha256:f0a373bf91cdc218c4ef604c474d47ea20cec0a5ea3e4d20d628f08ab70e5eb8"},
	{Table: "classes", CardNumber: "CLASS-wizard", ContentHash: "sha256:ae59530ed6a1314b732b46dbfaeb0a024ac202aad2b45afb494f7e156ce74fd9", DependencyHash: "sha256:cdcb2d63b2d00276fbf33d7b83b6992edc4fbd5426ccdc71673109b6eeb97791"},
	{Table: "classes", CardNumber: "CLASS-rogue", ContentHash: "sha256:aa211be85dec62a2934270ae8a2022ce18a6359b31a5a410031eb232ed8f935e", DependencyHash: "sha256:0e785b7e7ccb338a52e67a8c808789e190b0b27c5b3027b6d16acf9ede69e7c6"},
	{Table: "classes", CardNumber: "CLASS-cleric", ContentHash: "sha256:7844dbbf7894d443b3fca56ab86eb3888c303763c8d69ac03aab854464f460e6", DependencyHash: "sha256:c03627543353d3cb3677bfb62f5fe329b1b08bad64a81a9c3bfee2d062bef862"},
	{Table: "races", CardNumber: "RACE-0002", ContentHash: "sha256:986bd6254758ea00cb2037a680ad834a86417d5140e564eb8068ddecaacf14a0", DependencyHash: "sha256:040cda22a250b0f898631bc7896491dd23578343708ff790c8dd7c5e77c9a906"},
	{Table: "races", CardNumber: "RACE-0004", ContentHash: "sha256:5d0222eec32dd71656978754a6803adfd88b19dc956302c7cbde383be3c835e1", DependencyHash: "sha256:2dfad3970e71b8d3c0ee25db7796c8ea2f9993125eda156d2f6e6ca4e5a637b3", Limitations: []string{"Особенность «Транс» пока представлена только описанием и не имеет отдельной механической сущности."}},
	{Table: "races", CardNumber: "RACE-0003", ContentHash: "sha256:1ce6e277acdd4b91a0239f54fd4b543317fd870438ee7f6c6fc6bf07e8b3eaa6", DependencyHash: "sha256:c95c744428af7e1c11194f91dca3dce983bcfc6fb3027be6026916aa410df5b2", Limitations: []string{"Активное Камнечувствие пока не добавляет виброчувствительность в runtime-лист автоматически."}},
	{Table: "races", CardNumber: "RACE-0008", ContentHash: "sha256:1e9d5f7e1606132ee251d8c65e320f99317b16a1cf39fa8b47a5f5b94435d886", DependencyHash: "sha256:bd699c95383feb9dd7684e134b9c38b250d3fe50fbddaaf2def3198228be8ebe", Limitations: []string{"Оружие дыхания пока расходует действие и использует только конус; Драконий полёт вне среза первого уровня."}},
	{Table: "backgrounds", CardNumber: "BG-0012", ContentHash: "sha256:05a53cec2f71a1fa1dfa916cfd0c8af5c4782e08499853b2bc53bdf8c30bb83b", DependencyHash: "sha256:b6e2573752e80010aff68d0db6536c94e8c1b9723cc4878827f189422e3b238d"},
	{Table: "backgrounds", CardNumber: "BG-0005", ContentHash: "sha256:b2099a923f53f7366e5dfc1d405d415db5825b5294bba51f45ad579f07d007b0", DependencyHash: "sha256:171ed4745ce37915dcf36db6964e6b59ba881957468115faab04f9e9ad315fd0"},
	{Table: "backgrounds", CardNumber: "BG-0008", ContentHash: "sha256:c5a1d556f955b905f388f62c475e9ff7cc12344ae639733f384691aa052151d7", DependencyHash: "sha256:f1f011a653e8e1756f671a9310778e25f2bc9b75634fb072010ef75ab5892ef0"},
	{Table: "backgrounds", CardNumber: "BG-0009", ContentHash: "sha256:1aedaad3ea1662e07c866f94acd1eea03a993f45cea0d95e726ee189714d0ceb", DependencyHash: "sha256:94fc61c3f75c816f91d0a28a36caeca90a0702843dd609b9ae1d27b7f9bb7ec7"},
	{Table: "feats", CardNumber: "FEAT-0001", ContentHash: "sha256:19f1216d6e103eff632a9889104f0ea31b3d03d9709a971fd94329d502e52752", DependencyHash: "sha256:4a0468e1c3012b41eebbb62405ff2835065b9870e9ac1f0e969ccfd155c5d2a8"},
	{Table: "feats", CardNumber: "FEAT-0009", ContentHash: "sha256:5e233dbf4226533654ffca4a5df1e36bb12e5a274ad6654d4b5bc79decf68315", DependencyHash: "sha256:c8da4f87e9e128d89c3eebf1af5a0fa8f53282a9595d9cd5421dfa65d77e5f12"},
	{Table: "feats", CardNumber: "FEAT-0008", ContentHash: "sha256:413a15a4c078177fce359bea2c945632a9b646d6f696da2a5bb2d2110f8f5e91", DependencyHash: "sha256:4737ae512b8e9037de6301fc21ac31b3079b52a258dd4c85f97089bce2071244"},
	{Table: "feats", CardNumber: "FEAT-0005", ContentHash: "sha256:5ad1b52756ca9da485020314582c050cc94ff9191721912192515a3be95c7953", DependencyHash: "sha256:c3cda7f96005516ec906474801e4699653b2e1f69fdec020a02861b38510bd39"},
	{Table: "spells", CardNumber: "fire_bolt", ContentHash: "sha256:550f9fa52fbcc9fcf530f0e93ef58fc811490f6db812d4b1e63ecb31dcb5067f", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
	{Table: "spells", CardNumber: "SPELL-0286", ContentHash: "sha256:95e1e4ceb22569134898b655baaf0862c380c2f90376ac94d83f15d7de333727", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
	{Table: "spells", CardNumber: "SPELL-0230", ContentHash: "sha256:828d6365da7c50b7652375994ee681961280b2606aab72980bf07f7a61212788", DependencyHash: "sha256:dd112fd4474c8cc83cc7228d8bbf059fcfdb43f424f171ccdb214ea6b86d7d7d"},
	{Table: "spells", CardNumber: "minor_illusion", ContentHash: "sha256:e4ecfd8eec36939cea3b4a1715601aa4ac43aeb634f0663c1b86e5e3a3c8c1ce", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
	{Table: "spells", CardNumber: "SPELL-0218", ContentHash: "sha256:9d191a0718176bca26de6a53791bbec79111a4a79e7cdba1330ed5a875c92fda", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
	{Table: "spells", CardNumber: "chill_touch", ContentHash: "sha256:cccbb5732860c408301815d4b1cb252d3ab399d1a00bd26c5ced4f455edb8276", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
	{Table: "spells", CardNumber: "light", ContentHash: "sha256:ecf178dc5cc4d6558063e8ed0b6b531026e691599c5105f4d43d5372e247077c", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
	{Table: "spells", CardNumber: "SPELL-0174", ContentHash: "sha256:6dc62632daedc3cb44388b0e643adac31d753274f27e7da468770e625dce37a1", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
	{Table: "spells", CardNumber: "SPELL-0242", ContentHash: "sha256:c5fd05c09c1bab25d123f5d76c94cbbcb7a72ae49114aeec5181864a824e2ef0", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
	{Table: "spells", CardNumber: "SPELL-0214", ContentHash: "sha256:7a16f15ab5efb9e1b6139ed98f3f5e90d9d8f69e79fb1e144002ed7212df1f4e", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
	{Table: "spells", CardNumber: "SPELL-0317", ContentHash: "sha256:87ba7417088b3eb7856e062878aef0caae3750969dff66ec0e41359815884285", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", Limitations: []string{"Реакция проверена как действие листа; автоматическая остановка encounter и иммунитет к Волшебной стреле ещё не покрыты."}},
	{Table: "spells", CardNumber: "SPELL-0190", ContentHash: "sha256:a31406f9dfe8dc0079a0e81b9d640355b212dc31803267eb5972725b2ee91c8a", DependencyHash: "sha256:3fe44208a117c04d5619bea5d38c84d3e82779fd920a6079d3a985389ea0bf32", Limitations: []string{"Проверено наложение метода КЗ на лист; выбор иной цели и encounter-синхронизация ещё не покрыты."}},
	{Table: "spells", CardNumber: "SPELL-0171", ContentHash: "sha256:4b62a314ebe7dfab9af38b480404a7157ea580f371633939afe05d435467daf2", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
	{Table: "spells", CardNumber: "false_life", ContentHash: "sha256:db600e9b85961082d288a856c05e135e1acfcd2f1a698b5ba3b3edfdcb4f6eef", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
	{Table: "spells", CardNumber: "detect_magic", ContentHash: "sha256:7adf8c459bff9f7a97a17965d2cedce169c8f9965e2ebb151adc00612657bd94", DependencyHash: "sha256:dd112fd4474c8cc83cc7228d8bbf059fcfdb43f424f171ccdb214ea6b86d7d7d"},
	{Table: "spells", CardNumber: "SPELL-0163", ContentHash: "sha256:c22dbb37940d7a29f8428a300e660ab76c3b3d759cfa68c53b8af9da111f7508", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
	{Table: "spells", CardNumber: "SPELL-0229", ContentHash: "sha256:af80b282cb31a808bcbc6f52d8e9b1d4f0531f1deae2bdb1afac6b7a4c9becc7", DependencyHash: "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"},
	{Table: "feats", CardNumber: "FEAT-0063", ContentHash: "sha256:84c51edc3fddfc381648637fe511a4c46ff5ab9bc48e822b867e01a0da986a05", DependencyHash: "sha256:9503947b85141636114c3e65682929c1d9fb72b0f299e2d35256fe89eea0fc1c"},
	{Table: "feats", CardNumber: "FEAT-0056", ContentHash: "sha256:05b304a6ab4a547df6369ab0b496e44167a8184d0c3c4f0de58503586d047189", DependencyHash: "sha256:871643da5843dcd8c6f52bf7a6a7a5eda57e361b7027e912fa78391c545ab072"},
	{Table: "feats", CardNumber: "FEAT-0061", ContentHash: "sha256:0658b95baa82fde52d9cca6f360065c7a69ded869d233c4f1018a756f86ac97a", DependencyHash: "sha256:96b4bf11c7b313c2918db134f00b49b1e607ea6970191b477959ad951753e7d6"},
	{Table: "feats", CardNumber: "FEAT-0055", ContentHash: "sha256:0ec5b8d309fbb9399221138af066b3b5ca63096b5b8b28826943de65051e497d", DependencyHash: "sha256:b234c304cd2191787e84dfe1c145fdd34062200266613309dfe0f7429e85f575"},
}

var microMicroCertificationTables = map[string]bool{
	"classes": true, "races": true, "backgrounds": true, "feats": true, "spells": true,
}

func certifyMicroMicroContent(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, certification := range microMicroCertifications {
		if !microMicroCertificationTables[certification.Table] {
			return fmt.Errorf("unsupported certification table %q", certification.Table)
		}
		limitations := append([]string{microMicroCommonLimitation}, certification.Limitations...)
		support, err := json.Marshal(map[string]any{
			"status":                "verified_partial",
			"content_hash":          certification.ContentHash,
			"dependency_hash":       certification.DependencyHash,
			"certification_version": microMicroCertificationVersion,
			"certified_at":          "2026-07-28T00:00:00Z",
			"limitations":           limitations,
			"note":                  "Проверено автоматическим acceptance-аудитом micro-micro-MVP.",
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

func uncertifyMicroMicroContent(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, certification := range microMicroCertifications {
		if !microMicroCertificationTables[certification.Table] {
			return fmt.Errorf("unsupported certification table %q", certification.Table)
		}
		if _, err := tx.Exec(
			fmt.Sprintf(
				"UPDATE %s SET support = NULL WHERE card_number = $1 AND support->>'certification_version' = $2",
				certification.Table,
			),
			certification.CardNumber,
			microMicroCertificationVersion,
		); err != nil {
			return fmt.Errorf("failed to uncertify %s:%s: %w", certification.Table, certification.CardNumber, err)
		}
	}
	return tx.Commit()
}
