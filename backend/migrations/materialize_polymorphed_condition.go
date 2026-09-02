package migrations

import (
	"database/sql"
	"fmt"
)

const polymorphedConditionMigrationVersion = "141_materialize_polymorphed_condition"

const (
	polymorphedConditionID   = "14100000-0000-4000-8000-000000000001"
	polymorphedConditionCard = "COND-polymorphed"
	polymorphSpellCard       = "polymorph"
)

const polymorphedConditionMechanics = `{
  "activation":{"mode":"passive"},
  "condition":{"id":"polymorphed"},
  "effects":[]
}`

// materializePolymorphedCondition closes the last unresolved condition
// reference in the complete spell/action/effect catalog. It is presentation
// identity only until the full Polymorph mechanics receive their own release
// certificate; uncertified rows never add executable condition modifiers.
func materializePolymorphedCondition(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects`); err != nil {
		return fmt.Errorf("disable certified effect guard: %w", err)
	}

	var conflicts int
	if err = tx.QueryRow(`
		SELECT count(*) FROM effects
		WHERE deleted_at IS NULL AND (id=$1::uuid OR card_number=$2)
		  AND NOT (id=$1::uuid AND card_number=$2)
	`, polymorphedConditionID, polymorphedConditionCard).Scan(&conflicts); err != nil {
		return fmt.Errorf("inspect polymorphed condition identity: %w", err)
	}
	if conflicts != 0 {
		return fmt.Errorf("%s identity conflicts with %d active rows", polymorphedConditionCard, conflicts)
	}

	var references int
	if err = tx.QueryRow(`
		SELECT count(*) FROM spells
		WHERE deleted_at IS NULL
		  AND jsonb_path_exists(mechanics, '$.** ? (@.kind == "condition" && @.value == "polymorphed")')
	`).Scan(&references); err != nil {
		return fmt.Errorf("inspect polymorphed catalog references: %w", err)
	}
	if references == 0 {
		return fmt.Errorf("polymorphed condition has no active spell reference")
	}

	if _, err = tx.Exec(`
		INSERT INTO effects (
			id,name,name_en,description,detailed_description,image_url,rarity,
			card_number,effect_type,mechanics,repeatable,author,source,support
		) VALUES (
			$1::uuid,'Превращённый','Polymorphed',
			'Существо находится в иной форме, созданной эффектом превращения.',
			'Карточка хранит точную библиотечную идентичность состояния. Конкретная форма, характеристики и окончание превращения определяются применившим его заклинанием или действием.',
			COALESCE((SELECT image_url FROM spells WHERE card_number=$3 AND deleted_at IS NULL LIMIT 1),''),
			'common',$2,'condition',$4::jsonb,false,'System','PHB 2024',
			jsonb_build_object('status','untested','certification_version',$5::text,
			  'mechanics_locked',false,'note','Data-driven presentation identity; executable Polymorph certificate is pending.')
		)
		ON CONFLICT (card_number) DO UPDATE SET
			deleted_at=NULL,name=EXCLUDED.name,name_en=EXCLUDED.name_en,
			description=EXCLUDED.description,detailed_description=EXCLUDED.detailed_description,
			image_url=EXCLUDED.image_url,effect_type=EXCLUDED.effect_type,
			mechanics=EXCLUDED.mechanics,repeatable=false,support=EXCLUDED.support,updated_at=NOW()
	`, polymorphedConditionID, polymorphedConditionCard, polymorphSpellCard,
		polymorphedConditionMechanics, polymorphedConditionMigrationVersion); err != nil {
		return fmt.Errorf("materialize polymorphed condition: %w", err)
	}

	var postconditions int
	if err = tx.QueryRow(`
		SELECT count(*) FROM effects
		WHERE id=$1::uuid AND card_number=$2 AND effect_type='condition'
		  AND mechanics=$3::jsonb AND NULLIF(image_url,'') IS NOT NULL AND deleted_at IS NULL
	`, polymorphedConditionID, polymorphedConditionCard,
		polymorphedConditionMechanics).Scan(&postconditions); err != nil {
		return fmt.Errorf("verify polymorphed condition postcondition: %w", err)
	}
	if postconditions != 1 {
		return fmt.Errorf("polymorphed condition postcondition failed: %d/1", postconditions)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
