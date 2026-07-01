package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

// skillLabelToID — русские названия навыков → id (PHB 2024).
var skillLabelToID = map[string]string{
	"Акробатика": "acrobatics", "Уход за животными": "animal_handling", "Магия": "arcana",
	"Атлетика": "athletics", "Обман": "deception", "История": "history",
	"Проницательность": "insight", "Запугивание": "intimidation", "Расследование": "investigation",
	"Медицина": "medicine", "Природа": "nature", "Восприятие": "perception",
	"Выступление": "performance", "Убеждение": "persuasion", "Религия": "religion",
	"Ловкость рук": "sleight_of_hand", "Скрытность": "stealth", "Выживание": "survival",
}

func normalizeSkillArray(raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return raw, nil
	}
	var items []string
	if err := json.Unmarshal(raw, &items); err != nil {
		return raw, err
	}
	out := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, s := range items {
		id := s
		if mapped, ok := skillLabelToID[s]; ok {
			id = mapped
		}
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return json.Marshal(out)
}

func upsertEffect(db *sql.DB, cardNumber, name, description, effectType, mechanics string) (string, error) {
	var id string
	err := db.QueryRow(`SELECT id::text FROM effects WHERE card_number = $1 AND deleted_at IS NULL`, cardNumber).Scan(&id)
	if err == sql.ErrNoRows {
		err = db.QueryRow(`
			INSERT INTO effects (name, description, card_number, rarity, effect_type, mechanics, author)
			VALUES ($1, $2, $3, 'common', $4, $5::jsonb, 'Admin')
			RETURNING id::text`,
			name, description, cardNumber, effectType, mechanics,
		).Scan(&id)
		return id, err
	}
	if err != nil {
		return "", err
	}
	_, err = db.Exec(`
		UPDATE effects SET name = $1, description = $2, effect_type = $3, mechanics = $4::jsonb, updated_at = NOW()
		WHERE card_number = $5 AND deleted_at IS NULL`,
		name, description, effectType, mechanics, cardNumber,
	)
	return id, err
}

func upsertAction(db *sql.DB, cardNumber, name, description, actionType, mechanics string) (string, error) {
	var id string
	err := db.QueryRow(`SELECT id::text FROM actions WHERE card_number = $1 AND deleted_at IS NULL`, cardNumber).Scan(&id)
	if err == sql.ErrNoRows {
		err = db.QueryRow(`
			INSERT INTO actions (name, description, card_number, rarity, action_type, resource, mechanics, author)
			VALUES ($1, $2, $3, 'common', $4, 'bonus_action', $5::jsonb, 'Admin')
			RETURNING id::text`,
			name, description, cardNumber, actionType, mechanics,
		).Scan(&id)
		return id, err
	}
	if err != nil {
		return "", err
	}
	_, err = db.Exec(`
		UPDATE actions SET name = $1, description = $2, action_type = $3, mechanics = $4::jsonb, updated_at = NOW()
		WHERE card_number = $5 AND deleted_at IS NULL`,
		name, description, actionType, mechanics, cardNumber,
	)
	return id, err
}

func linkClassProgression(db *sql.DB, classCardNumber string, progressionJSON string) error {
	_, err := db.Exec(`
		UPDATE classes SET level_progression = $1::jsonb, updated_at = NOW()
		WHERE card_number = $2 AND deleted_at IS NULL`, progressionJSON, classCardNumber)
	return err
}

func linkFeatEffect(db *sql.DB, featNameLike, effectID string) error {
	_, err := db.Exec(`
		UPDATE feats SET related_effects = jsonb_build_array($1::text), updated_at = NOW()
		WHERE name ILIKE $2 AND deleted_at IS NULL`, effectID, featNameLike)
	return err
}

// seedForgeMVPContent — Фаза E: умения L1 классов, эффекты черт, нормализация навыков предысторий.
func seedForgeMVPContent(db *sql.DB) error {
	secondWindMech := `{
		"activation": {"mode": "active", "cost": [{"resource": "bonus_action"}]},
		"uses": {"count": 2, "per": "short_rest"},
		"effects": [{"resolution": "auto", "result": [{"kind": "healing", "amount": "1d10 + self_level"}]}]
	}`
	fightingStyleMech := `{
		"activation": {"mode": "passive"},
		"effects": [{
			"kind": "choice",
			"id": "fighter_fighting_style",
			"prompt": "Выберите боевой стиль",
			"count": 1,
			"options": {
				"source": "explicit",
				"items": [
					{"id": "archery", "name": "Стрельба", "grants": [{"kind": "narrative", "description": "+2 к броскам атаки дальним оружием"}]},
					{"id": "defense", "name": "Защита", "grants": [{"kind": "narrative", "description": "+1 КД в доспехе"}]},
					{"id": "dueling", "name": "Дуэль", "grants": [{"kind": "narrative", "description": "+2 урона одноручным оружием"}]},
					{"id": "great_weapon", "name": "Большое оружие", "grants": [{"kind": "narrative", "description": "Переброс 1–2 на уроне двуручным"}]},
					{"id": "protection", "name": "Охрана", "grants": [{"kind": "narrative", "description": "Помеха атаке по союзнику"}]},
					{"id": "two_weapon", "name": "Сражение двумя оружиями", "grants": [{"kind": "narrative", "description": "Модификатор к урону второй рукой"}]}
				]
			},
			"resolution": "on_acquire"
		}]
	}`
	spellcastingMech := `{
		"activation": {"mode": "passive"},
		"effects": [
			{"resolution": "auto", "result": [
				{"kind": "narrative", "description": "Подготовка заклинаний из книги заклинаний. INT — характеристика заклинаний."}
			]},
			{
				"kind": "choice",
				"id": "wizard_cantrips",
				"prompt": "Выберите 3 заговора волшебника",
				"count": 3,
				"options": {"source": "spell", "filter": {"classes": ["wizard"], "levels": [0]}},
				"grant": {"kind": "grant_spell", "label": "cantrip"},
				"resolution": "on_acquire"
			},
			{
				"kind": "choice",
				"id": "wizard_spellbook_level_1",
				"prompt": "Выберите 6 заклинаний 1 уровня в книгу заклинаний",
				"count": 6,
				"options": {"source": "spell", "filter": {"classes": ["wizard"], "levels": [1]}},
				"grant": {"kind": "grant_spell", "label": "spellbook"},
				"resolution": "on_acquire"
			}
		]
	}`
	arcaneRecoveryMech := `{
		"activation": {"mode": "triggered", "trigger": {"event": "short_rest", "timing": "during"}},
		"effects": [{"resolution": "auto", "result": [
			{"kind": "narrative", "description": "Восстановите ячейки суммарным уровнем ≤ половины уровня волшебника (мин. 1)."}
		]}]
	}`
	skilledMech := `{
		"activation": {"mode": "passive"},
		"effects": [{
			"kind": "choice",
			"id": "feat_skilled",
			"prompt": "Выберите 3 навыка или инструмента",
			"count": 3,
			"options": {"source": "skill", "filter": "all"},
			"grant": {"kind": "grant_proficiency", "prof": "skill"},
			"resolution": "on_acquire"
		}]
	}`
	alertMech := `{
		"activation": {"mode": "passive"},
		"effects": [{"resolution": "auto", "result": [
			{"kind": "narrative", "description": "Бонус к инициативе = модификатор Телосложения. Невозможно быть застигнутым врасплох."}
		]}]
	}`
	toughMech := `{
		"activation": {"mode": "passive"},
		"effects": [{"resolution": "auto", "result": [
			{"kind": "narrative", "description": "Максимум хитов увеличивается на 2 за каждый уровень (включая 1-й)."}
		]}]
	}`
	savageMech := `{
		"activation": {"mode": "passive"},
		"effects": [{"resolution": "auto", "result": [
			{"kind": "reroll", "which": "damage", "keep": "either", "description": "Один раз за ход перебросить урон оружия ближнего боя."}
		]}]
	}`

	secondWindID, err := upsertAction(db, "ACT-second-wind", "Второе дыхание",
		"Бонусным действием восстановите 1d10 + ваш уровень воина хитов.", "class_feature", secondWindMech)
	if err != nil {
		return fmt.Errorf("second wind: %w", err)
	}
	fightingStyleID, err := upsertEffect(db, "EFF-fighting-style", "Боевой стиль",
		"Выберите специализацию владения оружием.", "passive", fightingStyleMech)
	if err != nil {
		return fmt.Errorf("fighting style: %w", err)
	}
	spellcastingID, err := upsertEffect(db, "EFF-wizard-spellcasting", "Использование заклинаний",
		"Подготовка и сотворение заклинаний из книги заклинаний.", "passive", spellcastingMech)
	if err != nil {
		return fmt.Errorf("spellcasting: %w", err)
	}
	arcaneRecoveryID, err := upsertEffect(db, "EFF-arcane-recovery", "Магическое восстановление",
		"Один раз за короткий отдых восстановите ячейки заклинаний.", "triggered", arcaneRecoveryMech)
	if err != nil {
		return fmt.Errorf("arcane recovery: %w", err)
	}
	skilledID, err := upsertEffect(db, "EFF-skilled", "Одарённый — выбор навыков",
		"Владение тремя навыками или инструментами на выбор.", "passive", skilledMech)
	if err != nil {
		return fmt.Errorf("skilled: %w", err)
	}
	alertID, err := upsertEffect(db, "EFF-alert", "Бдительный",
		"Бонус к инициативе и защита от засады.", "passive", alertMech)
	if err != nil {
		return fmt.Errorf("alert: %w", err)
	}
	toughID, err := upsertEffect(db, "EFF-tough", "Крепкий",
		"+2 максимум хитов за уровень.", "passive", toughMech)
	if err != nil {
		return fmt.Errorf("tough: %w", err)
	}
	savageID, err := upsertEffect(db, "EFF-savage-attacker", "Дикий атакующий",
		"Переброс урона оружия ближнего боя.", "passive", savageMech)
	if err != nil {
		return fmt.Errorf("savage attacker: %w", err)
	}

	warriorProg, _ := json.Marshal(map[string]interface{}{
		"1": map[string]interface{}{
			"effects": []string{fightingStyleID},
			"actions": []string{secondWindID},
		},
	})
	if err := linkClassProgression(db, "CLASS-warrior", string(warriorProg)); err != nil {
		return fmt.Errorf("warrior progression: %w", err)
	}

	wizardProg, _ := json.Marshal(map[string]interface{}{
		"1": map[string]interface{}{
			"effects": []string{spellcastingID, arcaneRecoveryID},
		},
	})
	if err := linkClassProgression(db, "CLASS-wizard", string(wizardProg)); err != nil {
		return fmt.Errorf("wizard progression: %w", err)
	}

	for _, pair := range []struct{ name, id string }{
		{"%Одарён%", skilledID},
		{"%Skilled%", skilledID},
		{"%Бдитель%", alertID},
		{"%Alert%", alertID},
		{"%Крепк%", toughID},
		{"%Tough%", toughID},
		{"%Дикий атак%", savageID},
		{"%Savage%", savageID},
	} {
		if err := linkFeatEffect(db, pair.name, pair.id); err != nil {
			return fmt.Errorf("feat link %s: %w", pair.name, err)
		}
	}

	// Нормализация skill_proficiencies у предысторий (русские названия → id).
	rows, err := db.Query(`SELECT id::text, skill_proficiencies FROM backgrounds WHERE deleted_at IS NULL AND skill_proficiencies IS NOT NULL`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var raw json.RawMessage
		if err := rows.Scan(&id, &raw); err != nil {
			return err
		}
		norm, err := normalizeSkillArray(raw)
		if err != nil {
			continue
		}
		if _, err := db.Exec(`UPDATE backgrounds SET skill_proficiencies = $1::jsonb, updated_at = NOW() WHERE id = $2::uuid`, string(norm), id); err != nil {
			return err
		}
	}
	return rows.Err()
}
