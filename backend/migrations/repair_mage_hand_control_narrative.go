package migrations

import (
	"database/sql"
	"fmt"
)

const (
	mageHandControlMigrationVersion = "122_repair_mage_hand_control_narrative"
	mageHandEntityID                = "70e35366-5446-49ff-b0b9-759dbbff347e"
	mageHandControlOldNarrative     = "Движок валидирует действие, дальность, переносимый вес и стоимость последующего управления; выбор объекта и применение world_interaction остаются обязанностью адаптера сцены."
	mageHandControlNewNarrative     = "Рука готова к управлению. В активном эффекте «Волшебная рука» выберите «Управлять рукой», укажите объект, операцию, расстояние и вес. Каждая команда руке расходует основное действие и сохраняется в журнале."
)

// repairMageHandControlNarrative replaces an internal adapter note with the
// exact player-facing control instructions shipped by the sheet and combat UI.
// Only the reviewed live identity and the known preimage are accepted.
func repairMageHandControlNarrative(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var matchingIdentities, exactIdentity int
	if err := tx.QueryRow(`
		SELECT count(*), count(*) FILTER (WHERE id = $1::uuid AND card_number = $2)
		FROM spells
		WHERE deleted_at IS NULL AND (id = $1::uuid OR card_number = $2)
	`, mageHandEntityID, mageHandCardNumber).Scan(&matchingIdentities, &exactIdentity); err != nil {
		return fmt.Errorf("inspect Mage Hand identity: %w", err)
	}
	if matchingIdentities != 1 || exactIdentity != 1 {
		return fmt.Errorf("%s stable identity drifted: matching_rows=%d exact_rows=%d", mageHandCardNumber, matchingIdentities, exactIdentity)
	}

	var kind, narrative string
	if err := tx.QueryRow(`
		SELECT mechanics #>> '{effects,0,result,0,kind}',
		       mechanics #>> '{effects,0,result,1,description}'
		FROM spells
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		FOR UPDATE
	`, mageHandEntityID, mageHandCardNumber).Scan(&kind, &narrative); err != nil {
		return fmt.Errorf("read Mage Hand control preimage: %w", err)
	}
	if kind != "remote_manipulator" {
		return fmt.Errorf("%s remote manipulator contract drifted: kind=%q", mageHandCardNumber, kind)
	}
	if narrative == mageHandControlNewNarrative {
		return tx.Commit()
	}
	if narrative != mageHandControlOldNarrative {
		return fmt.Errorf("%s control narrative drifted; refusing repair", mageHandCardNumber)
	}

	if _, err := tx.Exec(`DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells`); err != nil {
		return fmt.Errorf("temporarily disable spell certification guard: %w", err)
	}
	result, err := tx.Exec(`
		UPDATE spells
		SET mechanics = jsonb_set(mechanics, '{effects,0,result,1,description}', to_jsonb($3::text), false),
		    support = jsonb_build_object(
		      'status', 'untested',
		      'certification_version', $4::text,
		      'mechanics_locked', false,
		      'limitations', jsonb_build_array('Требуется повторная браузерная проверка управления рукой.'),
		      'note', 'Внутреннее сообщение адаптера заменено инструкцией игроку.'
		    ),
		    updated_at = NOW()
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		  AND mechanics #>> '{effects,0,result,1,description}' = $5
	`, mageHandEntityID, mageHandCardNumber, mageHandControlNewNarrative, mageHandControlMigrationVersion, mageHandControlOldNarrative)
	if err != nil {
		return fmt.Errorf("repair Mage Hand control narrative: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil || affected != 1 {
		return fmt.Errorf("repair Mage Hand control narrative affected %d rows: %w", affected, err)
	}
	if _, err := tx.Exec(`
		CREATE TRIGGER protect_spells_certified_mechanics
		BEFORE UPDATE OR DELETE ON spells
		FOR EACH ROW EXECUTE FUNCTION protect_certified_content_mechanics()
	`); err != nil {
		return fmt.Errorf("restore spell certification guard: %w", err)
	}

	var compatible int
	if err := tx.QueryRow(`
		SELECT count(*) FROM spells
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		  AND mechanics #>> '{effects,0,result,0,kind}' = 'remote_manipulator'
		  AND mechanics #>> '{effects,0,result,1,description}' = $3
		  AND COALESCE((support->>'mechanics_locked')::boolean, false) = false
	`, mageHandEntityID, mageHandCardNumber, mageHandControlNewNarrative).Scan(&compatible); err != nil {
		return fmt.Errorf("verify Mage Hand control postcondition: %w", err)
	}
	if compatible != 1 {
		return fmt.Errorf("Mage Hand control postcondition failed: compatible_spells=%d", compatible)
	}
	return tx.Commit()
}
