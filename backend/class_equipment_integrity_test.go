package main

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestClassEquipmentReferenceValidationRejectsMalformedItemsBeforeQuery(t *testing.T) {
	invalidQuantity := &ClassEquipmentOptions{OptionA: &EquipmentOption{
		Items: CardRefList{{CardID: uuid.NewString(), Quantity: 0}},
	}}
	if err := validateClassEquipmentCardReferences(nil, invalidQuantity); err == nil || !strings.Contains(err.Error(), "non-positive quantity") {
		t.Fatalf("invalid quantity error = %v", err)
	}
	invalidID := &ClassEquipmentOptions{OptionA: &EquipmentOption{
		Items: CardRefList{{CardID: "not-a-card-id", Quantity: 1}},
	}}
	if err := validateClassEquipmentCardReferences(nil, invalidID); err == nil || !strings.Contains(err.Error(), "invalid card_id") {
		t.Fatalf("invalid id error = %v", err)
	}
}

func TestClassEquipmentReferenceValidationUsesActiveCardCatalog(t *testing.T) {
	db := openCatalogPaginationTestDB(t)
	if err := db.Exec(`
		CREATE TABLE cards (
			id uuid PRIMARY KEY,
			deleted_at timestamptz
		)
	`).Error; err != nil {
		t.Fatal(err)
	}
	activeID, deletedID := uuid.New(), uuid.New()
	if err := db.Exec(`
		INSERT INTO cards (id, deleted_at) VALUES (?, NULL), (?, NOW())
	`, activeID, deletedID).Error; err != nil {
		t.Fatal(err)
	}
	valid := &ClassEquipmentOptions{OptionA: &EquipmentOption{
		Items: CardRefList{{CardID: activeID.String(), Quantity: 20}},
	}}
	if err := validateClassEquipmentCardReferences(db, valid); err != nil {
		t.Fatalf("active card rejected: %v", err)
	}
	deleted := &ClassEquipmentOptions{OptionA: &EquipmentOption{
		Items: CardRefList{{CardID: deletedID.String(), Quantity: 1}},
	}}
	if err := validateClassEquipmentCardReferences(db, deleted); err == nil || !strings.Contains(err.Error(), deletedID.String()) {
		t.Fatalf("deleted card error = %v", err)
	}
}
