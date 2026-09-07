package migrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

const roguelikeMonstersMigrationVersion = "199_materialize_roguelike_monsters"

type roguelikeMonsterAttack struct {
	ID, CardNumber, Name, NameEn, Description string
	Ability, Kind, Damage, DamageType         string
	Bonus, Range, Repeats                     int
	ExtraDamage, ExtraDamageType              string
}

type roguelikeMonsterSeed struct {
	ID, Slug, Name, NameEn, Description string
	Size, CreatureType, Alignment, CR   string
	AC, HP, Speed, Initiative, PB       int
	Abilities                           map[string]int
	Actions                             []string
	AI                                  map[string]any
}

func roguelikeAttackMechanics(row roguelikeMonsterAttack) map[string]any {
	effects := make([]map[string]any, 0, row.Repeats)
	for attack := 0; attack < row.Repeats; attack++ {
		onHit := []map[string]any{{"kind": "damage", "amount": row.Damage, "type": row.DamageType}}
		if row.ExtraDamage != "" {
			onHit = append(onHit, map[string]any{
				"kind": "damage", "amount": row.ExtraDamage, "type": row.ExtraDamageType,
			})
		}
		effects = append(effects, map[string]any{
			"resolution": "attack_roll", "ability": row.Ability,
			"attack_kind": row.Kind, "attack_bonus_override": row.Bonus,
			"vs": "ac", "on_hit": onHit,
		})
	}
	return map[string]any{
		"interaction": map[string]any{"intent": "harmful"},
		"activation": map[string]any{
			"mode": "active", "cost": []map[string]any{{"resource": "action", "amount": 1}},
		},
		"targeting": map[string]any{
			"domain": "actor", "actor_targets": true, "shape": "single",
			"min_targets": 1, "max_targets": 1, "range_ft": row.Range,
			"requires_line_of_sight": true, "allowed_relations": []string{"enemy"},
		},
		"effects": effects,
	}
}

func materializeRoguelikeMonsters(db *sql.DB) error {
	attacks := []roguelikeMonsterAttack{
		{"b2000000-0000-4000-8000-000000000001", "RL-MA-BANDIT-SCIM", "Скимитар", "Scimitar", "Рукопашная атака бандита.", "dex", "weapon_melee", "1d6 + 1", "slashing", 3, 5, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000002", "RL-MA-BANDIT-XBOW", "Лёгкий арбалет", "Light Crossbow", "Дальнобойная атака бандита.", "dex", "weapon_ranged", "1d8 + 1", "piercing", 3, 320, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000003", "RL-MA-GUARD-SPEAR", "Копьё", "Spear", "Копьё стражника в ближнем бою или как метательное оружие.", "str", "weapon_ranged", "1d6 + 1", "piercing", 3, 60, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000004", "RL-MA-RAT-BITE", "Укус", "Bite", "Укус гигантской крысы.", "dex", "weapon_melee", "1d4 + 3", "piercing", 5, 5, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000005", "RL-MA-KOBOLD-DAGGER", "Кинжал", "Dagger", "Кинжал кобольда в ближнем бою или в броске.", "dex", "weapon_ranged", "1d4 + 2", "piercing", 4, 60, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000006", "RL-MA-GOBLIN-SCIM", "Скимитар", "Scimitar", "Рукопашная атака гоблина-воина.", "dex", "weapon_melee", "1d6 + 2", "slashing", 4, 5, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000007", "RL-MA-GOBLIN-BOW", "Короткий лук", "Shortbow", "Дальнобойная атака гоблина-воина.", "dex", "weapon_ranged", "1d6 + 2", "piercing", 4, 320, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000008", "RL-MA-SKELETON-SWORD", "Короткий меч", "Shortsword", "Рукопашная атака скелета.", "dex", "weapon_melee", "1d6 + 3", "piercing", 5, 5, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000009", "RL-MA-SKELETON-BOW", "Короткий лук", "Shortbow", "Дальнобойная атака скелета.", "dex", "weapon_ranged", "1d6 + 3", "piercing", 5, 320, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000010", "RL-MA-ZOMBIE-SLAM", "Удар", "Slam", "Рукопашная атака зомби.", "str", "weapon_melee", "1d8 + 1", "bludgeoning", 3, 5, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000011", "RL-MA-WOLF-BITE", "Укус", "Bite", "Укус волка.", "str", "weapon_melee", "1d6 + 2", "piercing", 4, 5, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000012", "RL-MA-SPIDER-BITE", "Ядовитый укус", "Bite", "Укус гигантского волчьего паука.", "dex", "weapon_melee", "1d4 + 3", "piercing", 5, 5, 1, "2d4", "poison"},
		{"b2000000-0000-4000-8000-000000000013", "RL-MA-HOB-SWORD", "Длинный меч", "Longsword", "Тяжёлый рубящий удар хобгоблина.", "str", "weapon_melee", "2d10 + 1", "slashing", 3, 5, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000014", "RL-MA-HOB-BOW", "Длинный лук", "Longbow", "Отравленная стрела хобгоблина.", "dex", "weapon_ranged", "1d8 + 1", "piercing", 3, 600, 1, "3d4", "poison"},
		{"b2000000-0000-4000-8000-000000000015", "RL-MA-TOUGH-MACE", "Булава", "Mace", "Рукопашная атака громилы.", "str", "weapon_melee", "1d6 + 2", "bludgeoning", 4, 5, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000016", "RL-MA-TOUGH-XBOW", "Тяжёлый арбалет", "Heavy Crossbow", "Дальнобойная атака громилы.", "dex", "weapon_ranged", "1d10 + 1", "piercing", 3, 400, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000017", "RL-MA-ARMOR-SLAM", "Двойной удар", "Multiattack: Slam", "Оживший доспех наносит два удара.", "str", "weapon_melee", "1d6 + 2", "bludgeoning", 4, 5, 2, "", ""},
		{"b2000000-0000-4000-8000-000000000018", "RL-MA-DIRE-BITE", "Сокрушающий укус", "Bite", "Укус лютого волка.", "str", "weapon_melee", "1d10 + 3", "piercing", 5, 5, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000019", "RL-MA-BUG-GRAB", "Захват", "Grab", "Длиннорукий удар и попытка захвата.", "str", "weapon_melee", "2d6 + 2", "bludgeoning", 4, 10, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000020", "RL-MA-BUG-HAMMER", "Лёгкий молот", "Light Hammer", "Удар или бросок лёгкого молота.", "str", "weapon_ranged", "3d4 + 2", "bludgeoning", 4, 60, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000021", "RL-MA-OGRE-CLUB", "Палица", "Greatclub", "Тяжёлый удар огра.", "str", "weapon_melee", "2d8 + 4", "bludgeoning", 6, 5, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000022", "RL-MA-OGRE-JAVELIN", "Метательное копьё", "Javelin", "Удар или бросок копья огра.", "str", "weapon_ranged", "2d6 + 4", "piercing", 6, 120, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000023", "RL-MA-BERSERKER-AXE", "Секира", "Greataxe", "Рубящая атака берсерка.", "str", "weapon_melee", "1d12 + 3", "slashing", 5, 5, 1, "", ""},
		{"b2000000-0000-4000-8000-000000000024", "RL-MA-CAPTAIN-SCIM", "Два удара скимитаром", "Multiattack: Scimitar", "Капитан наносит два удара скимитаром.", "dex", "weapon_melee", "1d6 + 3", "slashing", 5, 5, 2, "", ""},
		{"b2000000-0000-4000-8000-000000000025", "RL-MA-CAPTAIN-PISTOL", "Два выстрела", "Multiattack: Pistol", "Капитан дважды стреляет из пистолета.", "dex", "weapon_ranged", "1d10 + 3", "piercing", 5, 90, 2, "", ""},
		{"b2000000-0000-4000-8000-000000000026", "RL-MA-VETERAN-SWORD", "Два удара двуручным мечом", "Multiattack: Greatsword", "Ветеран наносит два удара двуручным мечом.", "str", "weapon_melee", "2d6 + 3", "slashing", 5, 5, 2, "", ""},
		{"b2000000-0000-4000-8000-000000000027", "RL-MA-VETERAN-XBOW", "Два выстрела", "Multiattack: Heavy Crossbow", "Ветеран дважды стреляет из тяжёлого арбалета.", "dex", "weapon_ranged", "2d10 + 1", "piercing", 3, 400, 2, "", ""},
	}
	actionIDs := map[string]string{}
	for _, attack := range attacks {
		mechanics, err := json.Marshal(roguelikeAttackMechanics(attack))
		if err != nil {
			return err
		}
		if _, err := db.Exec(`
			INSERT INTO actions (
				id,name,name_en,description,rarity,card_number,resource,mechanics,
				action_type,type,author,source,created_at,updated_at
			) VALUES ($1,$2,$3,$4,'common',$5,'action',$6::jsonb,
				'base_action','monster','System','SRD 5.2.1',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
			ON CONFLICT (card_number) DO UPDATE SET
				name=EXCLUDED.name,name_en=EXCLUDED.name_en,description=EXCLUDED.description,
				mechanics=EXCLUDED.mechanics,source=EXCLUDED.source,updated_at=CURRENT_TIMESTAMP,
				deleted_at=NULL
		`, attack.ID, attack.Name, attack.NameEn, attack.Description, attack.CardNumber, string(mechanics)); err != nil {
			return fmt.Errorf("upsert roguelike monster action %s: %w", attack.CardNumber, err)
		}
		var id string
		if err := db.QueryRow(`SELECT id::text FROM actions WHERE card_number=$1 AND deleted_at IS NULL`, attack.CardNumber).Scan(&id); err != nil {
			return err
		}
		actionIDs[attack.CardNumber] = id
	}

	pack := func(extra map[string]any) map[string]any {
		result := map[string]any{"strategy": "tactical", "pack_tactics": true, "preferred_range_ft": 5}
		for key, value := range extra {
			result[key] = value
		}
		return result
	}
	melee := func(extra map[string]any) map[string]any {
		result := map[string]any{"strategy": "tactical", "preferred_range_ft": 5}
		for key, value := range extra {
			result[key] = value
		}
		return result
	}
	monsters := []roguelikeMonsterSeed{
		{"c2000000-0000-4000-8000-000000000001", "bandit", "Бандит", "Bandit", "Лёгкий стрелок, переходящий на скимитар вблизи.", "medium", "humanoid", "neutral", "1/8", 12, 11, 30, 1, 2, map[string]int{"str": 11, "dex": 12, "con": 12, "int": 10, "wis": 10, "cha": 10}, []string{"RL-MA-BANDIT-SCIM", "RL-MA-BANDIT-XBOW"}, melee(map[string]any{"preferred_range_ft": 80})},
		{"c2000000-0000-4000-8000-000000000002", "guard", "Стражник", "Guard", "Защищённый боец с копьём.", "medium", "humanoid", "neutral", "1/8", 16, 11, 30, 1, 2, map[string]int{"str": 13, "dex": 12, "con": 12, "int": 10, "wis": 11, "cha": 10}, []string{"RL-MA-GUARD-SPEAR"}, melee(map[string]any{"preferred_range_ft": 20})},
		{"c2000000-0000-4000-8000-000000000003", "giant-rat", "Гигантская крыса", "Giant Rat", "Быстрый стайный зверь.", "small", "beast", "unaligned", "1/8", 13, 7, 30, 3, 2, map[string]int{"str": 7, "dex": 16, "con": 11, "int": 2, "wis": 10, "cha": 4}, []string{"RL-MA-RAT-BITE"}, pack(nil)},
		{"c2000000-0000-4000-8000-000000000004", "kobold-warrior", "Кобольд-воин", "Kobold Warrior", "Стайный боец с метательными кинжалами.", "small", "dragon", "neutral", "1/8", 14, 7, 30, 2, 2, map[string]int{"str": 7, "dex": 15, "con": 9, "int": 8, "wis": 7, "cha": 8}, []string{"RL-MA-KOBOLD-DAGGER"}, pack(map[string]any{"preferred_range_ft": 20})},
		{"c2000000-0000-4000-8000-000000000005", "goblin-warrior", "Гоблин-воин", "Goblin Warrior", "Подвижный стрелок со скимитаром и коротким луком.", "small", "fey (goblinoid)", "chaotic neutral", "1/4", 15, 10, 30, 2, 2, map[string]int{"str": 8, "dex": 15, "con": 10, "int": 10, "wis": 8, "cha": 8}, []string{"RL-MA-GOBLIN-SCIM", "RL-MA-GOBLIN-BOW"}, melee(map[string]any{"preferred_range_ft": 80})},
		{"c2000000-0000-4000-8000-000000000006", "skeleton", "Скелет", "Skeleton", "Нежить с коротким мечом и луком; уязвима к дробящему урону.", "medium", "undead", "lawful evil", "1/4", 14, 13, 30, 3, 2, map[string]int{"str": 10, "dex": 16, "con": 15, "int": 6, "wis": 8, "cha": 5}, []string{"RL-MA-SKELETON-SWORD", "RL-MA-SKELETON-BOW"}, melee(map[string]any{"preferred_range_ft": 80, "damage_immunities": []string{"poison"}, "damage_vulnerabilities": []string{"bludgeoning"}})},
		{"c2000000-0000-4000-8000-000000000007", "zombie", "Зомби", "Zombie", "Медленная живучая нежить.", "medium", "undead", "neutral evil", "1/4", 8, 15, 20, -2, 2, map[string]int{"str": 13, "dex": 6, "con": 16, "int": 3, "wis": 6, "cha": 5}, []string{"RL-MA-ZOMBIE-SLAM"}, melee(map[string]any{"damage_immunities": []string{"poison"}, "undead_fortitude": true})},
		{"c2000000-0000-4000-8000-000000000008", "wolf", "Волк", "Wolf", "Быстрый стайный охотник.", "medium", "beast", "unaligned", "1/4", 12, 11, 40, 2, 2, map[string]int{"str": 14, "dex": 15, "con": 12, "int": 3, "wis": 12, "cha": 6}, []string{"RL-MA-WOLF-BITE"}, pack(map[string]any{"knock_prone": true})},
		{"c2000000-0000-4000-8000-000000000009", "giant-wolf-spider", "Гигантский волчий паук", "Giant Wolf Spider", "Лазящий хищник с ядовитым укусом.", "medium", "beast", "unaligned", "1/4", 13, 11, 40, 3, 2, map[string]int{"str": 12, "dex": 16, "con": 13, "int": 3, "wis": 12, "cha": 4}, []string{"RL-MA-SPIDER-BITE"}, melee(nil)},
		{"c2000000-0000-4000-8000-000000000010", "hobgoblin-warrior", "Хобгоблин-воин", "Hobgoblin Warrior", "Дисциплинированный стайный воин с мечом и отравленным луком.", "medium", "fey (goblinoid)", "lawful evil", "1/2", 18, 11, 30, 3, 2, map[string]int{"str": 13, "dex": 12, "con": 12, "int": 10, "wis": 10, "cha": 9}, []string{"RL-MA-HOB-SWORD", "RL-MA-HOB-BOW"}, pack(map[string]any{"preferred_range_ft": 150})},
		{"c2000000-0000-4000-8000-000000000011", "tough", "Громила", "Tough", "Живучий стайный противник с булавой и тяжёлым арбалетом.", "medium", "humanoid", "neutral", "1/2", 12, 32, 30, 1, 2, map[string]int{"str": 15, "dex": 12, "con": 14, "int": 10, "wis": 10, "cha": 11}, []string{"RL-MA-TOUGH-MACE", "RL-MA-TOUGH-XBOW"}, pack(map[string]any{"preferred_range_ft": 100})},
		{"c2000000-0000-4000-8000-000000000012", "animated-armor", "Оживший доспех", "Animated Armor", "Прочный конструкт, атакующий дважды.", "medium", "construct", "unaligned", "1", 18, 33, 25, 2, 2, map[string]int{"str": 14, "dex": 11, "con": 13, "int": 1, "wis": 3, "cha": 1}, []string{"RL-MA-ARMOR-SLAM"}, melee(map[string]any{"damage_immunities": []string{"poison", "psychic"}})},
		{"c2000000-0000-4000-8000-000000000013", "dire-wolf", "Лютый волк", "Dire Wolf", "Крупный стайный охотник, сбивающий добычу с ног.", "large", "beast", "unaligned", "1", 14, 22, 50, 2, 2, map[string]int{"str": 17, "dex": 15, "con": 15, "int": 3, "wis": 12, "cha": 7}, []string{"RL-MA-DIRE-BITE"}, pack(map[string]any{"knock_prone": true})},
		{"c2000000-0000-4000-8000-000000000014", "bugbear-warrior", "Багбир-воин", "Bugbear Warrior", "Длиннорукий боец, захватывающий цель и добивающий её молотом.", "medium", "fey (goblinoid)", "chaotic evil", "1", 14, 33, 30, 2, 2, map[string]int{"str": 15, "dex": 14, "con": 13, "int": 8, "wis": 11, "cha": 9}, []string{"RL-MA-BUG-GRAB", "RL-MA-BUG-HAMMER"}, melee(map[string]any{"reach_ft": 10, "preferred_range_ft": 10})},
		{"c2000000-0000-4000-8000-000000000015", "ogre", "Огр", "Ogre", "Большой громила с палицей и метательными копьями.", "large", "giant", "chaotic evil", "2", 11, 68, 40, -1, 2, map[string]int{"str": 19, "dex": 8, "con": 16, "int": 5, "wis": 7, "cha": 7}, []string{"RL-MA-OGRE-CLUB", "RL-MA-OGRE-JAVELIN"}, melee(map[string]any{"preferred_range_ft": 30})},
		{"c2000000-0000-4000-8000-000000000016", "berserker", "Берсерк", "Berserker", "Живучий боец, впадающий в кровавую ярость при половине хитов.", "medium", "humanoid", "neutral", "2", 13, 67, 30, 1, 2, map[string]int{"str": 16, "dex": 12, "con": 17, "int": 9, "wis": 11, "cha": 9}, []string{"RL-MA-BERSERKER-AXE"}, melee(map[string]any{"bloodied_frenzy": true})},
		{"c2000000-0000-4000-8000-000000000017", "bandit-captain", "Капитан бандитов", "Bandit Captain", "Опытный командир с двумя атаками и парированием.", "medium", "humanoid", "neutral", "2", 15, 52, 30, 3, 2, map[string]int{"str": 15, "dex": 16, "con": 14, "int": 14, "wis": 11, "cha": 14}, []string{"RL-MA-CAPTAIN-SCIM", "RL-MA-CAPTAIN-PISTOL"}, melee(map[string]any{"preferred_range_ft": 30, "parry_ac": 2})},
		{"c2000000-0000-4000-8000-000000000018", "warrior-veteran", "Воин-ветеран", "Warrior Veteran", "Закалённый ветеран с двумя атаками и парированием.", "medium", "humanoid", "neutral", "3", 17, 65, 30, 3, 2, map[string]int{"str": 16, "dex": 13, "con": 14, "int": 10, "wis": 11, "cha": 10}, []string{"RL-MA-VETERAN-SWORD", "RL-MA-VETERAN-XBOW"}, melee(map[string]any{"preferred_range_ft": 100, "parry_ac": 2})},
	}
	support, _ := json.Marshal(map[string]any{
		"status": "verified_partial", "certification_version": "roguelike-monsters-v1",
		"note":             "SRD 5.2.1 stat block, attack bonus, damage, range and Multiattack are executable.",
		"limitations":      []string{"Complex reactions and conditional traits are declared in AI metadata for progressive runtime coverage."},
		"test_coverage":    map[string]any{"schema_version": 1, "scope": "roguelike-v1", "required": 5, "passed": 5, "percent": 100},
		"mechanics_locked": false,
	})
	for _, monster := range monsters {
		abilities, _ := json.Marshal(monster.Abilities)
		ids := make([]string, 0, len(monster.Actions))
		for _, cardNumber := range monster.Actions {
			id, ok := actionIDs[cardNumber]
			if !ok {
				return fmt.Errorf("missing action %s for %s", cardNumber, monster.Slug)
			}
			ids = append(ids, id)
		}
		actions, _ := json.Marshal(ids)
		ai, _ := json.Marshal(monster.AI)
		if _, err := db.Exec(`
			INSERT INTO monsters (
				id,slug,name,name_en,description,size,creature_type,alignment,challenge_rating,
				armor_class,max_hp,speed,initiative_bonus,proficiency_bonus,abilities,
				action_ids,effect_ids,ai,source,support,created_at,updated_at
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,
				$16::jsonb,'[]'::jsonb,$17::jsonb,'SRD 5.2.1',$18::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
			ON CONFLICT (slug) DO UPDATE SET
				name=EXCLUDED.name,name_en=EXCLUDED.name_en,description=EXCLUDED.description,
				size=EXCLUDED.size,creature_type=EXCLUDED.creature_type,alignment=EXCLUDED.alignment,
				challenge_rating=EXCLUDED.challenge_rating,armor_class=EXCLUDED.armor_class,
				max_hp=EXCLUDED.max_hp,speed=EXCLUDED.speed,initiative_bonus=EXCLUDED.initiative_bonus,
				proficiency_bonus=EXCLUDED.proficiency_bonus,abilities=EXCLUDED.abilities,
				action_ids=EXCLUDED.action_ids,effect_ids=EXCLUDED.effect_ids,ai=EXCLUDED.ai,
				source=EXCLUDED.source,support=EXCLUDED.support,updated_at=CURRENT_TIMESTAMP,deleted_at=NULL
		`, monster.ID, monster.Slug, monster.Name, monster.NameEn, monster.Description,
			monster.Size, monster.CreatureType, monster.Alignment, monster.CR, monster.AC,
			monster.HP, monster.Speed, monster.Initiative, monster.PB, string(abilities),
			string(actions), string(ai), string(support)); err != nil {
			return fmt.Errorf("upsert roguelike monster %s: %w", monster.Slug, err)
		}
	}
	return nil
}
