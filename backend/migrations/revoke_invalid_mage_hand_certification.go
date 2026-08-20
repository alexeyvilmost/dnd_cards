package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const (
	mageHandCardNumber      = "SPELL-0173"
	mageHandLegacyMechanics = `{
		"activation":{"cost":[{"resource":"action"}],"mode":"active"},
		"effects":[{"resolution":"auto","result":[{"description":"Волшебная рука: см. описание заклинания.","kind":"narrative"}]}],
		"targeting":{"filter":"any","range":"30 футов","shape":"single"}
	}`
	mageHandStaleCertificationVersion = "micro-mvp-l1-rules-core-v4"
	mageHandStaleContentHash          = "sha256:87e73b651e3e881551a26fdfe91cfc6cc1ad116fddea2ec31c899a63cf7b81db"
	mageHandStaleEvidenceID           = "9eb65494-a050-46dd-80d9-612cdfc73a96"
	mageHandRevocationVersion         = "revoked-invalid-mage-hand-v1"
	mageHandRevocationReason          = "Сертификат отозван: прежняя механика была narrative-only и не моделировала состояние руки, допустимые операции, дальность управления или предел переносимого веса."
)

type staleMageHandCertification struct {
	Status               string `json:"status"`
	CertificationVersion string `json:"certification_version"`
	ContentHash          string `json:"content_hash"`
	EvidenceID           string `json:"evidence_id"`
	MechanicsLocked      bool   `json:"mechanics_locked"`
	TestCoverage         struct {
		Scope    string `json:"scope"`
		Required int    `json:"required"`
		Passed   int    `json:"passed"`
		Percent  int    `json:"percent"`
	} `json:"test_coverage"`
}

func revokeInvalidMageHandCertification(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := createCertificationRevocationLedger(tx); err != nil {
		return fmt.Errorf("create certification revocation ledger: %w", err)
	}

	var entityID string
	var supportRaw []byte
	var legacyMechanicsMatches bool
	err = tx.QueryRow(`
		SELECT id::text, support, mechanics = $2::jsonb
		FROM spells
		WHERE card_number = $1 AND deleted_at IS NULL
	`, mageHandCardNumber, mageHandLegacyMechanics).Scan(
		&entityID, &supportRaw, &legacyMechanicsMatches,
	)
	if err == sql.ErrNoRows {
		return tx.Commit()
	}
	if err != nil {
		return fmt.Errorf("read %s certification: %w", mageHandCardNumber, err)
	}

	var support staleMageHandCertification
	if err := json.Unmarshal(supportRaw, &support); err != nil {
		return fmt.Errorf("decode %s certification: %w", mageHandCardNumber, err)
	}
	if support.CertificationVersion == mageHandRevocationVersion && !support.MechanicsLocked {
		return tx.Commit()
	}
	validPreimage := legacyMechanicsMatches && support.Status == "verified_mechanical" &&
		support.CertificationVersion == mageHandStaleCertificationVersion &&
		support.ContentHash == mageHandStaleContentHash &&
		support.EvidenceID == mageHandStaleEvidenceID &&
		support.MechanicsLocked &&
		support.TestCoverage.Scope == "micro-mvp-l1" &&
		support.TestCoverage.Required == 282 &&
		support.TestCoverage.Passed == 282 &&
		support.TestCoverage.Percent == 100
	if !validPreimage {
		return fmt.Errorf("%s certification or mechanics drifted; refusing revocation", mageHandCardNumber)
	}

	if _, err := tx.Exec(`DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells`); err != nil {
		return fmt.Errorf("temporarily disable spell certification guard: %w", err)
	}
	if _, err := tx.Exec(`
		INSERT INTO content_certification_revocations (
			entity_type, entity_id, card_number, prior_support, prior_mechanics, reason, migration_version
		)
		SELECT 'spell', id, card_number, support, mechanics, $2, '103_revoke_invalid_mage_hand_certification'
		FROM spells
		WHERE id = $1::uuid
		ON CONFLICT (migration_version, entity_type, entity_id) DO NOTHING
	`, entityID, mageHandRevocationReason); err != nil {
		return fmt.Errorf("record %s certification revocation: %w", mageHandCardNumber, err)
	}
	result, err := tx.Exec(`
		UPDATE spells
		SET support = jsonb_build_object(
			'status', 'untested',
			'certification_version', $2::text,
			'mechanics_locked', false,
			'note', $3::text,
			'limitations', jsonb_build_array($3::text)
		)
		WHERE id = $1::uuid
	`, entityID, mageHandRevocationVersion, mageHandRevocationReason)
	if err != nil {
		return fmt.Errorf("revoke %s certification: %w", mageHandCardNumber, err)
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		return fmt.Errorf("revoke %s certification affected %d rows: %w", mageHandCardNumber, affected, err)
	}
	if _, err := tx.Exec(certifiedContentMechanicsLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guard: %w", err)
	}
	return tx.Commit()
}
