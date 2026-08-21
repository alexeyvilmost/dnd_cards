package migrations

import "database/sql"

// certifiedContentMechanicsOnlyLockDDL narrows certification protection to the
// mechanics JSON itself. Descriptive fields and images remain ordinary content
// and can evolve without falsifying the tested rules contract.
const certifiedContentMechanicsOnlyLockDDL = `
CREATE OR REPLACE FUNCTION protect_certified_content_mechanics()
RETURNS TRIGGER AS $$
BEGIN
    IF COALESCE(OLD.support->>'mechanics_locked', 'false') <> 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'certified content mechanics are locked'
            USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(NEW.support->>'mechanics_locked', 'false') <> 'true' THEN
        RAISE EXCEPTION 'certified content mechanics lock cannot be removed'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.mechanics IS DISTINCT FROM OLD.mechanics THEN
        RAISE EXCEPTION 'certified content mechanics cannot be changed'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
CREATE TRIGGER protect_actions_certified_mechanics
    BEFORE UPDATE OR DELETE ON actions
    FOR EACH ROW EXECUTE FUNCTION protect_certified_content_mechanics();
DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
CREATE TRIGGER protect_effects_certified_mechanics
    BEFORE UPDATE OR DELETE ON effects
    FOR EACH ROW EXECUTE FUNCTION protect_certified_content_mechanics();
DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells;
CREATE TRIGGER protect_spells_certified_mechanics
    BEFORE UPDATE OR DELETE ON spells
    FOR EACH ROW EXECUTE FUNCTION protect_certified_content_mechanics();
`

func splitWeaponActionsAndUnlockMetadata(db *sql.DB) error {
	// This policy migration is the explicit authority that may replace the old
	// all-column trigger and repair the two previously certified action rows.
	if _, err := db.Exec(`
		DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
		DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells;
	`); err != nil {
		return err
	}

	if _, err := db.Exec(`
		UPDATE actions
		SET name = 'Рукопашная атака оружием',
			description = 'Атака надетым оружием в рукопашном режиме. Боеприпасы не требуются и не расходуются.',
			mechanics = '{
			  "primitive":{"type":"weapon_attack"},
			  "name":"Рукопашная атака оружием",
			  "activation":{"mode":"active","cost":[{"resource":"action"}]},
			  "effects":[{"resolution":"attack_roll","attack_kind":"weapon_melee","ability":"auto","vs":"ac","on_hit":[{"kind":"damage","dice":"weapon","type":"weapon","ability":"auto"}]}],
			  "targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":600,"requires_line_of_sight":true,"allowed_relations":["ally","enemy","neutral"]}
			}'::jsonb,
			support = NULL,
			updated_at = NOW()
		WHERE card_number = 'action_basic_weapon' AND deleted_at IS NULL;

		UPDATE actions
		SET mechanics = jsonb_set(
			mechanics,
			'{activation,cost}',
			COALESCE((
				SELECT jsonb_agg(entry)
				FROM jsonb_array_elements(mechanics->'activation'->'cost') AS entry
				WHERE entry->>'resource' <> 'equipped_weapon_ammo'
			), '[]'::jsonb),
			true
		), support = NULL, updated_at = NOW()
		WHERE card_number = 'action_basic_offhand' AND deleted_at IS NULL;

		INSERT INTO actions (
			id, name, name_en, description, image_url, rarity, card_number,
			action_type, type, resource, mechanics, author, source
		) VALUES (
			'10800000-0000-4000-8000-000000000001',
			'Дальнобойная атака оружием',
			'Ranged Weapon Attack',
			'Атака надетым оружием в дальнобойном режиме. Боеприпас расходуется только если он объявлен профилем оружия.',
			'/icons/actions/ranged_weapon_attack.png', 'common',
			'action_basic_weapon_ranged', 'base_action', 'basic', 'action',
			'{
			  "primitive":{"type":"weapon_attack"},
			  "name":"Дальнобойная атака оружием",
			  "activation":{"mode":"active","cost":[{"resource":"action"},{"resource":"equipped_weapon_ammo","amount":1}]},
			  "effects":[{"resolution":"attack_roll","attack_kind":"weapon_ranged","ability":"auto","vs":"ac","on_hit":[{"kind":"damage","dice":"weapon","type":"weapon","ability":"auto"}]}],
			  "targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":600,"requires_line_of_sight":true,"allowed_relations":["ally","enemy","neutral"]}
			}'::jsonb,
			'System', 'PHB 2024; micro-MVP L1 overlay canonical entity v1'
		)
		ON CONFLICT (card_number) DO UPDATE SET
			deleted_at = NULL,
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			image_url = EXCLUDED.image_url,
			name_en = EXCLUDED.name_en,
			action_type = EXCLUDED.action_type,
			type = EXCLUDED.type,
			resource = EXCLUDED.resource,
			source = EXCLUDED.source,
			mechanics = EXCLUDED.mechanics,
			support = NULL,
			updated_at = NOW();
	`); err != nil {
		return err
	}

	_, err := db.Exec(certifiedContentMechanicsOnlyLockDDL)
	return err
}
