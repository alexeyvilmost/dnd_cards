package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type encounterTransactionFixture struct {
	db          *gorm.DB
	ownerID     uuid.UUID
	characterID uuid.UUID
	encounterID uuid.UUID
}

func isolatedSchemaDSN(dsn, schema string) (string, error) {
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		parsed, err := url.Parse(dsn)
		if err != nil {
			return "", err
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		return parsed.String(), nil
	}
	return strings.TrimSpace(dsn) + " search_path=" + schema, nil
}

func openEncounterTransactionFixture(t *testing.T) encounterTransactionFixture {
	t.Helper()
	dsn := os.Getenv("CANONICAL_RUNTIME_TEST_DSN")
	if dsn == "" {
		t.Skip("CANONICAL_RUNTIME_TEST_DSN is not set")
	}
	logMode := logger.Silent
	if testing.Verbose() {
		logMode = logger.Info
	}
	quiet := &gorm.Config{Logger: logger.Default.LogMode(logMode)}
	admin, err := gorm.Open(postgres.Open(dsn), quiet)
	if err != nil {
		t.Fatal(err)
	}
	schema := "encounter_tx_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err = admin.Exec("CREATE EXTENSION IF NOT EXISTS pgcrypto").Error; err != nil {
		t.Fatal(err)
	}
	if err = admin.Exec(fmt.Sprintf("CREATE SCHEMA %s", schema)).Error; err != nil {
		t.Fatal(err)
	}
	isolatedDSN, err := isolatedSchemaDSN(dsn, schema)
	if err != nil {
		t.Fatal(err)
	}
	db, err := gorm.Open(postgres.Open(isolatedDSN), quiet)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = admin.Exec(fmt.Sprintf("DROP SCHEMA IF EXISTS %s CASCADE", schema)).Error
		if sqlDB, dbErr := db.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
		if sqlDB, dbErr := admin.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	if err = db.Exec(`
		CREATE TABLE characters_v3 (
			id UUID PRIMARY KEY,
			user_id UUID NOT NULL,
			name TEXT NOT NULL,
			current_hp INTEGER NOT NULL,
			max_hp INTEGER NOT NULL,
			armor_class INTEGER NOT NULL,
			current_encounter_id UUID,
			turn_state JSONB,
			active_effects JSONB,
			runtime_revision BIGINT NOT NULL DEFAULT 0,
			created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE encounters (
			id UUID PRIMARY KEY,
			name TEXT NOT NULL,
			owner_user_id UUID NOT NULL,
			member_user_ids JSONB NOT NULL,
			state JSONB NOT NULL,
			seq BIGINT NOT NULL DEFAULT 0,
			created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE encounter_events (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			encounter_id UUID NOT NULL,
			seq BIGINT NOT NULL,
			payload JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE character_events (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			character_id UUID NOT NULL,
			client_event_id UUID,
			ts TIMESTAMPTZ NOT NULL,
			type VARCHAR(64) NOT NULL,
			payload JSONB NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
	`).Error; err != nil {
		t.Fatal(err)
	}

	fixture := encounterTransactionFixture{
		db: db, ownerID: uuid.New(), characterID: uuid.New(), encounterID: uuid.New(),
	}
	state := JSONMap{
		"combatants": []interface{}{map[string]interface{}{
			"actorId": "hero", "characterId": fixture.characterID.String(),
			"ownerUserId": fixture.ownerID.String(), "name": "Hero",
			"hp": float64(10), "maxHp": float64(10), "temp": float64(0),
			"activeEffects": []interface{}{},
		}},
		"round": float64(1), "activeIndex": float64(0),
	}
	stateJSON, _ := json.Marshal(state)
	membersJSON, _ := json.Marshal(Properties{fixture.ownerID.String()})
	if err = db.Exec(`
		INSERT INTO encounters (id, name, owner_user_id, member_user_ids, state, seq)
		VALUES (?, 'Atomic encounter', ?, ?::jsonb, ?::jsonb, 0)
	`, fixture.encounterID, fixture.ownerID, string(membersJSON), string(stateJSON)).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Exec(`
		INSERT INTO characters_v3 (
			id, user_id, name, current_hp, max_hp, armor_class,
			current_encounter_id, turn_state, active_effects
		) VALUES (?, ?, 'Hero', 10, 10, 14, ?, '{"temp_hp":0}'::jsonb, '[]'::jsonb)
	`, fixture.characterID, fixture.ownerID, fixture.encounterID).Error; err != nil {
		t.Fatal(err)
	}
	return fixture
}

func (fixture encounterTransactionFixture) apply(t *testing.T, request ApplyRequest) *httptest.ResponseRecorder {
	t.Helper()
	payload, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/encounters/"+fixture.encounterID.String()+"/apply",
		bytes.NewReader(payload),
	)
	context.Request.Header.Set("Content-Type", "application/json")
	context.Params = gin.Params{{Key: "id", Value: fixture.encounterID.String()}}
	context.Set("user_id", fixture.ownerID)
	NewEncounterController(fixture.db, nil, nil).Apply(context)
	return recorder
}

func (fixture encounterTransactionFixture) deleteAs(userID uuid.UUID) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(
		http.MethodDelete,
		"/api/encounters/"+fixture.encounterID.String(),
		nil,
	)
	context.Params = gin.Params{{Key: "id", Value: fixture.encounterID.String()}}
	context.Set("user_id", userID)
	NewEncounterController(fixture.db, nil, nil).Delete(context)
	return recorder
}

func (fixture encounterTransactionFixture) assertInitialState(t *testing.T) {
	t.Helper()
	var encounter Encounter
	if err := fixture.db.First(&encounter, "id = ?", fixture.encounterID).Error; err != nil {
		t.Fatal(err)
	}
	if encounter.Seq != 0 {
		t.Fatalf("encounter seq=%d, want rollback to 0", encounter.Seq)
	}
	combatants, err := combatantMaps(stateOfEncounter(&encounter))
	if err != nil || len(combatants) != 1 || combatants[0]["hp"] != float64(10) {
		t.Fatalf("encounter state did not roll back: combatants=%#v err=%v", combatants, err)
	}
	var currentHP int
	if err := fixture.db.Table("characters_v3").Select("current_hp").Where(
		"id = ?", fixture.characterID,
	).Scan(&currentHP).Error; err != nil {
		t.Fatal(err)
	}
	if currentHP != 10 {
		t.Fatalf("character HP=%d, want rollback to 10", currentHP)
	}
	for table, want := range map[string]int64{"encounter_events": 0, "character_events": 0} {
		var count int64
		if err := fixture.db.Table(table).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != want {
			t.Fatalf("%s count=%d, want %d", table, count, want)
		}
	}
}

func encounterPatchWithJournal(characterID uuid.UUID) ApplyRequest {
	expectedSeq := int64(0)
	return ApplyRequest{
		ExpectedSeq: &expectedSeq,
		Patches:     []CombatantPatch{{ActorID: "hero", Set: JSONMap{"hp": float64(7)}}},
		Log: []BattleLogEntry{{
			TargetCharacterID: characterID.String(), Type: "damage",
			Payload: JSONMap{"type": "damage", "amount": float64(3), "damageType": "slashing"},
		}},
	}
}

func TestEncounterApplyPersistsCharacterJournalInAtomicTransaction(t *testing.T) {
	gin.SetMode(gin.TestMode)
	fixture := openEncounterTransactionFixture(t)
	response := fixture.apply(t, encounterPatchWithJournal(fixture.characterID))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}

	var encounter Encounter
	if err := fixture.db.First(&encounter, "id = ?", fixture.encounterID).Error; err != nil {
		t.Fatal(err)
	}
	if encounter.Seq != 1 {
		t.Fatalf("encounter seq=%d, want 1", encounter.Seq)
	}
	var currentHP int
	if err := fixture.db.Table("characters_v3").Select("current_hp").Where(
		"id = ?", fixture.characterID,
	).Scan(&currentHP).Error; err != nil {
		t.Fatal(err)
	}
	if currentHP != 7 {
		t.Fatalf("character HP=%d, want 7", currentHP)
	}
	var journal CharacterEvent
	if err := fixture.db.First(&journal).Error; err != nil {
		t.Fatal(err)
	}
	if journal.CharacterID != fixture.characterID || journal.Type != "damage" || journal.Payload["amount"] != float64(3) {
		t.Fatalf("unexpected journal entry: %#v", journal)
	}
	var encounterEventCount int64
	if err := fixture.db.Model(&EncounterEvent{}).Count(&encounterEventCount).Error; err != nil {
		t.Fatal(err)
	}
	if encounterEventCount != 1 {
		t.Fatalf("encounter event count=%d, want 1", encounterEventCount)
	}
}

func TestEncounterApplyPreservesRelationalEffectLifecycleOnCharacter(t *testing.T) {
	gin.SetMode(gin.TestMode)
	fixture := openEncounterTransactionFixture(t)
	expectedSeq := int64(0)
	request := ApplyRequest{
		ExpectedSeq: &expectedSeq,
		Patches: []CombatantPatch{{ActorID: "hero", Set: JSONMap{
			"activeEffects": []interface{}{map[string]interface{}{
				"id": "effect-guidance", "name": "Guidance",
				"mechanics": map[string]interface{}{"kind": "modifier"},
				"source":    "spell", "ownerId": "hero", "sourceId": "cleric",
				"sourceTurnExpiry": map[string]interface{}{
					"sourceActorId": "cleric", "ownerActorId": "hero",
					"boundary": "end", "armed": true,
				},
			}},
		}}},
	}
	response := fixture.apply(t, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}

	var stored CharacterV3
	if err := fixture.db.First(&stored, "id = ?", fixture.characterID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.ActiveEffects == nil || len(*stored.ActiveEffects) != 1 {
		t.Fatalf("active effects=%#v, want one", stored.ActiveEffects)
	}
	effect := (*stored.ActiveEffects)[0]
	if effect.OwnerID != "hero" || effect.SourceID != "cleric" || effect.SourceTurnExpiry == nil {
		t.Fatalf("relational metadata was lost: %#v", effect)
	}
	if effect.SourceTurnExpiry.SourceActorID != "cleric" || effect.SourceTurnExpiry.OwnerActorID != "hero" ||
		effect.SourceTurnExpiry.Boundary != "end" || !effect.SourceTurnExpiry.Armed {
		t.Fatalf("source-turn lifecycle was changed: %#v", effect.SourceTurnExpiry)
	}
}

func TestEncounterApplyCharacterSyncFailureRollsBackEncounterAndEvent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	fixture := openEncounterTransactionFixture(t)
	if err := fixture.db.Exec(`
		CREATE FUNCTION reject_character_sync() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF NEW.current_hp IS DISTINCT FROM OLD.current_hp THEN
				RAISE EXCEPTION 'forced character sync failure';
			END IF;
			RETURN NEW;
		END;
		$$;
		CREATE TRIGGER reject_character_sync
		BEFORE UPDATE ON characters_v3
		FOR EACH ROW EXECUTE FUNCTION reject_character_sync();
	`).Error; err != nil {
		t.Fatal(err)
	}
	response := fixture.apply(t, encounterPatchWithJournal(fixture.characterID))
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	fixture.assertInitialState(t)
}

func TestEncounterApplyJournalFailureRollsBackEncounterEventAndCharacter(t *testing.T) {
	gin.SetMode(gin.TestMode)
	fixture := openEncounterTransactionFixture(t)
	if err := fixture.db.Exec(`
		CREATE FUNCTION reject_character_journal() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			RAISE EXCEPTION 'forced character journal failure';
		END;
		$$;
		CREATE TRIGGER reject_character_journal
		BEFORE INSERT ON character_events
		FOR EACH ROW EXECUTE FUNCTION reject_character_journal();
	`).Error; err != nil {
		t.Fatal(err)
	}
	response := fixture.apply(t, encounterPatchWithJournal(fixture.characterID))
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	fixture.assertInitialState(t)
}

func TestEncounterApplyRejectsForeignOrMalformedJournalTargetWithoutWrites(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, test := range []struct {
		name       string
		target     string
		wantStatus int
	}{
		{name: "foreign", target: uuid.NewString(), wantStatus: http.StatusForbidden},
		{name: "malformed", target: "not-a-character-id", wantStatus: http.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := openEncounterTransactionFixture(t)
			request := encounterPatchWithJournal(fixture.characterID)
			request.Log[0].TargetCharacterID = test.target
			response := fixture.apply(t, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status=%d, want %d body=%s", response.Code, test.wantStatus, response.Body.String())
			}
			fixture.assertInitialState(t)
		})
	}
}

func TestEncounterApplyRequiresCurrentExpectedSeqBeforeAnyWrite(t *testing.T) {
	gin.SetMode(gin.TestMode)
	stale := int64(9)
	for _, test := range []struct {
		name       string
		expected   *int64
		wantStatus int
		wantError  string
	}{
		{name: "missing", expected: nil, wantStatus: http.StatusBadRequest, wantError: "expected_seq обязателен"},
		{name: "stale", expected: &stale, wantStatus: http.StatusConflict, wantError: "состояние боя устарело"},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := openEncounterTransactionFixture(t)
			request := encounterPatchWithJournal(fixture.characterID)
			request.ExpectedSeq = test.expected
			response := fixture.apply(t, request)
			if response.Code != test.wantStatus || !strings.Contains(response.Body.String(), test.wantError) {
				t.Fatalf("status=%d, want %d body=%s", response.Code, test.wantStatus, response.Body.String())
			}
			fixture.assertInitialState(t)
		})
	}
}

func TestEncounterApplyRejectsSecondCommandBuiltFromSameSnapshot(t *testing.T) {
	gin.SetMode(gin.TestMode)
	fixture := openEncounterTransactionFixture(t)
	request := encounterPatchWithJournal(fixture.characterID)
	first := fixture.apply(t, request)
	if first.Code != http.StatusOK {
		t.Fatalf("first status=%d body=%s", first.Code, first.Body.String())
	}
	second := fixture.apply(t, request)
	if second.Code != http.StatusConflict || !strings.Contains(second.Body.String(), "текущая версия 1") {
		t.Fatalf("second status=%d body=%s", second.Code, second.Body.String())
	}
	var encounterEvents int64
	if err := fixture.db.Model(&EncounterEvent{}).Count(&encounterEvents).Error; err != nil {
		t.Fatal(err)
	}
	if encounterEvents != 1 {
		t.Fatalf("encounter events=%d, want exactly one committed command", encounterEvents)
	}
}

func TestEncounterDeleteIsOwnerOnlyAndAtomicallyClearsCharacterLinksAndEvents(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Run("participant cannot delete", func(t *testing.T) {
		fixture := openEncounterTransactionFixture(t)
		response := fixture.deleteAs(uuid.New())
		if response.Code != http.StatusForbidden {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
		fixture.assertInitialState(t)
	})

	t.Run("owner cleanup", func(t *testing.T) {
		fixture := openEncounterTransactionFixture(t)
		applied := fixture.apply(t, encounterPatchWithJournal(fixture.characterID))
		if applied.Code != http.StatusOK {
			t.Fatalf("seed apply status=%d body=%s", applied.Code, applied.Body.String())
		}
		response := fixture.deleteAs(fixture.ownerID)
		if response.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
		var encounterCount, eventCount int64
		if err := fixture.db.Model(&Encounter{}).Where("id = ?", fixture.encounterID).Count(&encounterCount).Error; err != nil {
			t.Fatal(err)
		}
		if err := fixture.db.Model(&EncounterEvent{}).Where("encounter_id = ?", fixture.encounterID).Count(&eventCount).Error; err != nil {
			t.Fatal(err)
		}
		if encounterCount != 0 || eventCount != 0 {
			t.Fatalf("cleanup left encounter=%d events=%d", encounterCount, eventCount)
		}
		var character CharacterV3
		if err := fixture.db.Select("id", "current_encounter_id").
			First(&character, "id = ?", fixture.characterID).Error; err != nil {
			t.Fatal(err)
		}
		if character.CurrentEncounterID != nil {
			t.Fatalf("character link not cleared: %s", character.CurrentEncounterID.String())
		}
	})

	t.Run("delete failure rolls cleanup back", func(t *testing.T) {
		fixture := openEncounterTransactionFixture(t)
		applied := fixture.apply(t, encounterPatchWithJournal(fixture.characterID))
		if applied.Code != http.StatusOK {
			t.Fatalf("seed apply status=%d body=%s", applied.Code, applied.Body.String())
		}
		if err := fixture.db.Exec(`
			CREATE FUNCTION reject_encounter_delete() RETURNS trigger LANGUAGE plpgsql AS $$
			BEGIN
				RAISE EXCEPTION 'forced encounter delete failure';
			END;
			$$;
			CREATE TRIGGER reject_encounter_delete
			BEFORE DELETE ON encounters
			FOR EACH ROW EXECUTE FUNCTION reject_encounter_delete();
		`).Error; err != nil {
			t.Fatal(err)
		}
		response := fixture.deleteAs(fixture.ownerID)
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
		}
		var encounterCount, eventCount, linkedCount int64
		if err := fixture.db.Model(&Encounter{}).Where("id = ?", fixture.encounterID).Count(&encounterCount).Error; err != nil {
			t.Fatal(err)
		}
		if err := fixture.db.Model(&EncounterEvent{}).Where("encounter_id = ?", fixture.encounterID).Count(&eventCount).Error; err != nil {
			t.Fatal(err)
		}
		if err := fixture.db.Model(&CharacterV3{}).
			Where("id = ? AND current_encounter_id = ?", fixture.characterID, fixture.encounterID).
			Count(&linkedCount).Error; err != nil {
			t.Fatal(err)
		}
		if encounterCount != 1 || eventCount != 1 || linkedCount != 1 {
			t.Fatalf("failed cleanup was partial: encounter=%d events=%d linked=%d", encounterCount, eventCount, linkedCount)
		}
	})
}
