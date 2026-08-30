package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const (
	bardSpellcastingMigrationVersion  = "118_repair_bard_spellcasting_contract"
	bardSpellcastingRevocationVersion = "revoked-bard-spellcasting-contract-v1"
	bardSpellcastingRevocationReason  = "Сертификат отозван: механика колдовства барда не объявляла основную характеристику, поэтому выбранные в Forge заклинания нельзя было исполнить из листа или боя."
	bardSpellcastingEntityID          = "1ea222f0-2d5b-47a3-91b2-3f683af5d007"
	bardSpellcastingCardNumber        = "EFF-bard-spellcasting"

	bardSpellcastingLegacyMechanics = `{
		"activation":{"mode":"passive"},
		"effects":[
			{"resolution":"auto","result":[{"kind":"narrative","description":"Подготовка заклинаний барда. ХАР — характеристика заклинаний."}]},
			{"id":"bard_cantrips","kind":"choice","count":2,"grant":{"kind":"grant_spell","label":"cantrip"},"prompt":"Выберите 2 заговора барда","options":{"filter":{"levels":[0],"classes":["бард"]},"source":"spell"},"resolution":"on_acquire"},
			{"id":"bard_spells_l1","kind":"choice","count":4,"grant":{"kind":"grant_spell","label":"prepared"},"prompt":"Выберите 4 заклинания 1 уровня для подготовки","options":{"filter":{"levels":[1],"classes":["бард"]},"source":"spell"},"resolution":"on_acquire"}
		]
	}`
	bardSpellcastingCanonicalMechanics = `{
		"activation":{"mode":"passive"},
		"effects":[
			{"resolution":"auto","result":[{"kind":"spellcasting_ability","role":"primary","ability":"cha"},{"kind":"narrative","description":"Подготовка заклинаний барда. ХАР — характеристика заклинаний."}]},
			{"id":"bard_cantrips","kind":"choice","count":2,"grant":{"kind":"grant_spell","label":"cantrip"},"prompt":"Выберите 2 заговора барда","options":{"filter":{"levels":[0],"classes":["бард"]},"source":"spell"},"resolution":"on_acquire"},
			{"id":"bard_spells_l1","kind":"choice","count":4,"grant":{"kind":"grant_spell","label":"prepared"},"prompt":"Выберите 4 заклинания 1 уровня для подготовки","options":{"filter":{"levels":[1],"classes":["бард"]},"source":"spell"},"resolution":"on_acquire"}
		]
	}`
)

func bardRevokedSupport() ([]byte, error) {
	return json.Marshal(map[string]any{
		"status":                "untested",
		"certification_version": bardSpellcastingRevocationVersion,
		"mechanics_locked":      false,
		"note":                  bardSpellcastingRevocationReason,
		"limitations":           []string{bardSpellcastingRevocationReason},
	})
}

func repairBardSpellcastingContract(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := createCertificationRevocationLedger(tx); err != nil {
		return fmt.Errorf("create certification revocation ledger: %w", err)
	}
	if _, err := tx.Exec(`DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects`); err != nil {
		return fmt.Errorf("temporarily disable effect certification guard: %w", err)
	}

	var matchingIdentities, exactIdentity int
	if err := tx.QueryRow(`
		SELECT count(*), count(*) FILTER (WHERE id = $1::uuid AND card_number = $2)
		FROM effects
		WHERE deleted_at IS NULL AND (id = $1::uuid OR card_number = $2)
	`, bardSpellcastingEntityID, bardSpellcastingCardNumber).Scan(&matchingIdentities, &exactIdentity); err != nil {
		return fmt.Errorf("inspect bard spellcasting identity: %w", err)
	}
	if matchingIdentities != 1 || exactIdentity != 1 {
		return fmt.Errorf(
			"%s stable identity drifted: matching_rows=%d exact_rows=%d",
			bardSpellcastingCardNumber, matchingIdentities, exactIdentity,
		)
	}

	revokedSupport, err := bardRevokedSupport()
	if err != nil {
		return fmt.Errorf("encode bard revoked support: %w", err)
	}
	var mechanicsBefore, supportBefore []byte
	var isLegacy, isCanonical, hasSupport, hasCanonicalRevocation bool
	if err := tx.QueryRow(`
		SELECT mechanics, COALESCE(support, 'null'::jsonb),
		       mechanics = $3::jsonb, mechanics = $4::jsonb,
		       support IS NOT NULL, COALESCE(support, 'null'::jsonb) = $5::jsonb
		FROM effects
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		FOR UPDATE
	`, bardSpellcastingEntityID, bardSpellcastingCardNumber,
		bardSpellcastingLegacyMechanics, bardSpellcastingCanonicalMechanics, revokedSupport,
	).Scan(
		&mechanicsBefore, &supportBefore, &isLegacy, &isCanonical,
		&hasSupport, &hasCanonicalRevocation,
	); err != nil {
		return fmt.Errorf("read bard spellcasting preimage: %w", err)
	}
	if !isLegacy && !isCanonical {
		return fmt.Errorf("%s mechanics drifted; refusing non-declarative repair", bardSpellcastingCardNumber)
	}

	if !(isCanonical && (!hasSupport || hasCanonicalRevocation)) {
		supportAfter := []byte("null")
		if hasSupport {
			if _, err := tx.Exec(`
				INSERT INTO content_certification_revocations (
					entity_type, entity_id, card_number, prior_support, prior_mechanics,
					reason, migration_version
				)
				SELECT 'effect', id, card_number, support, mechanics, $3, $4
				FROM effects
				WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
				  AND mechanics = $5::jsonb
				  AND COALESCE(support, 'null'::jsonb) = $6::jsonb
				  AND support IS NOT NULL
				ON CONFLICT (migration_version, entity_type, entity_id) DO NOTHING
			`, bardSpellcastingEntityID, bardSpellcastingCardNumber,
				bardSpellcastingRevocationReason, bardSpellcastingMigrationVersion,
				mechanicsBefore, supportBefore,
			); err != nil {
				return fmt.Errorf("record bard certification revocation: %w", err)
			}
			supportAfter = revokedSupport
		}

		result, err := tx.Exec(`
			UPDATE effects
			SET mechanics = $3::jsonb,
			    support = CASE WHEN $4::jsonb = 'null'::jsonb THEN NULL ELSE $4::jsonb END,
			    updated_at = NOW()
			WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
			  AND mechanics = $5::jsonb
			  AND COALESCE(support, 'null'::jsonb) = $6::jsonb
		`, bardSpellcastingEntityID, bardSpellcastingCardNumber,
			bardSpellcastingCanonicalMechanics, supportAfter, mechanicsBefore, supportBefore,
		)
		if err != nil {
			return fmt.Errorf("repair bard spellcasting contract: %w", err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("read bard spellcasting row count: %w", err)
		}
		if affected != 1 {
			return fmt.Errorf("repair bard spellcasting contract affected %d rows", affected)
		}
	}

	var compatible int
	if err := tx.QueryRow(`
		SELECT count(*)
		FROM effects
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		  AND mechanics = $3::jsonb
		  AND mechanics->'activation'->>'mode' = 'passive'
		  AND (
			SELECT count(*)
			FROM jsonb_array_elements(mechanics->'effects'->0->'result') AS result
			WHERE result->>'kind' = 'spellcasting_ability'
			  AND result->>'role' = 'primary'
			  AND result->>'ability' = 'cha'
		  ) = 1
		  AND mechanics->'effects'->1->'grant'->>'kind' = 'grant_spell'
		  AND mechanics->'effects'->1->'grant'->>'label' = 'cantrip'
		  AND mechanics->'effects'->2->'grant'->>'kind' = 'grant_spell'
		  AND mechanics->'effects'->2->'grant'->>'label' = 'prepared'
	`, bardSpellcastingEntityID, bardSpellcastingCardNumber,
		bardSpellcastingCanonicalMechanics,
	).Scan(&compatible); err != nil {
		return fmt.Errorf("verify bard spellcasting postcondition: %w", err)
	}
	if compatible != 1 {
		return fmt.Errorf("bard spellcasting compiler postcondition failed: compatible_effects=%d", compatible)
	}

	if _, err := tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guard: %w", err)
	}
	return tx.Commit()
}
