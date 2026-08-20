package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const (
	featherFallCardNumber      = "SPELL-0253"
	featherFallLegacyMechanics = `{
		"activation":{"cost":[{"resource":"reaction"},{"amount":1,"level":1,"resource":"spell_slot"}],"mode":"active"},
		"effects":[{"resolution":"auto","result":[{"description":"Падение пёрышком: см. описание заклинания.","kind":"narrative"}]}],
		"targeting":{"filter":"any","range":"60 футов","shape":"single"}
	}`
	featherFallStaleCertificationVersion = "micro-mvp-l1-rules-core-v4"
	featherFallStaleContentHash          = "sha256:57849ad30bd2bf525296f7563bdc6e13f7be4a77706c18fe34f901a5127a7df5"
	featherFallStaleEvidenceID           = "9eb65494-a050-46dd-80d9-612cdfc73a96"
	featherFallRevocationVersion         = "revoked-invalid-mechanical-scope-v1"
	featherFallRevocationReason          = "Сертификат отозван: прежняя механика была narrative-only и не моделировала скорость падения, урон при приземлении или завершение эффекта."
)

type staleFeatherFallCertification struct {
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

func createCertificationRevocationLedger(tx *sql.Tx) error {
	_, err := tx.Exec(`
		CREATE TABLE IF NOT EXISTS content_certification_revocations (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			entity_type TEXT NOT NULL,
			entity_id UUID NOT NULL,
			card_number TEXT NOT NULL,
			prior_support JSONB NOT NULL,
			prior_mechanics JSONB NOT NULL,
			reason TEXT NOT NULL,
			migration_version TEXT NOT NULL,
			revoked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE (migration_version, entity_type, entity_id)
		)
	`)
	return err
}

func revokeInvalidFeatherFallCertification(db *sql.DB) error {
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
	`, featherFallCardNumber, featherFallLegacyMechanics).Scan(
		&entityID, &supportRaw, &legacyMechanicsMatches,
	)
	if err == sql.ErrNoRows {
		return tx.Commit()
	}
	if err != nil {
		return fmt.Errorf("read %s certification: %w", featherFallCardNumber, err)
	}

	var support staleFeatherFallCertification
	if err := json.Unmarshal(supportRaw, &support); err != nil {
		return fmt.Errorf("decode %s certification: %w", featherFallCardNumber, err)
	}
	if support.CertificationVersion == featherFallRevocationVersion && !support.MechanicsLocked {
		return tx.Commit()
	}
	validPreimage := legacyMechanicsMatches && support.Status == "verified_mechanical" &&
		support.CertificationVersion == featherFallStaleCertificationVersion &&
		support.ContentHash == featherFallStaleContentHash &&
		support.EvidenceID == featherFallStaleEvidenceID &&
		support.MechanicsLocked &&
		support.TestCoverage.Scope == "micro-mvp-l1" &&
		support.TestCoverage.Required == 282 &&
		support.TestCoverage.Passed == 282 &&
		support.TestCoverage.Percent == 100
	if !validPreimage {
		return fmt.Errorf("%s certification or mechanics drifted; refusing revocation", featherFallCardNumber)
	}

	// Migration 096 deliberately permits unlock only through a later explicit
	// policy migration. Disable only the spell trigger inside this transaction,
	// record the full preimage, revoke the false certificate, then reinstall the
	// complete guard DDL before commit.
	if _, err := tx.Exec(`DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells`); err != nil {
		return fmt.Errorf("temporarily disable spell certification guard: %w", err)
	}
	if _, err := tx.Exec(`
		INSERT INTO content_certification_revocations (
			entity_type, entity_id, card_number, prior_support, prior_mechanics, reason, migration_version
		)
		SELECT 'spell', id, card_number, support, mechanics, $2, '102_revoke_invalid_feather_fall_certification'
		FROM spells
		WHERE id = $1::uuid
		ON CONFLICT (migration_version, entity_type, entity_id) DO NOTHING
	`, entityID, featherFallRevocationReason); err != nil {
		return fmt.Errorf("record %s certification revocation: %w", featherFallCardNumber, err)
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
	`, entityID, featherFallRevocationVersion, featherFallRevocationReason)
	if err != nil {
		return fmt.Errorf("revoke %s certification: %w", featherFallCardNumber, err)
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		return fmt.Errorf("revoke %s certification affected %d rows: %w", featherFallCardNumber, affected, err)
	}
	if _, err := tx.Exec(certifiedContentMechanicsLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guard: %w", err)
	}
	return tx.Commit()
}
