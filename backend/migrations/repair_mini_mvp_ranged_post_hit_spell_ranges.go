package migrations

import (
	"database/sql"
	"fmt"
)

const miniMVPRangedPostHitSpellRangesMigrationVersion = "139_repair_mini_mvp_ranged_post_hit_spell_ranges"

var miniMVPRangedPostHitSpellRangeIdentities = []miniMVPSpellIdentity{
	{"a438dcc1-94d0-420c-ae29-35b2cafd2f7a", "SPELL-0185"},
	{"9afc306d-3f3d-4a05-8cb8-dfcd53b10b50", "SPELL-0247"},
}

func repairMiniMVPRangedPostHitSpellRanges(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, identity := range miniMVPRangedPostHitSpellRangeIdentities {
		var count int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM spells WHERE id=$1::uuid AND card_number=$2 AND deleted_at IS NULL`, identity.id, identity.card).Scan(&count); err != nil {
			return fmt.Errorf("verify ranged post-hit spell %s: %w", identity.card, err)
		}
		if count != 1 {
			return fmt.Errorf("ranged post-hit spell identity %s/%s matched %d rows, want exactly 1", identity.id, identity.card, count)
		}
	}
	if _, err := tx.Exec(`DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells`); err != nil {
		return fmt.Errorf("disable spell certification guard: %w", err)
	}
	cards := []string{"SPELL-0185", "SPELL-0247"}
	if _, err := tx.Exec(`
		UPDATE spells SET
			mechanics=jsonb_set(mechanics,'{targeting,range}','"600 feet"'::jsonb,true),
			support=jsonb_build_object(
				'status','untested','certification_version',$1::text,'mechanics_locked',false,
				'limitations',jsonb_build_array('Требуется повторная браузерная проверка применения после дальнобойного попадания.'),
				'note','Дальность post-hit заклинания соответствует уже подтверждённой дальнобойной атаке.'
			),
			updated_at=NOW()
		WHERE card_number=ANY($2::text[]) AND deleted_at IS NULL
	`, miniMVPRangedPostHitSpellRangesMigrationVersion, cards); err != nil {
		return fmt.Errorf("repair ranged post-hit spell ranges: %w", err)
	}
	if _, err := tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
