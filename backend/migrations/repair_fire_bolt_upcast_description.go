package migrations

import (
	"database/sql"
	"fmt"
)

const (
	fireBoltUpcastDescriptionMigrationVersion = "124_repair_fire_bolt_upcast_description"
	fireBoltEntityID                          = "50626b5a-33c5-46e0-af0e-50599f4306a0"
	fireBoltCardNumber                        = "fire_bolt"
	fireBoltOldUpcastDescription              = "Урон увеличивается на 1к6, когда вы достигаете 5‑го уровня (2к6), 11‑го уровня (3к6) и 17‑го уровня (4к6)."
	fireBoltNewUpcastDescription              = "Урон увеличивается на 1к10, когда вы достигаете 5‑го уровня (2к10), 11‑го уровня (3к10) и 17‑го уровня (4к10)."
)

// repairFireBoltUpcastDescription fixes the player-facing cantrip scaling text
// after the executable damage/scaling payload had already been corrected to
// d10. The stable live identity, level and mechanics preimage are all required.
func repairFireBoltUpcastDescription(db *sql.DB) error {
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
	`, fireBoltEntityID, fireBoltCardNumber).Scan(&matchingIdentities, &exactIdentity); err != nil {
		return fmt.Errorf("inspect Fire Bolt identity: %w", err)
	}
	if matchingIdentities != 1 || exactIdentity != 1 {
		return fmt.Errorf("%s stable identity drifted: matching_rows=%d exact_rows=%d", fireBoltCardNumber, matchingIdentities, exactIdentity)
	}

	var upcastDescription, scalingDice string
	var level int
	if err := tx.QueryRow(`
		SELECT upcast_description,
		       mechanics #>> '{effects,0,on_hit,0,scaling,dice}',
		       level
		FROM spells
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		FOR UPDATE
	`, fireBoltEntityID, fireBoltCardNumber).Scan(&upcastDescription, &scalingDice, &level); err != nil {
		return fmt.Errorf("read Fire Bolt display preimage: %w", err)
	}
	if level != 0 || scalingDice != "1d10" {
		return fmt.Errorf("%s executable preimage drifted: level=%d scaling=%q", fireBoltCardNumber, level, scalingDice)
	}
	if upcastDescription == fireBoltNewUpcastDescription {
		return tx.Commit()
	}
	if upcastDescription != fireBoltOldUpcastDescription {
		return fmt.Errorf("%s upcast description drifted; refusing repair", fireBoltCardNumber)
	}

	if _, err := tx.Exec(`DROP TRIGGER IF EXISTS protect_spells_certified_mechanics ON spells`); err != nil {
		return fmt.Errorf("temporarily disable spell certification guard: %w", err)
	}
	result, err := tx.Exec(`
		UPDATE spells
		SET upcast_description = $3,
		    updated_at = NOW()
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
		  AND upcast_description = $4
		  AND level = 0
		  AND mechanics #>> '{effects,0,on_hit,0,scaling,dice}' = '1d10'
	`, fireBoltEntityID, fireBoltCardNumber, fireBoltNewUpcastDescription, fireBoltOldUpcastDescription)
	if err != nil {
		return fmt.Errorf("repair Fire Bolt upcast description: %w", err)
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		return fmt.Errorf("repair Fire Bolt upcast description affected %d rows: %w", affected, err)
	}

	// The structural edit invalidator intentionally clears the stale certificate.
	// Write an explicit review state in a second update after that invalidation.
	if _, err := tx.Exec(`
		UPDATE spells
		SET support = jsonb_build_object(
		      'status', 'untested',
		      'certification_version', $3::text,
		      'mechanics_locked', false,
		      'limitations', jsonb_build_array('Требуется повторная браузерная проверка текста усиления заговора.'),
		      'note', 'Кость усиления в карточке исправлена с к6 на к10; исполняемая механика уже использует к10.'
		    ),
		    updated_at = NOW()
		WHERE id = $1::uuid AND card_number = $2 AND deleted_at IS NULL
	`, fireBoltEntityID, fireBoltCardNumber, fireBoltUpcastDescriptionMigrationVersion); err != nil {
		return fmt.Errorf("revoke stale Fire Bolt certification: %w", err)
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
		  AND level = 0
		  AND upcast_description = $3
		  AND mechanics #>> '{effects,0,on_hit,0,scaling,dice}' = '1d10'
		  AND support->>'status' = 'untested'
		  AND COALESCE((support->>'mechanics_locked')::boolean, false) = false
	`, fireBoltEntityID, fireBoltCardNumber, fireBoltNewUpcastDescription).Scan(&compatible); err != nil {
		return fmt.Errorf("verify Fire Bolt postcondition: %w", err)
	}
	if compatible != 1 {
		return fmt.Errorf("Fire Bolt postcondition failed: compatible_spells=%d", compatible)
	}
	return tx.Commit()
}
