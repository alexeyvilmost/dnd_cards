package migrations

import (
	"database/sql"
	"fmt"
)

const battleMasterChoices214 = `{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"variable","op":"set","id":"superiority_die","value":"1d8"}]},{"kind":"choice","id":"battle_master_maneuvers","count":3,"context":"level_up","resolution":"on_acquire","prompt":"Боевое превосходство: изучите три манёвра","options":{"source":"explicit","items":[{"id":"ACT-bm-evasive-footwork","name":"Уклоняющийся шаг","grants":[{"kind":"grant_action","value":"ACT-bm-evasive-footwork"}]},{"id":"ACT-bm-menacing-attack","name":"Устрашающая атака","grants":[{"kind":"grant_action","value":"ACT-bm-menacing-attack"}]},{"id":"ACT-bm-trip-attack","name":"Опрокидывающая атака","grants":[{"kind":"grant_action","value":"ACT-bm-trip-attack"}]},{"id":"ACT-bm-goading-attack","name":"Провоцирующая атака","grants":[{"kind":"grant_action","value":"ACT-bm-goading-attack"}]}]}}]}`

func materializeBattleMasterChoices(db *sql.DB) error {
	result, err := db.Exec(`UPDATE effects SET mechanics=$1::jsonb,updated_at=NOW()
      WHERE card_number='EFFECT-0041' AND deleted_at IS NULL`, battleMasterChoices214)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("expected one Combat Superiority effect, got %d: %v", n, err)
	}
	return nil
}
