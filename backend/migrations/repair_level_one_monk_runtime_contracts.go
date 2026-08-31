package migrations

import (
	"database/sql"
	"fmt"
)

const levelOneMonkRuntimeContractsMigrationVersion = "129_repair_level_one_monk_runtime_contracts"

const (
	monkClassID               = "ed17e7b6-366f-43ef-a94c-2d62dd5d7b20"
	monkClassCard             = "CLASS-monk"
	martialArtsEffectID       = "cdb9f4a8-1c33-4653-88a2-3d18405a83fc"
	martialArtsEffectCard     = "EFF-martial-arts"
	martialArtsHitActionID    = "12900000-0000-4000-8000-000000000001"
	martialArtsHitActionCard  = "ACT-monk-martial-arts-unarmed-hit"
	martialArtsMissActionID   = "12900000-0000-4000-8000-000000000002"
	martialArtsMissActionCard = "ACT-monk-martial-arts-unarmed-miss"
)

const martialArtsEffectMechanics = `{
  "activation":{"mode":"passive"},
  "effects":[{"resolution":"auto","result":[
    {"kind":"unarmed_damage_profile","dice":"martial_arts_die","ability_options":["str","dex"],"damage_type":"bludgeoning","requires_unarmored":true,"source":"Боевые искусства"},
    {"kind":"grant_action","values":["ACT-monk-martial-arts-unarmed-hit","ACT-monk-martial-arts-unarmed-miss"]},
    {"kind":"narrative","description":"После действия «Атака» безоружным ударом или оружием монаха движок предложит бонусный безоружный удар."}
  ]}]
}`

func martialArtsFollowUpMechanics(event string) string {
	return fmt.Sprintf(`{
  "activation":{"mode":"triggered","optional":true,"trigger":{"event":%q,"source_action_card_numbers":["action_basic_unarmed","action_basic_weapon"],"source_weapon_qualifier":"monk_weapon"},"cost":[{"resource":"bonus_action","amount":1}]},
  "targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":5,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]},
  "effects":[{"resolution":"attack_roll","attack_kind":"unarmed","ability":"str","vs":"ac","on_hit":[{"kind":"damage","amount":"1 + str","type":"bludgeoning"}]}]
}`, event)
}

func repairLevelOneMonkRuntimeContracts(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
	`); err != nil {
		return fmt.Errorf("temporarily disable certified mechanics guards: %w", err)
	}

	var classMatches, classExact int
	if err := tx.QueryRow(`
		SELECT count(*), count(*) FILTER (WHERE id = $1::uuid AND card_number = $2)
		FROM classes WHERE deleted_at IS NULL AND (id = $1::uuid OR card_number = $2)
	`, monkClassID, monkClassCard).Scan(&classMatches, &classExact); err != nil {
		return fmt.Errorf("inspect Monk class identity: %w", err)
	}
	if classMatches != 1 || classExact != 1 {
		return fmt.Errorf("%s stable identity drifted: matching_rows=%d exact_rows=%d", monkClassCard, classMatches, classExact)
	}

	const focusByLevel = `{"by_level":{"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,"11":11,"12":12,"13":13,"14":14,"15":15,"16":16,"17":17,"18":18,"19":19,"20":20},"per":"short_rest"}`
	if _, err := tx.Exec(`
		UPDATE classes
		SET resources = jsonb_set(COALESCE(resources, '{}'::jsonb), '{focus}', $3::jsonb, true),
		    updated_at = NOW()
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
	`, monkClassID, monkClassCard, focusByLevel); err != nil {
		return fmt.Errorf("move Monk Focus to level two: %w", err)
	}

	var effectMatches, effectExact int
	if err := tx.QueryRow(`
		SELECT count(*), count(*) FILTER (WHERE id = $1::uuid AND card_number = $2)
		FROM effects WHERE deleted_at IS NULL AND (id = $1::uuid OR card_number = $2)
	`, martialArtsEffectID, martialArtsEffectCard).Scan(&effectMatches, &effectExact); err != nil {
		return fmt.Errorf("inspect Martial Arts identity: %w", err)
	}
	if effectMatches != 1 || effectExact != 1 {
		return fmt.Errorf("%s stable identity drifted: matching_rows=%d exact_rows=%d", martialArtsEffectCard, effectMatches, effectExact)
	}

	for _, action := range []struct {
		id, card, event string
	}{
		{martialArtsHitActionID, martialArtsHitActionCard, "hit"},
		{martialArtsMissActionID, martialArtsMissActionCard, "miss"},
	} {
		if _, err := tx.Exec(`
			INSERT INTO actions (
				id, name, name_en, description, image_url, rarity, card_number,
				action_type, type, resource, mechanics, author, source, support
			) VALUES (
				$1::uuid, 'Боевые искусства: безоружный удар', 'Martial Arts: Unarmed Strike',
				'После подходящей Атаки можно потратить бонусное действие на безоружный удар. Движок предлагает это действие сразу после атаки.',
				'', 'common', $2, 'class_feature', 'class_feature', 'bonus_action', $3::jsonb,
				'System', 'PHB 2024', NULL
			)
			ON CONFLICT (card_number) DO UPDATE SET
				deleted_at = NULL, name = EXCLUDED.name, name_en = EXCLUDED.name_en,
				description = EXCLUDED.description, action_type = EXCLUDED.action_type,
				type = EXCLUDED.type, resource = EXCLUDED.resource,
				mechanics = EXCLUDED.mechanics, support = NULL, updated_at = NOW()
		`, action.id, action.card, martialArtsFollowUpMechanics(action.event)); err != nil {
			return fmt.Errorf("upsert Martial Arts %s follow-up: %w", action.event, err)
		}
	}

	if _, err := tx.Exec(`
		UPDATE effects
		SET mechanics = $3::jsonb,
		    description = 'Без доспеха и щита безоружный удар использует Ловкость или Силу и Кость боевых искусств. После подходящей Атаки появляется бонусный безоружный удар.',
		    support = NULL,
		    updated_at = NOW()
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
	`, martialArtsEffectID, martialArtsEffectCard, martialArtsEffectMechanics); err != nil {
		return fmt.Errorf("repair Martial Arts effect: %w", err)
	}

	// The origin-feat repair shipped a structurally incomplete damage profile.
	// Keep the already-approved feat operational while sharing the same adapter.
	if _, err := tx.Exec(`
		UPDATE effects
		SET mechanics = jsonb_set(
			jsonb_set(mechanics, '{effects,0,result,0,damage_type}', '"bludgeoning"'::jsonb, true),
			'{effects,0,result,0,source}', '"Дебошир: безоружный удар"'::jsonb, true
		), updated_at = NOW()
		WHERE card_number = 'EFF-feat-brawler-unarmed' AND deleted_at IS NULL
		  AND mechanics #>> '{effects,0,result,0,kind}' = 'unarmed_damage_profile'
	`); err != nil {
		return fmt.Errorf("complete Brawler unarmed profile: %w", err)
	}

	var postconditions int
	if err := tx.QueryRow(`
		SELECT
		  (SELECT count(*) FROM classes WHERE id=$1::uuid AND card_number=$2
		     AND resources #>> '{focus,by_level,1}' IS NULL
		     AND resources #>> '{focus,by_level,2}' = '2')
		+ (SELECT count(*) FROM effects WHERE id=$3::uuid AND card_number=$4
		     AND mechanics #>> '{effects,0,result,0,dice}' = 'martial_arts_die'
		     AND mechanics #>> '{effects,0,result,0,requires_unarmored}' = 'true')
		+ (SELECT count(*) FROM actions WHERE card_number IN ($5,$6)
		     AND mechanics #>> '{activation,mode}' = 'triggered')
	`, monkClassID, monkClassCard, martialArtsEffectID, martialArtsEffectCard,
		martialArtsHitActionCard, martialArtsMissActionCard).Scan(&postconditions); err != nil {
		return fmt.Errorf("verify Monk level-one postconditions: %w", err)
	}
	if postconditions != 4 {
		return fmt.Errorf("Monk level-one postconditions failed: compatible_records=%d", postconditions)
	}

	if _, err := tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
