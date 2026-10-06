package main

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
	"net/http"
	"testing"
)

func lifecycleRunFixture(t *testing.T) (characterV3AccessFixture, RoguelikeRun, CharacterV3) {
	t.Helper()
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	if err := fixture.db.AutoMigrate(&RoguelikeRun{}); err != nil {
		t.Fatal(err)
	}
	clone := testCharacterV3(fixture.owner.ID, "Run member")
	clone.CharacterType = "dungeon_crawl"
	if err := fixture.db.Omit("User", "Group").Create(&clone).Error; err != nil {
		t.Fatal(err)
	}
	run := RoguelikeRun{ID: uuid.New(), UserID: fixture.owner.ID, SourceCharacterID: fixture.deleteCharacter.ID, CharacterID: clone.ID,
		Status: RoguelikeStatusActive, Phase: RoguelikePhaseCamp, Attempt: 1, RunSeed: "lifecycle-test",
		Party: JSONMap{}, Journey: JSONMap{}, ModeRules: JSONMap{}, JourneyPrivate: JSONMap{}, Encounter: JSONMap{}, Shop: JSONMap{}, Checkpoint: JSONMap{}, LastReward: JSONMap{}}
	if err := fixture.db.Omit("Character").Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Exec("ALTER TABLE roguelike_runs ADD CONSTRAINT lifecycle_source FOREIGN KEY(source_character_id) REFERENCES characters_v3(id) ON DELETE RESTRICT").Error; err != nil {
		t.Fatal(err)
	}
	return fixture, run, clone
}

func TestCharacterLifecycleDeleteReferencedSourceRetainsRunHistory(t *testing.T) {
	fixture, run, _ := lifecycleRunFixture(t)
	response := performCharacterV3Request(t, fixture.router, http.MethodDelete, "/api/characters-v3/"+fixture.deleteCharacter.ID.String(), fixture.token(t, fixture.owner), nil)
	if response.Code != 200 {
		t.Fatalf("delete referenced source: %d %s", response.Code, response.Body.String())
	}
	var hidden CharacterV3
	if err := fixture.db.First(&hidden, "id = ?", fixture.deleteCharacter.ID).Error; err != gorm.ErrRecordNotFound {
		t.Fatalf("source still live: %v", err)
	}
	if err := fixture.db.Unscoped().First(&hidden, "id = ?", fixture.deleteCharacter.ID).Error; err != nil || !hidden.DeletedAt.Valid {
		t.Fatalf("historical identity lost: %v", err)
	}
	var retained RoguelikeRun
	if err := fixture.db.First(&retained, "id = ?", run.ID).Error; err != nil {
		t.Fatal(err)
	}
}

func TestCharacterLifecycleRunDeletionOwnershipAndAtomicSheets(t *testing.T) {
	fixture, run, clone := lifecycleRunFixture(t)
	err := fixture.db.Transaction(func(tx *gorm.DB) error { return deleteOwnedRoguelikeRun(tx, run.ID, fixture.other.ID) })
	if err == nil {
		t.Fatal("foreign owner deleted run")
	}
	var live CharacterV3
	if err = fixture.db.First(&live, "id = ?", clone.ID).Error; err != nil {
		t.Fatal(err)
	}
	err = fixture.db.Transaction(func(tx *gorm.DB) error { return deleteOwnedRoguelikeRun(tx, run.ID, fixture.owner.ID) })
	if err != nil {
		t.Fatal(err)
	}
	var removed RoguelikeRun
	if err = fixture.db.First(&removed, "id = ?", run.ID).Error; err != gorm.ErrRecordNotFound {
		t.Fatalf("run still live: %v", err)
	}
	if err = fixture.db.First(&live, "id = ?", clone.ID).Error; err != gorm.ErrRecordNotFound {
		t.Fatalf("run sheet still live: %v", err)
	}
	var source CharacterV3
	if err = fixture.db.First(&source, "id = ?", fixture.deleteCharacter.ID).Error; err != nil {
		t.Fatalf("source removed: %v", err)
	}
	if err = fixture.db.Unscoped().First(&removed, "id = ?", run.ID).Error; err != nil {
		t.Fatalf("run history lost: %v", err)
	}
}

func TestCharacterLifecycleDeleteLinkedCharacterAppendsRemovalWithoutChangingHistory(t *testing.T) {
	fixture, _, _ := lifecycleRunFixture(t)
	if err := fixture.db.AutoMigrate(&Encounter{}, &EncounterEvent{}); err != nil {
		t.Fatal(err)
	}
	state := JSONMap{"combatants": []any{
		map[string]any{"actorId": "owner-actor", "characterId": fixture.deleteCharacter.ID.String()},
		map[string]any{"actorId": "other-actor", "characterId": fixture.otherCharacter.ID.String()},
	}, "activeIndex": 1, "round": 3}
	encounter := Encounter{ID: uuid.New(), Name: "Historical battle", OwnerUserID: fixture.other.ID, State: &state, Seq: 5}
	if err := fixture.db.Create(&encounter).Error; err != nil {
		t.Fatal(err)
	}
	oldPayload := JSONMap{"events": []any{"Prior damage roll"}}
	event := EncounterEvent{ID: uuid.New(), EncounterID: encounter.ID, Seq: 5, Payload: &oldPayload}
	if err := fixture.db.Create(&event).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Model(&CharacterV3{}).Where("id=?", fixture.deleteCharacter.ID).Update("current_encounter_id", encounter.ID).Error; err != nil {
		t.Fatal(err)
	}
	response := performCharacterV3Request(t, fixture.router, http.MethodDelete, "/api/characters-v3/"+fixture.deleteCharacter.ID.String(), fixture.token(t, fixture.owner), nil)
	if response.Code != 200 {
		t.Fatalf("delete linked sheet: %d %s", response.Code, response.Body.String())
	}
	var retained Encounter
	if err := fixture.db.First(&retained, "id=?", encounter.ID).Error; err != nil {
		t.Fatal(err)
	}
	actors, err := combatantMaps(stateOfEncounter(&retained))
	if err != nil || len(actors) != 1 || actors[0]["actorId"] != "other-actor" || retained.Seq != 6 {
		t.Fatalf("invalid remaining battle: %+v %v", retained, err)
	}
	var events []EncounterEvent
	if err := fixture.db.Order("seq").Find(&events, "encounter_id=?", encounter.ID).Error; err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].ID != event.ID || (*events[1].Payload)["remove"] == nil {
		t.Fatalf("history changed: %+v", events)
	}
}

func TestCharacterLifecyclePresetPartyCreatesOnlyRunSheetsAndRollsBack(t *testing.T) {
	fixture := openCharacterV3AccessFixture(t)
	if err := fixture.db.AutoMigrate(&RoguelikeRun{}, &CharacterTemplate{}); err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Exec(`CREATE TABLE classes (id uuid PRIMARY KEY, deleted_at timestamptz)`).Error; err != nil {
		t.Fatal(err)
	}
	classID := uuid.New()
	if err := fixture.db.Exec(`INSERT INTO classes(id) VALUES (?)`, classID).Error; err != nil {
		t.Fatal(err)
	}
	potion := Card{ID: uuid.New(), CardNumber: roguelikeHealingPotionCard, Name: "Fixture potion", Rarity: RarityCommon}
	seedTaggedShopTest(t, fixture.db, potion)
	selections := []RoguelikeTemplateSource{}
	for _, name := range []string{"First template", "Second template"} {
		source := testCharacterV3(fixture.owner.ID, name)
		source.ClassID = &classID
		source.ClassLevels = &JSONMap{classID.String(): 1}
		snapshot, err := templateSnapshot(source)
		if err != nil {
			t.Fatal(err)
		}
		template := CharacterTemplate{ID: uuid.New(), Name: name, Character: snapshot, Version: 1}
		if err = fixture.db.Create(&template).Error; err != nil {
			t.Fatal(err)
		}
		selections = append(selections, RoguelikeTemplateSource{TemplateID: template.ID, Name: name})
	}
	var before int64
	fixture.db.Model(&CharacterV3{}).Count(&before)
	var run *RoguelikeRun
	err := fixture.db.Transaction(func(tx *gorm.DB) error {
		var err error
		run, err = createRoguelikePartyWithTemplates(tx, fixture.owner.ID, nil, selections)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	var after, standard int64
	fixture.db.Model(&CharacterV3{}).Count(&after)
	fixture.db.Model(&CharacterV3{}).Where("source_template_id IN ? AND character_type <> ?", []uuid.UUID{selections[0].TemplateID, selections[1].TemplateID}, "dungeon_crawl").Count(&standard)
	if after != before+2 || standard != 0 || len(run.Characters) != 2 {
		t.Fatalf("unexpected sheets before=%d after=%d standard=%d", before, after, standard)
	}
	if run.SourceCharacterID != run.CharacterID {
		t.Fatal("preset manufactured a separate source sheet")
	}
	selections[1].TemplateID = uuid.New()
	err = fixture.db.Transaction(func(tx *gorm.DB) error {
		_, err := createRoguelikePartyWithTemplates(tx, fixture.owner.ID, nil, selections)
		return err
	})
	if err == nil {
		t.Fatal("missing template accepted")
	}
	fixture.db.Model(&CharacterV3{}).Count(&after)
	if after != before+2 {
		t.Fatal("failed group left extra characters")
	}
}
