package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestSpellUpdateKeepsNullableListsWhenEditorSendsEmptyLists(t *testing.T) {
	empty := Properties{}
	emptyDamage := SpellDamage{}
	req := UpdateSpellRequest{
		Classes: &empty, Subclasses: &empty, Resources: &empty,
		Damage: &emptyDamage,
	}
	preserveNullSpellLists(Spell{}, &req)
	if req.Classes != nil || req.Subclasses != nil || req.Resources != nil || req.Damage != nil {
		t.Fatalf("empty lists were not normalized: %+v", req)
	}

	stored := Properties{"wizard"}
	req = UpdateSpellRequest{Classes: &empty, Subclasses: &stored}
	preserveNullSpellLists(Spell{Classes: &stored}, &req)
	if req.Classes == nil || req.Subclasses == nil {
		t.Fatal("intentional edit of a populated list or addition was discarded")
	}
}

// Exercise the exact full-form update that failed in the local Mage Hand
// editor. The transaction prevents this regression check from editing a
// player's content or its certified support.
func TestMageHandEditorialSaveWithFullEditorPayload(t *testing.T) {
	dsn := os.Getenv("CANONICAL_RUNTIME_TEST_DSN")
	if dsn == "" {
		t.Skip("local test DSN is not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	id := uuid.MustParse("70e35366-5446-49ff-b0b9-759dbbff347e")
	var original Spell
	if err := db.Where("id = ?", id).First(&original).Error; err != nil {
		t.Skip("local Mage Hand fixture is unavailable")
	}
	if !isContentMechanicsLocked(original.Support) || original.Subclasses != nil || original.Resources != nil {
		t.Skip("Mage Hand fixture no longer has the regression preconditions")
	}
	tx := db.Begin()
	defer tx.Rollback()
	payload := map[string]any{
		"name": original.Name, "name_en": original.NameEn,
		"description":          original.Description + " [[Магия|concept:magic]]",
		"detailed_description": original.DetailedDescription,
		"image_url":            original.ImageURL, "level": original.Level,
		"school": original.School, "casting_time": original.CastingTime,
		"range": original.Range, "component_verbal": original.ComponentVerbal,
		"component_somatic":  original.ComponentSomatic,
		"component_material": original.ComponentMaterial,
		"material_text":      original.MaterialText, "duration": original.Duration,
		"classes": original.Classes, "subclasses": []string{},
		"concentration": original.Concentration, "ritual": original.Ritual,
		"resources": []string{}, "damage": original.Damage,
		"area": original.Area, "is_healing": original.IsHealing,
		"heal_dice": original.HealDice, "save_outcome": original.SaveOutcome,
		"upcast_description": original.UpcastDescription,
		"source":             original.Source,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Params = gin.Params{{Key: "id", Value: id.String()}}
	context.Request = httptest.NewRequest(http.MethodPut, "/api/spells/"+id.String(), bytes.NewReader(raw))
	context.Request.Header.Set("Content-Type", "application/json")
	NewSpellController(tx).UpdateSpell(context)
	if recorder.Code != http.StatusOK {
		t.Fatalf("full-form save: %d %s", recorder.Code, recorder.Body.String())
	}
	var saved Spell
	if err := tx.Where("id = ?", id).First(&saved).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(saved.Description, "[[Магия|concept:magic]]") || !isContentMechanicsLocked(saved.Support) || saved.Subclasses != nil || saved.Resources != nil {
		t.Fatal("description, certification, or nullable lists were not preserved")
	}
}
