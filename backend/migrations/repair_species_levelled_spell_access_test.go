package migrations

import (
	"database/sql"
	"os"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestSpeciesLevelledSpellAccessDenominator(t *testing.T) {
	if speciesLevelledSpellAccessMigrationVersion != "173_repair_species_levelled_spell_access" {
		t.Fatal(speciesLevelledSpellAccessMigrationVersion)
	}
	if len(speciesLevelledSpellAccessSeeds) != 6 {
		t.Fatalf("species lineages=%d, want 6", len(speciesLevelledSpellAccessSeeds))
	}
	seenEffects := map[string]bool{}
	seenPairs := map[string]bool{}
	for _, seed := range speciesLevelledSpellAccessSeeds {
		if seed.effectCard == "" || seed.levelThreeSpell == "" || seed.levelFiveSpell == "" {
			t.Fatalf("incomplete seed: %+v", seed)
		}
		if seenEffects[seed.effectCard] {
			t.Fatalf("duplicate effect %s", seed.effectCard)
		}
		seenEffects[seed.effectCard] = true
		for level, spell := range map[int]string{3: seed.levelThreeSpell, 5: seed.levelFiveSpell} {
			key := seed.effectCard + ":" + spell
			if seenPairs[key] {
				t.Fatalf("duplicate species spell %s at level %d", key, level)
			}
			seenPairs[key] = true
		}
	}
	if len(seenPairs) != 12 {
		t.Fatalf("levelled species grants=%d, want 12", len(seenPairs))
	}
}

func TestSpeciesLevelledSpellAccessPostgresClone(t *testing.T) {
	dsn := os.Getenv("SPECIES_SPELL_ACCESS_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set SPECIES_SPELL_ACCESS_TEST_DATABASE_URL for clone integration")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for run := 1; run <= 2; run++ {
		if err = repairSpeciesLevelledSpellAccess(db); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}
	var total, labelled, freeUses, untested int
	err = db.QueryRow(`SELECT count(*),
		count(*) FILTER (WHERE item->>'label'='always_prepared'),
		count(*) FILTER (WHERE item#>>'{freeuse,count}'='1' AND item#>>'{freeuse,recharge}'='long_rest'),
		count(DISTINCT e.card_number) FILTER (WHERE e.support->>'status'='untested'
			AND e.support->>'certification_version'=$1)
		FROM effects e CROSS JOIN LATERAL jsonb_array_elements(e.mechanics#>'{effects,0,result}') item
		WHERE e.card_number IN
		('RE-sub-drow','RE-sub-high_elf','RE-sub-wood_elf','RE-sub-abyssal','RE-sub-chthonic','RE-sub-infernal')
		AND e.deleted_at IS NULL AND item->>'kind'='grant_spell'
		AND COALESCE((item->>'level_gate')::int,1) IN (3,5)`, speciesLevelledSpellAccessMigrationVersion).
		Scan(&total, &labelled, &freeUses, &untested)
	if err != nil {
		t.Fatal(err)
	}
	if total != 12 || labelled != 12 || freeUses != 12 || untested != 6 {
		t.Fatalf("total=%d labelled=%d freeuses=%d untested=%d, want 12/12/12/6", total, labelled, freeUses, untested)
	}
	var spellSniperChoices int
	err = db.QueryRow(`SELECT count(*) FROM effects e
		CROSS JOIN LATERAL jsonb_array_elements(e.mechanics->'effects') entry
		WHERE e.card_number='EFF-general-FEAT-0033' AND e.deleted_at IS NULL
		AND entry->>'id'='spell_sniper_cantrip'
		AND entry#>>'{options,filter,requires_attack_roll}'='true'
		AND entry#>>'{grant,label}'='cantrip'
		AND e.support->>'status'='untested'`).Scan(&spellSniperChoices)
	if err != nil {
		t.Fatal(err)
	}
	if spellSniperChoices != 1 {
		t.Fatalf("Spell Sniper attack-roll cantrip choices=%d, want 1", spellSniperChoices)
	}
}
