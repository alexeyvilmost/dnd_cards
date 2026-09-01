package migrations

import (
	"database/sql"
	"fmt"
)

const miniMVPPostHitSpellTargetsMigrationVersion = "138_repair_mini_mvp_post_hit_spell_targets"

var miniMVPPostHitSpellTargetIdentities = []miniMVPSpellIdentity{
	{"857500cb-45e7-4cce-9fd3-61116e10814f", "SPELL-0183"},
	{"a438dcc1-94d0-420c-ae29-35b2cafd2f7a", "SPELL-0185"},
	{"ae684edc-08c3-4f00-94ab-5c11c6b05f4e", "SPELL-0186"},
	{"9afc306d-3f3d-4a05-8cb8-dfcd53b10b50", "SPELL-0247"},
	{"04dc8ba1-388f-4acc-ab4b-5a6784faeeaa", "SPELL-0254"},
}

func repairMiniMVPPostHitSpellTargets(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, identity := range miniMVPPostHitSpellTargetIdentities {
		var count int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM spells WHERE id=$1::uuid AND card_number=$2 AND deleted_at IS NULL`, identity.id, identity.card).Scan(&count); err != nil {
			return fmt.Errorf("verify post-hit spell %s: %w", identity.card, err)
		}
		if count != 1 {
			return fmt.Errorf("post-hit spell identity %s/%s matched %d rows, want exactly 1", identity.id, identity.card, count)
		}
	}
	if _, err := tx.Exec(`DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells`); err != nil {
		return fmt.Errorf("disable spell certification guard: %w", err)
	}

	cards := make([]string, 0, len(miniMVPPostHitSpellTargetIdentities))
	for _, identity := range miniMVPPostHitSpellTargetIdentities {
		cards = append(cards, identity.card)
	}
	if _, err := tx.Exec(`
		UPDATE spells SET
			mechanics=jsonb_set(mechanics,'{targeting}','{"filter":"enemy","shape":"single"}'::jsonb,true),
			support=jsonb_build_object(
				'status','untested','certification_version',$1::text,'mechanics_locked',false,
				'limitations',jsonb_build_array('Требуется повторная браузерная проверка применения после попадания.'),
				'note','Цель заклинания после попадания исправлена: поражённое существо вместо заклинателя.'
			),
			updated_at=NOW()
		WHERE card_number=ANY($2::text[]) AND deleted_at IS NULL
	`, miniMVPPostHitSpellTargetsMigrationVersion, cards); err != nil {
		return fmt.Errorf("repair post-hit spell targets: %w", err)
	}
	if _, err := tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
