package main

import (
	"log"

	"gorm.io/gorm"
)

// cardToEntityInfo преобразует карту в map для тегов библиотеки изображений.
func cardToEntityInfo(card Card) map[string]interface{} {
	info := map[string]interface{}{
		"name":        card.Name,
		"description": card.Description,
		"rarity":      string(card.Rarity),
	}
	if card.Type != nil {
		info["type"] = *card.Type
	}
	if card.WeaponType != nil {
		info["weapon_type"] = *card.WeaponType
	}
	if card.Slot != nil {
		info["slot"] = string(*card.Slot)
	}
	if card.Properties != nil {
		info["properties"] = []string(*card.Properties)
	}
	return info
}

// mergeEntityInfo объединяет данные из БД и переданные в запросе (переданные имеют приоритет).
func mergeEntityInfo(base, override map[string]interface{}) map[string]interface{} {
	merged := make(map[string]interface{}, len(base)+len(override))
	for k, v := range base {
		merged[k] = v
	}
	for k, v := range override {
		if v != nil && v != "" {
			merged[k] = v
		}
	}
	return merged
}

type libraryTags struct {
	CardName   *string
	CardRarity *string
	ItemType   *string
	WeaponType *string
	ArmorType  *string
	Slot       *EquipmentSlot
}

func extractLibraryTags(entityInfo map[string]interface{}) libraryTags {
	var tags libraryTags

	if nameVal, ok := entityInfo["name"].(string); ok && nameVal != "" {
		tags.CardName = &nameVal
	}
	if rarityVal, ok := entityInfo["rarity"].(string); ok && rarityVal != "" {
		tags.CardRarity = &rarityVal
	}
	if typeVal, ok := entityInfo["type"].(string); ok && typeVal != "" {
		tags.ItemType = &typeVal
	}
	if weaponTypeVal, ok := entityInfo["weapon_type"].(string); ok && weaponTypeVal != "" {
		tags.WeaponType = &weaponTypeVal
	}
	if slotVal, ok := entityInfo["slot"].(string); ok && slotVal != "" {
		slotPtr := EquipmentSlot(slotVal)
		tags.Slot = &slotPtr
	}
	tags.ArmorType = armorTypeFromProperties(entityInfo["properties"])
	return tags
}

func propertiesToStrings(properties interface{}) []string {
	switch v := properties.(type) {
	case Properties:
		return []string(v)
	case *Properties:
		if v == nil {
			return nil
		}
		return []string(*v)
	case []string:
		return v
	case []interface{}:
		result := make([]string, 0, len(v))
		for _, prop := range v {
			if propStr, ok := prop.(string); ok {
				result = append(result, propStr)
			}
		}
		return result
	default:
		return nil
	}
}

func armorTypeFromProperties(properties interface{}) *string {
	for _, prop := range propertiesToStrings(properties) {
		switch prop {
		case "cloth", "light_armor", "medium_armor", "heavy_armor":
			armorTypeVal := prop
			return &armorTypeVal
		}
	}
	return nil
}

// upsertImageLibraryEntryToDB добавляет или восстанавливает запись в библиотеке изображений.
func upsertImageLibraryEntryToDB(db *gorm.DB, image ImageLibrary) bool {
	var existing ImageLibrary
	err := db.Unscoped().Where("cloudinary_id = ?", image.CloudinaryID).First(&existing).Error
	if err == nil {
		if existing.DeletedAt != nil {
			updates := map[string]interface{}{
				"deleted_at":         nil,
				"cloudinary_url":     image.CloudinaryURL,
				"original_name":      image.OriginalName,
				"file_size":          image.FileSize,
				"card_name":          image.CardName,
				"card_rarity":        image.CardRarity,
				"item_type":          image.ItemType,
				"weapon_type":        image.WeaponType,
				"armor_type":         image.ArmorType,
				"slot":               image.Slot,
				"generation_prompt":  image.GenerationPrompt,
				"generation_model":   image.GenerationModel,
				"generation_time_ms": image.GenerationTimeMs,
			}
			if updateErr := db.Unscoped().Model(&existing).Updates(updates).Error; updateErr != nil {
				log.Printf("Ошибка восстановления изображения в библиотеке: %v", updateErr)
				return false
			}
			return true
		}
		return false
	}

	if createErr := db.Create(&image).Error; createErr != nil {
		log.Printf("Ошибка добавления изображения в библиотеку: %v", createErr)
		return false
	}
	return true
}
