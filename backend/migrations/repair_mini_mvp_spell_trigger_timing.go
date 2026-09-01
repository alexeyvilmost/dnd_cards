package migrations

import (
	"database/sql"
	"fmt"
)

const miniMVPSpellTriggerTimingMigrationVersion = "137_repair_mini_mvp_spell_trigger_timing"

var miniMVPSpellTriggerTimingIdentities = []miniMVPSpellIdentity{
	{"3f618918-5477-4526-a123-da9dda136c7e", "hellish_rebuke"},
	{"857500cb-45e7-4cce-9fd3-61116e10814f", "SPELL-0183"},
	{"a438dcc1-94d0-420c-ae29-35b2cafd2f7a", "SPELL-0185"},
	{"ae684edc-08c3-4f00-94ab-5c11c6b05f4e", "SPELL-0186"},
	{"9afc306d-3f3d-4a05-8cb8-dfcd53b10b50", "SPELL-0247"},
	{"33e73716-4d61-4669-b9d4-b0e2f6fcc63f", "SPELL-0253"},
	{"04dc8ba1-388f-4acc-ab4b-5a6784faeeaa", "SPELL-0254"},
}

func repairMiniMVPSpellTriggerTiming(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, identity := range miniMVPSpellTriggerTimingIdentities {
		var matches, exact int
		if err := tx.QueryRow(`
			SELECT count(*), count(*) FILTER (WHERE id=$1::uuid AND card_number=$2)
			FROM spells WHERE deleted_at IS NULL AND (id=$1::uuid OR card_number=$2)
		`, identity.id, identity.card).Scan(&matches, &exact); err != nil {
			return fmt.Errorf("inspect %s identity: %w", identity.card, err)
		}
		if matches != 1 || exact != 1 {
			return fmt.Errorf("%s stable identity drifted: matching_rows=%d exact_rows=%d", identity.card, matches, exact)
		}
	}
	if _, err := tx.Exec(`DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells`); err != nil {
		return fmt.Errorf("disable spell certification guard: %w", err)
	}

	if _, err := tx.Exec(`
		UPDATE spells SET mechanics=jsonb_set(
			jsonb_set(mechanics,'{activation,mode}','"triggered"'::jsonb,true),
			'{activation,trigger}','{"event":"hit"}'::jsonb,true
		)
		WHERE card_number=ANY($1::text[]) AND deleted_at IS NULL
	`, []string{"SPELL-0183", "SPELL-0185", "SPELL-0186", "SPELL-0247", "SPELL-0254"}); err != nil {
		return fmt.Errorf("repair post-hit spell timing: %w", err)
	}
	if _, err := tx.Exec(`
		UPDATE spells SET mechanics=jsonb_set(
			jsonb_set(
				jsonb_set(mechanics,'{activation,mode}','"reaction"'::jsonb,true),
				'{activation,trigger}','{"event":"damage_taken"}'::jsonb,true
			),
			'{activation,cast_time}','{"amount":1,"unit":"reaction"}'::jsonb,true
		)
		WHERE card_number='hellish_rebuke' AND deleted_at IS NULL
	`); err != nil {
		return fmt.Errorf("repair Hellish Rebuke timing: %w", err)
	}
	if _, err := tx.Exec(`
		UPDATE spells SET mechanics=jsonb_set(
			jsonb_set(
				jsonb_set(mechanics,'{activation,mode}','"reaction"'::jsonb,true),
				'{activation,trigger}','{"event":"fall_started"}'::jsonb,true
			),
			'{activation,cast_time}','{"amount":1,"unit":"reaction"}'::jsonb,true
		)
		WHERE card_number='SPELL-0253' AND deleted_at IS NULL
	`); err != nil {
		return fmt.Errorf("repair Feather Fall timing: %w", err)
	}
	if _, err := tx.Exec(`
		UPDATE spells SET support=jsonb_build_object(
			'status','untested','certification_version',$1::text,'mechanics_locked',false,
			'limitations',jsonb_build_array('Требуется повторная браузерная проверка окна активации.'),
			'note','Исправлено окно реакции или сотворения сразу после попадания.'
		), updated_at=NOW()
		WHERE card_number=ANY($2::text[]) AND deleted_at IS NULL
	`, miniMVPSpellTriggerTimingMigrationVersion,
		[]string{"hellish_rebuke", "SPELL-0183", "SPELL-0185", "SPELL-0186", "SPELL-0247", "SPELL-0253", "SPELL-0254"}); err != nil {
		return fmt.Errorf("reset repaired spell certifications: %w", err)
	}
	if _, err := tx.Exec(certifiedContentMechanicsOnlyLockDDL); err != nil {
		return fmt.Errorf("restore certified mechanics guards: %w", err)
	}
	return tx.Commit()
}
