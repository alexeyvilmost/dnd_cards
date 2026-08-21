package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

type goliathLineageRepair struct {
	ID          string
	CardNumber  string
	Name        string
	NameEn      string
	Description string
	EffectID    string
	ActionID    string
}

var goliathLineageRepairs = []goliathLineageRepair{
	{ID: "b262a4c9-e303-472b-b347-e3fcb2fe93f1", CardNumber: "RACE-0011-cloud", Name: "Наследие облачного великана", NameEn: "Cloud's Jaunt", Description: "Наследие великанов: облачный великан.", EffectID: "64efbfe5-4a0a-4143-8254-ca66b3c35a57", ActionID: "8295a341-92ef-485b-b1de-7a5d7712fe4e"},
	{ID: "1fc68a11-99de-4870-85ad-1cedf6e844e9", CardNumber: "RACE-0011-fire", Name: "Наследие огненного великана", NameEn: "Fire's Burn", Description: "Наследие великанов: огненный великан.", EffectID: "dbc5133e-5e80-451a-b457-6b8d4de5f678", ActionID: "5f18fc6f-3821-4602-8c1f-33bdcd4060f3"},
	{ID: "6e28e3b3-9049-44ff-9458-6efedfaa3013", CardNumber: "RACE-0011-frost", Name: "Наследие ледяного великана", NameEn: "Frost's Chill", Description: "Наследие великанов: ледяной великан.", EffectID: "dd24ebf4-91d6-4f42-9654-94b52f43ed59", ActionID: "7ee8be70-2ae7-4519-a237-6de14c0bef1c"},
	{ID: "593f8c23-6ca8-49ab-8f71-ff88c39e95c7", CardNumber: "RACE-0011-hill", Name: "Наследие холмового великана", NameEn: "Hill's Tumble", Description: "Наследие великанов: холмовой великан.", EffectID: "81bba49b-99da-4ae1-a0c8-fc9cbb14dcc3", ActionID: "44752a41-56fa-4321-b5ac-ff56c08372bc"},
	{ID: "0fc14aae-e914-46d4-9143-b71758494983", CardNumber: "RACE-0011-stone", Name: "Наследие каменного великана", NameEn: "Stone's Endurance", Description: "Наследие великанов: каменный великан.", EffectID: "86817ebd-10e0-4f47-84e7-197cc973938d"},
	{ID: "5f4be1d6-792c-4473-a7fa-3473528dea03", CardNumber: "RACE-0011-storm", Name: "Наследие штормового великана", NameEn: "Storm's Thunder", Description: "Наследие великанов: штормовой великан.", EffectID: "d82ad1b1-3345-4eb3-bbf5-33c260628158", ActionID: "611f1be7-1eac-4b69-beaa-5a802d362b03"},
}

type weaponProfileRepair struct {
	CardNumber string
	Profile    map[string]any
}

func weaponProfileBase(weaponType, category, ability, dice, damageType, defaultMode, mastery string, modes []map[string]any, properties []string, ammo any) map[string]any {
	return map[string]any{
		"weapon_type": weaponType, "proficiency_category": category, "attack_ability": ability,
		"damage_lines":        []map[string]any{{"dice": dice, "type": damageType}},
		"default_attack_mode": defaultMode, "attack_modes": modes, "properties": properties,
		"mastery_effect_id": mastery, "ammo": ammo,
		"enchantment": map[string]any{"attack_bonus": 0, "damage_bonus": 0, "extra_damage_lines": []any{}},
		"attunement":  map[string]any{"required": false},
	}
}

func liveWeaponProfileRepairs() []weaponProfileRepair {
	melee := []map[string]any{{"kind": "melee", "reach_ft": 5}}
	shortRange := []map[string]any{{"kind": "ranged", "normal_ft": 80, "long_ft": 320}}
	thrown := []map[string]any{{"kind": "melee", "reach_ft": 5}, {"kind": "ranged", "normal_ft": 20, "long_ft": 60}}
	const push = "651f4b6a-74c1-4ecf-a787-d98580bc9495"
	const vex = "2877d5fd-f912-4186-867d-53d353570ded"
	const nick = "c00b501c-2e9a-4f32-89e7-1c5ed898d7b2"
	const slow = "c7d07a67-374c-49f6-b34b-40e85c26674e"
	profiles := []weaponProfileRepair{
		{CardNumber: "CARD-0485", Profile: weaponProfileBase("greatsword", "martial", "str", "2d6", "slashing", "melee", push, melee, []string{"heavy", "two_handed"}, nil)},
		{CardNumber: "CARD-0490", Profile: weaponProfileBase("shortbow", "simple", "dex", "1d6", "piercing", "ranged", vex, shortRange, []string{"ammunition", "two_handed"}, map[string]any{"card_id": "59b10a1e-8669-4bf6-88a5-69d0abfc76a6", "name": "Стрелы"})},
		{CardNumber: "CARD-0492", Profile: weaponProfileBase("dagger", "simple", "finesse", "1d4", "piercing", "melee", nick, thrown, []string{"finesse", "light", "thrown"}, nil)},
		{CardNumber: "CARD-0564", Profile: weaponProfileBase("handaxe", "simple", "str", "1d6", "slashing", "melee", vex, thrown, []string{"light", "thrown"}, nil)},
		{CardNumber: "CARD-0567", Profile: weaponProfileBase("sickle", "simple", "str", "1d4", "slashing", "melee", nick, melee, []string{"light"}, nil)},
		{CardNumber: "CARD-0570", Profile: weaponProfileBase("light_crossbow", "simple", "dex", "1d8", "piercing", "ranged", slow, shortRange, []string{"ammunition", "two_handed"}, map[string]any{"card_id": "d70ecda9-36dc-4175-8a05-ccb91d4ce92f", "name": "Болты"})},
	}
	profiles[0].Profile["heavy"] = map[string]any{
		"minimum_ability_score": 13,
		"ability_by_mode":       map[string]any{"melee": "str", "ranged": "dex"},
		"consequence":           "attack_disadvantage",
	}
	return profiles
}

// normalizeLiveHappyPathContent materializes legacy display declarations at the
// catalog boundary. The strict rules runtime remains deliberately unable to
// infer weapon, spell-list, lineage, or inventory-consumption semantics.
func normalizeLiveHappyPathContent(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, lineage := range goliathLineageRepairs {
		effects, _ := json.Marshal([]string{lineage.EffectID})
		actions := []string{}
		if lineage.ActionID != "" {
			actions = append(actions, lineage.ActionID)
		}
		actionJSON, _ := json.Marshal(actions)
		_, err := tx.Exec(`
			INSERT INTO races (
				id, name, name_en, description, image_url, image_cloudinary_id,
				image_cloudinary_url, rarity, card_number, is_subrace, parent_race_id,
				subrace_level, related_effects, related_actions, support, type, author,
				source, tags, is_extended, created_at, updated_at
			)
			SELECT $1::uuid, $2, $3, $4, parent.image_url, parent.image_cloudinary_id,
				parent.image_cloudinary_url, parent.rarity, $5, TRUE, parent.id, 1,
				$6::jsonb, $7::jsonb,
				'{"status":"verified_partial","mechanics_locked":false,"note":"Legacy of Giants lineage normalized as an explicit subrace."}'::jsonb,
				parent.type, parent.author, parent.source, parent.tags, parent.is_extended, NOW(), NOW()
			FROM races parent
			WHERE parent.card_number = 'RACE-0011' AND parent.deleted_at IS NULL
			ON CONFLICT (card_number) DO UPDATE SET
				name = EXCLUDED.name, name_en = EXCLUDED.name_en,
				description = EXCLUDED.description, is_subrace = TRUE,
				parent_race_id = EXCLUDED.parent_race_id, subrace_level = 1,
				related_effects = EXCLUDED.related_effects,
				related_actions = EXCLUDED.related_actions, updated_at = NOW(), deleted_at = NULL
		`, lineage.ID, lineage.Name, lineage.NameEn, lineage.Description, lineage.CardNumber, string(effects), string(actionJSON))
		if err != nil {
			return fmt.Errorf("normalize %s: %w", lineage.CardNumber, err)
		}
	}

	for _, repair := range liveWeaponProfileRepairs() {
		profile, marshalErr := json.Marshal(repair.Profile)
		if marshalErr != nil {
			return marshalErr
		}
		if _, err := tx.Exec(`
			UPDATE cards
			SET mechanics = jsonb_set(COALESCE(mechanics, '{}'::jsonb), '{weapon_profile}', $2::jsonb, true),
				updated_at = NOW()
			WHERE card_number = $1 AND deleted_at IS NULL
			  AND COALESCE(mechanics->'weapon_profile', 'null'::jsonb) IS DISTINCT FROM $2::jsonb
		`, repair.CardNumber, string(profile)); err != nil {
			return fmt.Errorf("normalize %s weapon profile: %w", repair.CardNumber, err)
		}
	}

	if _, err := tx.Exec(`
		UPDATE cards
		SET mechanics = (COALESCE(mechanics, '{}'::jsonb) - 'uses') || jsonb_build_object(
			'activation',
			(COALESCE(mechanics->'activation', '{}'::jsonb) - 'consumes_self') || jsonb_build_object(
					'cost', CASE
						WHEN COALESCE(mechanics->'activation'->'cost', '[]'::jsonb)
							@> '[{"resource":"self_item"}]'::jsonb
						THEN COALESCE(mechanics->'activation'->'cost', '[]'::jsonb)
						ELSE COALESCE(mechanics->'activation'->'cost', '[]'::jsonb)
							|| '[{"resource":"self_item","amount":1}]'::jsonb
					END
				)
			), updated_at = NOW()
			WHERE card_number IN ('CARD-0839', 'CARD-0840', 'CARD-0841', 'CARD-0842')
			  AND deleted_at IS NULL
	`); err != nil {
		return fmt.Errorf("normalize potion self-item costs: %w", err)
	}

	if _, err := tx.Exec(`
		WITH spell_labels AS (
			SELECT s.id AS spell_id, lower(btrim(label.value)) AS label
			FROM spells s
			CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.classes::jsonb, '[]'::jsonb)) label(value)
			WHERE s.deleted_at IS NULL
			  AND s.mechanics IS NOT NULL
				  AND NOT (COALESCE(s.mechanics, '{}'::jsonb) ? 'spell_class_list_ids')
			  AND COALESCE(s.support->>'mechanics_locked', 'false') <> 'true'
			GROUP BY s.id, lower(btrim(label.value))
		), resolved AS (
			SELECT labels.spell_id,
				array_agg(DISTINCT c.card_number ORDER BY c.card_number) AS class_ids,
				count(DISTINCT labels.label) AS declared_count,
				count(DISTINCT c.card_number) AS resolved_count
			FROM spell_labels labels
			LEFT JOIN classes c ON c.deleted_at IS NULL
				AND COALESCE(c.is_subclass, FALSE) = FALSE
				AND (lower(btrim(c.name)) = labels.label OR lower(btrim(COALESCE(c.name_en, ''))) = labels.label)
			GROUP BY labels.spell_id
		)
		UPDATE spells s
		SET mechanics = jsonb_set(s.mechanics, '{spell_class_list_ids}', to_jsonb(resolved.class_ids), true),
			support = (COALESCE(s.support, '{}'::jsonb)
				- 'content_hash' - 'dependency_hash' - 'certified_at' - 'certification_version')
				|| jsonb_build_object(
						'status', COALESCE(s.support->>'status', 'verified_partial'),
					'mechanics_locked', false,
					'note', 'Legacy localized class lists normalized to stable class ids; certification must be refreshed.'
				),
			updated_at = NOW()
		FROM resolved
		WHERE s.id = resolved.spell_id
		  AND resolved.declared_count > 0
		  AND resolved.declared_count = resolved.resolved_count
	`); err != nil {
		return fmt.Errorf("normalize spell class identities: %w", err)
	}

	return tx.Commit()
}
