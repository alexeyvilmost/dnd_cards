package migrations

import (
	"encoding/json"
	"testing"
)

func TestRepairLiveMvpContentContractsMigrationIsRegisteredAfter096(t *testing.T) {
	migrations := GetAllMigrations()
	index := -1
	for candidate, migration := range migrations {
		if migration.Version == "097_repair_live_mvp_content_contracts" {
			index = candidate
			if migration.Up == nil || migration.Down == nil {
				t.Fatal("097 must register Up and safe Down")
			}
		}
	}
	if index < 1 {
		t.Fatal("097_repair_live_mvp_content_contracts is not registered")
	}
	if previous := migrations[index-1].Version; previous != "096_lock_certified_content_mechanics" {
		t.Fatalf("migration before 097 = %q, want 096", previous)
	}
}

func TestLiveMvpSelfUsesRepairInventoryIsUnique(t *testing.T) {
	seen := map[string]bool{}
	for table, cardNumbers := range liveMvpSelfUsesCardNumbers {
		if table != "actions" && table != "effects" {
			t.Fatalf("unsupported table %q", table)
		}
		for _, cardNumber := range cardNumbers {
			key := table + ":" + cardNumber
			if seen[key] {
				t.Fatalf("duplicate repair target %s", key)
			}
			seen[key] = true
		}
	}
	if len(seen) != 6 {
		t.Fatalf("repair targets = %d, want 6", len(seen))
	}
}

func TestRepairLiveMvpContentContractsExecutesIdempotently(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	if _, err := db.Exec(`
		CREATE TABLE effects (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			card_number TEXT NOT NULL UNIQUE,
			effect_type TEXT,
			mechanics JSONB,
			deleted_at TIMESTAMPTZ
		);
		CREATE TABLE actions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			card_number TEXT NOT NULL UNIQUE,
			mechanics JSONB,
			deleted_at TIMESTAMPTZ
		);
		CREATE TABLE classes (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			card_number TEXT NOT NULL UNIQUE,
			level_progression JSONB,
			deleted_at TIMESTAMPTZ
		);
		INSERT INTO effects (card_number, effect_type, mechanics) VALUES
			('COND-poisoned', 'condition', '{"condition":{"id":"poisoned"},"effects":[]}'),
			('fs_defense', 'feature', '{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"add","value":"+1","applies_to":{"roll":"ac","filter":{"wearingArmor":true}},"source":"Fighting Style: Defense"}]}]}'),
			('EFF-rogue-thieves-cant', 'feature', '{"activation":{"mode":"passive"},"effects":[]}'),
			('RE-dragonborn-4', 'feature', '{"activation":{"mode":"active","cost":[{"resource":"bonus_action"}]},"uses":{"count":1,"per":"long_rest"},"effects":[]}');
		INSERT INTO actions (card_number, mechanics) VALUES
			('ACT-aasimar-revelation', '{"activation":{"mode":"active","cost":[{"resource":"bonus_action"}]},"uses":{"count":1,"per":"long_rest"},"effects":[]}');
		INSERT INTO classes (card_number, level_progression) VALUES
			('CLASS-rogue', '{"1":{"effects":["other","EFF-rogue-thieves-cant"],"actions":[]}}');
	`); err != nil {
		t.Fatal(err)
	}
	if err := repairLiveMvpContentContracts(db); err != nil {
		t.Fatal(err)
	}
	if err := repairLiveMvpContentContracts(db); err != nil {
		t.Fatalf("097 is not idempotent: %v", err)
	}

	var conditionMode, defenseSource string
	var defenseWhen, dragonCost, actionCost, rogueRefs []byte
	if err := db.QueryRow(`SELECT mechanics #>> '{activation,mode}' FROM effects WHERE card_number='COND-poisoned'`).Scan(&conditionMode); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT mechanics #> '{effects,0,result,0,when}', mechanics #>> '{effects,0,result,0,source}' FROM effects WHERE card_number='fs_defense'`).Scan(&defenseWhen, &defenseSource); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT mechanics #> '{activation,cost}' FROM effects WHERE card_number='RE-dragonborn-4'`).Scan(&dragonCost); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT mechanics #> '{activation,cost}' FROM actions WHERE card_number='ACT-aasimar-revelation'`).Scan(&actionCost); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT level_progression #> '{1,effects}' FROM classes WHERE card_number='CLASS-rogue'`).Scan(&rogueRefs); err != nil {
		t.Fatal(err)
	}
	if conditionMode != "passive" || defenseSource != "Боевой стиль: Оборона" {
		t.Fatalf("condition=%q defense source=%q", conditionMode, defenseSource)
	}
	var when []map[string]any
	if err := json.Unmarshal(defenseWhen, &when); err != nil || len(when) != 1 || when[0]["kind"] != "wearing_armor" {
		t.Fatalf("defense when=%s err=%v", defenseWhen, err)
	}
	for label, raw := range map[string][]byte{"dragon": dragonCost, "action": actionCost} {
		var costs []map[string]any
		if err := json.Unmarshal(raw, &costs); err != nil {
			t.Fatalf("%s cost: %v", label, err)
		}
		selfUses := 0
		for _, cost := range costs {
			if cost["resource"] == "self_uses" {
				selfUses++
			}
		}
		if selfUses != 1 {
			t.Fatalf("%s self_uses count=%d in %s", label, selfUses, raw)
		}
	}
	var refs []string
	if err := json.Unmarshal(rogueRefs, &refs); err != nil {
		t.Fatal(err)
	}
	if len(refs) != 2 || refs[0] != "other" || refs[1] == "EFF-rogue-thieves-cant" {
		t.Fatalf("rogue refs=%v", refs)
	}
}
