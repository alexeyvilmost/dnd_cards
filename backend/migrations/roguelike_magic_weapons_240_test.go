package migrations

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestRoguelikeMagicWeaponProfileScopesBonusAndPreservesOtherEffects(t *testing.T) {
	base := []byte(`{"weapon_profile":{"weapon_type":"warhammer","damage_lines":[{"dice":"1d8","type":"bludgeoning"}],"enchantment":{"attack_bonus":0,"damage_bonus":0,"extra_damage_lines":[]}}}`)
	legacy := []byte(`{"activation":{"mode":"passive"},"effects":[{"resolution":"auto","result":[{"kind":"modifier","op":"add","value":"+1","applies_to":{"roll":"attack"}},{"kind":"modifier","op":"add","value":"+1","applies_to":{"roll":"damage"}},{"kind":"modifier","op":"add","value":"+1","applies_to":{"roll":"ability_check","filter":{"ability":"int"}}}]}]}`)
	next, e := roguelikeMagicWeaponMechanics(base, legacy)
	if e != nil {
		t.Fatal(e)
	}
	var parsed map[string]any
	json.Unmarshal(next, &parsed)
	profile := parsed["weapon_profile"].(map[string]any)
	ench := profile["enchantment"].(map[string]any)
	if profile["weapon_type"] != "warhammer" || ench["attack_bonus"] != float64(1) || ench["damage_bonus"] != float64(1) {
		t.Fatal("weapon enchantment missing")
	}
	results := parsed["effects"].([]any)[0].(map[string]any)["result"].([]any)
	if len(results) != 1 || results[0].(map[string]any)["applies_to"].(map[string]any)["roll"] != "ability_check" {
		t.Fatal("global attack bonus survived or unrelated property lost")
	}
	again, e := roguelikeMagicWeaponMechanics(base, next)
	if e != nil || string(again) != string(next) {
		t.Fatal("profile repair is not idempotent")
	}
	profile["weapon_type"] = "unreviewed"
	drift, _ := json.Marshal(parsed)
	if _, e := roguelikeMagicWeaponMechanics(base, drift); e == nil {
		t.Fatal("must reject existing profile drift")
	}
	if _, e := roguelikeMagicWeaponMechanics([]byte(`{}`), legacy); e == nil {
		t.Fatal("must reject missing base")
	}
}
func TestRoguelikeMagicWeaponMigrationIsAtomicAndIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	_, e := db.Exec(`CREATE TABLE cards(id uuid PRIMARY KEY, card_number text UNIQUE, mechanics jsonb, updated_at timestamptz DEFAULT NOW(), deleted_at timestamptz)`)
	if e != nil {
		t.Fatal(e)
	}
	for i, row := range roguelikeMagicWeapons {
		kind := "longsword"
		if i == 1 {
			kind = "warhammer"
		}
		base, _ := json.Marshal(map[string]any{"weapon_profile": map[string]any{"weapon_type": kind}})
		if _, e = db.Exec(`INSERT INTO cards(id,card_number,mechanics) VALUES(gen_random_uuid(),$1,$2::jsonb),($3::uuid,$4,'{"effects":[{"result":[{"kind":"modifier","op":"add","value":"+1","applies_to":{"roll":"attack"}}]}]}'::jsonb)`, row.Base, base, row.ID, row.Number); e != nil {
			t.Fatal(e)
		}
	}
	if e = materializeRoguelikeMagicWeapons(db); e != nil {
		t.Fatal(e)
	}
	var before, after []byte
	db.QueryRow(`SELECT jsonb_agg(to_jsonb(cards) ORDER BY card_number) FROM cards`).Scan(&before)
	if e = materializeRoguelikeMagicWeapons(db); e != nil {
		t.Fatal(e)
	}
	db.QueryRow(`SELECT jsonb_agg(to_jsonb(cards) ORDER BY card_number) FROM cards`).Scan(&after)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("repeat changed persisted rows")
	}
	var bonus int
	if e = db.QueryRow(`SELECT (mechanics#>>'{weapon_profile,enchantment,attack_bonus}')::int FROM cards WHERE card_number='CARD-0118'`).Scan(&bonus); e != nil || bonus != 1 {
		t.Fatal("missing persisted profile")
	}
	if _, e = db.Exec(`UPDATE cards SET mechanics=mechanics-'weapon_profile' WHERE card_number='CARD-0081'; UPDATE cards SET mechanics=jsonb_set(mechanics,'{weapon_profile,weapon_type}','"drifted"') WHERE card_number='CARD-0118'`); e != nil {
		t.Fatal(e)
	}
	if e = materializeRoguelikeMagicWeapons(db); e == nil {
		t.Fatal("drift must abort migration")
	}
	var stillMissing bool
	if e = db.QueryRow(`SELECT NOT (mechanics ? 'weapon_profile') FROM cards WHERE card_number='CARD-0081'`).Scan(&stillMissing); e != nil || !stillMissing {
		t.Fatal("earlier item repair must roll back on later drift")
	}
}
