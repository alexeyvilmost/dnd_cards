package migrations

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

//go:embed entity_tags_258_seed.json
var entityTags258Seed []byte

func createEntityTags258(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`
 CREATE TABLE entity_tag_definitions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),description text NOT NULL DEFAULT '');
 CREATE UNIQUE INDEX entity_tag_name_unique ON entity_tag_definitions(lower(name));
 CREATE TABLE entity_tag_assignments(entity_type text NOT NULL,entity_id text NOT NULL,tag_id uuid NOT NULL REFERENCES entity_tag_definitions(id),PRIMARY KEY(entity_type,entity_id,tag_id));
 CREATE INDEX entity_tag_pool ON entity_tag_assignments(tag_id,entity_type,entity_id);
 CREATE TABLE legacy_entity_tags_258(entity_type text NOT NULL,entity_id text NOT NULL,tags jsonb NOT NULL,PRIMARY KEY(entity_type,entity_id));
 CREATE TABLE roguelike_shop_settings(id integer PRIMARY KEY CHECK(id=1),version integer NOT NULL DEFAULT 1,config jsonb NOT NULL);
 CREATE TABLE roguelike_item_rules(card_id uuid PRIMARY KEY REFERENCES cards(id),min_level integer NOT NULL DEFAULT 1 CHECK(min_level BETWEEN 1 AND 5),weight integer NOT NULL DEFAULT 1 CHECK(weight BETWEEN 1 AND 1000),kind text NOT NULL DEFAULT 'equipment' CHECK(kind IN ('equipment','consumable','magic')),quantity integer NOT NULL DEFAULT 1 CHECK(quantity BETWEEN 1 AND 1000),price integer CHECK(price>=0));
 INSERT INTO entity_tag_definitions(id,name,description) VALUES
 ('d2580000-0000-4000-8000-000000000001','Предмет забега','Участвует в случайном ассортименте и добыче забега.'),
 ('d2580000-0000-4000-8000-000000000002','Стартовая экипировка','Доступна за оставшееся золото до первой победы в забеге.'),
 ('d2580000-0000-4000-8000-000000000003','Базовый товар забега','Постоянный товар без ограничения количества покупок.');
 INSERT INTO roguelike_shop_settings(id,config) VALUES(1,'{
 "pool_tag":"d2580000-0000-4000-8000-000000000001","starting_tag":"d2580000-0000-4000-8000-000000000002","staple_tag":"d2580000-0000-4000-8000-000000000003",
 "supplies_price":20,"refresh_price":5,"levels":[
 {"level":1,"slots":5,"magic_limit":5,"uncommon_bp":50,"rare_bp":0,"epic_bp":0},
 {"level":2,"slots":6,"magic_limit":6,"uncommon_bp":125,"rare_bp":10,"epic_bp":0},
 {"level":3,"slots":7,"magic_limit":7,"uncommon_bp":210,"rare_bp":50,"epic_bp":0},
 {"level":4,"slots":8,"magic_limit":8,"uncommon_bp":300,"rare_bp":125,"epic_bp":10},
 {"level":5,"slots":9,"magic_limit":9,"uncommon_bp":300,"rare_bp":125,"epic_bp":10}]}');
 `); err != nil {
		return err
	}
	// Preserve every old metadata value (including duplicates) before retirement.
	for kind, table := range map[string]string{"card": "cards", "action": "actions", "effect": "effects", "spell": "spells", "feat": "feats", "background": "backgrounds", "race": "races", "class": "classes"} {
		query := fmt.Sprintf(`SELECT id::text,CASE WHEN jsonb_typeof(to_jsonb(tags))='string' THEN (to_jsonb(tags)#>>'{}')::jsonb ELSE to_jsonb(tags) END FROM %s WHERE tags IS NOT NULL`, table)
		rows, e := tx.Query(query)
		if e != nil {
			return e
		}
		type oldRow struct {
			id  string
			raw []byte
		}
		old := []oldRow{}
		for rows.Next() {
			var r oldRow
			if e = rows.Scan(&r.id, &r.raw); e != nil {
				rows.Close()
				return e
			}
			old = append(old, r)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		for _, r := range old {
			if _, err = tx.Exec(`INSERT INTO legacy_entity_tags_258 VALUES($1,$2,$3::jsonb)`, kind, r.id, r.raw); err != nil {
				return err
			}
			var tags []string
			if err = json.Unmarshal(r.raw, &tags); err != nil {
				return fmt.Errorf("invalid legacy tags %s/%s: %w", kind, r.id, err)
			}
			for _, name := range tags {
				name = strings.Join(strings.Fields(name), " ")
				if name == "" {
					continue
				}
				if _, err = tx.Exec(`INSERT INTO entity_tag_definitions(name) VALUES($1) ON CONFLICT DO NOTHING`, name); err != nil {
					return err
				}
				if _, err = tx.Exec(`INSERT INTO entity_tag_assignments SELECT $1,$2,id FROM entity_tag_definitions WHERE lower(name)=lower($3) ON CONFLICT DO NOTHING`, kind, r.id, name); err != nil {
					return err
				}
			}
		}
		// Retain a read-only wire snapshot: old certifications hashed this field.
		// It is not editable, searchable or used for mechanics/pool membership.
		if _, err = tx.Exec(fmt.Sprintf(`ALTER TABLE %s RENAME COLUMN tags TO legacy_tags`, table)); err != nil {
			return err
		}
	}
	var seeds []struct {
		CardNumber string `json:"card_number"`
		Price      int    `json:"price"`
		MinLevel   int    `json:"min_level"`
		Weight     int    `json:"weight"`
		Kind       string `json:"kind"`
	}
	if err = json.Unmarshal(entityTags258Seed, &seeds); err != nil {
		return err
	}
	for _, s := range seeds {
		var id string
		if err = tx.QueryRow(`SELECT id::text FROM cards WHERE card_number=$1 AND deleted_at IS NULL`, s.CardNumber).Scan(&id); err != nil {
			return fmt.Errorf("seed tag for %s: %w", s.CardNumber, err)
		}
		if _, err = tx.Exec(`INSERT INTO entity_tag_assignments VALUES('card',$1,'d2580000-0000-4000-8000-000000000001') ON CONFLICT DO NOTHING`, id); err != nil {
			return err
		}
		if _, err = tx.Exec(`INSERT INTO roguelike_item_rules(card_id,min_level,weight,kind,price) VALUES($1,$2,$3,$4,$5)`, id, s.MinLevel, s.Weight, s.Kind, s.Price); err != nil {
			return err
		}
	}
	// Initial seed from the already materialized PHB base equipment. Thereafter
	// administrators own membership; generation never consults these manifests.
	starting := []string{}
	for _, w := range baseWeapons2024 {
		starting = append(starting, w.CardNumber)
	}
	for _, a := range baseArmors2024 {
		starting = append(starting, a.CardNumber)
	}
	for _, u := range utilityItems2024() {
		starting = append(starting, u.CardNumber)
	}
	for _, number := range starting {
		if _, err = tx.Exec(`INSERT INTO entity_tag_assignments SELECT 'card',id::text,'d2580000-0000-4000-8000-000000000002'::uuid FROM cards WHERE deleted_at IS NULL AND rarity='common' AND price IS NOT NULL AND card_number=$1 ON CONFLICT DO NOTHING`, number); err != nil {
			return err
		}
	}
	// Retain old standalone staple bundle prices as shop data.
	if _, err = tx.Exec(`
 INSERT INTO entity_tag_assignments SELECT 'card',id::text,'d2580000-0000-4000-8000-000000000002'::uuid FROM cards
 WHERE deleted_at IS NULL AND is_template='template' AND rarity='common' AND price IS NOT NULL ON CONFLICT DO NOTHING;
 INSERT INTO entity_tag_assignments SELECT 'card',id::text,'d2580000-0000-4000-8000-000000000003'::uuid FROM cards
 WHERE deleted_at IS NULL AND card_number IN ('CARD-0839','CARD-0728','CARD-0749') ON CONFLICT DO NOTHING;
 INSERT INTO roguelike_item_rules(card_id,kind,quantity,price) SELECT id,'consumable',CASE WHEN card_number='CARD-0839' THEN 1 ELSE 20 END,CASE WHEN card_number='CARD-0839' THEN 50 ELSE 1 END
 FROM cards WHERE deleted_at IS NULL AND card_number IN ('CARD-0839','CARD-0728','CARD-0749') ON CONFLICT DO NOTHING;
 `); err != nil {
		return err
	}
	return tx.Commit()
}
