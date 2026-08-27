package migrations

import (
	"database/sql"
	"fmt"
)

// repairGoliathReactionAuthority makes the Action entity the single runtime
// authority for Giant Ancestry reactions.  Earlier one-off scripts moved Stone
// Endurance mechanics onto a related Effect while migration 109 restored an
// Action, leaving both semantic copies visible and only the Action capable of
// entering canonical combat.  Identity is resolved by immutable card numbers;
// no environment-specific UUID is trusted.
func repairGoliathReactionAuthority(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
	`); err != nil {
		return err
	}

	if _, err = tx.Exec(`
		INSERT INTO actions (
			name, description, image_url, rarity, card_number, action_type,
			type, resource, mechanics, author, source
		) VALUES (
			'Каменная стойкость',
			'Получив урон, используйте реакцию и заряд Наследия великанов, чтобы уменьшить полученный урон на 1к12 + модификатор Телосложения.',
			'', 'common', 'ACT-goliath-stone', 'class_feature', 'species',
			'reaction,giant_legacy', '{
		  "activation":{"mode":"reaction","trigger":{"event":"damage_taken","timing":"before"},"cost":[{"resource":"reaction","amount":1},{"resource":"giant_legacy","amount":1}]},
		  "targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},
		  "effects":[{"resolution":"auto","result":[{"kind":"reduce_damage","amount":"1d12+con"}]}]
		}'::jsonb, 'System', 'PHB 2024'
		)
		ON CONFLICT (card_number) DO UPDATE SET
			deleted_at = NULL,
			mechanics = EXCLUDED.mechanics,
			resource = EXCLUDED.resource,
			support = NULL,
			updated_at = NOW();

		UPDATE races lineage
		SET related_effects = COALESCE((
			SELECT jsonb_agg(reference ORDER BY ordinal)
			FROM jsonb_array_elements_text(COALESCE(lineage.related_effects, '[]'::jsonb))
				WITH ORDINALITY AS linked(reference, ordinal)
			WHERE NOT EXISTS (
				SELECT 1
				FROM effects effect
				WHERE effect.deleted_at IS NULL
				  AND (effect.id::text = linked.reference OR effect.card_number = linked.reference)
				  AND EXISTS (
					SELECT 1
					FROM jsonb_array_elements(COALESCE(effect.mechanics->'effects', '[]'::jsonb)) mechanic_effect,
					     jsonb_array_elements(COALESCE(
					       mechanic_effect->'result', mechanic_effect->'results', '[]'::jsonb
					     )) payload
					WHERE payload->>'kind' = 'reduce_damage'
				  )
			)
		), '[]'::jsonb), updated_at = NOW()
		WHERE lineage.card_number = 'RACE-0011-stone' AND lineage.deleted_at IS NULL;
	`); err != nil {
		return err
	}

	if err = bindGoliathCanonicalLineages(tx); err != nil {
		return err
	}

	var actionCount, boundCount, duplicateEffectCount int
	if err = tx.QueryRow(`
		SELECT
		  (SELECT count(*) FROM actions
		   WHERE card_number = 'ACT-goliath-stone' AND deleted_at IS NULL
		     AND mechanics->'activation'->>'mode' = 'reaction'
		     AND mechanics->'activation'->'trigger'->>'event' = 'damage_taken'
		     AND mechanics->'activation'->'trigger'->>'timing' = 'before'
		     AND mechanics->'targeting'->>'domain' = 'actor'
		     AND mechanics->'targeting'->>'shape' = 'self'
		     AND mechanics->'targeting'->'actor_targets' = 'false'::jsonb
		     AND EXISTS (
		       SELECT 1
		       FROM jsonb_array_elements(COALESCE(mechanics->'effects', '[]'::jsonb)) mechanic_effect,
		            jsonb_array_elements(COALESCE(
		              mechanic_effect->'result', mechanic_effect->'results', '[]'::jsonb
		            )) payload
		       WHERE payload->>'kind' = 'reduce_damage'
		     )),
		  (SELECT count(*)
		   FROM races lineage
		   JOIN actions action ON lineage.related_actions = jsonb_build_array(action.id::text)
		   WHERE lineage.card_number = 'RACE-0011-stone' AND lineage.deleted_at IS NULL
		     AND action.card_number = 'ACT-goliath-stone' AND action.deleted_at IS NULL),
		  (SELECT count(*)
		   FROM races lineage,
		        jsonb_array_elements_text(COALESCE(lineage.related_effects, '[]'::jsonb)) AS linked(reference)
		   JOIN effects effect ON (effect.id::text = linked.reference OR effect.card_number = linked.reference)
		   WHERE lineage.card_number = 'RACE-0011-stone' AND lineage.deleted_at IS NULL
		     AND effect.deleted_at IS NULL
		     AND EXISTS (
		       SELECT 1
		       FROM jsonb_array_elements(COALESCE(effect.mechanics->'effects', '[]'::jsonb)) mechanic_effect,
		            jsonb_array_elements(COALESCE(
		              mechanic_effect->'result', mechanic_effect->'results', '[]'::jsonb
		            )) payload
		       WHERE payload->>'kind' = 'reduce_damage'
		     ))
	`).Scan(&actionCount, &boundCount, &duplicateEffectCount); err != nil {
		return err
	}
	if actionCount != 1 || boundCount != 1 || duplicateEffectCount != 0 {
		return fmt.Errorf(
			"stone endurance authority postcondition failed: actions=%d bound=%d duplicate_effects=%d",
			actionCount, boundCount, duplicateEffectCount,
		)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return err
	}
	return tx.Commit()
}
