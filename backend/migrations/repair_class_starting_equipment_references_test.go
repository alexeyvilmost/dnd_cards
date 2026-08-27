package migrations

import (
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestRepairClassStartingEquipmentReferencesMigrationIsRegisteredAfter113(t *testing.T) {
	migrations := GetAllMigrations()
	for index, migration := range migrations {
		if migration.Version != "114_repair_class_starting_equipment_references" {
			continue
		}
		if index == 0 || migrations[index-1].Version != "113_repair_goliath_reaction_authority" {
			t.Fatal("migration 114 must immediately follow 113")
		}
		if migration.Up == nil || migration.Down == nil {
			t.Fatal("migration 114 must register Up and safe Down")
		}
		return
	}
	t.Fatal("migration 114 is not registered")
}

func optionCardQuantities(option *startingEquipmentOptionIdentity) map[string]int {
	result := map[string]int{}
	if option == nil {
		return result
	}
	for _, item := range option.Items {
		result[item.CardNumber] = item.Quantity
	}
	return result
}

func TestCanonicalClassStartingEquipmentCoversAllFiveBrokenClasses(t *testing.T) {
	byClass := map[string]classStartingEquipmentIdentity{}
	for _, repair := range canonicalClassStartingEquipment {
		byClass[repair.ClassCardNumber] = repair
	}
	if len(byClass) != 5 {
		t.Fatalf("repair covers %d classes, want 5", len(byClass))
	}

	expected := map[string]map[string]int{
		"CLASS-warrior": {"CARD-0283": 1, "CARD-0317": 1, "CARD-0309": 1, "CARD-0301": 8, "CARD-0805": 1},
		"CLASS-cleric":  {"CARD-0278": 1, "CARD-0200": 1, "CARD-0298": 1, "CARD-0816": 1, "CARD-0409": 1},
		"CLASS-druid":   {"CARD-0275": 1, "CARD-0200": 1, "CARD-0299": 1, "CARD-0827": 1, "CARD-0806": 1, "CARD-0712": 1},
		"CLASS-paladin": {"CARD-0283": 1, "CARD-0200": 1, "CARD-0319": 1, "CARD-0301": 6, "CARD-0816": 1, "CARD-0409": 1},
		"CLASS-ranger":  {"CARD-0276": 1, "CARD-0311": 1, "CARD-0294": 1, "CARD-0327": 1, "CARD-0728": 20, "CARD-0729": 1, "CARD-0827": 1, "CARD-0806": 1},
	}
	for classCardNumber, want := range expected {
		repair, ok := byClass[classCardNumber]
		if !ok {
			t.Fatalf("missing repair for %s", classCardNumber)
		}
		got := optionCardQuantities(repair.OptionA)
		if string(mustJSON(t, got)) != string(mustJSON(t, want)) {
			t.Fatalf("%s option_a = %v, want %v", classCardNumber, got, want)
		}
	}
	if optionCardQuantities(byClass["CLASS-ranger"].OptionA)["CARD-0728"] != 20 {
		t.Fatal("Ranger must receive 20 arrows")
	}
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return payload
}

func TestCanonicalEquipmentIdentitiesResolveInImmutableCatalog(t *testing.T) {
	payload, err := os.ReadFile("../../officials/canon/prod-snapshot/cards.json")
	if err != nil {
		t.Fatal(err)
	}
	var cards []struct {
		ID         string `json:"id"`
		CardNumber string `json:"card_number"`
	}
	if err := json.Unmarshal(payload, &cards); err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, card := range cards {
		if strings.TrimSpace(card.ID) != "" {
			counts[card.CardNumber]++
		}
	}
	for _, repair := range canonicalClassStartingEquipment {
		for _, option := range []*startingEquipmentOptionIdentity{repair.OptionA, repair.OptionB, repair.OptionC} {
			if option == nil {
				continue
			}
			for _, item := range option.Items {
				if counts[item.CardNumber] != 1 {
					t.Fatalf("%s equipment identity %s resolves %d times in immutable catalog", repair.ClassCardNumber, item.CardNumber, counts[item.CardNumber])
				}
			}
		}
	}
}

type snapshotEquipmentItem struct {
	CardID   string `json:"card_id"`
	Quantity int    `json:"quantity"`
}

type snapshotEquipmentOption struct {
	Items []snapshotEquipmentItem `json:"items"`
	Gold  int                     `json:"gold"`
}

type snapshotEquipmentClass struct {
	CardNumber       string                             `json:"card_number"`
	IsSubclass       bool                               `json:"is_subclass"`
	EquipmentOptions map[string]snapshotEquipmentOption `json:"equipment_options"`
}

func TestRepairedImmutableClassCatalogHasReferentialClosure(t *testing.T) {
	var cards []struct {
		ID         string `json:"id"`
		CardNumber string `json:"card_number"`
	}
	cardPayload, err := os.ReadFile("../../officials/canon/prod-snapshot/cards.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(cardPayload, &cards); err != nil {
		t.Fatal(err)
	}
	cardIDByNumber := map[string]string{}
	activeCardIDs := map[string]bool{}
	for _, card := range cards {
		if cardIDByNumber[card.CardNumber] != "" {
			t.Fatalf("duplicate immutable card identity %s", card.CardNumber)
		}
		cardIDByNumber[card.CardNumber] = card.ID
		activeCardIDs[card.ID] = true
	}

	var classes []snapshotEquipmentClass
	classPayload, err := os.ReadFile("../../officials/canon/prod-snapshot/classes.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(classPayload, &classes); err != nil {
		t.Fatal(err)
	}
	byClass := map[string]*snapshotEquipmentClass{}
	for index := range classes {
		byClass[classes[index].CardNumber] = &classes[index]
	}
	for _, repair := range canonicalClassStartingEquipment {
		class := byClass[repair.ClassCardNumber]
		if class == nil {
			t.Fatalf("immutable catalog is missing %s", repair.ClassCardNumber)
		}
		class.EquipmentOptions = map[string]snapshotEquipmentOption{}
		for key, option := range map[string]*startingEquipmentOptionIdentity{
			"option_a": repair.OptionA,
			"option_b": repair.OptionB,
			"option_c": repair.OptionC,
		} {
			if option == nil {
				continue
			}
			materialized := snapshotEquipmentOption{Items: []snapshotEquipmentItem{}, Gold: option.Gold}
			for _, item := range option.Items {
				cardID := cardIDByNumber[item.CardNumber]
				if cardID == "" {
					t.Fatalf("%s cannot resolve %s", repair.ClassCardNumber, item.CardNumber)
				}
				materialized.Items = append(materialized.Items, snapshotEquipmentItem{
					CardID: cardID, Quantity: item.Quantity,
				})
			}
			class.EquipmentOptions[key] = materialized
		}
	}

	for _, class := range classes {
		if class.IsSubclass {
			continue
		}
		for optionKey, option := range class.EquipmentOptions {
			for itemIndex, item := range option.Items {
				if !activeCardIDs[item.CardID] {
					t.Errorf("%s.%s.items[%d] dangles: %s", class.CardNumber, optionKey, itemIndex, item.CardID)
				}
				if item.Quantity <= 0 {
					t.Errorf("%s.%s.items[%d] has quantity %d", class.CardNumber, optionKey, itemIndex, item.Quantity)
				}
			}
		}
	}
}

func createStartingEquipmentRepairSchema(t *testing.T, db *sql.DB) map[string]string {
	t.Helper()
	if _, err := db.Exec(`
		CREATE TABLE cards (
			id UUID PRIMARY KEY, card_number TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
			weapon_type TEXT, mastery TEXT, range TEXT, mechanics JSONB,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
		);
		CREATE TABLE effects (
			id UUID PRIMARY KEY, card_number TEXT NOT NULL UNIQUE, deleted_at TIMESTAMPTZ
		);
		CREATE TABLE classes (
			id UUID PRIMARY KEY, card_number TEXT NOT NULL UNIQUE, equipment_options JSONB,
			is_subclass BOOLEAN, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
		);
	`); err != nil {
		t.Fatal(err)
	}

	cardIDs := map[string]string{}
	for _, repair := range canonicalClassStartingEquipment {
		for _, option := range []*startingEquipmentOptionIdentity{repair.OptionA, repair.OptionB, repair.OptionC} {
			if option == nil {
				continue
			}
			for _, item := range option.Items {
				if _, exists := cardIDs[item.CardNumber]; exists {
					continue
				}
				id := uuid.NewString()
				cardIDs[item.CardNumber] = id
				if _, err := db.Exec(`INSERT INTO cards (id, card_number, name) VALUES ($1, $2, $2)`, id, item.CardNumber); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	if _, err := db.Exec(`INSERT INTO effects (id, card_number) VALUES ($1, 'EFFECT-0250')`, uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	for _, repair := range canonicalClassStartingEquipment {
		if _, err := db.Exec(`
			INSERT INTO classes (id, card_number, equipment_options, is_subclass)
			VALUES ($1, $2, '{"option_a":{"items":[{"card_id":"00000000-0000-4000-8000-000000000999","quantity":1}],"gold":0}}', FALSE)
		`, uuid.NewString(), repair.ClassCardNumber); err != nil {
			t.Fatal(err)
		}
	}
	return cardIDs
}

func TestRepairClassStartingEquipmentReferencesIsIdempotentAndClosed(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	cardIDs := createStartingEquipmentRepairSchema(t, db)

	if err := repairClassStartingEquipmentReferences(db); err != nil {
		t.Fatal(err)
	}
	var firstOptions, firstProfile string
	if err := db.QueryRow(`SELECT equipment_options::text FROM classes WHERE card_number = 'CLASS-ranger'`).Scan(&firstOptions); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT mechanics->'weapon_profile' FROM cards WHERE card_number = 'CARD-0327'`).Scan(&firstProfile); err != nil {
		t.Fatal(err)
	}
	if err := repairClassStartingEquipmentReferences(db); err != nil {
		t.Fatalf("migration 114 is not idempotent: %v", err)
	}
	var secondOptions, secondProfile string
	if err := db.QueryRow(`SELECT equipment_options::text FROM classes WHERE card_number = 'CLASS-ranger'`).Scan(&secondOptions); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT mechanics->'weapon_profile' FROM cards WHERE card_number = 'CARD-0327'`).Scan(&secondProfile); err != nil {
		t.Fatal(err)
	}
	if firstOptions != secondOptions || firstProfile != secondProfile {
		t.Fatal("migration changed declarative output on the second run")
	}

	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	dangling, err := findDanglingClassEquipmentReferences(tx)
	_ = tx.Rollback()
	if err != nil {
		t.Fatal(err)
	}
	if len(dangling) != 0 {
		t.Fatalf("repaired catalog still has dangling references: %v", dangling)
	}

	var ammoID, weaponType, attackMode string
	var normalRange, longRange int
	if err := db.QueryRow(`
		SELECT mechanics #>> '{weapon_profile,ammo,card_id}',
			mechanics #>> '{weapon_profile,weapon_type}',
			mechanics #>> '{weapon_profile,default_attack_mode}',
			(mechanics #>> '{weapon_profile,attack_modes,0,normal_ft}')::int,
			(mechanics #>> '{weapon_profile,attack_modes,0,long_ft}')::int
		FROM cards WHERE card_number = 'CARD-0327'
	`).Scan(&ammoID, &weaponType, &attackMode, &normalRange, &longRange); err != nil {
		t.Fatal(err)
	}
	if ammoID != cardIDs["CARD-0728"] || weaponType != "longbow" || attackMode != "ranged" || normalRange != 150 || longRange != 600 {
		t.Fatalf("Ranger longbow profile = ammo %s, %s/%s %d/%d", ammoID, weaponType, attackMode, normalRange, longRange)
	}
}

func TestClassEquipmentCatalogGateRejectsUnknownDanglingReference(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	createStartingEquipmentRepairSchema(t, db)
	if _, err := db.Exec(`
		INSERT INTO classes (id, card_number, equipment_options, is_subclass)
		VALUES ($1, 'CLASS-unknown', '{"option_a":{"items":[{"card_id":"00000000-0000-4000-8000-000000000998","quantity":1}],"gold":0}}', FALSE)
	`, uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	err := repairClassStartingEquipmentReferences(db)
	if err == nil || !strings.Contains(err.Error(), "CLASS-unknown.option_a") {
		t.Fatalf("catalog gate error = %v", err)
	}
}
