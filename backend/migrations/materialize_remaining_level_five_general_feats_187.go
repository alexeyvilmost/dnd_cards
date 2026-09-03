package migrations

import (
	"database/sql"
	"fmt"
)

const remainingLevelFiveGeneralFeatsVersion = "187_materialize_remaining_level_five_general_feats"

const polearmMasterButtMechanics = `{
  "activation":{"mode":"triggered","optional":true,"cost":[{"resource":"bonus_action","amount":1}],
    "trigger":{"events":["hit","miss"],"source_action_card_number":"action_basic_weapon",
      "feat_polearm_master_butt":true}},
  "targeting":{"domain":"actor","actor_targets":true,"shape":"single","range_ft":10,
    "min_targets":1,"max_targets":1,"requires_line_of_sight":true,"allowed_relations":["enemy"]},
  "effects":[{"resolution":"attack_roll","attack_kind":"weapon_melee","ability":"auto","vs":"ac",
    "who":"target","on_hit":[{"kind":"damage","dice":"1d4","type":"bludgeoning","ability":"auto"}]}]
}`

// materializeRemainingLevelFiveGeneralFeats closes the two last wholly
// unsupported General-feat rows without claiming browser certification.
// Mounted Combatant's board relation is consumed by the tactical adapter;
// Polearm Master additionally grants one data-owned post-Attack action.
func materializeRemainingLevelFiveGeneralFeats(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions;
		DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects`); err != nil {
		return fmt.Errorf("disable mechanics guards: %w", err)
	}

	if _, err = tx.Exec(`INSERT INTO actions
		(id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
		VALUES('18700000-0000-4000-8000-000000000001','Мастер древкового оружия: удар древком',
		'Polearm Master: Pole Strike',
		'После завершения действия Атака подходящим древковым оружием совершите Бонусным действием атаку другим концом: 1к4 дробящего урона.',
		'','common','ACT-general-polearm-master-butt','class_feature','feat','bonus_action',$1::jsonb,
		'System','PHB 2024',jsonb_build_object('status','untested','certification_version',$2::text,
		'mechanics_locked',false,'note','Exact weapon ownership and completed Attack timing are enforced; browser verification pending'))
		ON CONFLICT(card_number) DO UPDATE SET name=EXCLUDED.name,name_en=EXCLUDED.name_en,
		description=EXCLUDED.description,action_type=EXCLUDED.action_type,type=EXCLUDED.type,
		resource=EXCLUDED.resource,mechanics=EXCLUDED.mechanics,support=EXCLUDED.support,
		deleted_at=NULL,updated_at=NOW()`, polearmMasterButtMechanics, remainingLevelFiveGeneralFeatsVersion); err != nil {
		return fmt.Errorf("upsert Polearm Master butt action: %w", err)
	}

	type binding struct {
		featCard, effectCard, capability, note string
		actionCard                             *string
	}
	polearmAction := "ACT-general-polearm-master-butt"
	bindings := []binding{
		{
			featCard: "FEAT-0017", effectCard: "EFF-general-FEAT-0017",
			capability: "general_feat.mounted_combatant",
			note:       "Mounted Strike consumes an explicit larger allied mount relation; redirect and mount Evasion remain pending; browser verification required",
		},
		{
			featCard: "FEAT-0028", effectCard: "EFF-general-FEAT-0028",
			capability: "general_feat.polearm_master", actionCard: &polearmAction,
			note: "Pole Strike and the enter-reach reaction are executable from the held weapon profile; browser verification required",
		},
	}
	for _, row := range bindings {
		result, execErr := tx.Exec(`UPDATE effects SET
			mechanics=jsonb_set(mechanics,'{capabilities}',
				COALESCE(mechanics->'capabilities','[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',$1::text)),true),
			support=jsonb_build_object('status','untested','certification_version',$2::text,
				'mechanics_locked',false,'note',$3::text),updated_at=NOW()
			WHERE card_number=$4 AND deleted_at IS NULL
			AND NOT COALESCE(mechanics->'capabilities','[]'::jsonb)
				@> jsonb_build_array(jsonb_build_object('id',$1::text))`,
			row.capability, remainingLevelFiveGeneralFeatsVersion, row.note, row.effectCard)
		if execErr != nil {
			return fmt.Errorf("project %s capability: %w", row.effectCard, execErr)
		}
		if affected, _ := result.RowsAffected(); affected > 1 {
			return fmt.Errorf("project %s capability rows=%d, want at most 1", row.effectCard, affected)
		}
		if row.actionCard != nil {
			if _, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects}',
				COALESCE(mechanics->'effects','[]'::jsonb)||jsonb_build_array(
					jsonb_build_object('resolution','auto','result',jsonb_build_array(
						jsonb_build_object('kind','grant_action','value',$1::text)))),true),updated_at=NOW()
				WHERE card_number=$2 AND deleted_at IS NULL AND mechanics::text NOT LIKE ('%'||$1::text||'%')`,
				*row.actionCard, row.effectCard); err != nil {
				return fmt.Errorf("grant %s from %s: %w", *row.actionCard, row.effectCard, err)
			}
		}
		// Mechanics updates invoke the generic support invalidation trigger. Set
		// the truthful untested marker only after every capability/action grant,
		// including on an idempotent re-run where no mechanics bytes change.
		if _, err = tx.Exec(`UPDATE effects SET support=jsonb_build_object(
			'status','untested','certification_version',$1::text,'mechanics_locked',false,'note',$2::text),
			updated_at=NOW() WHERE card_number=$3 AND deleted_at IS NULL`,
			remainingLevelFiveGeneralFeatsVersion, row.note, row.effectCard); err != nil {
			return fmt.Errorf("refresh %s support: %w", row.effectCard, err)
		}
		if _, err = tx.Exec(`UPDATE feats SET support=jsonb_build_object(
			'status','untested','certification_version',$1::text,'mechanics_locked',false,'note',$2::text),
			updated_at=NOW() WHERE card_number=$3 AND deleted_at IS NULL`,
			remainingLevelFiveGeneralFeatsVersion, row.note, row.featCard); err != nil {
			return fmt.Errorf("refresh %s support: %w", row.featCard, err)
		}
	}

	var mounted, polearm, action int
	if err = tx.QueryRow(`SELECT
		(SELECT count(*) FROM effects WHERE card_number='EFF-general-FEAT-0017' AND deleted_at IS NULL
			AND mechanics@>'{"capabilities":[{"id":"general_feat.mounted_combatant"}]}'::jsonb
			AND support->>'status'='untested' AND support->>'certification_version'=$1),
		(SELECT count(*) FROM effects WHERE card_number='EFF-general-FEAT-0028' AND deleted_at IS NULL
			AND mechanics@>'{"capabilities":[{"id":"general_feat.polearm_master"}]}'::jsonb
			AND mechanics::text LIKE '%ACT-general-polearm-master-butt%'
			AND support->>'status'='untested' AND support->>'certification_version'=$1),
		(SELECT count(*) FROM actions WHERE card_number='ACT-general-polearm-master-butt' AND deleted_at IS NULL
			AND mechanics#>>'{activation,trigger,feat_polearm_master_butt}'='true'
			AND support->>'status'='untested' AND support->>'certification_version'=$1)`,
		remainingLevelFiveGeneralFeatsVersion).Scan(&mounted, &polearm, &action); err != nil {
		return fmt.Errorf("verify remaining General feats: %w", err)
	}
	if mounted != 1 || polearm != 1 || action != 1 {
		return fmt.Errorf("remaining General-feat rows mounted=%d polearm=%d action=%d, want 1/1/1", mounted, polearm, action)
	}
	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
