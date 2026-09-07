package migrations

import (
	"database/sql"
	"fmt"
)

// SRD5.2.1 pp262/337: +2 AC against one triggering melee attack while holding
// a weapon. Equipment is a frozen ordinary card, so disarming removes eligibility.
func materializeRoguelikeParry(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`INSERT INTO actions(id,name,name_en,description,rarity,card_number,resource,mechanics,action_type,type,author,source,created_at,updated_at)
 VALUES ('b2040000-0000-4000-8000-000000000001','Парирование','Parry','Реакция: +2 к КЗ против попавшей рукопашной атаки, если в руке есть оружие.','common','RL-MA-PARRY','reaction',
 '{"activation":{"mode":"reaction","trigger":{"event":"hit_by_attack","melee_attack_while_holding_weapon":true},"cost":[{"resource":"reaction","amount":1}]},"effects":[],"attack_defense":{"scope":"triggering_attack","ac_bonus":2},"targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]}}'::jsonb,
 'base_action','monster','System','SRD 5.2.1',NOW(),NOW()) ON CONFLICT(card_number) DO NOTHING`)
	if err != nil {
		return err
	}
	for _, row := range []struct{ slug, weapon, traits string }{
		{"bandit-captain", "CARD-0311", `{"save_proficiencies":["str","dex","wis"],"skill_proficiencies":["athletics","deception"]}`},
		{"warrior-veteran", "CARD-0317", `{"skill_proficiencies":["athletics","perception"]}`},
	} {
		result, err := tx.Exec(`UPDATE monsters m SET ai=m.ai || $3::jsonb || jsonb_build_object('held_weapon_card',to_jsonb(c)-'created_at'-'updated_at'-'deleted_at'),
   action_ids=CASE WHEN m.action_ids @> '["b2040000-0000-4000-8000-000000000001"]'::jsonb THEN m.action_ids ELSE m.action_ids || '["b2040000-0000-4000-8000-000000000001"]'::jsonb END,
   updated_at=NOW() FROM cards c WHERE m.slug=$1 AND m.deleted_at IS NULL AND c.card_number=$2 AND c.deleted_at IS NULL`, row.slug, row.weapon, row.traits)
		if err != nil {
			return err
		}
		if n, err := result.RowsAffected(); err != nil || n != 1 {
			return fmt.Errorf("missing monster/weapon for %s: %v", row.slug, err)
		}
	}
	return tx.Commit()
}
