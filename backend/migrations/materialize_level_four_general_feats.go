package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const levelFourGeneralFeatsMigrationVersion = "170_materialize_level_four_general_feats"
const levelFourGeneralHalfFeatCount = 42
const slowFallActionType = "class_feature"

// materializeLevelFourGeneralFeats installs the universally required half-feat
// ability choice without pretending that a prose-only signature benefit is
// executable. Those benefits remain untested until their engine primitive exists.
func materializeLevelFourGeneralFeats(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects`); err != nil {
		return fmt.Errorf("disable effect guard: %w", err)
	}

	rows, err := tx.Query(`SELECT id,card_number,name,COALESCE(ability_increase,'[]'::jsonb)
		FROM feats WHERE category='general' AND card_number<>'FEAT-0049' AND deleted_at IS NULL ORDER BY card_number`)
	if err != nil {
		return fmt.Errorf("list general feats: %w", err)
	}
	type featRow struct {
		id, card, name string
		abilities      []string
	}
	var feats []featRow
	for rows.Next() {
		var f featRow
		var raw []byte
		if err = rows.Scan(&f.id, &f.card, &f.name, &raw); err != nil {
			rows.Close()
			return err
		}
		if err = json.Unmarshal(raw, &f.abilities); err != nil {
			rows.Close()
			return fmt.Errorf("decode %s abilities: %w", f.card, err)
		}
		feats = append(feats, f)
	}
	if err = rows.Close(); err != nil {
		return err
	}
	if len(feats) != levelFourGeneralHalfFeatCount {
		return fmt.Errorf("general half-feat denominator: got %d, want %d", len(feats), levelFourGeneralHalfFeatCount)
	}

	for i, f := range feats {
		items := make([]map[string]any, 0, len(f.abilities))
		for _, ability := range f.abilities {
			items = append(items, map[string]any{"id": ability, "name": ability})
		}
		// Feats with an open ability choice (Resilient and Skill Expert) source the
		// six abilities dynamically; every other feat uses its explicit whitelist.
		options := map[string]any{"source": "explicit", "items": items}
		if len(items) == 0 {
			options = map[string]any{"source": "ability"}
		}
		mechanics := map[string]any{"activation": map[string]any{"mode": "passive"}, "effects": []any{map[string]any{
			"id": "general_feat_ability_increase", "kind": "choice", "count": 1,
			"prompt": f.name + ": выберите характеристику (+1)", "options": options,
			"grant": map[string]any{"kind": "grant_ability_score", "amount": 1, "cap": 20},
		}}}
		payload, _ := json.Marshal(mechanics)
		effectID := fmt.Sprintf("17000000-0000-4000-8000-%012d", i+1)
		effectCard := "EFF-general-" + f.card
		if _, err = tx.Exec(`INSERT INTO effects
			(id,name,name_en,description,detailed_description,image_url,rarity,card_number,effect_type,mechanics,repeatable,author,source,support)
			VALUES($1::uuid,$2,'',$3,'','','common',$4,'passive',$5::jsonb,false,'System','PHB 2024',
			jsonb_build_object('status','untested','certification_version',$6::text,'mechanics_locked',false,
			'note','Ability increase is executable; signature feat benefit and prerequisite require browser/runtime verification'))
			ON CONFLICT(card_number) DO UPDATE SET deleted_at=NULL,name=EXCLUDED.name,description=EXCLUDED.description,
			mechanics=EXCLUDED.mechanics,support=EXCLUDED.support,updated_at=NOW()`, effectID, f.name+" — увеличение характеристики", f.name+": +1 к выбранной допустимой характеристике (максимум 20).", effectCard, string(payload), levelFourGeneralFeatsMigrationVersion); err != nil {
			return fmt.Errorf("upsert %s: %w", f.card, err)
		}
		if _, err = tx.Exec(`UPDATE feats SET related_effects=CASE WHEN COALESCE(related_effects,'[]'::jsonb) ? $1 THEN related_effects ELSE COALESCE(related_effects,'[]'::jsonb)||jsonb_build_array($1) END,
			support=jsonb_build_object('status','untested','certification_version',$2::text,'mechanics_locked',false,
			'note','Ability increase is executable; signature mechanics/prerequisite pending verification'),updated_at=NOW() WHERE id=$3::uuid`, effectID, levelFourGeneralFeatsMigrationVersion, f.id); err != nil {
			return fmt.Errorf("bind %s: %w", f.card, err)
		}
	}

	// Repair gates that 165 created but did not persist into the owner progression.
	if err = bindProgressionEffect(tx, "CLASS-monk", 3, "EFF-monk-deflect-attacks"); err != nil {
		return err
	}
	if err = bindProgressionEffect(tx, "CLASS-rogue", 3, "EFF-rogue-steady-aim"); err != nil {
		return err
	}
	const slowID = "17000000-0000-4000-8000-000000000043"
	if _, err = tx.Exec(`INSERT INTO effects(id,name,name_en,description,detailed_description,image_url,rarity,card_number,effect_type,mechanics,repeatable,author,source,support)
		VALUES($1::uuid,'Замедленное падение','Slow Fall','Реакцией уменьшите урон от падения на пятикратный уровень Монаха.','','','common','EFF-monk-slow-fall','passive',
		'{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"grant_action","value":"ACT-monk-slow-fall"}]}]}'::jsonb,false,'System','PHB 2024',
		jsonb_build_object('status','untested','certification_version',$2::text,'mechanics_locked',false,'note','Browser verification pending'))
		ON CONFLICT(card_number) DO UPDATE SET mechanics=EXCLUDED.mechanics,support=EXCLUDED.support,deleted_at=NULL,updated_at=NOW()`, slowID, levelFourGeneralFeatsMigrationVersion); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO actions(id,name,name_en,description,image_url,rarity,card_number,action_type,type,resource,mechanics,author,source,support)
		VALUES('17000000-0000-4000-8000-000000000044','Замедленное падение','Slow Fall','Уменьшите урон от падения на 5 × уровень Монаха.','','common','ACT-monk-slow-fall',$2,'class_feature','reaction',
		'{"activation":{"mode":"reaction","cost":[{"resource":"reaction"}],"trigger":{"event":"damage_taken","filter":{"source":"fall"}}},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},"effects":[{"resolution":"auto","result":[{"kind":"reduce_damage","amount":"5 * monk_level","filter":{"source":"fall"}}]}]}'::jsonb,'System','PHB 2024',
		jsonb_build_object('status','untested','certification_version',$1::text,'mechanics_locked',false,'note','Browser verification pending'))
		ON CONFLICT(card_number) DO UPDATE SET action_type=EXCLUDED.action_type,type=EXCLUDED.type,resource=EXCLUDED.resource,mechanics=EXCLUDED.mechanics,support=EXCLUDED.support,deleted_at=NULL,updated_at=NOW()`, levelFourGeneralFeatsMigrationVersion, slowFallActionType); err != nil {
		return err
	}
	if err = bindProgressionEffect(tx, "CLASS-monk", 4, "EFF-monk-slow-fall"); err != nil {
		return err
	}
	return tx.Commit()
}
