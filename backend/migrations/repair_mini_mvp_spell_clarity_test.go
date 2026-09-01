package migrations

import (
	"encoding/json"
	"testing"
)

func TestMiniMVPSpellClarityMigrationFollowsTrueStrikeZeroDamageRepair(t *testing.T) {
	migrations := GetAllMigrations()
	index := registeredMigrationIndex(t, miniMVPSpellClarityMigrationVersion)
	if index == 0 || migrations[index-1].Version != trueStrikeZeroDamageMigrationVersion {
		t.Fatal("migration 136 must immediately follow 135")
	}
	if index+1 >= len(migrations) || migrations[index+1].Version != miniMVPSpellTriggerTimingMigrationVersion {
		t.Fatal("migration 136 must immediately precede 137")
	}
}

func TestRepairMiniMVPSpellClarityIsExactAndIdempotent(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	for _, ddl := range []string{
		`CREATE TABLE actions (id UUID PRIMARY KEY, card_number TEXT UNIQUE NOT NULL, mechanics JSONB, support JSONB, updated_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ)`,
		`CREATE TABLE effects (id UUID PRIMARY KEY, mechanics JSONB, support JSONB)`,
		`CREATE TABLE spells (id UUID PRIMARY KEY, card_number TEXT UNIQUE NOT NULL, mechanics JSONB, support JSONB, updated_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ)`,
	} {
		if _, err := db.Exec(ddl); err != nil {
			t.Fatal(err)
		}
	}
	base := `{"activation":{"mode":"active","cost":[]},"effects":[{"resolution":"auto","on_hit":[{"kind":"damage","dice":"3d8","type":"fire"}],"result":[{"kind":"movement","value":"double"},{"kind":"narrative","description":"old"},{"kind":"narrative","description":"stale"}]}],"targeting":{"shape":"self"}}`
	for _, identity := range miniMVPSpellClarityIdentities {
		if _, err := db.Exec(`INSERT INTO spells (id,card_number,mechanics) VALUES ($1::uuid,$2,$3::jsonb)`, identity.id, identity.card, base); err != nil {
			t.Fatal(err)
		}
	}
	for run := 0; run < 2; run++ {
		if err := repairMiniMVPSpellClarity(db); err != nil {
			t.Fatalf("migration run %d: %v", run+1, err)
		}
	}
	var raw []byte
	if err := db.QueryRow(`SELECT mechanics->'spell_class_list_ids' FROM spells WHERE card_number='SPELL-0204'`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var classIDs []string
	if err := json.Unmarshal(raw, &classIDs); err != nil {
		t.Fatal(err)
	}
	if len(classIDs) != 2 || classIDs[0] != "CLASS-bard" || classIDs[1] != "CLASS-druid" {
		t.Fatalf("Starry Wisp class ids = %#v", classIDs)
	}
	var detectText, retreatKind, chromaticChoice string
	var shieldRows int
	if err := db.QueryRow(`SELECT mechanics #>> '{effects,0,result,0,description}' FROM spells WHERE card_number='detect_magic'`).Scan(&detectText); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT mechanics #>> '{effects,0,result,0,kind}' FROM spells WHERE card_number='SPELL-0269'`).Scan(&retreatKind); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT jsonb_array_length(mechanics #> '{effects,0,result}') FROM spells WHERE card_number='SPELL-0318'`).Scan(&shieldRows); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT mechanics #>> '{effects,0,on_hit,0,id}' FROM spells WHERE card_number='SPELL-0314'`).Scan(&chromaticChoice); err != nil {
		t.Fatal(err)
	}
	if detectText == "old" || retreatKind != "narrative" || shieldRows != 2 || chromaticChoice != "chromatic_orb_damage_type" {
		t.Fatalf("clarity patch mismatch: detect=%q retreat=%q shieldRows=%d chromatic=%q", detectText, retreatKind, shieldRows, chromaticChoice)
	}
}
