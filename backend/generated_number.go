package main

import (
	"fmt"
	"strconv"
	"strings"

	"gorm.io/gorm"
)

// generateNumber allocates PREFIX-NNNN across every catalog model. Named IDs
// with the same prefix stay valid but do not participate in the numeric counter.
func generateNumber(db *gorm.DB, model interface{}, prefix string) (string, error) {
	var cardNumbers []string
	if err := db.Unscoped().Model(model).
		Where("card_number LIKE ?", prefix+"-%").
		Pluck("card_number", &cardNumbers).Error; err != nil {
		return "", fmt.Errorf("получить номера %s: %w", prefix, err)
	}
	return nextGeneratedNumber(cardNumbers, prefix), nil
}

// SQL ORDER BY on text makes 9999 sort after 10000 and may select a named ID.
// Parse exact numeric suffixes so rollover and mixed human IDs stay deterministic.
func nextGeneratedNumber(cardNumbers []string, prefix string) string {
	maxNumber := 0
	prefix += "-"
	for _, cardNumber := range cardNumbers {
		if !strings.HasPrefix(cardNumber, prefix) {
			continue
		}
		suffix := strings.TrimPrefix(cardNumber, prefix)
		if suffix == "" || strings.ContainsAny(suffix, "+- ") {
			continue
		}
		number, err := strconv.Atoi(suffix)
		if err == nil && number > maxNumber {
			maxNumber = number
		}
	}

	return fmt.Sprintf("%s%04d", prefix, maxNumber+1)
}
