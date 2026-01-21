package main

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// EffectModifiers - структура для хранения всех модификаторов от активных эффектов
type EffectModifiers struct {
	AttackModifiers      []AttackModifier      `json:"attack_modifiers"`
	Resistances          []Resistance          `json:"resistances"`
	AbilityCheckModifiers []AbilityCheckModifier `json:"ability_check_modifiers"`
	SavingThrowModifiers []SavingThrowModifier `json:"saving_throw_modifiers"`
	SpellRestrictions    []SpellRestriction    `json:"spell_restrictions"`
}

// AttackModifier - модификатор атаки
type AttackModifier struct {
	Name          string                 `json:"name"`
	AttackRange   string                 `json:"attack_range"`   // "melee" | "ranged" | "all"
	AttackType    string                 `json:"attack_type"`     // "weapon" | "unarmed" | "spell" | "all"
	Modifies      string                 `json:"modifies"`        // "attack_dices" | "attack_roll" | "damage_dices" | "damage_roll"
	ModifierType  string                 `json:"modifier_type"`   // "replace" | "add" | "multiply" | "custom"
	Modifier      string                 `json:"modifier"`        // "+2", "advantage", "disadvantage"
	Conditions    map[string]interface{} `json:"conditions"`
	ReplacePriority int                  `json:"replace_priority,omitempty"`
}

// Resistance - сопротивление к урону
type Resistance struct {
	DamageType     string `json:"damage_type"`
	ResistanceType string `json:"resistance_type"` // "resistance" | "immunity" | "vulnerability"
}

// AbilityCheckModifier - модификатор проверки характеристики
type AbilityCheckModifier struct {
	AbilityChecks []string `json:"ability_checks"`
	Modifier      string   `json:"modifier"` // "advantage" | "disadvantage" | "+N" | "-N"
}

// SavingThrowModifier - модификатор спасброска
type SavingThrowModifier struct {
	SavingThrows []string `json:"saving_throws"`
	Modifier     string   `json:"modifier"` // "advantage" | "disadvantage" | "+N" | "-N"
}

// SpellRestriction - ограничение на заклинания
type SpellRestriction struct {
	Restriction string `json:"restriction"` // "cannot_cast_or_concentrate"
}

// ApplyAction применяет действие к персонажу
func ApplyAction(db *gorm.DB, character *CharacterV2, action *Action) error {
	if action.Script == nil {
		return fmt.Errorf("действие не содержит скрипт")
	}

	script := *action.Script

	// Проверяем стоимость ресурсов
	resourceCost, ok := script["resource_cost"].([]interface{})
	if !ok {
		return fmt.Errorf("неверный формат resource_cost в скрипте")
	}

	// Проверяем и тратим ресурсы
	if character.Resources == nil {
		character.Resources = &CharacterResources{}
	}
	resources := *character.Resources

	for _, cost := range resourceCost {
		costStr, ok := cost.(string)
		if !ok {
			continue
		}

		// Проверяем специальные ресурсы (заряды ярости и т.д.)
		if costStr == "rage_charge" {
			// Проверяем оба варианта ключа (rage_charges и rage_charge)
			charges, exists := resources["rage_charges"]
			if !exists {
				charges, exists = resources["rage_charge"]
			}
			if !exists {
				return fmt.Errorf("у персонажа не инициализированы заряды ярости")
			}
			if charges <= 0 {
				return fmt.Errorf("недостаточно зарядов ярости (текущее значение: %d)", charges)
			}
			// Уменьшаем заряд, используя правильный ключ
			if _, exists := resources["rage_charges"]; exists {
				resources["rage_charges"]--
			} else if _, exists := resources["rage_charge"]; exists {
				resources["rage_charge"]--
				// Если использовали ключ без 's', синхронизируем
				resources["rage_charges"] = resources["rage_charge"]
			}
		}
		// Другие ресурсы (action, bonus_action) проверяются на фронтенде
	}

	// Получаем длительность эффекта
	durationStr, ok := script["duration"].(string)
	if !ok {
		return fmt.Errorf("неверный формат duration в скрипте")
	}

	// Парсим длительность (например, "10 rounds")
	var durationRemaining int
	var durationType string
	if durationStr == "10 rounds" {
		durationRemaining = 10
		durationType = "rounds"
	} else {
		// Можно расширить для других форматов
		durationRemaining = 0
		durationType = "until_dispelled"
	}

	// Создаем активный эффект
	if character.ActiveEffects == nil {
		character.ActiveEffects = &ActiveEffects{}
	}
	activeEffects := *character.ActiveEffects

	effectID := uuid.New()
	newEffect := ActiveEffect{
		EffectID:         effectID.String(),
		ActionID:         action.ID.String(),
		Name:             action.Name,
		DurationRemaining: durationRemaining,
		DurationType:     durationType,
		AppliedAt:        time.Now(),
		Script:           action.Script,
	}

	activeEffects = append(activeEffects, newEffect)
	character.ActiveEffects = &activeEffects
	character.Resources = &resources

	// Сохраняем изменения
	if err := db.Save(character).Error; err != nil {
		return fmt.Errorf("ошибка сохранения персонажа: %w", err)
	}

	return nil
}

// GetActiveEffectsModifiers получает все модификаторы от активных эффектов
func GetActiveEffectsModifiers(character *CharacterV2) *EffectModifiers {
	modifiers := &EffectModifiers{
		AttackModifiers:       []AttackModifier{},
		Resistances:           []Resistance{},
		AbilityCheckModifiers: []AbilityCheckModifier{},
		SavingThrowModifiers: []SavingThrowModifier{},
		SpellRestrictions:    []SpellRestriction{},
	}

	if character.ActiveEffects == nil || len(*character.ActiveEffects) == 0 {
		return modifiers
	}

	for _, effect := range *character.ActiveEffects {
		if effect.Script == nil {
			continue
		}

		script := *effect.Script
		effectsList, ok := script["effects"].([]interface{})
		if !ok {
			continue
		}

		for _, effectData := range effectsList {
			effectMap, ok := effectData.(map[string]interface{})
			if !ok {
				continue
			}

			effectType, ok := effectMap["type"].(string)
			if !ok {
				continue
			}

			switch effectType {
			case "attack_modifier":
				modifier := parseAttackModifier(effectMap)
				if modifier != nil {
					modifiers.AttackModifiers = append(modifiers.AttackModifiers, *modifier)
				}

			case "resistance":
				resistances := parseResistances(effectMap)
				modifiers.Resistances = append(modifiers.Resistances, resistances...)

			case "ability_check_modifier":
				modifier := parseAbilityCheckModifier(effectMap)
				if modifier != nil {
					modifiers.AbilityCheckModifiers = append(modifiers.AbilityCheckModifiers, *modifier)
				}

			case "saving_throw_modifier":
				modifier := parseSavingThrowModifier(effectMap)
				if modifier != nil {
					modifiers.SavingThrowModifiers = append(modifiers.SavingThrowModifiers, *modifier)
				}

			case "spell_restriction":
				restriction := parseSpellRestriction(effectMap)
				if restriction != nil {
					modifiers.SpellRestrictions = append(modifiers.SpellRestrictions, *restriction)
				}
			}
		}
	}

	return modifiers
}

// parseAttackModifier парсит модификатор атаки из JSON
func parseAttackModifier(data map[string]interface{}) *AttackModifier {
	modifier := &AttackModifier{}

	if name, ok := data["name"].(string); ok {
		modifier.Name = name
	}
	if attackRange, ok := data["attack_range"].(string); ok {
		modifier.AttackRange = attackRange
	}
	if attackType, ok := data["attack_type"].(string); ok {
		modifier.AttackType = attackType
	}
	if modifies, ok := data["modifies"].(string); ok {
		modifier.Modifies = modifies
	}
	if modifierType, ok := data["modifier_type"].(string); ok {
		modifier.ModifierType = modifierType
	}
	if mod, ok := data["modifier"].(string); ok {
		modifier.Modifier = mod
	}
	if conditions, ok := data["conditions"].(map[string]interface{}); ok {
		modifier.Conditions = conditions
	}
	if priority, ok := data["replace_priority"].(float64); ok {
		modifier.ReplacePriority = int(priority)
	}

	return modifier
}

// parseResistances парсит сопротивления из JSON
func parseResistances(data map[string]interface{}) []Resistance {
	var resistances []Resistance

	resistancesList, ok := data["resistances"].([]interface{})
	if !ok {
		return resistances
	}

	for _, r := range resistancesList {
		rMap, ok := r.(map[string]interface{})
		if !ok {
			continue
		}

		resistance := Resistance{}
		if damageType, ok := rMap["damage_type"].(string); ok {
			resistance.DamageType = damageType
		}
		if resistanceType, ok := rMap["resistance_type"].(string); ok {
			resistance.ResistanceType = resistanceType
		}

		resistances = append(resistances, resistance)
	}

	return resistances
}

// parseAbilityCheckModifier парсит модификатор проверки характеристики
func parseAbilityCheckModifier(data map[string]interface{}) *AbilityCheckModifier {
	modifier := &AbilityCheckModifier{}

	if checks, ok := data["ability_checks"].([]interface{}); ok {
		for _, check := range checks {
			if checkStr, ok := check.(string); ok {
				modifier.AbilityChecks = append(modifier.AbilityChecks, checkStr)
			}
		}
	}
	if mod, ok := data["modifier"].(string); ok {
		modifier.Modifier = mod
	}

	return modifier
}

// parseSavingThrowModifier парсит модификатор спасброска
func parseSavingThrowModifier(data map[string]interface{}) *SavingThrowModifier {
	modifier := &SavingThrowModifier{}

	if throws, ok := data["saving_throws"].([]interface{}); ok {
		for _, throw := range throws {
			if throwStr, ok := throw.(string); ok {
				modifier.SavingThrows = append(modifier.SavingThrows, throwStr)
			}
		}
	}
	if mod, ok := data["modifier"].(string); ok {
		modifier.Modifier = mod
	}

	return modifier
}

// parseSpellRestriction парсит ограничение на заклинания
func parseSpellRestriction(data map[string]interface{}) *SpellRestriction {
	restriction := &SpellRestriction{}

	if rest, ok := data["restriction"].(string); ok {
		restriction.Restriction = rest
	}

	return restriction
}

// EndEffect завершает эффект на персонаже
func EndEffect(db *gorm.DB, character *CharacterV2, effectID string) error {
	if character.ActiveEffects == nil {
		return fmt.Errorf("у персонажа нет активных эффектов")
	}

	activeEffects := *character.ActiveEffects
	newEffects := ActiveEffects{}

	for _, effect := range activeEffects {
		if effect.EffectID != effectID {
			newEffects = append(newEffects, effect)
		}
	}

	character.ActiveEffects = &newEffects

	if err := db.Save(character).Error; err != nil {
		return fmt.Errorf("ошибка сохранения персонажа: %w", err)
	}

	return nil
}

// ProcessTurnEnd обрабатывает конец хода
func ProcessTurnEnd(db *gorm.DB, character *CharacterV2) error {
	if character.ActiveEffects == nil {
		return nil
	}

	activeEffects := *character.ActiveEffects
	newEffects := ActiveEffects{}

	for _, effect := range activeEffects {
		if effect.DurationType == "rounds" {
			effect.DurationRemaining--
			if effect.DurationRemaining > 0 {
				newEffects = append(newEffects, effect)
			}
		} else {
			// Эффекты с другими типами длительности не уменьшаются
			newEffects = append(newEffects, effect)
		}
	}

	character.ActiveEffects = &newEffects

	if err := db.Save(character).Error; err != nil {
		return fmt.Errorf("ошибка сохранения персонажа: %w", err)
	}

	return nil
}

// ProcessLongRest обрабатывает длинный отдых
func ProcessLongRest(db *gorm.DB, character *CharacterV2) error {
	// Восстанавливаем ресурсы до максимума
	if character.MaxResources != nil && character.Resources != nil {
		maxResources := *character.MaxResources
		resources := *character.Resources

		for key, maxValue := range maxResources {
			resources[key] = maxValue
		}

		character.Resources = &resources
	}

	// Восстанавливаем здоровье до максимума
	character.CurrentHP = character.MaxHP

	// Очищаем активные эффекты (или можно оставить некоторые)
	// По правилам D&D большинство эффектов заканчиваются после длинного отдыха
	character.ActiveEffects = &ActiveEffects{}

	if err := db.Save(character).Error; err != nil {
		return fmt.Errorf("ошибка сохранения персонажа: %w", err)
	}

	return nil
}
