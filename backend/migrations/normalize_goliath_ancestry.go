package migrations

import "database/sql"

// normalizeGoliathAncestry restores the data-owned Giant Ancestry choice. The
// UI already understands ordinary parent/subrace relationships and action
// grants, so this migration deliberately contains no character-specific code.
func normalizeGoliathAncestry(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Certified rows may only be changed by an audited migration. Reinstall the
	// mechanics-only locks after replacing the malformed legacy declarations.
	// Keep the trigger changes and content rewrite in one transaction so a
	// malformed data declaration can never leave certified mechanics unlocked.
	if _, err = tx.Exec(`
		DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;
	`); err != nil {
		return err
	}

	if _, err = tx.Exec(`
		UPDATE effects SET mechanics = '{
		  "activation":{"mode":"passive"},
		  "effects":[{"resolution":"auto","result":[
		    {"kind":"resource","op":"grant","id":"giant_legacy","amount":"prof_bonus"},
		    {"kind":"narrative","description":"Наследие великанов: число применений равно бонусу мастерства; восстанавливается после продолжительного отдыха."}
		  ]}]
		}'::jsonb, support = NULL, updated_at = NOW()
		WHERE card_number = 'RE-goliath-1' AND deleted_at IS NULL;

		UPDATE actions SET mechanics = '{
		  "activation":{"mode":"triggered","optional":true,"trigger":{"event":"hit","timing":"during"},"cost":[{"resource":"giant_legacy","amount":1}]},
		  "targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":600,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]},
		  "effects":[{"resolution":"auto","who":"target","result":[{"kind":"damage","dice":"1d10","type":"fire","ability":"none"}]}]
		}'::jsonb, resource = 'giant_legacy', support = NULL, updated_at = NOW()
		WHERE card_number = 'ACT-goliath-fire' AND deleted_at IS NULL;

		UPDATE actions SET mechanics = '{
		  "activation":{"mode":"triggered","optional":true,"trigger":{"event":"hit","timing":"during"},"cost":[{"resource":"giant_legacy","amount":1}]},
		  "targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":600,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]},
		  "effects":[{"resolution":"auto","who":"target","result":[
		    {"kind":"damage","dice":"1d6","type":"cold","ability":"none"},
		    {"kind":"modifier","applies_to":{"roll":"speed"},"op":"add","value":"-10","duration":{"type":"until_start_of_source_next_turn"}}
		  ]}]
		}'::jsonb, resource = 'giant_legacy', support = NULL, updated_at = NOW()
		WHERE card_number = 'ACT-goliath-frost' AND deleted_at IS NULL;

		UPDATE actions SET mechanics = '{
		  "activation":{"mode":"triggered","optional":true,"trigger":{"event":"hit","timing":"during"},"cost":[{"resource":"giant_legacy","amount":1}]},
		  "targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":600,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]},
		  "effects":[{"resolution":"auto","who":"target","result":[{"kind":"condition","value":"prone"}]}]
		}'::jsonb, resource = 'giant_legacy', support = NULL, updated_at = NOW()
		WHERE card_number = 'ACT-goliath-hill' AND deleted_at IS NULL;

		UPDATE actions SET mechanics = '{
		  "activation":{"mode":"active","cost":[{"resource":"bonus_action","amount":1},{"resource":"giant_legacy","amount":1}]},
		  "targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},
		  "effects":[{"resolution":"auto","result":[{"kind":"movement","mode":"teleport","distance":30}]}]
		}'::jsonb, resource = 'bonus_action,giant_legacy', support = NULL, updated_at = NOW()
		WHERE card_number = 'ACT-goliath-cloud' AND deleted_at IS NULL;

		UPDATE actions SET mechanics = '{
		  "activation":{"mode":"reaction","trigger":{"event":"damage_taken"},"cost":[{"resource":"reaction","amount":1},{"resource":"giant_legacy","amount":1}]},
		  "targeting":{"domain":"actor","actor_targets":true,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},
		  "effects":[{"resolution":"auto","result":[{"kind":"reduce_damage","amount":"1d12+con"}]}]
		}'::jsonb, resource = 'reaction,giant_legacy', support = NULL, updated_at = NOW()
		WHERE card_number = 'ACT-goliath-stone' AND deleted_at IS NULL;

		UPDATE actions SET mechanics = '{
		  "activation":{"mode":"reaction","trigger":{"event":"damage_taken"},"cost":[{"resource":"reaction","amount":1},{"resource":"giant_legacy","amount":1}]},
		  "targeting":{"domain":"actor","actor_targets":true,"shape":"single","min_targets":1,"max_targets":1,"range_ft":60,"requires_line_of_sight":true,"allowed_relations":["enemy","neutral"]},
		  "effects":[{"resolution":"auto","who":"target","result":[{"kind":"damage","dice":"1d8","type":"thunder","ability":"none"}]}]
		}'::jsonb, resource = 'reaction,giant_legacy', support = NULL, updated_at = NOW()
		WHERE card_number = 'ACT-goliath-storm' AND deleted_at IS NULL;

		INSERT INTO actions (
			id, name, description, image_url, rarity, card_number, action_type,
			type, resource, mechanics, author, source
		) VALUES (
			'10900000-0000-4000-8000-000000000001', 'Каменная стойкость',
			'Получив урон, используйте реакцию и заряд Наследия великанов, чтобы уменьшить полученный урон на 1к12 + модификатор Телосложения.',
			'', 'common', 'ACT-goliath-stone', 'class_feature', 'species', 'reaction,giant_legacy',
			'{
			  "activation":{"mode":"reaction","trigger":{"event":"damage_taken"},"cost":[{"resource":"reaction","amount":1},{"resource":"giant_legacy","amount":1}]},
			  "targeting":{"domain":"actor","actor_targets":true,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},
			  "effects":[{"resolution":"auto","result":[{"kind":"reduce_damage","amount":"1d12+con"}]}]
			}'::jsonb, 'System', 'PHB 2024'
		)
		ON CONFLICT (card_number) DO UPDATE SET
			deleted_at = NULL, name = EXCLUDED.name, description = EXCLUDED.description,
			mechanics = EXCLUDED.mechanics, resource = EXCLUDED.resource,
			support = NULL, updated_at = NOW();

	`); err != nil {
		return err
	}
	if err = bindGoliathCanonicalLineages(tx); err != nil {
		return err
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return err
	}
	return tx.Commit()
}
