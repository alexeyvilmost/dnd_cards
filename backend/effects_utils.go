package main

import (
	"fmt"
	"strings"
)

// EffectAnalysisResult - результат анализа эффектов предмета
type EffectAnalysisResult struct {
	CharacteristicBonuses map[string]int `json:"characteristic_bonuses"` // Бонусы к характеристикам
	SkillBonuses          map[string]int `json:"skill_bonuses"`          // Бонусы к навыкам
	SavingThrowBonuses    map[string]int `json:"saving_throw_bonuses"`   // Бонусы к спасброскам
}

// AnalyzeCardEffects анализирует эффекты карты и возвращает структурированные бонусы
func AnalyzeCardEffects(effects *Effects) *EffectAnalysisResult {
	result := &EffectAnalysisResult{
		CharacteristicBonuses: make(map[string]int),
		SkillBonuses:          make(map[string]int),
		SavingThrowBonuses:    make(map[string]int),
	}

	if effects == nil || len(*effects) == 0 {
		return result
	}

	for _, effect := range *effects {
		bonus := effect.Value
		if effect.Modifier == EffectModifierMinus {
			bonus = -bonus
		}

		switch effect.TargetType {
		case EffectTargetCharacteristic:
			if effect.TargetSpecific == "all" {
				// Применяем ко всем характеристикам
				characteristics := []string{"strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"}
				for _, char := range characteristics {
					result.CharacteristicBonuses[char] += bonus
				}
			} else {
				// Применяем к конкретной характеристике
				result.CharacteristicBonuses[effect.TargetSpecific] += bonus
			}

		case EffectTargetSkill:
			if effect.TargetSpecific == "all" {
				// Применяем ко всем навыкам
				skills := []string{
					"athletics", "acrobatics", "sleight_of_hand", "stealth",
					"arcana", "history", "investigation", "nature", "religion",
					"animal_handling", "insight", "medicine", "perception", "survival",
					"deception", "intimidation", "performance", "persuasion",
				}
				for _, skill := range skills {
					result.SkillBonuses[skill] += bonus
				}
			} else {
				// Применяем к конкретному навыку
				result.SkillBonuses[effect.TargetSpecific] += bonus
			}

		case EffectTargetSavingThrow:
			if effect.TargetSpecific == "all" {
				// Применяем ко всем спасброскам
				savingThrows := []string{"strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"}
				for _, st := range savingThrows {
					result.SavingThrowBonuses[st] += bonus
				}
			} else {
				// Применяем к конкретному спасброску
				result.SavingThrowBonuses[effect.TargetSpecific] += bonus
			}
		}
	}

	return result
}

// GetEffectDescription возвращает человекочитаемое описание эффекта
func GetEffectDescription(effect Effect) string {
	targetTypeName := getTargetTypeName(effect.TargetType)
	targetSpecificName := getTargetSpecificName(effect.TargetType, effect.TargetSpecific)

	modifier := "+"
	if effect.Modifier == EffectModifierMinus {
		modifier = "-"
	}

	return fmt.Sprintf("%s - %s %s%d", targetTypeName, targetSpecificName, modifier, effect.Value)
}

// getTargetTypeName возвращает название типа цели
func getTargetTypeName(targetType EffectTargetType) string {
	switch targetType {
	case EffectTargetCharacteristic:
		return "Характеристика"
	case EffectTargetSkill:
		return "Навык"
	case EffectTargetSavingThrow:
		return "Спасбросок"
	default:
		return string(targetType)
	}
}

// getTargetSpecificName возвращает название конкретной цели
func getTargetSpecificName(targetType EffectTargetType, targetSpecific string) string {
	if targetSpecific == "all" {
		return "Все"
	}

	switch targetType {
	case EffectTargetCharacteristic:
		return getCharacteristicName(targetSpecific)
	case EffectTargetSkill:
		return getSkillName(targetSpecific)
	case EffectTargetSavingThrow:
		return getSavingThrowName(targetSpecific)
	default:
		return targetSpecific
	}
}

// getCharacteristicName возвращает название характеристики
func getCharacteristicName(char string) string {
	switch char {
	case "strength":
		return "Сила"
	case "dexterity":
		return "Ловкость"
	case "constitution":
		return "Телосложение"
	case "intelligence":
		return "Интеллект"
	case "wisdom":
		return "Мудрость"
	case "charisma":
		return "Харизма"
	default:
		return char
	}
}

// getSkillName возвращает название навыка
func getSkillName(skill string) string {
	switch skill {
	case "athletics":
		return "Атлетика"
	case "acrobatics":
		return "Акробатика"
	case "sleight_of_hand":
		return "Ловкость рук"
	case "stealth":
		return "Скрытность"
	case "arcana":
		return "Магия"
	case "history":
		return "История"
	case "investigation":
		return "Расследование"
	case "nature":
		return "Природа"
	case "religion":
		return "Религия"
	case "animal_handling":
		return "Дрессировка"
	case "insight":
		return "Проницательность"
	case "medicine":
		return "Медицина"
	case "perception":
		return "Восприятие"
	case "survival":
		return "Выживание"
	case "deception":
		return "Обман"
	case "intimidation":
		return "Запугивание"
	case "performance":
		return "Выступление"
	case "persuasion":
		return "Убеждение"
	default:
		return skill
	}
}

// getSavingThrowName возвращает название спасброска
func getSavingThrowName(st string) string {
	charName := getCharacteristicName(st)
	if charName != st {
		return fmt.Sprintf("Спасбросок %s", charName)
	}
	return st
}

// ValidateEffect проверяет корректность эффекта
func ValidateEffect(effect Effect) error {
	// Проверяем тип цели
	switch effect.TargetType {
	case EffectTargetCharacteristic, EffectTargetSkill, EffectTargetSavingThrow:
		// Валидные типы
	default:
		return fmt.Errorf("неподдерживаемый тип цели: %s", effect.TargetType)
	}

	// Проверяем модификатор
	switch effect.Modifier {
	case EffectModifierPlus, EffectModifierMinus:
		// Валидные модификаторы
	default:
		return fmt.Errorf("неподдерживаемый модификатор: %s", effect.Modifier)
	}

	// Проверяем значение
	if effect.Value < 1 || effect.Value > 20 {
		return fmt.Errorf("значение эффекта должно быть от 1 до 20, получено: %d", effect.Value)
	}

	// Проверяем конкретную цель
	if effect.TargetSpecific == "all" {
		return nil // "all" всегда валидно
	}

	// Проверяем конкретные цели в зависимости от типа
	switch effect.TargetType {
	case EffectTargetCharacteristic:
		validCharacteristics := []string{"strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"}
		if !containsString(validCharacteristics, effect.TargetSpecific) {
			return fmt.Errorf("неподдерживаемая характеристика: %s", effect.TargetSpecific)
		}

	case EffectTargetSkill:
		validSkills := []string{
			"athletics", "acrobatics", "sleight_of_hand", "stealth",
			"arcana", "history", "investigation", "nature", "religion",
			"animal_handling", "insight", "medicine", "perception", "survival",
			"deception", "intimidation", "performance", "persuasion",
		}
		if !containsString(validSkills, effect.TargetSpecific) {
			return fmt.Errorf("неподдерживаемый навык: %s", effect.TargetSpecific)
		}

	case EffectTargetSavingThrow:
		validSavingThrows := []string{"strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"}
		if !containsString(validSavingThrows, effect.TargetSpecific) {
			return fmt.Errorf("неподдерживаемый спасбросок: %s", effect.TargetSpecific)
		}
	}

	return nil
}

// ValidateEffects проверяет корректность массива эффектов
func ValidateEffects(effects *Effects) error {
	if effects == nil {
		return nil
	}

	for i, effect := range *effects {
		if err := ValidateEffect(effect); err != nil {
			return fmt.Errorf("ошибка в эффекте %d: %w", i+1, err)
		}
	}

	return nil
}

// containsString проверяет, содержится ли строка в слайсе
func containsString(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// GetEffectsSummary возвращает краткое описание всех эффектов карты
func GetEffectsSummary(effects *Effects) string {
	if effects == nil || len(*effects) == 0 {
		return "Эффекты отсутствуют"
	}

	var descriptions []string
	for _, effect := range *effects {
		descriptions = append(descriptions, GetEffectDescription(effect))
	}

	return strings.Join(descriptions, ", ")
}
