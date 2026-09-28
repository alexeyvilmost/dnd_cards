package migrations

import (
	"database/sql"
	"dnd-cards-backend/roguelikecontent"
	"encoding/json"
	"fmt"
)

func addUrvinRun273(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`ALTER TABLE roguelike_runs ADD COLUMN IF NOT EXISTS mode varchar(24) NOT NULL DEFAULT 'classic';
 ALTER TABLE roguelike_runs ADD COLUMN IF NOT EXISTS journey jsonb NOT NULL DEFAULT '{}';
 ALTER TABLE roguelike_runs ADD COLUMN IF NOT EXISTS mode_rules jsonb NOT NULL DEFAULT '{}';
 ALTER TABLE roguelike_runs ADD COLUMN IF NOT EXISTS journey_private jsonb NOT NULL DEFAULT '{}';
 CREATE TABLE IF NOT EXISTS roguelike_mode_definitions (id varchar(24) PRIMARY KEY, definition jsonb NOT NULL);`); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO roguelike_mode_definitions(id,definition) VALUES ('urvin',$1::jsonb) ON CONFLICT(id) DO NOTHING`, string(roguelikecontent.UrvinDefinition)); err != nil {
		return err
	}
	var definition struct {
		Auras []struct {
			ID, Name, Description string
			CardNumber            string `json:"card_number"`
			ImageURL              string `json:"image_url"`
			Mechanics             json.RawMessage
		}
	}
	if err = json.Unmarshal(roguelikecontent.UrvinDefinition, &definition); err != nil {
		return err
	}
	for _, aura := range definition.Auras {
		if _, err = tx.Exec(`INSERT INTO effects(id,name,description,detailed_description,image_url,rarity,card_number,effect_type,mechanics,repeatable,author,source,support)
   VALUES($1,$2,$3,$3,$4,'uncommon',$5,'positive_effect',$6::jsonb,false,'System','Bag Of Holding','{"status":"untested","mechanics_locked":false}'::jsonb)
   ON CONFLICT(card_number) DO NOTHING`, aura.ID, aura.Name, aura.Description, aura.ImageURL, aura.CardNumber, string(aura.Mechanics)); err != nil {
			return err
		}
	}
	// New creatures use ordinary attack/action declarations and the common monster compiler.
	rows := []struct {
		Slug, Name, Size, CR, Dice, DamageType string
		HP, AC, Bonus, Repeats, XP             int
	}{
		{"urvin-goblin-warden", "Урвинский дозорный", "small", "1/2", "1d6 + 2", "piercing", 22, 13, 4, 1, 100},
		{"urvin-stone-warden", "Каменный привратник", "large", "1", "1d8 + 3", "bludgeoning", 35, 14, 4, 1, 200},
		{"urvin-ash-hound", "Пепельная гончая", "large", "2", "2d6 + 3", "fire", 52, 14, 5, 1, 450},
		{"urvin-harbinger", "Вестник затмения", "medium", "3", "1d8 + 3", "necrotic", 72, 15, 5, 2, 700},
		{"urvin-dreadlord", "Хранитель Чёрных врат", "huge", "4", "1d10 + 4", "slashing", 96, 16, 6, 2, 1100},
	}
	for i, row := range rows {
		actionID := fmt.Sprintf("b2730000-0000-4000-8000-%012d", i+1)
		monsterID := fmt.Sprintf("c2730000-0000-4000-8000-%012d", i+1)
		attack := roguelikeMonsterAttack{Ability: "str", Kind: "weapon_melee", Damage: row.Dice, DamageType: row.DamageType, Bonus: row.Bonus, Range: 5, Repeats: row.Repeats}
		mechanics, _ := json.Marshal(roguelikeAttackMechanics(attack))
		if _, err = tx.Exec(`INSERT INTO actions(id,name,description,rarity,card_number,resource,mechanics,action_type,type,author,source)
   VALUES($1,$2,$3,'common',$4,'action',$5::jsonb,'base_action','monster','System','Bag Of Holding') ON CONFLICT(card_number) DO NOTHING`, actionID, "Удар · "+row.Name, "Атака хранителя Урвинских земель.", "URVIN-ATTACK-"+row.Slug, string(mechanics)); err != nil {
			return err
		}
		ai, _ := json.Marshal(map[string]any{"strategy": "tactical", "preferred_range_ft": 5, "experience": row.XP})
		if _, err = tx.Exec(`INSERT INTO monsters(id,slug,name,description,size,creature_type,alignment,challenge_rating,armor_class,max_hp,speed,initiative_bonus,proficiency_bonus,abilities,action_ids,effect_ids,ai,source,support)
   VALUES($1,$2,$3,$4,$5,'monstrosity','neutral evil',$6,$7,$8,30,1,2,'{"str":16,"dex":12,"con":14,"int":10,"wis":12,"cha":10}',jsonb_build_array($9::text),'[]',$10::jsonb,'Bag Of Holding','{"status":"untested","mechanics_locked":false}') ON CONFLICT(slug) DO NOTHING`, monsterID, row.Slug, row.Name, "Хранитель Урвинского пути. Его сила и сопровождающие зависят от состава встречи.", row.Size, row.CR, row.AC, row.HP, actionID, string(ai)); err != nil {
			return err
		}
	}
	return tx.Commit()
}
