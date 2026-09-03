package migrations

import (
	"database/sql"
	"fmt"
)

const mobileEmanationsMigrationVersion = "196_materialize_mobile_emanations"

// The transformation remains self-targeted: only its selected Radiance branch
// additionally creates a board-owned emanation which follows the source.
const aasimarMobileRadianceActionMechanics = `{
  "uses":{"per":"long_rest","count":1},
  "activation":{"mode":"active","cost":[{"resource":"bonus_action"},{"resource":"self_uses"}],"requirements":[{"type":"level","min_level":3}]},
  "targeting":{"domain":"actor","actor_targets":false,"shape":"self","min_targets":0,"max_targets":1,"range_ft":0,"requires_line_of_sight":false,"allowed_relations":["self"]},
  "effects":[{"kind":"choice","id":"revelation","count":1,"prompt":"Выберите проявление Небесного откровения (на 1 минуту)","context":"in_play","options":{"source":"explicit","items":[
    {"id":"wings","name":"Небесные крылья","grants":[{"kind":"grant_effect","value":"RE-sub-wings"}]},
    {"id":"radiance","name":"Внутренний свет","grants":[
      {"kind":"grant_effect","value":"RE-sub-radiance"},
      {"kind":"world_zone","zone_type":"aasimar_radiance","geometry":{"shape":"emanation","size_ft":10},"duration":{"type":"rounds","amount":10},"tactical":{"anchor":"source","triggers":["end_turn"],"trigger_scope":"source_turn_all_inside","auto_effects":[{"kind":"damage","dice":"prof_bonus","type":"radiant"}],"notice":"Эманация следует за аасимаром; в конце его хода каждое существо в пределах 10 футов получает урон излучением, равный бонусу мастерства."}}
    ]},
    {"id":"shroud","name":"Некротический покров","grants":[{"kind":"grant_effect","value":"RE-sub-necrotic"}]}
  ]}}]
}`

// materializeMobileEmanations intentionally leaves the action and linked
// effect untested. Unit/integration coverage proves the runtime contract, but
// the required sheet, combat and clarity browser evidence is still separate.
func materializeMobileEmanations(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	result, err := tx.Exec(`UPDATE actions SET
		mechanics=$2::jsonb,
		support=jsonb_build_object(
			'status','untested',
			'certification_version',$1::text,
			'mechanics_locked',false,
			'note','All three transformations remain library-owned. Radiance now creates a visible ten-foot source-following board emanation with end-turn proficiency-bonus damage. Sheet/combat/clarity browser evidence, Wings aerial traversal and Shroud initial fear remain pending.'),
		updated_at=NOW()
		WHERE card_number='ACT-aasimar-revelation' AND deleted_at IS NULL`,
		mobileEmanationsMigrationVersion, aasimarMobileRadianceActionMechanics)
	if err != nil {
		return fmt.Errorf("materialize Aasimar mobile radiance: %w", err)
	}
	rows, rowsErr := result.RowsAffected()
	if rowsErr != nil || rows != 1 {
		return fmt.Errorf("materialize Aasimar mobile radiance affected %d rows: %w", rows, rowsErr)
	}

	effectResult, err := tx.Exec(`UPDATE effects SET
		support=jsonb_build_object(
			'status','untested',
			'certification_version',$1::text,
			'mechanics_locked',false,
			'note','The library-owned transformation and damage rider execute. Its board emanation follows the source, is visible and resolves proficiency-bonus radiant damage at the end of the source turn; browser evidence remains pending.'),
		updated_at=NOW()
		WHERE card_number='RE-sub-radiance' AND deleted_at IS NULL`,
		mobileEmanationsMigrationVersion)
	if err != nil {
		return fmt.Errorf("mark Aasimar radiance untested: %w", err)
	}
	effectRows, effectRowsErr := effectResult.RowsAffected()
	if effectRowsErr != nil || effectRows != 1 {
		return fmt.Errorf("mark Aasimar radiance affected %d rows: %w", effectRows, effectRowsErr)
	}

	var anchor, trigger, triggerScope, dice string
	if err = tx.QueryRow(`SELECT
		mechanics #>> '{effects,0,options,items,1,grants,1,tactical,anchor}',
		mechanics #>> '{effects,0,options,items,1,grants,1,tactical,triggers,0}',
		mechanics #>> '{effects,0,options,items,1,grants,1,tactical,trigger_scope}',
		mechanics #>> '{effects,0,options,items,1,grants,1,tactical,auto_effects,0,dice}'
		FROM actions WHERE card_number='ACT-aasimar-revelation' AND deleted_at IS NULL`).
		Scan(&anchor, &trigger, &triggerScope, &dice); err != nil {
		return fmt.Errorf("verify Aasimar mobile radiance: %w", err)
	}
	if anchor != "source" || trigger != "end_turn" || triggerScope != "source_turn_all_inside" || dice != "prof_bonus" {
		return fmt.Errorf("bad Aasimar mobile radiance postimage anchor=%q trigger=%q scope=%q dice=%q", anchor, trigger, triggerScope, dice)
	}

	return tx.Commit()
}
