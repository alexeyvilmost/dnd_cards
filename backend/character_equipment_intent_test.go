package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func TestEquipmentIntentStrictIdentityOnlySchema(t *testing.T) {
	base := fmt.Sprintf(`{"command_id":%q,"expected_runtime_revision":0,"operation":{"equip":%q}}`, uuid.NewString(), uuid.NewString())
	if _, err := decodeEquipmentIntent([]byte(base)); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{strings.Replace(base, `"operation":`, `"resources":{"forged":10},"operation":`, 1), strings.Replace(base, `"equip":`, `"equip":"bad","unequip":`, 1), strings.Replace(base, `"expected_runtime_revision":0`, `"expected_runtime_revision":-1`, 1), strings.Replace(base, `"expected_runtime_revision":0,`, ``, 1), strings.Replace(base, `"expected_runtime_revision":0`, `"expected_runtime_revision":null`, 1), strings.Replace(base, `"operation":`, `"command_id":"duplicate","operation":`, 1)} {
		if _, err := decodeEquipmentIntent([]byte(raw)); err == nil {
			t.Fatal("invalid intent accepted")
		}
	}
}

func TestEquipmentCatalogStampTracksQueriesAndRightsWithoutUnrelatedRows(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&Action{}, &Effect{}, &Variable{}, &Spell{}); err != nil {
		t.Fatal(err)
	}
	basic, other := "basic", "other"
	action := Action{ID: uuid.New(), Name: "basic", CardNumber: "QA-stamp-basic", Type: &basic}
	unrelated := Action{ID: uuid.New(), Name: "unrelated", CardNumber: "QA-stamp-unrelated", Type: &other}
	if err := f.db.Create(&action).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.db.Create(&unrelated).Error; err != nil {
		t.Fatal(err)
	}
	needs := []roguelikeWorkerNeed{{Kind: "variables"}, {Kind: "effect_type", EffectType: "equipment-fixture"}, {Kind: "entity", EntityType: "spell", Reference: "alpha_alias"}}
	stamp := func() string {
		value, err := equipmentCatalogStamp(f.db, needs, []uuid.UUID{f.owner.ID})
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	before := stamp()
	if err := f.db.Model(&unrelated).Update("name", "changed unrelated").Error; err != nil {
		t.Fatal(err)
	}
	if stamp() != before {
		t.Fatal("unrelated row widened dependency check")
	}
	for _, mutate := range []func() error{
		func() error { return f.db.Model(&action).Update("name", "changed basic").Error },
		func() error {
			return f.db.Create(&Action{ID: uuid.New(), Name: "inserted basic", CardNumber: "QA-stamp-inserted", Type: &basic}).Error
		},
		func() error {
			kind := "equipment-fixture"
			return f.db.Create(&Effect{ID: uuid.New(), Name: "inserted effect", Type: &kind}).Error
		},
		func() error {
			name := "Alpha Alias"
			return f.db.Create(&Spell{ID: uuid.New(), Name: "alias", NameEn: &name}).Error
		},
		func() error { return f.db.Create(&Variable{VariableID: "equipment-variable", Name: "Variable"}).Error },
		func() error { return f.db.Model(&f.owner).Update("is_admin", true).Error },
	} {
		before = stamp()
		if err := mutate(); err != nil {
			t.Fatal(err)
		}
		if stamp() == before {
			t.Fatal("dependency version/membership change not detected")
		}
	}
}

func equipmentIntentTransportFixture(t *testing.T, onWorker func(characterV3AccessFixture)) (characterV3AccessFixture, *atomic.Int32) {
	t.Helper()
	t.Setenv("JWT_SECRET", characterV3AccessTestSecret)
	t.Setenv("RULES_EQUIPMENT_INTENT_ENABLED", "1")
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&Action{}); err != nil {
		t.Fatal(err)
	}
	calls := &atomic.Int32{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body struct {
			Input struct {
				Character CharacterV3 `json:"character"`
				CommandID string      `json:"commandId"`
			}
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		if onWorker != nil {
			onWorker(f)
		}
		hp := 9
		command := CharacterRuntimeCommandRequest{CommandID: body.Input.CommandID, RulesetRef: CharacterRuntimeCommandRulesetRef{SystemID: body.Input.Character.SystemID, ReleaseID: "equipment-fixture", ContentHash: "sha256:" + strings.Repeat("a", 64), ErrataVersion: "1"}, Participants: []CharacterRuntimeCommandParticipant{{CharacterID: body.Input.Character.ID.String(), ExpectedRuntimeRevision: body.Input.Character.RuntimeRevision, Patch: CharacterRuntimeCommandPatch{CurrentHP: &hp}}}, Events: []CharacterRuntimeCommandEvent{{CharacterID: body.Input.Character.ID.String(), Type: "narrative", Payload: JSONMap{"type": "narrative", "text": "fixture transition"}}}}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "ready", "artifactHash": "sha256:" + strings.Repeat("b", 64), "preparedCommand": command})
	}))
	t.Cleanup(server.Close)
	t.Setenv("RULES_WORKER_URL", server.URL)
	t.Setenv("RULES_WORKER_TOKEN", strings.Repeat("f", 32))
	return f, calls
}

func TestEquipmentIntentPreparesWithoutRowLockAndReplaysWithoutWorker(t *testing.T) {
	f, calls := equipmentIntentTransportFixture(t, func(f characterV3AccessFixture) {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		err := f.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var hero CharacterV3
			return tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "NOWAIT"}).First(&hero, "id = ?", f.ownerCharacter.ID).Error
		})
		if err != nil {
			t.Errorf("worker ran while character was locked: %v", err)
		}
	})
	request := CharacterEquipmentIntent{CommandID: uuid.NewString(), ExpectedRuntimeRevision: f.ownerCharacter.RuntimeRevision, Operation: map[string]string{"equip": uuid.NewString()}}
	url := "/api/characters-v3/" + f.ownerCharacter.ID.String() + "/equipment-commands"
	token := f.token(t, f.owner)
	first := performCharacterV3Request(t, f.router, "POST", url, token, request)
	if first.Code != 200 {
		t.Fatalf("initial status %d: %s", first.Code, first.Body.String())
	}
	retry := performCharacterV3Request(t, f.router, "POST", url, token, request)
	if retry.Code != 200 || !strings.Contains(retry.Body.String(), `"replayed":true`) {
		t.Fatalf("replay status %d", retry.Code)
	}
	if calls.Load() != 1 {
		t.Fatal("receipt retry called worker")
	}
	t.Setenv("RULES_EQUIPMENT_INTENT_ENABLED", "0")
	rollbackRetry := performCharacterV3Request(t, f.router, "POST", url, token, request)
	if rollbackRetry.Code != 200 || calls.Load() != 1 {
		t.Fatal("rollback made an accepted receipt unreadable")
	}
	t.Setenv("RULES_EQUIPMENT_INTENT_ENABLED", "1")
	var count int64
	if err := f.db.Model(&CharacterEvent{}).Where("character_id = ?", f.ownerCharacter.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatal("event was not exactly once")
	}
	request.Operation["equip"] = uuid.NewString()
	if got := performCharacterV3Request(t, f.router, "POST", url, token, request); got.Code != 409 {
		t.Fatalf("reuse status %d", got.Code)
	}
}

func TestEquipmentIntentConcurrentRequestsHaveOneAtomicEffect(t *testing.T) {
	for _, sameID := range []bool{false, true} {
		t.Run(fmt.Sprint(sameID), func(t *testing.T) {
			arrived, release := make(chan struct{}, 2), make(chan struct{})
			released := false
			defer func() {
				if !released {
					close(release)
				}
			}()
			f, _ := equipmentIntentTransportFixture(t, func(characterV3AccessFixture) {
				arrived <- struct{}{}
				select {
				case <-release:
				case <-time.After(5 * time.Second):
					t.Error("fixture barrier timeout")
				}
			})
			first := CharacterEquipmentIntent{CommandID: uuid.NewString(), ExpectedRuntimeRevision: f.ownerCharacter.RuntimeRevision, Operation: map[string]string{"equip": uuid.NewString()}}
			second := first
			if !sameID {
				second.CommandID = uuid.NewString()
			}
			token, url := f.token(t, f.owner), "/api/characters-v3/"+f.ownerCharacter.ID.String()+"/equipment-commands"
			results := make(chan *httptest.ResponseRecorder, 2)
			for _, request := range []CharacterEquipmentIntent{first, second} {
				go func(request CharacterEquipmentIntent) {
					results <- performCharacterV3Request(t, f.router, "POST", url, token, request)
				}(request)
			}
			for i := 0; i < 2; i++ {
				select {
				case <-arrived:
				case <-time.After(5 * time.Second):
					t.Fatal("both preparations did not enter worker")
				}
			}
			close(release)
			released = true
			accepted, conflicts, replays := 0, 0, 0
			for i := 0; i < 2; i++ {
				response := <-results
				switch response.Code {
				case 200:
					accepted++
					if strings.Contains(response.Body.String(), `"replayed":true`) {
						replays++
					}
				case 409:
					conflicts++
				default:
					t.Fatalf("unexpected concurrent status %d", response.Code)
				}
			}
			if sameID && (accepted != 2 || replays != 1) || !sameID && (accepted != 1 || conflicts != 1) {
				t.Fatal("concurrent requests did not converge on one receipt")
			}
			var hero CharacterV3
			f.db.First(&hero, "id = ?", f.ownerCharacter.ID)
			if hero.RuntimeRevision != f.ownerCharacter.RuntimeRevision+1 {
				t.Fatal("double runtime revision")
			}
			var count int64
			f.db.Model(&CharacterEvent{}).Where("character_id = ?", hero.ID).Count(&count)
			if count != 1 {
				t.Fatal("duplicate event")
			}
		})
	}
}

func TestEquipmentIntentRejectsRunPhaseAndPrivateStateChanges(t *testing.T) {
	for _, field := range []string{"phase", "journey_private"} {
		t.Run(field, func(t *testing.T) {
			var run RoguelikeRun
			f, _ := equipmentIntentTransportFixture(t, func(f characterV3AccessFixture) {
				update := any(RoguelikePhaseCombat)
				if field == "journey_private" {
					update = JSONMap{"changed": true}
				}
				if err := f.db.Model(&run).Update(field, update).Error; err != nil {
					t.Error(err)
				}
			})
			if err := f.db.AutoMigrate(&RoguelikeRun{}); err != nil {
				t.Fatal(err)
			}
			if err := f.db.Model(&f.ownerCharacter).Update("character_type", "dungeon_crawl").Error; err != nil {
				t.Fatal(err)
			}
			run = RoguelikeRun{ID: uuid.New(), UserID: f.owner.ID, SourceCharacterID: f.ownerCharacter.ID, CharacterID: f.ownerCharacter.ID, Status: RoguelikeStatusActive, Phase: RoguelikePhaseCamp, Encounter: JSONMap{}, Shop: JSONMap{}, Checkpoint: JSONMap{}, LastReward: JSONMap{}, RunSeed: "local-owned-fixture"}
			if err := f.db.Create(&run).Error; err != nil {
				t.Fatal(err)
			}
			request := CharacterEquipmentIntent{CommandID: uuid.NewString(), ExpectedRuntimeRevision: f.ownerCharacter.RuntimeRevision, RoguelikeRunID: run.ID.String(), ExpectedRunRevision: &run.Revision, Operation: map[string]string{"equip": uuid.NewString()}}
			got := performCharacterV3Request(t, f.router, "POST", "/api/characters-v3/"+f.ownerCharacter.ID.String()+"/equipment-commands", f.token(t, f.owner), request)
			if got.Code != 409 {
				t.Fatalf("run %s change status %d", field, got.Code)
			}
			var count int64
			f.db.Model(&CharacterRuntimeCommandRecord{}).Count(&count)
			if count != 0 {
				t.Fatal("stale run command committed")
			}
		})
	}
}

func TestEquipmentIntentRejectsChangedBuildCatalogAndOwnershipAfterPreparation(t *testing.T) {
	for _, kind := range []string{"build", "catalog", "ownership", "rights"} {
		t.Run(kind, func(t *testing.T) {
			f, _ := equipmentIntentTransportFixture(t, func(f characterV3AccessFixture) {
				var err error
				switch kind {
				case "build":
					err = f.db.Model(&f.ownerCharacter).Update("name", "concurrent build edit").Error
				case "catalog":
					basic := "basic"
					err = f.db.Create(&Action{ID: uuid.New(), Name: "concurrent catalog insert", Type: &basic}).Error
				case "ownership":
					err = f.db.Model(&f.ownerCharacter).Update("user_id", f.other.ID).Error
				case "rights":
					err = f.db.Model(&f.owner).Update("is_admin", true).Error
				}
				if err != nil {
					t.Error(err)
				}
			})
			request := CharacterEquipmentIntent{CommandID: uuid.NewString(), ExpectedRuntimeRevision: f.ownerCharacter.RuntimeRevision, Operation: map[string]string{"equip": uuid.NewString()}}
			got := performCharacterV3Request(t, f.router, "POST", "/api/characters-v3/"+f.ownerCharacter.ID.String()+"/equipment-commands", f.token(t, f.owner), request)
			if got.Code != 409 && got.Code != 403 {
				t.Fatalf("stale %s status %d: %s", kind, got.Code, got.Body.String())
			}
			var count int64
			f.db.Model(&CharacterRuntimeCommandRecord{}).Count(&count)
			if count != 0 {
				t.Fatal("stale command persisted receipt")
			}
			var hero CharacterV3
			f.db.First(&hero, "id = ?", f.ownerCharacter.ID)
			if hero.RuntimeRevision != f.ownerCharacter.RuntimeRevision || hero.CurrentHP != f.ownerCharacter.CurrentHP {
				t.Fatal("stale command partially changed runtime")
			}
		})
	}
}
