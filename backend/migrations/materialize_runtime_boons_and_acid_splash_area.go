package migrations

import (
	"database/sql"
	"fmt"
)

const runtimeBoonsAreaMigrationVersion = "140_materialize_runtime_boons_and_acid_splash_area"

const (
	bardicBoonEffectID   = "14000000-0000-4000-8000-000000000001"
	bardicBoonEffectCard = "EFFECT-bardic-inspiration"
	acidSplashID         = "3b0ac4ac-73bb-4525-83fa-9f4a9a14c430"
	acidSplashCard       = "SPELL-0166"
)

const bardicBoonMechanics = `{
  "kind":"boon","id":"bardic_inspiration","die":"1d6",
  "applies_to":["ability_check","attack_roll","saving_throw"],
  "timing":["before_roll","after_failure"],"consume":"on_roll",
  "duration":{"type":"hours","amount":1}
}`

const bardicGrantMechanics = `{
  "activation":{"cost":[{"resource":"bonus_action"},{"amount":1,"resource":"bardic_inspiration"}],"mode":"active"},
  "effects":[{"resolution":"auto","who":"target","result":[{"kind":"grant_effect","value":"EFFECT-bardic-inspiration"}]}],
  "targeting":{"actor_targets":true,"allowed_relations":["ally"],"domain":"actor","max_targets":1,"min_targets":1,"range_ft":60,"requires_line_of_sight":true,"shape":"single"}
}`

const acidSplashAreaTargeting = `{
  "domain":"actor","actor_targets":true,"shape":"area",
  "min_targets":1,"max_targets":8,"range_ft":60,
  "requires_line_of_sight":true,"allowed_relations":["self","ally","enemy","neutral"],
  "area":{"kind":"sphere","radius_ft":5}
}`

// materializeRuntimeBoonsAndAcidSplashArea moves the Bardic Inspiration token
// into the effects catalog and makes Acid Splash geometry executable. Both
// repaired entities lose stale certification until browser evidence is issued.
func materializeRuntimeBoonsAndAcidSplashArea(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
		DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells;
	`); err != nil {
		return fmt.Errorf("disable certified mechanics guards: %w", err)
	}

	var acidMatches, acidExact int
	if err = tx.QueryRow(`
		SELECT count(*), count(*) FILTER (WHERE id=$1::uuid AND card_number=$2)
		FROM spells WHERE deleted_at IS NULL AND (id=$1::uuid OR card_number=$2)
	`, acidSplashID, acidSplashCard).Scan(&acidMatches, &acidExact); err != nil {
		return fmt.Errorf("inspect Acid Splash identity: %w", err)
	}
	if acidMatches != 1 || acidExact != 1 {
		return fmt.Errorf("%s stable identity drifted: matching_rows=%d exact_rows=%d", acidSplashCard, acidMatches, acidExact)
	}

	var actionMatches, actionExact int
	if err = tx.QueryRow(`
		SELECT count(*), count(*) FILTER (WHERE id=$1::uuid AND card_number=$2)
		FROM actions WHERE deleted_at IS NULL AND (id=$1::uuid OR card_number=$2)
	`, bardicInspirationEntityID, bardicInspirationCardNumber).Scan(&actionMatches, &actionExact); err != nil {
		return fmt.Errorf("inspect Bardic Inspiration identity: %w", err)
	}
	if actionMatches != 1 || actionExact != 1 {
		return fmt.Errorf("%s stable identity drifted: matching_rows=%d exact_rows=%d", bardicInspirationCardNumber, actionMatches, actionExact)
	}

	var effectConflicts int
	if err = tx.QueryRow(`
		SELECT count(*) FROM effects
		WHERE deleted_at IS NULL AND (id=$1::uuid OR card_number=$2)
		  AND NOT (id=$1::uuid AND card_number=$2)
	`, bardicBoonEffectID, bardicBoonEffectCard).Scan(&effectConflicts); err != nil {
		return fmt.Errorf("inspect Bardic Inspiration effect identity: %w", err)
	}
	if effectConflicts != 0 {
		return fmt.Errorf("%s identity conflicts with %d active rows", bardicBoonEffectCard, effectConflicts)
	}

	if _, err = tx.Exec(`
		INSERT INTO effects (
			id,name,name_en,description,detailed_description,image_url,rarity,
			card_number,effect_type,mechanics,repeatable,author,source,support
		) VALUES (
			$1::uuid,'Вдохновение барда','Bardic Inspiration',
			'Кость к6 для одной проверки характеристики, атаки или спасброска. Используйте до броска либо после провала.',
			'Выберите подходящий бросок. После броска кости эффект расходуется автоматически; срок — 1 час.',
			COALESCE((SELECT image_url FROM actions WHERE id=$3::uuid),''),
			'common',$2,'positive_effect',$4::jsonb,false,'System','PHB 2024',
			jsonb_build_object('status','untested','certification_version',$5::text,
			  'mechanics_locked',false,'note','Материализован data-driven boon; требуется браузерная проверка.')
		)
		ON CONFLICT (card_number) DO UPDATE SET
			deleted_at=NULL,name=EXCLUDED.name,name_en=EXCLUDED.name_en,
			description=EXCLUDED.description,detailed_description=EXCLUDED.detailed_description,
			image_url=EXCLUDED.image_url,effect_type=EXCLUDED.effect_type,
			mechanics=EXCLUDED.mechanics,repeatable=false,support=EXCLUDED.support,updated_at=NOW()
	`, bardicBoonEffectID, bardicBoonEffectCard, bardicInspirationEntityID,
		bardicBoonMechanics, runtimeBoonsAreaMigrationVersion); err != nil {
		return fmt.Errorf("materialize Bardic Inspiration effect: %w", err)
	}

	if _, err = tx.Exec(`
		UPDATE actions SET mechanics=$3::jsonb,
			support=jsonb_build_object('status','untested','certification_version',$4::text,
			  'mechanics_locked',false,'note','Теперь выдаёт data-driven эффект из библиотеки.'),
			updated_at=NOW()
		WHERE id=$1::uuid AND card_number=$2 AND deleted_at IS NULL
	`, bardicInspirationEntityID, bardicInspirationCardNumber,
		bardicGrantMechanics, runtimeBoonsAreaMigrationVersion); err != nil {
		return fmt.Errorf("link Bardic Inspiration action to effect: %w", err)
	}

	if _, err = tx.Exec(`
		UPDATE spells SET
			mechanics=jsonb_set(COALESCE(mechanics,'{}'::jsonb),'{targeting}',$3::jsonb,true),
			area='Сфера радиусом 5 футов',
			support=jsonb_build_object('status','untested','certification_version',$4::text,
			  'mechanics_locked',false,'note','Исправлена геометрия 5-футовой сферы; требуется браузерная проверка.'),
			updated_at=NOW()
		WHERE id=$1::uuid AND card_number=$2 AND deleted_at IS NULL
	`, acidSplashID, acidSplashCard, acidSplashAreaTargeting,
		runtimeBoonsAreaMigrationVersion); err != nil {
		return fmt.Errorf("repair Acid Splash area targeting: %w", err)
	}

	var postconditions int
	if err = tx.QueryRow(`
		SELECT
		  (SELECT count(*) FROM effects WHERE id=$1::uuid AND card_number=$2
		    AND mechanics=$3::jsonb AND deleted_at IS NULL)
		+ (SELECT count(*) FROM actions WHERE id=$4::uuid AND card_number=$5
		    AND mechanics=$6::jsonb AND deleted_at IS NULL)
		+ (SELECT count(*) FROM spells WHERE id=$7::uuid AND card_number=$8
		    AND mechanics->'targeting'=$9::jsonb AND deleted_at IS NULL)
	`, bardicBoonEffectID, bardicBoonEffectCard, bardicBoonMechanics,
		bardicInspirationEntityID, bardicInspirationCardNumber, bardicGrantMechanics,
		acidSplashID, acidSplashCard, acidSplashAreaTargeting).Scan(&postconditions); err != nil {
		return fmt.Errorf("verify data-driven effects/targeting postconditions: %w", err)
	}
	if postconditions != 3 {
		return fmt.Errorf("data-driven effects/targeting postconditions failed: %d/3", postconditions)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
