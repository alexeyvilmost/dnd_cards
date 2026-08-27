package main

import (
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func classEquipmentOptions(options *ClassEquipmentOptions) []*EquipmentOption {
	if options == nil {
		return nil
	}
	return []*EquipmentOption{options.OptionA, options.OptionB, options.OptionC}
}

// validateClassEquipmentCardReferences prevents new JSONB references from
// bypassing the catalog's soft-delete-aware card relationship. The runtime can
// therefore consume explicit item identities without fallback name/UUID logic.
func validateClassEquipmentCardReferences(db *gorm.DB, options *ClassEquipmentOptions) error {
	if options == nil {
		return nil
	}
	requested := map[uuid.UUID]string{}
	for optionIndex, option := range classEquipmentOptions(options) {
		if option == nil {
			continue
		}
		for itemIndex, item := range option.Items {
			if item.Quantity <= 0 {
				return fmt.Errorf("equipment option %d item %d has non-positive quantity", optionIndex+1, itemIndex+1)
			}
			id, err := uuid.Parse(strings.TrimSpace(item.CardID))
			if err != nil {
				return fmt.Errorf("equipment option %d item %d has invalid card_id", optionIndex+1, itemIndex+1)
			}
			requested[id] = id.String()
		}
	}
	if len(requested) == 0 {
		return nil
	}

	ids := make([]uuid.UUID, 0, len(requested))
	for id := range requested {
		ids = append(ids, id)
	}
	var activeIDs []uuid.UUID
	if err := db.Model(&Card{}).Where("id IN ?", ids).Pluck("id", &activeIDs).Error; err != nil {
		return fmt.Errorf("validate class equipment cards: %w", err)
	}
	for _, id := range activeIDs {
		delete(requested, id)
	}
	if len(requested) == 0 {
		return nil
	}
	missing := make([]string, 0, len(requested))
	for _, id := range requested {
		missing = append(missing, id)
	}
	sort.Strings(missing)
	return fmt.Errorf("equipment_options references missing or deleted cards: %s", strings.Join(missing, ", "))
}
