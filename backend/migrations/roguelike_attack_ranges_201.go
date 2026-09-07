package migrations

import (
	"database/sql"
	"fmt"
)

// Preserve historical catalogs; newly drawn encounters receive explicit normal
// ranges and separate melee modes for weapons that can also be thrown.
func materializeRoguelikeAttackRanges(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, row := range []struct {
		card   string
		normal int
	}{
		{"RL-MA-BANDIT-XBOW", 80}, {"RL-MA-GUARD-SPEAR", 20},
		{"RL-MA-KOBOLD-DAGGER", 20}, {"RL-MA-GOBLIN-BOW", 80},
		{"RL-MA-SKELETON-BOW", 80}, {"RL-MA-HOB-BOW", 150},
		{"RL-MA-TOUGH-XBOW", 100}, {"RL-MA-BUG-HAMMER", 20},
		{"RL-MA-OGRE-JAVELIN", 30}, {"RL-MA-CAPTAIN-PISTOL", 30},
		{"RL-MA-VETERAN-XBOW", 100},
	} {
		result, err := tx.Exec(`UPDATE actions SET mechanics=jsonb_set(mechanics,'{effects}',
   (SELECT jsonb_agg(effect || jsonb_build_object('normal_range_ft',$2::int) ORDER BY ordinal)
    FROM jsonb_array_elements(mechanics->'effects') WITH ORDINALITY AS e(effect,ordinal))),
   updated_at=NOW() WHERE card_number=$1 AND deleted_at IS NULL`, row.card, row.normal)
		if err != nil {
			return err
		}
		if n, err := result.RowsAffected(); err != nil || n != 1 {
			return fmt.Errorf("missing ranged action %s: %v", row.card, err)
		}
	}
	for i, row := range []struct{ card, slug, name string }{
		{"RL-MA-GUARD-SPEAR", "guard", "Копьё: удар"},
		{"RL-MA-KOBOLD-DAGGER", "kobold-warrior", "Кинжал: удар"},
		{"RL-MA-BUG-HAMMER", "bugbear-warrior", "Лёгкий молот: удар"},
		{"RL-MA-OGRE-JAVELIN", "ogre", "Копьё: удар"},
	} {
		id := fmt.Sprintf("b2010000-0000-4000-8000-%012d", i+1)
		meleeCard := row.card + "-MELEE"
		_, err := tx.Exec(`INSERT INTO actions(id,name,name_en,description,rarity,card_number,resource,mechanics,action_type,type,author,source,created_at,updated_at)
   SELECT $1::uuid,$2,name_en,'Рукопашная атака тем же оружием.','common',$3,resource,
    jsonb_set(jsonb_set(mechanics,'{targeting,range_ft}','5'),'{effects}',
      (SELECT jsonb_agg((effect-'normal_range_ft') || '{"attack_kind":"weapon_melee"}'::jsonb ORDER BY ordinal)
       FROM jsonb_array_elements(mechanics->'effects') WITH ORDINALITY AS e(effect,ordinal))),
    action_type,type,author,source,NOW(),NOW() FROM actions WHERE card_number=$4 AND deleted_at IS NULL
   ON CONFLICT(card_number) DO NOTHING`, id, row.name, meleeCard, row.card)
		if err != nil {
			return err
		}
		_, err = tx.Exec(`UPDATE monsters SET action_ids=action_ids || jsonb_build_array((SELECT id::text FROM actions WHERE card_number=$2)),updated_at=NOW()
    WHERE slug=$1 AND deleted_at IS NULL AND NOT action_ids @> jsonb_build_array((SELECT id::text FROM actions WHERE card_number=$2))`, row.slug, meleeCard)
		if err != nil {
			return err
		}
	}
	_, err = tx.Exec(`UPDATE monsters SET ai=ai || '{"darkvision_ft":60}'::jsonb,updated_at=NOW()
   WHERE slug='hobgoblin-warrior' AND deleted_at IS NULL`)
	if err != nil {
		return err
	}
	return tx.Commit()
}
