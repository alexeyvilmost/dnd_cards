package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const miniMVPSpellClarityMigrationVersion = "136_repair_mini_mvp_spell_clarity"

type miniMVPSpellIdentity struct {
	id, card string
}

var miniMVPSpellClarityIdentities = []miniMVPSpellIdentity{
	{"73d4195c-5da4-444d-a0c1-19572df641b2", "SPELL-0202"},
	{"7f7d92ed-0d5c-4567-990b-3395247b9266", "SPELL-0204"},
	{"bdeda1c3-6574-4946-8b91-5faf0f76072c", "SPELL-0205"},
	{"25d868ad-0714-4fce-b5b2-2931dd5646bc", "detect_magic"},
	{"bc90dc67-8fac-41b8-b3bf-a1e218013929", "SPELL-0269"},
	{"f0256294-e692-4695-8e29-d8288139a7ad", "SPELL-0314"},
	{"656f3c28-9fdd-44c7-88df-ce032a501e52", "SPELL-0318"},
}

func chromaticOrbDamageChoice() map[string]any {
	types := []struct{ id, name string }{
		{"thunder", "Звук"}, {"acid", "Кислота"}, {"fire", "Огонь"},
		{"cold", "Холод"}, {"lightning", "Электричество"}, {"poison", "Яд"},
	}
	items := make([]any, 0, len(types))
	for _, damageType := range types {
		items = append(items, map[string]any{
			"id": damageType.id, "name": damageType.name,
			"grants": []any{map[string]any{
				"kind": "damage", "dice": "3d8", "type": damageType.id,
				"scaling": map[string]any{"dice": "1d8", "per": "spell_slot_above"},
			}},
		})
	}
	return map[string]any{
		"kind": "choice", "id": "chromatic_orb_damage_type", "context": "in_play",
		"prompt": "Выберите тип урона", "count": 1,
		"options": map[string]any{"source": "explicit", "items": items},
	}
}

func repairMiniMVPSpellClarity(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, identity := range miniMVPSpellClarityIdentities {
		var matches, exact int
		if err := tx.QueryRow(`
			SELECT count(*), count(*) FILTER (WHERE id=$1::uuid AND card_number=$2)
			FROM spells WHERE deleted_at IS NULL AND (id=$1::uuid OR card_number=$2)
		`, identity.id, identity.card).Scan(&matches, &exact); err != nil {
			return fmt.Errorf("inspect %s identity: %w", identity.card, err)
		}
		if matches != 1 || exact != 1 {
			return fmt.Errorf("%s stable identity drifted: matching_rows=%d exact_rows=%d", identity.card, matches, exact)
		}
	}
	if _, err := tx.Exec(`DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells`); err != nil {
		return fmt.Errorf("disable spell certification guard: %w", err)
	}

	classLists := map[string][]string{
		"SPELL-0202": {"CLASS-bard", "CLASS-sorcerer", "CLASS-warlock", "CLASS-wizard"},
		"SPELL-0204": {"CLASS-bard", "CLASS-druid"},
		"SPELL-0205": {"CLASS-bard"},
	}
	for card, classIDs := range classLists {
		encoded, encodeErr := json.Marshal(classIDs)
		if encodeErr != nil {
			return fmt.Errorf("encode %s class list: %w", card, encodeErr)
		}
		if _, err := tx.Exec(`
			UPDATE spells SET mechanics=jsonb_set(mechanics,'{spell_class_list_ids}',$2::jsonb,true)
			WHERE card_number=$1 AND deleted_at IS NULL
		`, card, encoded); err != nil {
			return fmt.Errorf("repair %s class list: %w", card, err)
		}
	}

	if _, err := tx.Exec(`
		UPDATE spells SET mechanics=jsonb_set(
			mechanics,'{effects,0,result,0,description}',to_jsonb($2::text),false
		) WHERE id=$1::uuid AND card_number='detect_magic' AND deleted_at IS NULL
	`, "25d868ad-0714-4fce-b5b2-2931dd5646bc",
		"До 10 минут (концентрация) вы ощущаете магию в пределах 30 футов. Для видимой магической ауры показывается школа магии; камень, металл, свинец, дерево или земля достаточной толщины могут блокировать обнаружение."); err != nil {
		return fmt.Errorf("repair Detect Magic explanation: %w", err)
	}
	if _, err := tx.Exec(`
		UPDATE spells SET mechanics=jsonb_set(
			mechanics,'{effects,0,result}',
			jsonb_build_array(jsonb_build_object(
				'kind','narrative','description',
				'До 10 минут (концентрация) вы можете совершать Рывок бонусным действием. В пошаговом бою расход бонусного действия пока отмечается вручную.'
			)),true
		) WHERE id=$1::uuid AND card_number='SPELL-0269' AND deleted_at IS NULL
	`, "bc90dc67-8fac-41b8-b3bf-a1e218013929"); err != nil {
		return fmt.Errorf("repair Expeditious Retreat journal: %w", err)
	}
	if _, err := tx.Exec(`
		UPDATE spells SET mechanics=jsonb_set(
			mechanics,'{effects,0,result}',(mechanics #> '{effects,0,result}') - 2,true
		) WHERE id=$1::uuid AND card_number='SPELL-0318' AND deleted_at IS NULL
	`, "656f3c28-9fdd-44c7-88df-ce032a501e52"); err != nil {
		return fmt.Errorf("remove stale Shield of Faith instruction: %w", err)
	}
	chromaticChoice, err := json.Marshal(chromaticOrbDamageChoice())
	if err != nil {
		return fmt.Errorf("encode Chromatic Orb damage choice: %w", err)
	}
	if _, err := tx.Exec(`
		UPDATE spells SET mechanics=jsonb_set(
			mechanics,'{effects,0,on_hit,0}',$2::jsonb,false
		) WHERE id=$1::uuid AND card_number='SPELL-0314' AND deleted_at IS NULL
	`, "f0256294-e692-4695-8e29-d8288139a7ad", chromaticChoice); err != nil {
		return fmt.Errorf("repair Chromatic Orb damage choice: %w", err)
	}
	if _, err := tx.Exec(`
		UPDATE spells SET support=jsonb_build_object(
			'status','untested','certification_version',$1::text,'mechanics_locked',false,
			'limitations',jsonb_build_array('Требуется повторная браузерная проверка.'),
			'note','Исправлены данные доступа или ясность результата заклинания.'
		), updated_at=NOW()
		WHERE card_number=ANY($2::text[]) AND deleted_at IS NULL
	`, miniMVPSpellClarityMigrationVersion,
		[]string{"SPELL-0202", "SPELL-0204", "SPELL-0205", "detect_magic", "SPELL-0269", "SPELL-0314", "SPELL-0318"}); err != nil {
		return fmt.Errorf("reset repaired spell certifications: %w", err)
	}
	if _, err := tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
