package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const (
	halfCasterSpellcastingMigrationVersion  = "116_repair_half_caster_spellcasting_contract"
	halfCasterSpellcastingRevocationVersion = "revoked-half-caster-spellcasting-contract-v1"
	halfCasterSpellcastingRevocationReason  = "Сертификат отозван: механика классового колдовства не объявляла основную характеристику и не могла пройти строгую компиляцию листа и боя."
)

type halfCasterSpellcastingRepair struct {
	EntityID           string
	CardNumber         string
	Ability            string
	LegacyMechanics    string
	CanonicalMechanics string
}

var halfCasterSpellcastingRepairs = []halfCasterSpellcastingRepair{
	{
		EntityID:   "ab0c1d14-d8ef-4d0d-9952-b26e2f862b5c",
		CardNumber: "EFF-paladin-spellcasting",
		Ability:    "cha",
		LegacyMechanics: `{
			"activation":{"mode":"passive"},
			"effects":[
				{"resolution":"auto","result":[{"description":"Подготовка заклинаний паладина. ХАР — характеристика заклинаний.","kind":"narrative"}]},
				{"count":2,"grant":{"kind":"grant_spell","label":"prepared"},"id":"paladin_spells_l1","kind":"choice","options":{"filter":{"classes":["паладин"],"levels":[1]},"source":"spell"},"prompt":"Выберите 2 заклинания 1 уровня для подготовки","resolution":"on_acquire"}
			]
		}`,
		CanonicalMechanics: `{
			"activation":{"mode":"passive"},
			"effects":[
				{"resolution":"auto","result":[{"kind":"spellcasting_ability","role":"primary","ability":"cha"},{"description":"Подготовка заклинаний паладина. ХАР — характеристика заклинаний.","kind":"narrative"}]},
				{"count":2,"grant":{"kind":"grant_spell","label":"prepared"},"id":"paladin_spells_l1","kind":"choice","options":{"filter":{"classes":["паладин"],"levels":[1]},"source":"spell"},"prompt":"Выберите 2 заклинания 1 уровня для подготовки","resolution":"on_acquire"}
			]
		}`,
	},
	{
		EntityID:   "c4d0a9b1-90e8-49d4-8201-fc0aff542ae6",
		CardNumber: "EFF-ranger-spellcasting",
		Ability:    "wis",
		LegacyMechanics: `{
			"activation":{"mode":"passive"},
			"effects":[
				{"resolution":"auto","result":[{"description":"Подготовка заклинаний следопыта. МДР — характеристика заклинаний.","kind":"narrative"}]},
				{"count":2,"grant":{"kind":"grant_spell","label":"prepared"},"id":"ranger_spells_l1","kind":"choice","options":{"filter":{"classes":["следопыт"],"levels":[1]},"source":"spell"},"prompt":"Выберите 2 заклинания 1 уровня для подготовки","resolution":"on_acquire"}
			]
		}`,
		CanonicalMechanics: `{
			"activation":{"mode":"passive"},
			"effects":[
				{"resolution":"auto","result":[{"kind":"spellcasting_ability","role":"primary","ability":"wis"},{"description":"Подготовка заклинаний следопыта. МДР — характеристика заклинаний.","kind":"narrative"}]},
				{"count":2,"grant":{"kind":"grant_spell","label":"prepared"},"id":"ranger_spells_l1","kind":"choice","options":{"filter":{"classes":["следопыт"],"levels":[1]},"source":"spell"},"prompt":"Выберите 2 заклинания 1 уровня для подготовки","resolution":"on_acquire"}
			]
		}`,
	},
}

func halfCasterRevokedSupport() ([]byte, error) {
	return json.Marshal(map[string]any{
		"status":                "untested",
		"certification_version": halfCasterSpellcastingRevocationVersion,
		"mechanics_locked":      false,
		"note":                  halfCasterSpellcastingRevocationReason,
		"limitations":           []string{halfCasterSpellcastingRevocationReason},
	})
}

func applyHalfCasterSpellcastingRepair(tx *sql.Tx, repair halfCasterSpellcastingRepair) error {
	revokedSupport, err := halfCasterRevokedSupport()
	if err != nil {
		return fmt.Errorf("encode %s revoked support: %w", repair.CardNumber, err)
	}
	var matchingIdentities, exactIdentity int
	if err := tx.QueryRow(`
		SELECT
			count(*),
			count(*) FILTER (WHERE id = $1::uuid AND card_number = $2)
		FROM effects
		WHERE deleted_at IS NULL
		  AND (id = $1::uuid OR card_number = $2)
	`, repair.EntityID, repair.CardNumber).Scan(&matchingIdentities, &exactIdentity); err != nil {
		return fmt.Errorf("inspect %s identity: %w", repair.CardNumber, err)
	}
	if matchingIdentities != 1 || exactIdentity != 1 {
		return fmt.Errorf(
			"%s stable identity drifted: matching_rows=%d exact_rows=%d",
			repair.CardNumber,
			matchingIdentities,
			exactIdentity,
		)
	}

	var entityID string
	var mechanicsBefore, supportBefore []byte
	var isLegacy, isCanonical, hasSupport, hasCanonicalRevocation bool
	if err := tx.QueryRow(`
		SELECT
			id::text,
			mechanics,
			COALESCE(support, 'null'::jsonb),
			mechanics = $3::jsonb,
			mechanics = $4::jsonb,
			support IS NOT NULL,
			COALESCE(support, 'null'::jsonb) = $5::jsonb
		FROM effects
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		FOR UPDATE
	`, repair.EntityID, repair.CardNumber, repair.LegacyMechanics, repair.CanonicalMechanics, revokedSupport).Scan(
		&entityID,
		&mechanicsBefore,
		&supportBefore,
		&isLegacy,
		&isCanonical,
		&hasSupport,
		&hasCanonicalRevocation,
	); err != nil {
		return fmt.Errorf("read %s mechanics preimage: %w", repair.CardNumber, err)
	}
	if isCanonical && (!hasSupport || hasCanonicalRevocation) {
		return nil
	}
	if !isLegacy && !isCanonical {
		return fmt.Errorf("%s mechanics drifted; refusing non-declarative repair", repair.CardNumber)
	}

	supportAfter := []byte("null")
	if hasSupport {
		if _, err := tx.Exec(`
			INSERT INTO content_certification_revocations (
				entity_type, entity_id, card_number, prior_support, prior_mechanics,
				reason, migration_version
			)
			SELECT 'effect', id, card_number, support, mechanics, $3, $4
			FROM effects
			WHERE id = $1::uuid
			  AND card_number = $2
			  AND deleted_at IS NULL
			  AND mechanics = $5::jsonb
			  AND COALESCE(support, 'null'::jsonb) = $6::jsonb
			  AND support IS NOT NULL
			ON CONFLICT (migration_version, entity_type, entity_id) DO NOTHING
		`,
			repair.EntityID,
			repair.CardNumber,
			halfCasterSpellcastingRevocationReason,
			halfCasterSpellcastingMigrationVersion,
			mechanicsBefore,
			supportBefore,
		); err != nil {
			return fmt.Errorf("record %s certification revocation: %w", repair.CardNumber, err)
		}
		supportAfter = revokedSupport
	}

	result, err := tx.Exec(`
		UPDATE effects
		SET mechanics = $3::jsonb,
			support = CASE WHEN $4::jsonb = 'null'::jsonb THEN NULL ELSE $4::jsonb END,
			updated_at = NOW()
		WHERE id = $1::uuid
		  AND card_number = $2
		  AND deleted_at IS NULL
		  AND mechanics = $5::jsonb
		  AND COALESCE(support, 'null'::jsonb) = $6::jsonb
	`,
		entityID,
		repair.CardNumber,
		repair.CanonicalMechanics,
		supportAfter,
		mechanicsBefore,
		supportBefore,
	)
	if err != nil {
		return fmt.Errorf("repair %s spellcasting contract: %w", repair.CardNumber, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read %s spellcasting repair row count: %w", repair.CardNumber, err)
	}
	if affected != 1 {
		return fmt.Errorf("repair %s spellcasting contract affected %d rows", repair.CardNumber, affected)
	}
	return nil
}

func assertHalfCasterSpellcastingPostconditions(tx *sql.Tx, repair halfCasterSpellcastingRepair) error {
	var compatible int
	if err := tx.QueryRow(`
		SELECT count(*)
		FROM effects
		WHERE id = $1::uuid
		  AND card_number = $2
		  AND deleted_at IS NULL
		  AND mechanics = $3::jsonb
		  AND mechanics->'activation'->>'mode' = 'passive'
		  AND (
			SELECT count(*)
			FROM jsonb_array_elements(mechanics->'effects'->0->'result') AS result
			WHERE result->>'kind' = 'spellcasting_ability'
			  AND result->>'role' = 'primary'
			  AND result->>'ability' = $4
		  ) = 1
		  AND mechanics->'effects'->1->>'kind' = 'choice'
		  AND mechanics->'effects'->1->>'count' = '2'
		  AND mechanics->'effects'->1->'grant'->>'kind' = 'grant_spell'
		  AND mechanics->'effects'->1->'grant'->>'label' = 'prepared'
		  AND mechanics->'effects'->1->'options'->>'source' = 'spell'
		  AND mechanics->'effects'->1->>'resolution' = 'on_acquire'
	`, repair.EntityID, repair.CardNumber, repair.CanonicalMechanics, repair.Ability).Scan(&compatible); err != nil {
		return fmt.Errorf("verify %s spellcasting postcondition: %w", repair.CardNumber, err)
	}
	if compatible != 1 {
		return fmt.Errorf("%s spellcasting compiler postcondition failed: compatible_effects=%d", repair.CardNumber, compatible)
	}
	return nil
}

func repairHalfCasterSpellcastingContract(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := createCertificationRevocationLedger(tx); err != nil {
		return fmt.Errorf("create certification revocation ledger: %w", err)
	}
	// Certified mechanics are immutable by default. This migration is the narrow,
	// audited authority for exactly two reviewed preimages. PostgreSQL rolls the
	// trigger DDL back together with the data if either identity or CAS check fails.
	if _, err := tx.Exec(`DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects`); err != nil {
		return fmt.Errorf("temporarily disable effect certification guard: %w", err)
	}
	for _, repair := range halfCasterSpellcastingRepairs {
		if err := applyHalfCasterSpellcastingRepair(tx, repair); err != nil {
			return err
		}
	}
	for _, repair := range halfCasterSpellcastingRepairs {
		if err := assertHalfCasterSpellcastingPostconditions(tx, repair); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guard: %w", err)
	}
	return tx.Commit()
}
