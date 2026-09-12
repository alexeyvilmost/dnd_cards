package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

type monsterWeaponAction247 struct {
	actionCard string
	weaponCard string
}

type monsterWeaponLoadout247 struct {
	slug                       string
	armorClass, maxHP, speed   int
	primaryCard, secondaryCard string
	actions                    []monsterWeaponAction247
}

var monsterWeaponLoadouts247 = []monsterWeaponLoadout247{
	{slug: "bandit-captain", armorClass: 15, maxHP: 52, speed: 30, primaryCard: "CARD-0311", secondaryCard: "CARD-0838", actions: []monsterWeaponAction247{
		{actionCard: "RL-MA-CAPTAIN-SCIM", weaponCard: "CARD-0311"},
		{actionCard: "RL-MA-CAPTAIN-PISTOL", weaponCard: "CARD-0838"},
	}},
	{slug: "warrior-veteran", armorClass: 17, maxHP: 65, speed: 30, primaryCard: "CARD-0317", secondaryCard: "CARD-0328", actions: []monsterWeaponAction247{
		{actionCard: "RL-MA-VETERAN-SWORD", weaponCard: "CARD-0317"},
		{actionCard: "RL-MA-VETERAN-XBOW", weaponCard: "CARD-0328"},
	}},
}

// SRD 5.2.1 Bandit Captain and Warrior Veteran each own two physical weapons.
// Freeze both cards, bind each stat-block action to its weapon and let the
// deterministic monster controller ready the carried alternative before use.
func materializeMonsterWeaponLoadouts(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, row := range monsterWeaponLoadouts247 {
		cards := make([]json.RawMessage, 0, 2)
		weaponIDs := map[string]string{}
		for _, cardNumber := range []string{row.primaryCard, row.secondaryCard} {
			var frozen, id string
			if err = tx.QueryRow(`SELECT (to_jsonb(c)-'created_at'-'updated_at'-'deleted_at')::text,c.id::text
 FROM cards c WHERE card_number=$1 AND deleted_at IS NULL`, cardNumber).Scan(&frozen, &id); err != nil {
				return fmt.Errorf("missing weapon %s for %s: %w", cardNumber, row.slug, err)
			}
			cards = append(cards, json.RawMessage(frozen))
			weaponIDs[cardNumber] = id
		}
		actionWeapons := map[string]string{}
		for _, binding := range row.actions {
			var actionID, current string
			if err = tx.QueryRow(`SELECT id::text,COALESCE(mechanics->>'requires_held_item','')
 FROM actions WHERE card_number=$1 AND deleted_at IS NULL`, binding.actionCard).Scan(&actionID, &current); err != nil {
				return fmt.Errorf("missing action %s for %s: %w", binding.actionCard, row.slug, err)
			}
			weaponID := weaponIDs[binding.weaponCard]
			if current != "" && current != weaponID {
				return fmt.Errorf("conflicting weapon binding on %s", binding.actionCard)
			}
			actionWeapons[actionID] = weaponID
			if _, err = tx.Exec(`UPDATE actions SET mechanics=mechanics || jsonb_build_object('requires_held_item',$2::text),updated_at=NOW()
 WHERE card_number=$1 AND deleted_at IS NULL AND NOT mechanics @> jsonb_build_object('requires_held_item',$2::text)`, binding.actionCard, weaponID); err != nil {
				return err
			}
		}
		expected, err := json.Marshal(map[string]any{
			"held_weapon_cards": cards,
			"action_weapon_ids": actionWeapons,
		})
		if err != nil {
			return err
		}
		var valid bool
		if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM monsters WHERE slug=$1 AND deleted_at IS NULL
 AND armor_class=$2 AND max_hp=$3 AND speed=$4
 AND (NOT ai ? 'held_weapon_cards' OR ai->'held_weapon_cards'=$5::jsonb->'held_weapon_cards')
 AND (NOT ai ? 'action_weapon_ids' OR ai->'action_weapon_ids'=$5::jsonb->'action_weapon_ids'))`,
			row.slug, row.armorClass, row.maxHP, row.speed, expected).Scan(&valid); err != nil {
			return err
		}
		if !valid {
			return fmt.Errorf("%s stat block or weapon loadout is missing, changed, or conflicting", row.slug)
		}
		result, err := tx.Exec(`UPDATE monsters SET ai=ai || $2::jsonb,updated_at=NOW()
 WHERE slug=$1 AND deleted_at IS NULL AND NOT ai @> $2::jsonb`, row.slug, expected)
		if err != nil {
			return err
		}
		if n, e := result.RowsAffected(); e != nil || n > 1 {
			return fmt.Errorf("unexpected %s updates: %d (%v)", row.slug, n, e)
		}
	}
	return tx.Commit()
}
