package migrations

import (
	"database/sql"
	"fmt"
)

const wizardMemorizeSpellMigrationVersion = "188_materialize_wizard_memorize_spell"

const wizardMemorizeSpellMechanics = `{
  "activation":{"mode":"passive"},
  "spell_preparation_rest":{
    "kind":"prepared_spell_swap",
    "decision_type":"wizard_memorize_spell",
    "rest":"short_rest",
    "source":"spellbook",
    "maximum_per_rest":1,
    "minimum_spell_level":1,
    "maximum_spell_level":"max_available_spell_slot",
    "optional":true
  }
}`

// materializeWizardMemorizeSpell replaces the dead post-rest action with an
// atomic rest decision. The effect remains the class-progression authority;
// changing a character's mutable spell preparation needs no schema column.
func materializeWizardMemorizeSpell(db *sql.DB) error {
	result, err := db.Exec(`
		UPDATE effects
		SET mechanics = $1::jsonb,
		    description = 'После завершения Короткого отдыха можно заменить одно подготовленное заклинание Волшебника уровня 1+ на другое из своей книги заклинаний, для которого есть ячейка.',
		    support = jsonb_build_object(
		      'status', 'untested',
		      'certification_version', $2::text,
		      'mechanics_locked', false,
		      'note', 'Deterministic runtime coverage added; browser evidence is still required'
		    ),
		    updated_at = NOW()
		WHERE card_number = 'EFF-wizard-memorize-spell'
		  AND deleted_at IS NULL
	`, wizardMemorizeSpellMechanics, wizardMemorizeSpellMigrationVersion)
	if err != nil {
		return fmt.Errorf("materialize Wizard Memorize Spell: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("count Wizard Memorize Spell updates: %w", err)
	}
	if count != 1 {
		return fmt.Errorf("expected one Wizard Memorize Spell effect, updated %d", count)
	}
	return nil
}
