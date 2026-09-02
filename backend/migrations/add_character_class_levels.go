package migrations

import (
	"database/sql"
	"fmt"
)

const characterClassLevelsMigrationVersion = "153_add_character_class_levels"

func addCharacterClassLevels(db *sql.DB) error {
	if _, err := db.Exec(`
		ALTER TABLE characters_v3
			ADD COLUMN IF NOT EXISTS class_levels JSONB NOT NULL DEFAULT '{}'::jsonb;
		UPDATE characters_v3
		SET class_levels = jsonb_build_object(class_id::text, GREATEST(level, 1))
		WHERE class_id IS NOT NULL
		  AND (class_levels IS NULL OR class_levels = '{}'::jsonb);
	`); err != nil {
		return fmt.Errorf("add/backfill characters_v3.class_levels: %w", err)
	}
	if _, err := db.Exec(`
		ALTER TABLE classes ADD COLUMN IF NOT EXISTS multiclass_proficiencies JSONB;
		UPDATE classes SET multiclass_proficiencies = CASE card_number
		  WHEN 'CLASS-barbarian' THEN '{"armor":["shields"],"weapons":["martial"]}'::jsonb
		  WHEN 'CLASS-bard' THEN '{"armor":["light"],"choices":[{"id":"multiclass_bard_skill","prompt":"Мультикласс барда: выберите навык","count":1,"source":"skill","options":["acrobatics","animal_handling","arcana","athletics","deception","history","insight","intimidation","investigation","medicine","nature","perception","performance","persuasion","religion","sleight_of_hand","stealth","survival"],"grant":{"kind":"grant_proficiency","prof":"skill"}},{"id":"multiclass_bard_instrument","prompt":"Мультикласс барда: выберите музыкальный инструмент","count":1,"source":"tool","options":["bagpipes","drum","dulcimer","flute","horn","lute","lyre","pan_flute","shawm","viol"],"grant":{"kind":"grant_proficiency","prof":"tool"}}]}'::jsonb
		  WHEN 'CLASS-cleric' THEN '{"armor":["light","medium","shields"]}'::jsonb
		  WHEN 'CLASS-druid' THEN '{"armor":["light","shields"]}'::jsonb
		  WHEN 'CLASS-warrior' THEN '{"armor":["light","medium","shields"],"weapons":["martial"]}'::jsonb
		  WHEN 'CLASS-monk' THEN '{"weapons":["simple","scimitar","shortsword"]}'::jsonb
		  WHEN 'CLASS-paladin' THEN '{"armor":["light","medium","shields"],"weapons":["martial"]}'::jsonb
		  WHEN 'CLASS-ranger' THEN '{"armor":["light","medium","shields"],"weapons":["martial"],"choices":[{"id":"multiclass_ranger_skill","prompt":"Мультикласс следопыта: выберите навык класса","count":1,"source":"skill","options":["animal_handling","athletics","insight","investigation","nature","perception","stealth","survival"],"grant":{"kind":"grant_proficiency","prof":"skill"}}]}'::jsonb
		  WHEN 'CLASS-rogue' THEN '{"armor":["light"],"tools":["thieves_tools"],"choices":[{"id":"multiclass_rogue_skill","prompt":"Мультикласс плута: выберите навык","count":1,"source":"skill","options":["acrobatics","athletics","deception","insight","intimidation","investigation","perception","persuasion","sleight_of_hand","stealth"],"grant":{"kind":"grant_proficiency","prof":"skill"}}]}'::jsonb
		  ELSE '{}'::jsonb END
		WHERE deleted_at IS NULL AND parent_class_id IS NULL;
	`); err != nil {
		return fmt.Errorf("add/seed classes.multiclass_proficiencies: %w", err)
	}
	return nil
}
