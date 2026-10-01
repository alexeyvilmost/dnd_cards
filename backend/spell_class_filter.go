package main

import (
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// The spell editor stores class slugs while imported spells can retain localized
// names. Resolve those representations through the class catalog, without
// rewriting content or maintaining a separate list of class translations.
func spellClassFilterAliases(db *gorm.DB, reference string) ([]string, error) {
	key := normalizeSpellClassReference(reference)
	aliases := []string{key}
	seen := map[string]bool{key: true}
	var classes []Class
	if err := db.Model(&Class{}).
		Select("id", "name", "name_en", "card_number").
		Where("is_subclass = ? OR is_subclass IS NULL", false).
		Find(&classes).Error; err != nil {
		return nil, err
	}
	for _, class := range classes {
		classAliases := spellClassReferenceAliases(class)
		matched := false
		for _, alias := range classAliases {
			if alias == key {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}
		for _, alias := range classAliases {
			if !seen[alias] {
				aliases = append(aliases, alias)
				seen[alias] = true
			}
		}
	}
	return aliases, nil
}

func spellClassReferenceAliases(class Class) []string {
	values := []string{class.Name, class.CardNumber}
	if class.NameEn != nil {
		values = append(values, *class.NameEn)
	}
	if class.ID != uuid.Nil {
		values = append(values, class.ID.String())
	}
	if len(class.CardNumber) > len("CLASS-") && strings.EqualFold(class.CardNumber[:len("CLASS-")], "CLASS-") {
		values = append(values, class.CardNumber[len("CLASS-"):])
	}
	aliases := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		alias := normalizeSpellClassReference(value)
		if alias != "" && !seen[alias] {
			aliases = append(aliases, alias)
			seen[alias] = true
		}
	}
	return aliases
}

func normalizeSpellClassReference(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
