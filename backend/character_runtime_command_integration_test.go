package main

import (
	"encoding/json"
	"net/http"
	"reflect"
	"sort"
	"sync"
	"testing"

	"github.com/google/uuid"
)

func testRuntimeCommandRuleset() CharacterRuntimeCommandRulesetRef {
	return CharacterRuntimeCommandRulesetRef{
		SystemID:      DefaultCharacterSystemID,
		ReleaseID:     "micro-mvp@test",
		ContentHash:   "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		ErrataVersion: "2024.1",
	}
}

func runtimeCommandRequest(
	commandID uuid.UUID,
	source CharacterV3,
	target CharacterV3,
	targetHP int,
) CharacterRuntimeCommandRequest {
	participants := []CharacterRuntimeCommandParticipant{
		{
			CharacterID: source.ID.String(), ExpectedRuntimeRevision: source.RuntimeRevision,
			Patch: CharacterRuntimeCommandPatch{
				Resources: &JSONMap{"spell_slot_1": 0},
				TurnState: &JSONMap{"sheet_canonical_world": map[string]any{"revision": 1}},
			},
		},
		{
			CharacterID: target.ID.String(), ExpectedRuntimeRevision: target.RuntimeRevision,
			Patch: CharacterRuntimeCommandPatch{CurrentHP: &targetHP},
		},
	}
	sort.Slice(participants, func(left, right int) bool {
		return participants[left].CharacterID < participants[right].CharacterID
	})
	return CharacterRuntimeCommandRequest{
		CommandID: commandID.String(), RulesetRef: testRuntimeCommandRuleset(),
		Participants: participants,
		Events: []CharacterRuntimeCommandEvent{
			{
				CharacterID: source.ID.String(), Type: "resource_spent",
				Payload: JSONMap{
					"type": "resource_spent", "resource": "spell_slot_1",
					"amount": 1, "remaining": 0,
				},
			},
			{
				CharacterID: target.ID.String(), Type: "damage",
				Payload: JSONMap{
					"type": "damage", "amount": 3, "damageType": "force",
					"source": "Magic Missile",
				},
			},
		},
	}
}

func decodeRuntimeCommandResponse(t *testing.T, body []byte) CharacterRuntimeCommandResponse {
	t.Helper()
	var response CharacterRuntimeCommandResponse
	if err := json.Unmarshal(body, &response); err != nil {
		t.Fatal(err)
	}
	return response
}

func TestCharacterRuntimeCommandCommitsTwoSheetsEventsAndReplayAtomically(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	token := fixture.token(t, fixture.owner)

	if err := fixture.db.Model(&CharacterV3{}).Where("id = ?", fixture.ownerCharacter.ID).
		Update("turn_state", &JSONMap{"death_saves": map[string]any{"successes": 1}}).Error; err != nil {
		t.Fatal(err)
	}
	request := runtimeCommandRequest(
		uuid.New(), fixture.ownerCharacter, fixture.deleteCharacter, 7,
	)
	response := performCharacterV3Request(
		t, fixture.router, http.MethodPost, "/api/characters-v3/runtime-commands", token, request,
	)
	if response.Code != http.StatusOK {
		t.Fatalf("commit status=%d body=%s", response.Code, response.Body.String())
	}
	committed := decodeRuntimeCommandResponse(t, response.Body.Bytes())
	if committed.Replayed || committed.CommandID != request.CommandID || len(committed.Participants) != 2 {
		t.Fatalf("unexpected command response: %#v", committed)
	}
	for _, participant := range committed.Participants {
		if participant.RuntimeRevision != 1 || participant.Character.RuntimeRevision != 1 {
			t.Fatalf("participant revision was not advanced exactly once: %#v", participant)
		}
	}

	var source, target CharacterV3
	if err := fixture.db.First(&source, "id = ?", fixture.ownerCharacter.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.First(&target, "id = ?", fixture.deleteCharacter.ID).Error; err != nil {
		t.Fatal(err)
	}
	if source.RuntimeRevision != 1 || target.RuntimeRevision != 1 || target.CurrentHP != 7 {
		t.Fatalf("atomic projections diverged: source=%#v target=%#v", source, target)
	}
	if source.TurnState == nil || (*source.TurnState)["death_saves"] == nil ||
		(*source.TurnState)["sheet_canonical_world"] == nil {
		t.Fatalf("turn_state was replaced instead of merged: %#v", source.TurnState)
	}
	var eventCount, receiptCount int64
	if err := fixture.db.Model(&CharacterEvent{}).
		Where("character_id IN ?", []uuid.UUID{source.ID, target.ID}).Count(&eventCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Model(&CharacterRuntimeCommandRecord{}).Count(&receiptCount).Error; err != nil {
		t.Fatal(err)
	}
	if eventCount != 2 || receiptCount != 1 {
		t.Fatalf("events=%d receipts=%d, want 2/1", eventCount, receiptCount)
	}

	replayedResponse := performCharacterV3Request(
		t, fixture.router, http.MethodPost, "/api/characters-v3/runtime-commands", token, request,
	)
	if replayedResponse.Code != http.StatusOK {
		t.Fatalf("replay status=%d body=%s", replayedResponse.Code, replayedResponse.Body.String())
	}
	replayed := decodeRuntimeCommandResponse(t, replayedResponse.Body.Bytes())
	if !replayed.Replayed {
		t.Fatalf("idempotent retry was not marked replayed: %#v", replayed)
	}
	replayed.Replayed = false
	if !reflect.DeepEqual(replayed, committed) {
		t.Fatalf("replay did not return the exact committed response: committed=%#v replayed=%#v", committed, replayed)
	}
	if err := fixture.db.Model(&CharacterEvent{}).
		Where("character_id IN ?", []uuid.UUID{source.ID, target.ID}).Count(&eventCount).Error; err != nil {
		t.Fatal(err)
	}
	if eventCount != 2 {
		t.Fatalf("replay appended duplicate events: %d", eventCount)
	}
}

func TestCharacterRuntimeCommandCommitsInventoryConsumptionWithHPResourcesAndEvents(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	token := fixture.token(t, fixture.owner)
	ammoID := uuid.NewString()
	beforeInventory := InventoryItemRows{{CardID: ammoID, Qty: 2}}
	if err := fixture.db.Model(&CharacterV3{}).Where("id = ?", fixture.ownerCharacter.ID).
		Update("inventory_items", &beforeInventory).Error; err != nil {
		t.Fatal(err)
	}
	source := fixture.ownerCharacter
	source.InventoryItems = &beforeInventory
	request := runtimeCommandRequest(uuid.New(), source, fixture.deleteCharacter, 7)
	afterInventory := InventoryItemRows{{CardID: ammoID, Qty: 1}}
	for index := range request.Participants {
		if request.Participants[index].CharacterID == source.ID.String() {
			request.Participants[index].Patch.InventoryItems = &afterInventory
		}
	}
	request.Events = append(request.Events, CharacterRuntimeCommandEvent{
		CharacterID: source.ID.String(), Type: "item_consumed",
		Payload: JSONMap{
			"type": "item_consumed", "cardId": ammoID,
			"amount": 1, "remaining": 1,
		},
	})

	response := performCharacterV3Request(
		t, fixture.router, http.MethodPost, "/api/characters-v3/runtime-commands", token, request,
	)
	if response.Code != http.StatusOK {
		t.Fatalf("commit status=%d body=%s", response.Code, response.Body.String())
	}
	var committedSource, committedTarget CharacterV3
	if err := fixture.db.First(&committedSource, "id = ?", source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.First(&committedTarget, "id = ?", fixture.deleteCharacter.ID).Error; err != nil {
		t.Fatal(err)
	}
	if committedSource.InventoryItems == nil || len(*committedSource.InventoryItems) != 1 ||
		(*committedSource.InventoryItems)[0].CardID != ammoID || (*committedSource.InventoryItems)[0].Qty != 1 ||
		committedSource.RuntimeRevision != 1 || committedTarget.RuntimeRevision != 1 ||
		committedTarget.CurrentHP != 7 {
		t.Fatalf("atomic inventory/HP projection diverged: source=%#v target=%#v", committedSource, committedTarget)
	}

	replay := performCharacterV3Request(
		t, fixture.router, http.MethodPost, "/api/characters-v3/runtime-commands", token, request,
	)
	if replay.Code != http.StatusOK || !decodeRuntimeCommandResponse(t, replay.Body.Bytes()).Replayed {
		t.Fatalf("replay status=%d body=%s", replay.Code, replay.Body.String())
	}
	var eventCount int64
	if err := fixture.db.Model(&CharacterEvent{}).
		Where("character_id IN ?", []uuid.UUID{source.ID, committedTarget.ID}).Count(&eventCount).Error; err != nil {
		t.Fatal(err)
	}
	if eventCount != 3 {
		t.Fatalf("replay wrote duplicate atomic events: got %d, want 3", eventCount)
	}
}

func TestCharacterRuntimeCommandInventoryRollsBackWhenParticipantCASFails(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	token := fixture.token(t, fixture.owner)
	ammoID := uuid.NewString()
	beforeInventory := InventoryItemRows{{CardID: ammoID, Qty: 2}}
	if err := fixture.db.Model(&CharacterV3{}).Where("id = ?", fixture.ownerCharacter.ID).
		Update("inventory_items", &beforeInventory).Error; err != nil {
		t.Fatal(err)
	}
	source := fixture.ownerCharacter
	source.InventoryItems = &beforeInventory
	request := runtimeCommandRequest(uuid.New(), source, fixture.deleteCharacter, 7)
	afterInventory := InventoryItemRows{{CardID: ammoID, Qty: 1}}
	for index := range request.Participants {
		if request.Participants[index].CharacterID == source.ID.String() {
			request.Participants[index].Patch.InventoryItems = &afterInventory
		}
	}
	if err := fixture.db.Model(&CharacterV3{}).Where("id = ?", fixture.deleteCharacter.ID).
		Update("runtime_revision", 1).Error; err != nil {
		t.Fatal(err)
	}

	response := performCharacterV3Request(
		t, fixture.router, http.MethodPost, "/api/characters-v3/runtime-commands", token, request,
	)
	if response.Code != http.StatusConflict || !jsonBodyHasCode(response.Body.Bytes(), "runtime_revision_conflict") {
		t.Fatalf("CAS status=%d body=%s", response.Code, response.Body.String())
	}
	var rolledBack CharacterV3
	if err := fixture.db.First(&rolledBack, "id = ?", source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if rolledBack.RuntimeRevision != 0 || rolledBack.InventoryItems == nil ||
		len(*rolledBack.InventoryItems) != 1 || (*rolledBack.InventoryItems)[0].Qty != 2 {
		t.Fatalf("failed CAS partially consumed inventory: %#v", rolledBack)
	}
	var eventCount int64
	if err := fixture.db.Model(&CharacterEvent{}).
		Where("character_id IN ?", []uuid.UUID{source.ID, fixture.deleteCharacter.ID}).Count(&eventCount).Error; err != nil {
		t.Fatal(err)
	}
	if eventCount != 0 {
		t.Fatalf("failed CAS wrote %d events", eventCount)
	}
}

func TestCharacterRuntimeCommandRejectsIDReuseAndStaleRevisionWithoutPartialWrite(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	token := fixture.token(t, fixture.owner)
	commandID := uuid.New()
	request := runtimeCommandRequest(commandID, fixture.ownerCharacter, fixture.deleteCharacter, 7)
	first := performCharacterV3Request(
		t, fixture.router, http.MethodPost, "/api/characters-v3/runtime-commands", token, request,
	)
	if first.Code != http.StatusOK {
		t.Fatalf("first status=%d body=%s", first.Code, first.Body.String())
	}

	changed := request
	for index := range changed.Participants {
		if changed.Participants[index].CharacterID == fixture.deleteCharacter.ID.String() {
			hp := 6
			changed.Participants[index].Patch.CurrentHP = &hp
		}
	}
	reuse := performCharacterV3Request(
		t, fixture.router, http.MethodPost, "/api/characters-v3/runtime-commands", token, changed,
	)
	if reuse.Code != http.StatusConflict || !jsonBodyHasCode(reuse.Body.Bytes(), "command_id_reuse") {
		t.Fatalf("reuse status=%d body=%s", reuse.Code, reuse.Body.String())
	}

	stale := runtimeCommandRequest(uuid.New(), fixture.ownerCharacter, fixture.deleteCharacter, 5)
	staleResponse := performCharacterV3Request(
		t, fixture.router, http.MethodPost, "/api/characters-v3/runtime-commands", token, stale,
	)
	if staleResponse.Code != http.StatusConflict || !jsonBodyHasCode(staleResponse.Body.Bytes(), "runtime_revision_conflict") {
		t.Fatalf("stale status=%d body=%s", staleResponse.Code, staleResponse.Body.String())
	}
	var target CharacterV3
	if err := fixture.db.First(&target, "id = ?", fixture.deleteCharacter.ID).Error; err != nil {
		t.Fatal(err)
	}
	if target.CurrentHP != 7 || target.RuntimeRevision != 1 {
		t.Fatalf("stale command partially wrote target: %#v", target)
	}
}

func jsonBodyHasCode(body []byte, expected string) bool {
	var payload map[string]any
	return json.Unmarshal(body, &payload) == nil && payload["code"] == expected
}

func TestCharacterRuntimeCommandConcurrentRetryCommitsOnce(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	token := fixture.token(t, fixture.owner)
	request := runtimeCommandRequest(uuid.New(), fixture.ownerCharacter, fixture.deleteCharacter, 7)

	responses := make(chan CharacterRuntimeCommandResponse, 2)
	errors := make(chan string, 2)
	var wait sync.WaitGroup
	for attempt := 0; attempt < 2; attempt++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			response := performCharacterV3Request(
				t, fixture.router, http.MethodPost, "/api/characters-v3/runtime-commands", token, request,
			)
			if response.Code != http.StatusOK {
				errors <- response.Body.String()
				return
			}
			responses <- decodeRuntimeCommandResponse(t, response.Body.Bytes())
		}()
	}
	wait.Wait()
	close(responses)
	close(errors)
	for failure := range errors {
		t.Fatalf("concurrent retry failed: %s", failure)
	}
	replayedCount := 0
	count := 0
	for response := range responses {
		count++
		if response.Replayed {
			replayedCount++
		}
	}
	if count != 2 || replayedCount != 1 {
		t.Fatalf("responses=%d replayed=%d, want 2/1", count, replayedCount)
	}
	var eventCount int64
	if err := fixture.db.Model(&CharacterEvent{}).
		Where("character_id IN ?", []uuid.UUID{fixture.ownerCharacter.ID, fixture.deleteCharacter.ID}).
		Count(&eventCount).Error; err != nil {
		t.Fatal(err)
	}
	if eventCount != 2 {
		t.Fatalf("concurrent retry wrote %d events, want 2", eventCount)
	}
}

func TestCharacterRuntimeCommandConcurrentDifferentCommandsSerializeOnParticipants(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	token := fixture.token(t, fixture.owner)
	requests := []CharacterRuntimeCommandRequest{
		runtimeCommandRequest(uuid.New(), fixture.ownerCharacter, fixture.deleteCharacter, 7),
		runtimeCommandRequest(uuid.New(), fixture.ownerCharacter, fixture.deleteCharacter, 6),
	}

	type result struct {
		status int
		body   []byte
	}
	results := make(chan result, len(requests))
	var wait sync.WaitGroup
	for _, request := range requests {
		request := request
		wait.Add(1)
		go func() {
			defer wait.Done()
			response := performCharacterV3Request(
				t, fixture.router, http.MethodPost, "/api/characters-v3/runtime-commands", token, request,
			)
			results <- result{status: response.Code, body: append([]byte(nil), response.Body.Bytes()...)}
		}()
	}
	wait.Wait()
	close(results)

	successes, conflicts := 0, 0
	for observed := range results {
		switch {
		case observed.status == http.StatusOK:
			successes++
		case observed.status == http.StatusConflict && jsonBodyHasCode(observed.body, "runtime_revision_conflict"):
			conflicts++
		default:
			t.Fatalf("unexpected concurrent command result: status=%d body=%s", observed.status, observed.body)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent commands successes/conflicts=%d/%d, want 1/1", successes, conflicts)
	}

	var source, target CharacterV3
	if err := fixture.db.First(&source, "id = ?", fixture.ownerCharacter.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.First(&target, "id = ?", fixture.deleteCharacter.ID).Error; err != nil {
		t.Fatal(err)
	}
	if source.RuntimeRevision != 1 || target.RuntimeRevision != 1 || (target.CurrentHP != 6 && target.CurrentHP != 7) {
		t.Fatalf("concurrent commands did not leave one complete projection: source=%#v target=%#v", source, target)
	}
	var eventCount, receiptCount int64
	if err := fixture.db.Model(&CharacterEvent{}).
		Where("character_id IN ?", []uuid.UUID{source.ID, target.ID}).Count(&eventCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Model(&CharacterRuntimeCommandRecord{}).Count(&receiptCount).Error; err != nil {
		t.Fatal(err)
	}
	if eventCount != 2 || receiptCount != 1 {
		t.Fatalf("concurrent commands events/receipts=%d/%d, want 2/1", eventCount, receiptCount)
	}
}

func TestCharacterRuntimeCommandRejectsEncounterLinkedParticipant(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	token := fixture.token(t, fixture.owner)
	encounterID := uuid.New()
	if err := fixture.db.Model(&CharacterV3{}).Where("id = ?", fixture.deleteCharacter.ID).
		Update("current_encounter_id", encounterID).Error; err != nil {
		t.Fatal(err)
	}
	request := runtimeCommandRequest(uuid.New(), fixture.ownerCharacter, fixture.deleteCharacter, 7)
	response := performCharacterV3Request(
		t, fixture.router, http.MethodPost, "/api/characters-v3/runtime-commands", token, request,
	)
	if response.Code != http.StatusConflict || !jsonBodyHasCode(response.Body.Bytes(), "character_linked_encounter") {
		t.Fatalf("linked status=%d body=%s", response.Code, response.Body.String())
	}
	var source CharacterV3
	if err := fixture.db.First(&source, "id = ?", fixture.ownerCharacter.ID).Error; err != nil {
		t.Fatal(err)
	}
	if source.RuntimeRevision != 0 {
		t.Fatalf("linked failure partially wrote source revision=%d", source.RuntimeRevision)
	}
}

func TestCharacterRuntimeCommandRejectsForeignParticipantBeforeAnyWrite(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	token := fixture.token(t, fixture.owner)
	cardID := uuid.NewString()
	beforeInventory := InventoryItemRows{{CardID: cardID, Qty: 2}}
	if err := fixture.db.Model(&CharacterV3{}).Where("id = ?", fixture.ownerCharacter.ID).
		Update("inventory_items", &beforeInventory).Error; err != nil {
		t.Fatal(err)
	}
	source := fixture.ownerCharacter
	source.InventoryItems = &beforeInventory
	request := runtimeCommandRequest(
		uuid.New(), source, fixture.otherCharacter, 7,
	)
	afterInventory := InventoryItemRows{{CardID: cardID, Qty: 1}}
	for index := range request.Participants {
		if request.Participants[index].CharacterID == source.ID.String() {
			request.Participants[index].Patch.InventoryItems = &afterInventory
		}
	}
	response := performCharacterV3Request(
		t, fixture.router, http.MethodPost, "/api/characters-v3/runtime-commands", token, request,
	)
	if response.Code != http.StatusForbidden || !jsonBodyHasCode(response.Body.Bytes(), "runtime_command_forbidden") {
		t.Fatalf("foreign status=%d body=%s", response.Code, response.Body.String())
	}
	var storedSource CharacterV3
	if err := fixture.db.First(&storedSource, "id = ?", fixture.ownerCharacter.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedSource.RuntimeRevision != 0 || storedSource.Resources != nil || storedSource.InventoryItems == nil ||
		len(*storedSource.InventoryItems) != 1 || (*storedSource.InventoryItems)[0].Qty != 2 {
		t.Fatalf("foreign participant failure partially wrote source: %#v", storedSource)
	}
}

func TestCharacterRuntimeCommandRollsBackEveryProjectionWhenJournalWriteFails(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	token := fixture.token(t, fixture.owner)
	cardID := uuid.NewString()
	beforeInventory := InventoryItemRows{{CardID: cardID, Qty: 2}}
	if err := fixture.db.Model(&CharacterV3{}).Where("id = ?", fixture.ownerCharacter.ID).
		Update("inventory_items", &beforeInventory).Error; err != nil {
		t.Fatal(err)
	}
	source := fixture.ownerCharacter
	source.InventoryItems = &beforeInventory
	if err := fixture.db.Exec(`
		CREATE FUNCTION reject_runtime_command_journal() RETURNS TRIGGER AS $$
		BEGIN
			IF NEW.character_id = '` + fixture.deleteCharacter.ID.String() + `'::uuid THEN
				RAISE EXCEPTION 'injected journal failure';
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;
		CREATE TRIGGER reject_runtime_command_journal
			BEFORE INSERT ON character_events
			FOR EACH ROW EXECUTE FUNCTION reject_runtime_command_journal();
	`).Error; err != nil {
		t.Fatal(err)
	}
	request := runtimeCommandRequest(
		uuid.New(), source, fixture.deleteCharacter, 7,
	)
	afterInventory := InventoryItemRows{{CardID: cardID, Qty: 1}}
	for index := range request.Participants {
		if request.Participants[index].CharacterID == source.ID.String() {
			request.Participants[index].Patch.InventoryItems = &afterInventory
		}
	}
	response := performCharacterV3Request(
		t, fixture.router, http.MethodPost, "/api/characters-v3/runtime-commands", token, request,
	)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("injected failure status=%d body=%s", response.Code, response.Body.String())
	}

	for _, expected := range []CharacterV3{source, fixture.deleteCharacter} {
		var stored CharacterV3
		if err := fixture.db.First(&stored, "id = ?", expected.ID).Error; err != nil {
			t.Fatal(err)
		}
		inventoryRolledBack := expected.ID != source.ID || (stored.InventoryItems != nil && len(*stored.InventoryItems) == 1 &&
			(*stored.InventoryItems)[0].Qty == 2)
		if stored.CurrentHP != expected.CurrentHP || stored.RuntimeRevision != 0 ||
			stored.Resources != nil || !inventoryRolledBack {
			t.Fatalf("failed transaction partially wrote %s: %#v", expected.ID, stored)
		}
	}
	var receiptCount, eventCount int64
	if err := fixture.db.Model(&CharacterRuntimeCommandRecord{}).Count(&receiptCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Model(&CharacterEvent{}).
		Where("character_id IN ?", []uuid.UUID{fixture.ownerCharacter.ID, fixture.deleteCharacter.ID}).
		Count(&eventCount).Error; err != nil {
		t.Fatal(err)
	}
	if receiptCount != 0 || eventCount != 0 {
		t.Fatalf("failed transaction left receipt/events: %d/%d", receiptCount, eventCount)
	}
}

func TestCharacterRuntimeCommandRollsBackProjectionsAndJournalWhenReceiptWriteFails(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	token := fixture.token(t, fixture.owner)
	if err := fixture.db.Exec(`
		CREATE FUNCTION reject_runtime_command_receipt() RETURNS TRIGGER AS $$
		BEGIN
			RAISE EXCEPTION 'injected receipt failure';
		END;
		$$ LANGUAGE plpgsql;
		CREATE TRIGGER reject_runtime_command_receipt
			BEFORE INSERT ON character_runtime_commands
			FOR EACH ROW EXECUTE FUNCTION reject_runtime_command_receipt();
	`).Error; err != nil {
		t.Fatal(err)
	}
	request := runtimeCommandRequest(
		uuid.New(), fixture.ownerCharacter, fixture.deleteCharacter, 7,
	)
	response := performCharacterV3Request(
		t, fixture.router, http.MethodPost, "/api/characters-v3/runtime-commands", token, request,
	)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("injected receipt failure status=%d body=%s", response.Code, response.Body.String())
	}

	for _, expected := range []CharacterV3{fixture.ownerCharacter, fixture.deleteCharacter} {
		var stored CharacterV3
		if err := fixture.db.First(&stored, "id = ?", expected.ID).Error; err != nil {
			t.Fatal(err)
		}
		if stored.CurrentHP != expected.CurrentHP || stored.RuntimeRevision != 0 || stored.Resources != nil {
			t.Fatalf("receipt failure partially wrote %s: %#v", expected.ID, stored)
		}
	}
	var receiptCount, eventCount int64
	if err := fixture.db.Model(&CharacterRuntimeCommandRecord{}).Count(&receiptCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := fixture.db.Model(&CharacterEvent{}).
		Where("character_id IN ?", []uuid.UUID{fixture.ownerCharacter.ID, fixture.deleteCharacter.ID}).
		Count(&eventCount).Error; err != nil {
		t.Fatal(err)
	}
	if receiptCount != 0 || eventCount != 0 {
		t.Fatalf("receipt failure left receipt/events: %d/%d", receiptCount, eventCount)
	}
}

func TestCharacterRuntimePatchAdvancesAndOptionallyChecksRevision(t *testing.T) {
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	fixture := openCharacterV3AccessFixture(t)
	token := fixture.token(t, fixture.owner)
	path := "/api/characters-v3/" + fixture.ownerCharacter.ID.String() + "/runtime"
	first := performCharacterV3Request(t, fixture.router, http.MethodPatch, path, token, map[string]any{
		"expected_runtime_revision": 0,
		"resources":                 map[string]any{"action": 0},
	})
	if first.Code != http.StatusOK {
		t.Fatalf("first patch status=%d body=%s", first.Code, first.Body.String())
	}
	var updated CharacterV3
	if err := json.Unmarshal(first.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.RuntimeRevision != 1 {
		t.Fatalf("runtime revision=%d, want 1", updated.RuntimeRevision)
	}
	stale := performCharacterV3Request(t, fixture.router, http.MethodPatch, path, token, map[string]any{
		"expected_runtime_revision": 0,
		"resources":                 map[string]any{"action": 1},
	})
	if stale.Code != http.StatusConflict || !jsonBodyHasCode(stale.Body.Bytes(), "runtime_revision_conflict") {
		t.Fatalf("stale patch status=%d body=%s", stale.Code, stale.Body.String())
	}
}
