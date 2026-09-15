package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"dnd-cards-backend/roguelikecontent"
)

// Keep exact preimages in the same transaction as the content changes. Prices
// on original library cards are untouched; the merchant receives distinct ids.
func materializeRoguelikeShopItems(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`CREATE TABLE IF NOT EXISTS roguelike_shop_item_migration_249 (
		card_id uuid PRIMARY KEY, copy_id uuid NOT NULL UNIQUE,
		before_mechanics jsonb, before_support jsonb, after_mechanics jsonb NOT NULL,
		copy_postimage jsonb NOT NULL, applied_at timestamptz NOT NULL DEFAULT NOW()
	)`)
	if err != nil {
		return err
	}
	for _, item := range roguelikecontent.ShopItems() {
		var sourceJSON []byte
		if err := tx.QueryRow(`SELECT to_jsonb(c) FROM cards c WHERE id=$1::uuid AND card_number=$2 AND deleted_at IS NULL FOR UPDATE`,
			item.Source.ID, item.Source.CardNumber).Scan(&sourceJSON); err != nil {
			return fmt.Errorf("%s source: %w", item.Source.CardNumber, err)
		}
		var source map[string]json.RawMessage
		if err := json.Unmarshal(sourceJSON, &source); err != nil {
			return err
		}
		for key, expected := range map[string]string{"name": item.Source.Name, "description": item.Source.Description, "rarity": item.Source.Rarity} {
			var value string
			if err := json.Unmarshal(source[key], &value); err != nil || value != expected {
				return fmt.Errorf("%s %s drifted", item.Source.CardNumber, key)
			}
		}
		var recorded bool
		if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM roguelike_shop_item_migration_249 WHERE card_id=$1::uuid)`, item.Source.ID).Scan(&recorded); err != nil {
			return err
		}
		if recorded {
			var valid bool
			if err := tx.QueryRow(`SELECT c.mechanics IS NOT DISTINCT FROM a.after_mechanics
				AND (to_jsonb(copy)-'updated_at') = (a.copy_postimage-'updated_at')
				FROM roguelike_shop_item_migration_249 a JOIN cards c ON c.id=a.card_id JOIN cards copy ON copy.id=a.copy_id
				WHERE a.card_id=$1::uuid`, item.Source.ID).Scan(&valid); err != nil {
				return err
			}
			if !valid {
				return fmt.Errorf("%s applied content drifted", item.Source.CardNumber)
			}
			continue
		}
		var matches bool
		if err := tx.QueryRow(`SELECT COALESCE(mechanics,'null'::jsonb) = $2::jsonb FROM cards WHERE id=$1::uuid`, item.Source.ID, string(item.Source.Mechanics)).Scan(&matches); err != nil {
			return err
		}
		if !matches {
			return fmt.Errorf("%s mechanics preimage drifted; review the production record before applying", item.Source.CardNumber)
		}
		if _, err := tx.Exec(`UPDATE cards SET mechanics=$2::jsonb, support=NULL, updated_at=NOW()
			WHERE id=$1::uuid AND mechanics IS DISTINCT FROM $2::jsonb`, item.Source.ID, string(item.Mechanics)); err != nil {
			return err
		}
		patch, err := json.Marshal(map[string]any{"id": item.ID, "card_number": item.CardNumber, "name": item.Name,
			"price": item.Price, "price_currency": "gold", "rarity": item.Rarity, "mechanics": item.Mechanics,
			"support": nil, "source": "roguelike-shop-249:" + item.Source.ID})
		if err != nil {
			return err
		}
		var copyJSON []byte
		if err := tx.QueryRow(`INSERT INTO cards SELECT (jsonb_populate_record(NULL::cards,
			to_jsonb(c) || $2::jsonb || jsonb_build_object('created_at',NOW(),'updated_at',NOW()))).*
			FROM cards c WHERE c.id=$1::uuid RETURNING to_jsonb(cards)`, item.Source.ID, string(patch)).Scan(&copyJSON); err != nil {
			return fmt.Errorf("%s copy: %w", item.CardNumber, err)
		}
		if _, err := tx.Exec(`INSERT INTO roguelike_shop_item_migration_249(card_id,copy_id,before_mechanics,before_support,after_mechanics,copy_postimage)
			VALUES($1::uuid,$2::uuid,NULLIF($3::jsonb,'null'::jsonb),NULLIF($4::jsonb,'null'::jsonb),$5::jsonb,$6::jsonb)`, item.Source.ID, item.ID, string(source["mechanics"]), string(source["support"]), string(item.Mechanics), string(copyJSON)); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Keep merchant copies readable for characters that already own them. Rolling
// back the merchant code removes them from future stock, not from inventories.
func rollbackRoguelikeShopItems(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, item := range roguelikecontent.ShopItems() {
		var matches bool
		if err := tx.QueryRow(`SELECT c.mechanics IS NOT DISTINCT FROM a.after_mechanics
			AND (to_jsonb(copy)-'updated_at') = (a.copy_postimage-'updated_at')
			FROM roguelike_shop_item_migration_249 a JOIN cards c ON c.id=a.card_id JOIN cards copy ON copy.id=a.copy_id
			WHERE a.card_id=$1::uuid FOR UPDATE OF c,copy`, item.Source.ID).Scan(&matches); err != nil {
			return err
		}
		if !matches {
			return fmt.Errorf("%s changed after migration; rollback refused", item.Source.CardNumber)
		}
		if _, err := tx.Exec(`UPDATE cards c SET mechanics=a.before_mechanics,support=a.before_support,updated_at=NOW()
			FROM roguelike_shop_item_migration_249 a WHERE c.id=a.card_id AND c.id=$1::uuid`, item.Source.ID); err != nil {
			return err
		}
	}
	return tx.Commit()
}
