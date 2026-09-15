package migrations

import (
	"dnd-cards-backend/charactertemplates"
	"encoding/json"
	"testing"
)

func TestCharacterTemplatePresets250(t *testing.T) {
	rows, err := charactertemplates.Presets()
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatal("expected three presets")
	}
	for i, row := range rows {
		var c map[string]any
		if err = json.Unmarshal(row.Character, &c); err != nil {
			t.Fatal(err)
		}
		for _, key := range []string{"id", "user_id", "user", "group_id", "group", "access_mode", "runtime_revision", "current_encounter_id"} {
			if _, ok := c[key]; ok {
				t.Fatal("owned template", key)
			}
		}
		if c["level"] != float64(1) || c["class_id"] != "2705eb12-1556-40c8-bdae-671e8f5c67eb" {
			t.Fatal("not level-one fighter")
		}
		if c["armor_class"] != float64([]int{16, 15, 19}[i]) || c["max_hp"] != float64([]int{15, 13, 15}[i]) {
			t.Fatal("incorrect derived stats", row.Name)
		}
	}
}

func TestCharacterTemplatesMigration250PreservesAdminEdits(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	if err := createCharacterTemplates250(db); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := db.QueryRow("SELECT count(*) FROM character_templates").Scan(&n); err != nil || n != 3 {
		t.Fatal(n, err)
	}
	if _, err := db.Exec("UPDATE character_templates SET name='Edited',version=2 WHERE preset_key='archer'"); err != nil {
		t.Fatal(err)
	}
	if err := createCharacterTemplates250(db); err != nil {
		t.Fatal(err)
	}
	if err := retainCharacterTemplates250(db); err != nil {
		t.Fatal(err)
	}
	var name string
	var version int
	if err := db.QueryRow("SELECT name,version FROM character_templates WHERE preset_key='archer'").Scan(&name, &version); err != nil || name != "Edited" || version != 2 {
		t.Fatal(name, version, err)
	}
	if _, err := db.Exec(`UPDATE character_templates SET character=character || '{"user_id":"unsafe"}'::jsonb`); err == nil {
		t.Fatal("database accepted an owned template")
	}
}

func TestArcherTemplate251UpgradeAndPreserveEdits(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "CONTENT_MIGRATION_TEST_DSN")
	if err := createCharacterTemplates250(db); err != nil {
		t.Fatal(err)
	}
	oldBackground := `UPDATE character_templates SET character=jsonb_set(character,'{background_id}','"ddde0222-b594-4bac-8103-d32395c294c2"'::jsonb),version=$1 WHERE preset_key='archer'`
	if _, err := db.Exec(oldBackground, 1); err != nil {
		t.Fatal(err)
	}
	if err := updateArcherTemplate251(db); err != nil {
		t.Fatal(err)
	}
	var background string
	var version int
	db.QueryRow(`SELECT character->>'background_id',version FROM character_templates WHERE preset_key='archer'`).Scan(&background, &version)
	if background != "a5d6d5a3-31b8-429c-88a3-6f112618a23c" || version != 2 {
		t.Fatal(background, version)
	}
	if err := updateArcherTemplate251(db); err != nil {
		t.Fatal(err)
	}
	db.QueryRow(`SELECT version FROM character_templates WHERE preset_key='archer'`).Scan(&version)
	if version != 2 {
		t.Fatal("not idempotent")
	}
	if _, err := db.Exec(oldBackground, 7); err != nil {
		t.Fatal(err)
	}
	if err := updateArcherTemplate251(db); err != nil {
		t.Fatal(err)
	}
	db.QueryRow(`SELECT character->>'background_id',version FROM character_templates WHERE preset_key='archer'`).Scan(&background, &version)
	if background != "ddde0222-b594-4bac-8103-d32395c294c2" || version != 7 {
		t.Fatal("administrator edit overwritten")
	}
}
