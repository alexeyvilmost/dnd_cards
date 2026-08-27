package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

type startingEquipmentItemIdentity struct {
	CardNumber string
	Quantity   int
}

type startingEquipmentOptionIdentity struct {
	Items []startingEquipmentItemIdentity
	Gold  int
}

type classStartingEquipmentIdentity struct {
	ClassCardNumber string
	OptionA         *startingEquipmentOptionIdentity
	OptionB         *startingEquipmentOptionIdentity
	OptionC         *startingEquipmentOptionIdentity
}

// These are PHB 2024 catalog identities, not database UUIDs. The migration
// resolves each identity inside the target database so it also repairs rows
// whose UUIDs differ between the immutable snapshot and production.
var canonicalClassStartingEquipment = []classStartingEquipmentIdentity{
	{
		ClassCardNumber: "CLASS-warrior",
		OptionA: &startingEquipmentOptionIdentity{Items: []startingEquipmentItemIdentity{
			{CardNumber: "CARD-0283", Quantity: 1}, // Chain Mail
			{CardNumber: "CARD-0317", Quantity: 1}, // Greatsword
			{CardNumber: "CARD-0309", Quantity: 1}, // Flail
			{CardNumber: "CARD-0301", Quantity: 8}, // Javelins
			{CardNumber: "CARD-0805", Quantity: 1}, // Dungeoneer's Pack
		}, Gold: 4},
		OptionB: &startingEquipmentOptionIdentity{Items: []startingEquipmentItemIdentity{
			{CardNumber: "CARD-0276", Quantity: 1}, // Studded Leather Armor
			{CardNumber: "CARD-0311", Quantity: 1}, // Scimitar
			{CardNumber: "CARD-0294", Quantity: 1}, // Shortsword
			{CardNumber: "CARD-0327", Quantity: 1}, // Longbow
			{CardNumber: "CARD-0728", Quantity: 20},
			{CardNumber: "CARD-0729", Quantity: 1}, // Quiver
			{CardNumber: "CARD-0805", Quantity: 1},
		}, Gold: 11},
		OptionC: &startingEquipmentOptionIdentity{Items: []startingEquipmentItemIdentity{}, Gold: 155},
	},
	{
		ClassCardNumber: "CLASS-cleric",
		OptionA: &startingEquipmentOptionIdentity{Items: []startingEquipmentItemIdentity{
			{CardNumber: "CARD-0278", Quantity: 1}, // Chain Shirt
			{CardNumber: "CARD-0200", Quantity: 1}, // Shield
			{CardNumber: "CARD-0298", Quantity: 1}, // Mace
			{CardNumber: "CARD-0816", Quantity: 1}, // Holy Symbol
			{CardNumber: "CARD-0409", Quantity: 1}, // Priest's Pack
		}, Gold: 7},
		OptionB: &startingEquipmentOptionIdentity{Items: []startingEquipmentItemIdentity{}, Gold: 110},
	},
	{
		ClassCardNumber: "CLASS-druid",
		OptionA: &startingEquipmentOptionIdentity{Items: []startingEquipmentItemIdentity{
			{CardNumber: "CARD-0275", Quantity: 1}, // Leather Armor
			{CardNumber: "CARD-0200", Quantity: 1}, // Shield
			{CardNumber: "CARD-0299", Quantity: 1}, // Sickle
			{CardNumber: "CARD-0827", Quantity: 1}, // Druidic Focus
			{CardNumber: "CARD-0806", Quantity: 1}, // Explorer's Pack
			{CardNumber: "CARD-0712", Quantity: 1}, // Herbalism Kit
		}, Gold: 9},
		OptionB: &startingEquipmentOptionIdentity{Items: []startingEquipmentItemIdentity{}, Gold: 50},
	},
	{
		ClassCardNumber: "CLASS-paladin",
		OptionA: &startingEquipmentOptionIdentity{Items: []startingEquipmentItemIdentity{
			{CardNumber: "CARD-0283", Quantity: 1}, // Chain Mail
			{CardNumber: "CARD-0200", Quantity: 1}, // Shield
			{CardNumber: "CARD-0319", Quantity: 1}, // Longsword
			{CardNumber: "CARD-0301", Quantity: 6}, // Javelins
			{CardNumber: "CARD-0816", Quantity: 1}, // Holy Symbol
			{CardNumber: "CARD-0409", Quantity: 1}, // Priest's Pack
		}, Gold: 9},
		OptionB: &startingEquipmentOptionIdentity{Items: []startingEquipmentItemIdentity{}, Gold: 150},
	},
	{
		ClassCardNumber: "CLASS-ranger",
		OptionA: &startingEquipmentOptionIdentity{Items: []startingEquipmentItemIdentity{
			{CardNumber: "CARD-0276", Quantity: 1}, // Studded Leather Armor
			{CardNumber: "CARD-0311", Quantity: 1}, // Scimitar
			{CardNumber: "CARD-0294", Quantity: 1}, // Shortsword
			{CardNumber: "CARD-0327", Quantity: 1}, // Longbow
			{CardNumber: "CARD-0728", Quantity: 20},
			{CardNumber: "CARD-0729", Quantity: 1}, // Quiver
			{CardNumber: "CARD-0827", Quantity: 1}, // Druidic Focus
			{CardNumber: "CARD-0806", Quantity: 1}, // Explorer's Pack
		}, Gold: 7},
		OptionB: &startingEquipmentOptionIdentity{Items: []startingEquipmentItemIdentity{}, Gold: 150},
	},
}

type materializedStartingEquipmentItem struct {
	CardID   string `json:"card_id"`
	Quantity int    `json:"quantity"`
}

type materializedStartingEquipmentOption struct {
	Items []materializedStartingEquipmentItem `json:"items"`
	Gold  int                                 `json:"gold"`
}

func activeCatalogEntityID(tx *sql.Tx, table, cardNumber string) (string, error) {
	if table != "cards" && table != "effects" {
		return "", fmt.Errorf("unsupported identity table %q", table)
	}
	var id string
	query := fmt.Sprintf(`SELECT id::text FROM %s WHERE card_number = $1 AND deleted_at IS NULL`, table)
	if err := tx.QueryRow(query, cardNumber).Scan(&id); err != nil {
		if err == sql.ErrNoRows {
			return "", fmt.Errorf("active %s identity %s is missing", table, cardNumber)
		}
		return "", fmt.Errorf("resolve %s identity %s: %w", table, cardNumber, err)
	}
	return id, nil
}

func materializeStartingEquipmentOption(
	tx *sql.Tx,
	option *startingEquipmentOptionIdentity,
) (*materializedStartingEquipmentOption, error) {
	if option == nil {
		return nil, nil
	}
	result := &materializedStartingEquipmentOption{
		Items: make([]materializedStartingEquipmentItem, 0, len(option.Items)),
		Gold:  option.Gold,
	}
	for _, item := range option.Items {
		if item.Quantity <= 0 {
			return nil, fmt.Errorf("%s has invalid quantity %d", item.CardNumber, item.Quantity)
		}
		id, err := activeCatalogEntityID(tx, "cards", item.CardNumber)
		if err != nil {
			return nil, err
		}
		result.Items = append(result.Items, materializedStartingEquipmentItem{
			CardID: id, Quantity: item.Quantity,
		})
	}
	return result, nil
}

func repairRangerLongbowProfile(tx *sql.Tx) error {
	longbowID, err := activeCatalogEntityID(tx, "cards", "CARD-0327")
	if err != nil {
		return err
	}
	ammoID, err := activeCatalogEntityID(tx, "cards", "CARD-0728")
	if err != nil {
		return err
	}
	masteryID, err := activeCatalogEntityID(tx, "effects", "EFFECT-0250")
	if err != nil {
		return err
	}
	profile := weaponProfileBase(
		"longbow", "martial", "dex", "1d8", "piercing", "ranged", masteryID,
		[]map[string]any{{"kind": "ranged", "normal_ft": 150, "long_ft": 600}},
		[]string{"ammunition", "two_handed", "heavy"},
		map[string]any{"card_id": ammoID, "name": "Стрела"},
	)
	profile["heavy"] = map[string]any{
		"minimum_ability_score": 13,
		"ability_by_mode":       map[string]any{"melee": "str", "ranged": "dex"},
		"consequence":           "attack_disadvantage",
	}
	payload, err := json.Marshal(profile)
	if err != nil {
		return fmt.Errorf("marshal Ranger longbow profile: %w", err)
	}
	if _, err = tx.Exec(`
		UPDATE cards
		SET weapon_type = 'longbow', mastery = $2, range = '150/600',
			mechanics = jsonb_set(COALESCE(mechanics, '{}'::jsonb), '{weapon_profile}', $3::jsonb, true),
			updated_at = NOW()
		WHERE id = $1::uuid AND card_number = 'CARD-0327' AND deleted_at IS NULL
		  AND (
			weapon_type IS DISTINCT FROM 'longbow'
			OR mastery IS DISTINCT FROM $2
			OR range IS DISTINCT FROM '150/600'
			OR COALESCE(mechanics->'weapon_profile', 'null'::jsonb) IS DISTINCT FROM $3::jsonb
		  )
	`, longbowID, masteryID, string(payload)); err != nil {
		return fmt.Errorf("repair Ranger longbow declaration: %w", err)
	}
	return nil
}

func findDanglingClassEquipmentReferences(tx *sql.Tx) ([]string, error) {
	rows, err := tx.Query(`
		SELECT class.card_number, option_entry.key, COALESCE(item->>'card_id', '<blank>')
		FROM classes AS class
		CROSS JOIN LATERAL jsonb_each(COALESCE(class.equipment_options, '{}'::jsonb)) AS option_entry
		CROSS JOIN LATERAL jsonb_array_elements(COALESCE(option_entry.value->'items', '[]'::jsonb)) AS item
		LEFT JOIN cards AS card
			ON card.id::text = item->>'card_id' AND card.deleted_at IS NULL
		WHERE class.deleted_at IS NULL
		  AND COALESCE(class.is_subclass, FALSE) = FALSE
		  AND card.id IS NULL
		ORDER BY class.card_number, option_entry.key, item->>'card_id'
	`)
	if err != nil {
		return nil, fmt.Errorf("scan class starting-equipment references: %w", err)
	}
	defer rows.Close()

	var dangling []string
	for rows.Next() {
		var classCardNumber, option, cardID string
		if err := rows.Scan(&classCardNumber, &option, &cardID); err != nil {
			return nil, err
		}
		dangling = append(dangling, fmt.Sprintf("%s.%s -> %s", classCardNumber, option, cardID))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return dangling, nil
}

// repairClassStartingEquipmentReferences replaces legacy UUID references with
// stable PHB 2024 identities and then checks referential closure for the whole
// active, non-subclass class catalog. It deliberately fails closed instead of
// teaching the runtime to guess replacement equipment.
func repairClassStartingEquipmentReferences(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	rangerPresent := false
	for _, repair := range canonicalClassStartingEquipment {
		var classID string
		err := tx.QueryRow(`
			SELECT id::text FROM classes
			WHERE card_number = $1 AND deleted_at IS NULL
			  AND COALESCE(is_subclass, FALSE) = FALSE
		`, repair.ClassCardNumber).Scan(&classID)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			return fmt.Errorf("resolve class %s: %w", repair.ClassCardNumber, err)
		}

		optionA, err := materializeStartingEquipmentOption(tx, repair.OptionA)
		if err != nil {
			return fmt.Errorf("materialize %s option_a: %w", repair.ClassCardNumber, err)
		}
		optionB, err := materializeStartingEquipmentOption(tx, repair.OptionB)
		if err != nil {
			return fmt.Errorf("materialize %s option_b: %w", repair.ClassCardNumber, err)
		}
		optionC, err := materializeStartingEquipmentOption(tx, repair.OptionC)
		if err != nil {
			return fmt.Errorf("materialize %s option_c: %w", repair.ClassCardNumber, err)
		}
		options := map[string]*materializedStartingEquipmentOption{}
		if optionA != nil {
			options["option_a"] = optionA
		}
		if optionB != nil {
			options["option_b"] = optionB
		}
		if optionC != nil {
			options["option_c"] = optionC
		}
		payload, err := json.Marshal(options)
		if err != nil {
			return fmt.Errorf("marshal %s starting equipment: %w", repair.ClassCardNumber, err)
		}
		if _, err = tx.Exec(`
			UPDATE classes SET equipment_options = $2::jsonb, updated_at = NOW()
			WHERE id = $1::uuid AND COALESCE(equipment_options, '{}'::jsonb) IS DISTINCT FROM $2::jsonb
		`, classID, string(payload)); err != nil {
			return fmt.Errorf("repair %s starting equipment: %w", repair.ClassCardNumber, err)
		}
		if repair.ClassCardNumber == "CLASS-ranger" {
			rangerPresent = true
		}
	}
	if rangerPresent {
		if err := repairRangerLongbowProfile(tx); err != nil {
			return err
		}
	}

	dangling, err := findDanglingClassEquipmentReferences(tx)
	if err != nil {
		return err
	}
	if len(dangling) > 0 {
		return fmt.Errorf("class starting-equipment catalog has dangling card references: %s", strings.Join(dangling, "; "))
	}
	return tx.Commit()
}
