package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const (
	sleepSpellClassListMigrationVersion  = "119_repair_sleep_spell_class_list_contract"
	sleepSpellClassListRevocationVersion = "revoked-sleep-spell-class-list-v1"
	sleepSpellClassListRevocationReason  = "Сертификат отозван: Усыпление не объявляло стабильные идентификаторы списков классов, поэтому лист персонажа не мог скомпилировать заклинание."
	sleepSpellEntityID                   = "0f81f3e2-ff95-4629-9292-e81332a57282"
	sleepSpellCardNumber                 = "SPELL-0311"

	sleepSpellLegacyMechanics = `{
		"effects":[{"dc":"8+prof+spellcasting","who":"target","ability":"wis","on_fail":[{"op":"apply","kind":"condition","value":"unconscious","duration":{"type":"rounds","amount":1}}],"on_success":[],"resolution":"save"}],
		"targeting":{"area":{"kind":"sphere","size":5},"range":"60 футов","shape":"area","filter":"creature"},
		"activation":{"cost":[{"resource":"action"},{"level":1,"resource":"spell_slot"}],"mode":"active"}
	}`
	sleepSpellCanonicalMechanics = `{
		"effects":[{"dc":"8+prof+spellcasting","who":"target","ability":"wis","on_fail":[{"op":"apply","kind":"condition","value":"unconscious","duration":{"type":"rounds","amount":1}}],"on_success":[],"resolution":"save"}],
		"targeting":{"area":{"kind":"sphere","size":5},"range":"60 футов","shape":"area","filter":"creature"},
		"activation":{"cost":[{"resource":"action"},{"level":1,"resource":"spell_slot"}],"mode":"active"},
		"spell_class_list_ids":["CLASS-bard","CLASS-sorcerer","CLASS-wizard"]
	}`
)

func sleepSpellRevokedSupport() ([]byte, error) {
	return json.Marshal(map[string]any{
		"status":                "untested",
		"certification_version": sleepSpellClassListRevocationVersion,
		"mechanics_locked":      false,
		"note":                  sleepSpellClassListRevocationReason,
		"limitations":           []string{sleepSpellClassListRevocationReason},
	})
}

func repairSleepSpellClassListContract(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := createCertificationRevocationLedger(tx); err != nil {
		return fmt.Errorf("create certification revocation ledger: %w", err)
	}
	if _, err := tx.Exec(`DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells`); err != nil {
		return fmt.Errorf("temporarily disable spell certification guard: %w", err)
	}

	var matchingIdentities, exactIdentity int
	if err := tx.QueryRow(`
		SELECT count(*), count(*) FILTER (WHERE id = $1::uuid AND card_number = $2)
		FROM spells
		WHERE deleted_at IS NULL AND (id = $1::uuid OR card_number = $2)
	`, sleepSpellEntityID, sleepSpellCardNumber).Scan(&matchingIdentities, &exactIdentity); err != nil {
		return fmt.Errorf("inspect Sleep identity: %w", err)
	}
	if matchingIdentities != 1 || exactIdentity != 1 {
		return fmt.Errorf(
			"%s stable identity drifted: matching_rows=%d exact_rows=%d",
			sleepSpellCardNumber, matchingIdentities, exactIdentity,
		)
	}

	revokedSupport, err := sleepSpellRevokedSupport()
	if err != nil {
		return fmt.Errorf("encode Sleep revoked support: %w", err)
	}
	var mechanicsBefore, supportBefore []byte
	var isLegacy, isCanonical, hasSupport, hasCanonicalRevocation bool
	if err := tx.QueryRow(`
		SELECT mechanics, COALESCE(support, 'null'::jsonb),
		       mechanics = $3::jsonb, mechanics = $4::jsonb,
		       support IS NOT NULL, COALESCE(support, 'null'::jsonb) = $5::jsonb
		FROM spells
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		FOR UPDATE
	`, sleepSpellEntityID, sleepSpellCardNumber,
		sleepSpellLegacyMechanics, sleepSpellCanonicalMechanics, revokedSupport,
	).Scan(
		&mechanicsBefore, &supportBefore, &isLegacy, &isCanonical,
		&hasSupport, &hasCanonicalRevocation,
	); err != nil {
		return fmt.Errorf("read Sleep preimage: %w", err)
	}
	if !isLegacy && !isCanonical {
		return fmt.Errorf("%s mechanics drifted; refusing non-declarative repair", sleepSpellCardNumber)
	}

	if !(isCanonical && (!hasSupport || hasCanonicalRevocation)) {
		supportAfter := []byte("null")
		if hasSupport {
			if _, err := tx.Exec(`
				INSERT INTO content_certification_revocations (
					entity_type, entity_id, card_number, prior_support, prior_mechanics,
					reason, migration_version
				)
				SELECT 'spell', id, card_number, support, mechanics, $3, $4
				FROM spells
				WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
				  AND mechanics = $5::jsonb
				  AND COALESCE(support, 'null'::jsonb) = $6::jsonb
				  AND support IS NOT NULL
				ON CONFLICT (migration_version, entity_type, entity_id) DO NOTHING
			`, sleepSpellEntityID, sleepSpellCardNumber,
				sleepSpellClassListRevocationReason, sleepSpellClassListMigrationVersion,
				mechanicsBefore, supportBefore,
			); err != nil {
				return fmt.Errorf("record Sleep certification revocation: %w", err)
			}
			supportAfter = revokedSupport
		}

		result, err := tx.Exec(`
			UPDATE spells
			SET mechanics = $3::jsonb,
			    support = CASE WHEN $4::jsonb = 'null'::jsonb THEN NULL ELSE $4::jsonb END,
			    updated_at = NOW()
			WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
			  AND mechanics = $5::jsonb
			  AND COALESCE(support, 'null'::jsonb) = $6::jsonb
		`, sleepSpellEntityID, sleepSpellCardNumber,
			sleepSpellCanonicalMechanics, supportAfter, mechanicsBefore, supportBefore,
		)
		if err != nil {
			return fmt.Errorf("repair Sleep class-list contract: %w", err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("read Sleep row count: %w", err)
		}
		if affected != 1 {
			return fmt.Errorf("repair Sleep class-list contract affected %d rows", affected)
		}
	}

	var compatible int
	if err := tx.QueryRow(`
		SELECT count(*)
		FROM spells
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		  AND mechanics = $3::jsonb
		  AND mechanics->'spell_class_list_ids' =
		      '["CLASS-bard","CLASS-sorcerer","CLASS-wizard"]'::jsonb
	`, sleepSpellEntityID, sleepSpellCardNumber, sleepSpellCanonicalMechanics).Scan(&compatible); err != nil {
		return fmt.Errorf("verify Sleep postcondition: %w", err)
	}
	if compatible != 1 {
		return fmt.Errorf("Sleep sheet-projection postcondition failed: compatible_spells=%d", compatible)
	}

	if _, err := tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guard: %w", err)
	}
	return tx.Commit()
}
