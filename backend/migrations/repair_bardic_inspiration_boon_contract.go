package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const (
	bardicInspirationMigrationVersion  = "120_repair_bardic_inspiration_boon_contract"
	bardicInspirationRevocationVersion = "revoked-bardic-inspiration-boon-v1"
	bardicInspirationRevocationReason  = "Сертификат отозван: Вдохновение барда было описано только текстом и не выдавало выбранному союзнику кость вдохновения."
	bardicInspirationEntityID          = "507a13bf-ca6a-4d14-89e4-21016293e0a7"
	bardicInspirationCardNumber        = "ACT-bardic-inspiration"

	bardicInspirationLegacyMechanics = `{
		"activation":{"cost":[{"resource":"bonus_action"},{"amount":1,"resource":"bardic_inspiration"}],"mode":"active"},
		"effects":[{"resolution":"auto","result":[{"description":"Союзник в 60 фт получает кость вдохновения (d6) для одного d20 броска в течение 1 часа.","kind":"narrative"}]}],
		"targeting":{"actor_targets":true,"allowed_relations":["ally"],"domain":"actor","max_targets":1,"min_targets":1,"range_ft":60,"requires_line_of_sight":true,"shape":"single"}
	}`
	bardicInspirationCanonicalMechanics = `{
		"activation":{"cost":[{"resource":"bonus_action"},{"amount":1,"resource":"bardic_inspiration"}],"mode":"active"},
		"effects":[{"resolution":"auto","who":"target","result":[{"kind":"boon","id":"bardic_inspiration","die":"1d6","applies_to":["ability_check","attack_roll","saving_throw"],"expires":"1 час"}]}],
		"targeting":{"actor_targets":true,"allowed_relations":["ally"],"domain":"actor","max_targets":1,"min_targets":1,"range_ft":60,"requires_line_of_sight":true,"shape":"single"}
	}`
)

func bardicInspirationRevokedSupport() ([]byte, error) {
	return json.Marshal(map[string]any{
		"status":                "untested",
		"certification_version": bardicInspirationRevocationVersion,
		"mechanics_locked":      false,
		"note":                  bardicInspirationRevocationReason,
		"limitations":           []string{bardicInspirationRevocationReason},
	})
}

func repairBardicInspirationBoonContract(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := createCertificationRevocationLedger(tx); err != nil {
		return fmt.Errorf("create certification revocation ledger: %w", err)
	}
	if _, err := tx.Exec(`DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions`); err != nil {
		return fmt.Errorf("temporarily disable action certification guard: %w", err)
	}

	var matchingIdentities, exactIdentity int
	if err := tx.QueryRow(`
		SELECT count(*), count(*) FILTER (WHERE id = $1::uuid AND card_number = $2)
		FROM actions
		WHERE deleted_at IS NULL AND (id = $1::uuid OR card_number = $2)
	`, bardicInspirationEntityID, bardicInspirationCardNumber).Scan(&matchingIdentities, &exactIdentity); err != nil {
		return fmt.Errorf("inspect Bardic Inspiration identity: %w", err)
	}
	if matchingIdentities != 1 || exactIdentity != 1 {
		return fmt.Errorf(
			"%s stable identity drifted: matching_rows=%d exact_rows=%d",
			bardicInspirationCardNumber, matchingIdentities, exactIdentity,
		)
	}

	revokedSupport, err := bardicInspirationRevokedSupport()
	if err != nil {
		return fmt.Errorf("encode Bardic Inspiration revoked support: %w", err)
	}
	var mechanicsBefore, supportBefore []byte
	var isLegacy, isCanonical, hasSupport, hasCanonicalRevocation bool
	if err := tx.QueryRow(`
		SELECT mechanics, COALESCE(support, 'null'::jsonb),
		       mechanics = $3::jsonb, mechanics = $4::jsonb,
		       support IS NOT NULL, COALESCE(support, 'null'::jsonb) = $5::jsonb
		FROM actions
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		FOR UPDATE
	`, bardicInspirationEntityID, bardicInspirationCardNumber,
		bardicInspirationLegacyMechanics, bardicInspirationCanonicalMechanics, revokedSupport,
	).Scan(
		&mechanicsBefore, &supportBefore, &isLegacy, &isCanonical,
		&hasSupport, &hasCanonicalRevocation,
	); err != nil {
		return fmt.Errorf("read Bardic Inspiration preimage: %w", err)
	}
	if !isLegacy && !isCanonical {
		return fmt.Errorf("%s mechanics drifted; refusing non-declarative repair", bardicInspirationCardNumber)
	}

	if !(isCanonical && (!hasSupport || hasCanonicalRevocation)) {
		supportAfter := []byte("null")
		if hasSupport {
			if _, err := tx.Exec(`
				INSERT INTO content_certification_revocations (
					entity_type, entity_id, card_number, prior_support, prior_mechanics,
					reason, migration_version
				)
				SELECT 'action', id, card_number, support, mechanics, $3, $4
				FROM actions
				WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
				  AND mechanics = $5::jsonb
				  AND COALESCE(support, 'null'::jsonb) = $6::jsonb
				  AND support IS NOT NULL
				ON CONFLICT (migration_version, entity_type, entity_id) DO NOTHING
			`, bardicInspirationEntityID, bardicInspirationCardNumber,
				bardicInspirationRevocationReason, bardicInspirationMigrationVersion,
				mechanicsBefore, supportBefore,
			); err != nil {
				return fmt.Errorf("record Bardic Inspiration certification revocation: %w", err)
			}
			supportAfter = revokedSupport
		}

		result, err := tx.Exec(`
			UPDATE actions
			SET mechanics = $3::jsonb,
			    support = CASE WHEN $4::jsonb = 'null'::jsonb THEN NULL ELSE $4::jsonb END,
			    updated_at = NOW()
			WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
			  AND mechanics = $5::jsonb
			  AND COALESCE(support, 'null'::jsonb) = $6::jsonb
		`, bardicInspirationEntityID, bardicInspirationCardNumber,
			bardicInspirationCanonicalMechanics, supportAfter, mechanicsBefore, supportBefore,
		)
		if err != nil {
			return fmt.Errorf("repair Bardic Inspiration boon contract: %w", err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("read Bardic Inspiration row count: %w", err)
		}
		if affected != 1 {
			return fmt.Errorf("repair Bardic Inspiration boon contract affected %d rows", affected)
		}
	}

	var compatible int
	if err := tx.QueryRow(`
		SELECT count(*)
		FROM actions
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		  AND mechanics = $3::jsonb
		  AND mechanics->'effects'->0->>'who' = 'target'
		  AND mechanics->'effects'->0->'result'->0->>'kind' = 'boon'
		  AND mechanics->'effects'->0->'result'->0->>'id' = 'bardic_inspiration'
		  AND mechanics->'effects'->0->'result'->0->>'die' = '1d6'
	`, bardicInspirationEntityID, bardicInspirationCardNumber,
		bardicInspirationCanonicalMechanics,
	).Scan(&compatible); err != nil {
		return fmt.Errorf("verify Bardic Inspiration postcondition: %w", err)
	}
	if compatible != 1 {
		return fmt.Errorf("Bardic Inspiration target-boon postcondition failed: compatible_actions=%d", compatible)
	}

	if _, err := tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guard: %w", err)
	}
	return tx.Commit()
}
