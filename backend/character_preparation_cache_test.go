package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestPreparationCatalogContentProofTracksMembershipAndRights(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	if err := f.db.AutoMigrate(&Action{}, &Effect{}, &Spell{}, &Variable{}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("RULES_PREPARATION_CACHE_ENABLED", "1")
	basic, other := "basic", "other"
	action := Action{ID: uuid.New(), Name: "basic", CardNumber: "QA-cache-basic", Type: &basic}
	unrelated := Action{ID: uuid.New(), Name: "unrelated", CardNumber: "QA-cache-unrelated", Type: &other}
	if err := f.db.Create(&action).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.db.Create(&unrelated).Error; err != nil {
		t.Fatal(err)
	}
	needs := []roguelikeWorkerNeed{{Kind: "variables"}, {Kind: "effect_type", EffectType: "cache-member"}, {Kind: "entity", EntityType: "spell", Reference: "fresh_alias"}}
	stamp := func() string {
		value, err := equipmentCatalogFingerprint(f.db, needs, []uuid.UUID{f.owner.ID}, true)
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	before := stamp()
	if err := f.db.Model(&unrelated).Update("name", "unrelated changed").Error; err != nil {
		t.Fatal(err)
	}
	if stamp() != before {
		t.Fatal("proof depends on unrelated row")
	}
	// Different xmin with exactly the same content must not invalidate this
	// durable input proof; row metadata is unchanged by UpdateColumn.
	if err := f.db.Model(&action).UpdateColumn("name", action.Name).Error; err != nil {
		t.Fatal(err)
	}
	if stamp() != before {
		t.Fatal("content proof incorrectly uses xmin")
	}
	for mutation, mutate := range []func() error{
		func() error { return f.db.Model(&action).UpdateColumn("name", "changed mechanics source").Error },
		func() error {
			return f.db.Create(&Action{ID: uuid.New(), Name: "new", CardNumber: "QA-cache-added", Type: &basic}).Error
		},
		func() error {
			kind := "cache-member"
			return f.db.Create(&Effect{ID: uuid.New(), Name: "new effect", Type: &kind}).Error
		},
		func() error {
			name := "Fresh Alias"
			return f.db.Create(&Spell{ID: uuid.New(), Name: "new alias", NameEn: &name}).Error
		},
		func() error {
			return f.db.Create(&Variable{VariableID: "cache-proof-variable", Name: "new variable"}).Error
		},
		func() error { return f.db.Model(&f.owner).UpdateColumn("is_admin", !f.owner.IsAdmin).Error },
	} {
		before = stamp()
		if err := mutate(); err != nil {
			t.Fatal(err)
		}
		if stamp() == before {
			t.Fatalf("content/membership/rights change missed at mutation %d", mutation)
		}
	}
	before = stamp()
	t.Setenv("CONTENT_ADMIN_USER_IDS", f.owner.ID.String())
	if stamp() == before {
		t.Fatal("policy change missed")
	}

	catalog := emptyRoguelikeFrozenCatalog()
	if err := catalog.add("action", action); err != nil {
		t.Fatal(err)
	}
	artifact := "sha256:" + strings.Repeat("d", 64)
	hash, err := preparationCatalogHash(catalog, f.owner.ID, artifact)
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(catalog)
	hint, _ := preparationCatalogHint(f.db, f.owner.ID, f.ownerCharacter)
	characterPreparationCatalogs.put(preparationCatalogEntry{Hint: hint, ContentHash: hash, Fingerprint: stamp(), Artifact: artifact, Payload: payload, Needs: needs})
	ctx := context.Background()
	entry, copy, err := validatedPreparationCatalog(ctx, f.db, f.owner.ID, f.ownerCharacter)
	if err != nil || entry == nil || copy == nil {
		t.Fatalf("valid cache miss: %v", err)
	}
	copy.Entities["action"][0]["name"] = "request-local mutation"
	_, second, err := validatedPreparationCatalog(ctx, f.db, f.owner.ID, f.ownerCharacter)
	if err != nil || second.Entities["action"][0]["name"] != action.Name {
		t.Fatal("cache shared mutable data")
	}
	if foreign, _, err := validatedPreparationCatalog(ctx, f.db, f.other.ID, f.ownerCharacter); err != nil || foreign != nil {
		t.Fatal("cache crossed caller scope")
	}
	// Repeated-read transactions unwrap to the same pool scope, but still run
	// their own snapshot proof before any cached bytes can be reused.
	tx := f.db.Begin(&sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	defer tx.Rollback()
	if within, _, err := validatedPreparationCatalog(ctx, tx, f.owner.ID, f.ownerCharacter); err != nil || within == nil {
		t.Fatalf("transaction scope miss: %v", err)
	}
	if err := f.db.Model(&f.owner).UpdateColumn("username", "changed-cache-owner-policy").Error; err != nil {
		t.Fatal(err)
	}
	if revoked, _, err := validatedPreparationCatalog(ctx, f.db, f.owner.ID, f.ownerCharacter); err != nil || revoked != nil {
		t.Fatal("revoked rights reused cached input")
	}
}

func TestPreparationCatalogWorkerHashPreservesHistoricalJSKeyOrder(t *testing.T) {
	value := map[string]any{"nested": map[string]any{"10": "ten", "2": "two", "01": "leading", "4294967295": "max", "0": "zero", "<>&": "Юникод"}}
	hash, err := workerCatalogHash(value)
	if err != nil {
		t.Fatal(err)
	}
	expected := canonicalSHA256([]byte(`{"nested":{"0":"zero","2":"two","10":"ten","01":"leading","4294967295":"max","<>&":"Юникод"}}`))
	if hash != expected {
		t.Fatal("catalog serializer differs from historical JS numeric-property ordering")
	}
	if equipmentInputHash(value) == hash {
		t.Fatal("test did not distinguish the two serializer contracts")
	}
}

func TestPreparationCatalogBoundedEvictionAndIdentity(t *testing.T) {
	cache := newPreparationCatalogLRU(2048, 2)
	for _, key := range []string{"a", "b"} {
		cache.put(preparationCatalogEntry{Hint: key, Payload: []byte("12345678")})
	}
	if cache.get("a") == nil {
		t.Fatal("missing first entry")
	}
	cache.put(preparationCatalogEntry{Hint: "c", Payload: []byte("12345678")})
	if cache.get("b") != nil || cache.get("a") == nil || cache.get("c") == nil || cache.bytes > 2048 {
		t.Fatal("LRU or bytes limit failed")
	}
	copy := cache.get("a")
	copy.Payload[0] = 'X'
	if cache.get("a").Payload[0] == 'X' {
		t.Fatal("caller mutated retained bytes")
	}
	cache.put(preparationCatalogEntry{Hint: "oversized-metadata", Payload: []byte("tiny"), Needs: make([]roguelikeWorkerNeed, 4096)})
	if cache.get("oversized-metadata") != nil {
		t.Fatal("metadata bypassed cache budget")
	}
	catalog := emptyRoguelikeFrozenCatalog()
	owner := uuid.New()
	artifact := "sha256:" + strings.Repeat("a", 64)
	first, err := preparationCatalogHash(catalog, owner, artifact)
	if err != nil {
		t.Fatal(err)
	}
	otherOwner, _ := preparationCatalogHash(catalog, uuid.New(), artifact)
	otherArtifact, _ := preparationCatalogHash(catalog, owner, "sha256:"+strings.Repeat("b", 64))
	if first == otherOwner || first == otherArtifact {
		t.Fatal("immutable identity omitted owner or artifact")
	}
}

func TestPreparationCatalogCandidateCannotPinNewArtifact(t *testing.T) {
	for _, rejectCandidate := range []bool{false, true} {
		t.Run(map[bool]string{false: "identity-change", true: "candidate-rejected"}[rejectCandidate], func(t *testing.T) {
			f := openCharacterV3AccessFixture(t)
			if err := f.db.AutoMigrate(&Action{}); err != nil {
				t.Fatal(err)
			}
			t.Setenv("RULES_PREPARATION_CACHE_ENABLED", "1")
			catalog := emptyRoguelikeFrozenCatalog()
			oldArtifact, newArtifact := "sha256:"+strings.Repeat("a", 64), "sha256:"+strings.Repeat("b", 64)
			hash, _ := preparationCatalogHash(catalog, f.owner.ID, oldArtifact)
			payload, _ := json.Marshal(catalog)
			proof, err := equipmentCatalogFingerprint(f.db, nil, []uuid.UUID{f.owner.ID}, true)
			if err != nil {
				t.Fatal(err)
			}
			hint, _ := preparationCatalogHint(f.db, f.owner.ID, f.ownerCharacter)
			characterPreparationCatalogs.put(preparationCatalogEntry{Hint: hint, Artifact: oldArtifact, ContentHash: hash, Fingerprint: proof, Payload: payload})
			manifest, _ := workerCatalogHash(catalog)
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var request struct {
					Artifact string `json:"artifactHash"`
				}
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
				}
				if calls == 1 && request.Artifact != "" {
					t.Error("candidate pinned a new command")
				}
				if calls == 1 && rejectCandidate {
					w.WriteHeader(422)
					return
				}
				if calls == 2 && !rejectCandidate && request.Artifact != newArtifact {
					t.Error("cold restart lost chosen current artifact")
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"status": "ready", "artifactHash": newArtifact, "preparedCommand": CharacterRuntimeCommandRequest{}, "contentManifestHash": manifest, "catalogSelection": map[string]any{"version": 1, "entities": []any{}, "effectTypes": []string{}, "variables": false, "reads": []any{}}})
			}))
			defer server.Close()
			result, _, err := prepareCharacterWorker(context.Background(), f.db, roguelikeWorkerClient{URL: server.URL, Token: strings.Repeat("f", 32)}, "/equipment", f.owner.ID, f.ownerCharacter, nil)
			if err != nil || result.ArtifactHash != newArtifact || calls != 2 {
				t.Fatalf("candidate changed artifact selection: calls=%d err=%v", calls, err)
			}
		})
	}
}
