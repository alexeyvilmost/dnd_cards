package migrations

import (
	"database/sql"
	"fmt"
)

const levelFiveBaseProgressionRepairVersion = "179_repair_level_five_base_progression"

const levelFiveBaseProgressionSupport = `jsonb_build_object(
	'status','untested','certification_version',$1::text,'mechanics_locked',false,
	'note','Level 1-5 base progression repaired; retained-character browser verification required'
)`

type levelFiveSpellChoiceRepair struct {
	id, card, name, className, label string
	count                            int
}

var levelFiveSpellChoiceRepairs = []levelFiveSpellChoiceRepair{
	{"17900000-0000-4000-8000-000000000001", "caster-bard-spells-l5-bonus", "Заклинания барда: дополнительное заклинание 5 уровня", "бард", "prepared", 1},
	{"17900000-0000-4000-8000-000000000002", "caster-cleric-spells-l5-bonus", "Заклинания жреца: дополнительное заклинание 5 уровня", "жрец", "prepared", 1},
	{"17900000-0000-4000-8000-000000000003", "caster-druid-spells-l5-bonus", "Заклинания друида: дополнительное заклинание 5 уровня", "друид", "prepared", 1},
	{"17900000-0000-4000-8000-000000000004", "caster-sorcerer-spells-l4", "Заклинания чародея: заклинание 4 уровня", "чародей", "known", 1},
}

func levelFiveSpellChoiceMechanics(className, label string, count int) string {
	return fmt.Sprintf(`{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"id":"%s_spells_level_growth","kind":"choice","count":%d,"prompt":"Выберите %d заклинание","options":{"source":"spell","filter":{"classes":["%s"],"only_available_slots":true}},"grant":{"kind":"grant_spell","label":"%s"}}]}]}`,
		className, count, count, className, label)
}

func repairLevelFiveBaseProgression(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.Exec(`DROP TRIGGER IF EXISTS protect_actions_certified_mechanics ON actions; DROP TRIGGER IF EXISTS protect_effects_certified_mechanics ON effects;`); err != nil {
		return fmt.Errorf("unlock progression repair: %w", err)
	}

	// Bard, Cleric, and Druid grow 4/5/6/7/9 prepared spells. Their existing
	// recurring choice supplies one at levels 2-5, so level 5 needs one extra.
	// Sorcerer grows 2/4/6/7/9; replace its erroneous two-spell level-4 grant.
	for _, row := range levelFiveSpellChoiceRepairs {
		mechanics := levelFiveSpellChoiceMechanics(row.className, row.label, row.count)
		if _, err = tx.Exec(`
			INSERT INTO effects (id,name,name_en,description,card_number,effect_type,mechanics,source,support,updated_at)
			VALUES ($1::uuid,$2::text,$2::text,$2::text,$3::text,'passive',$4::jsonb,'PHB 2024',
			        jsonb_build_object('status','untested','certification_version',$5::text,'mechanics_locked',false),NOW())
			ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,
			  card_number=EXCLUDED.card_number,effect_type=EXCLUDED.effect_type,mechanics=EXCLUDED.mechanics,
			  source=EXCLUDED.source,updated_at=NOW()
		`, row.id, row.name, row.card, mechanics, levelFiveBaseProgressionRepairVersion); err != nil {
			return fmt.Errorf("upsert %s: %w", row.card, err)
		}
	}

	for _, classCard := range []string{"CLASS-bard", "CLASS-cleric", "CLASS-druid"} {
		var effectID string
		switch classCard {
		case "CLASS-bard":
			effectID = levelFiveSpellChoiceRepairs[0].id
		case "CLASS-cleric":
			effectID = levelFiveSpellChoiceRepairs[1].id
		default:
			effectID = levelFiveSpellChoiceRepairs[2].id
		}
		if _, err = tx.Exec(`UPDATE classes SET level_progression=jsonb_set(level_progression,'{5,effects}',
			CASE WHEN level_progression#>'{5,effects}' @> jsonb_build_array($1::text)
			THEN level_progression#>'{5,effects}' ELSE (level_progression#>'{5,effects}') || jsonb_build_array($1::text) END,true),updated_at=NOW()
			WHERE card_number=$2`, effectID, classCard); err != nil {
			return fmt.Errorf("append %s level-5 spell capacity: %w", classCard, err)
		}
	}
	if _, err = tx.Exec(`UPDATE classes SET level_progression=jsonb_set(level_progression,'{4,effects}',
		(SELECT jsonb_agg(CASE WHEN value='"89e369fe-34fa-4b48-b943-b44a2b59d330"'::jsonb THEN to_jsonb($1::text) ELSE value END)
		 FROM jsonb_array_elements(level_progression#>'{4,effects}')),true),updated_at=NOW() WHERE card_number='CLASS-sorcerer'`, levelFiveSpellChoiceRepairs[3].id); err != nil {
		return fmt.Errorf("replace Sorcerer level-4 spell growth: %w", err)
	}

	// Every recurring prepared-caster choice must use the prepared label.
	if _, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,0,result,0,grant,label}','"prepared"'::jsonb,true),updated_at=NOW()
		WHERE card_number IN ('caster-bard-spells','caster-cleric-spells','caster-druid-spells')`); err != nil {
		return fmt.Errorf("repair prepared labels: %w", err)
	}

	// 2024 Warlock invocations: 1 at L1, 3 at L2, 5 at L5. Include every
	// invocation currently materialized for this tier; L2 choices carry a gate.
	if _, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(jsonb_set(mechanics,'{effects,0,count_by_level}',
		'{"1":1,"2":3,"5":5}'::jsonb,true),'{effects,0,options,items}',
		'[{"id":"EFF-invoc-armor_of_shadows","name":"Доспех теней","value":"EFF-invoc-armor_of_shadows","minimum_class_level":1},{"id":"EFF-invoc-eldritch_mind","name":"Мистический разум","value":"EFF-invoc-eldritch_mind","minimum_class_level":1},{"id":"EFF-pact-blade","name":"Клинок","value":"EFF-pact-blade","minimum_class_level":1},{"id":"EFF-pact-chain","name":"Цепь","value":"EFF-pact-chain","minimum_class_level":1},{"id":"EFF-pact-tome","name":"Гримуар","value":"EFF-pact-tome","minimum_class_level":1},{"id":"EFF-invoc-agonizing_blast","name":"Мучительный залп","value":"EFF-invoc-agonizing_blast","minimum_class_level":2},{"id":"EFF-invoc-devils_sight","name":"Зрение исчадия","value":"EFF-invoc-devils_sight","minimum_class_level":2},{"id":"EFF-invoc-fiendish_vigor","name":"Бодрость исчадия","value":"EFF-invoc-fiendish_vigor","minimum_class_level":2},{"id":"EFF-invoc-mask_of_many_faces","name":"Маска многих лиц","value":"EFF-invoc-mask_of_many_faces","minimum_class_level":2}]'::jsonb,true),updated_at=NOW()
		WHERE card_number='EFF-eldritch-invocations'`); err != nil {
		return fmt.Errorf("repair Warlock invocation progression: %w", err)
	}

	if _, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,0,result,0,freeuse,count}','"prof_bonus"'::jsonb,true),updated_at=NOW() WHERE card_number='EFF-favored-enemy'`); err != nil {
		return fmt.Errorf("repair Favored Enemy uses: %w", err)
	}
	if _, err = tx.Exec(`UPDATE effects SET mechanics=jsonb_set(mechanics,'{effects,0,result,0,dice}','"class_level:rogue/2 d6"'::jsonb,true),updated_at=NOW() WHERE card_number='EFF-sneak-attack'`); err != nil {
		return fmt.Errorf("repair Sneak Attack scaling: %w", err)
	}
	if _, err = tx.Exec(`UPDATE actions SET mechanics=jsonb_set(jsonb_set(mechanics,'{uses,count}','3'::jsonb,true),'{effects,0,result,0,amount}','"1d10 + class_level:fighter"'::jsonb,true),updated_at=NOW() WHERE card_number='ACT-second-wind'`); err != nil {
		return fmt.Errorf("repair Second Wind: %w", err)
	}

	if _, err = tx.Exec(fmt.Sprintf(`UPDATE effects SET support=%s,updated_at=NOW() WHERE card_number IN ('caster-bard-spells','caster-cleric-spells','caster-druid-spells','caster-sorcerer-spells','caster-bard-spells-l5-bonus','caster-cleric-spells-l5-bonus','caster-druid-spells-l5-bonus','caster-sorcerer-spells-l4','EFF-eldritch-invocations','EFF-favored-enemy','EFF-sneak-attack')`, levelFiveBaseProgressionSupport), levelFiveBaseProgressionRepairVersion); err != nil {
		return err
	}
	if _, err = tx.Exec(fmt.Sprintf(`UPDATE actions SET support=%s,updated_at=NOW() WHERE card_number='ACT-second-wind'`, levelFiveBaseProgressionSupport), levelFiveBaseProgressionRepairVersion); err != nil {
		return err
	}

	var ready int
	if err = tx.QueryRow(`SELECT count(*) FROM effects WHERE
		(card_number='EFF-eldritch-invocations' AND mechanics#>>'{effects,0,count_by_level,5}'='5' AND jsonb_array_length(mechanics#>'{effects,0,options,items}')=9)
		OR (card_number='EFF-favored-enemy' AND mechanics#>>'{effects,0,result,0,freeuse,count}'='prof_bonus')
		OR (card_number='EFF-sneak-attack' AND mechanics#>>'{effects,0,result,0,dice}'='class_level:rogue/2 d6')
		OR card_number IN ('caster-bard-spells-l5-bonus','caster-cleric-spells-l5-bonus','caster-druid-spells-l5-bonus','caster-sorcerer-spells-l4')`).Scan(&ready); err != nil || ready != 7 {
		return fmt.Errorf("progression postconditions: ready=%d err=%v", ready, err)
	}

	if _, err = tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore mechanics guards: %w", err)
	}
	return tx.Commit()
}
