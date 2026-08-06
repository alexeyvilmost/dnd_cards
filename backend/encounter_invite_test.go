package main

import (
	"encoding/base64"
	"errors"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

var encounterInviteTestSecret = []byte("encounter-invite-test-secret-at-least-32-bytes")

func TestEncounterInviteValidForExactEncounterAndExpiresWithinFifteenMinutes(t *testing.T) {
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	service := newEncounterInviteService(encounterInviteTestSecret, encounterInviteTTL, func() time.Time { return now })
	encounterID, ownerID := uuid.New(), uuid.New()

	token, expiresAt, err := service.Issue(encounterID, ownerID)
	if err != nil {
		t.Fatal(err)
	}
	if expiresAt.Sub(now) != 15*time.Minute {
		t.Fatalf("invite ttl=%s, want 15m", expiresAt.Sub(now))
	}
	if err := service.Validate(token, encounterID, ownerID); err != nil {
		t.Fatalf("exact-scope invite must validate: %v", err)
	}
	if strings.Contains(token, string(encounterInviteTestSecret[0:16])) {
		t.Fatal("token must not expose signing secret")
	}
}

func TestEncounterInviteRejectsForgedSignature(t *testing.T) {
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	service := newEncounterInviteService(encounterInviteTestSecret, encounterInviteTTL, func() time.Time { return now })
	token, _, err := service.Issue(uuid.New(), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(token, ".")
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		t.Fatal(err)
	}
	signature[0] ^= 0xff
	parts[2] = base64.RawURLEncoding.EncodeToString(signature)
	forged := strings.Join(parts, ".")
	if err := service.Validate(forged, uuid.New(), uuid.New()); !errors.Is(err, ErrEncounterInviteInvalid) {
		t.Fatalf("forged signature must be invalid, got %v", err)
	}
}

func TestEncounterInviteRejectsWrongEncounterAndOwner(t *testing.T) {
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	service := newEncounterInviteService(encounterInviteTestSecret, encounterInviteTTL, func() time.Time { return now })
	encounterID, ownerID := uuid.New(), uuid.New()
	token, _, err := service.Issue(encounterID, ownerID)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Validate(token, uuid.New(), ownerID); !errors.Is(err, ErrEncounterInviteWrongScope) {
		t.Fatalf("wrong encounter must fail exact-scope validation, got %v", err)
	}
	if err := service.Validate(token, encounterID, uuid.New()); !errors.Is(err, ErrEncounterInviteWrongScope) {
		t.Fatalf("changed encounter owner must invalidate old invite, got %v", err)
	}
}

func TestEncounterInviteRejectsExpiredToken(t *testing.T) {
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	service := newEncounterInviteService(encounterInviteTestSecret, time.Minute, func() time.Time { return now })
	encounterID, ownerID := uuid.New(), uuid.New()
	token, expiresAt, err := service.Issue(encounterID, ownerID)
	if err != nil {
		t.Fatal(err)
	}
	now = expiresAt
	if err := service.Validate(token, encounterID, ownerID); !errors.Is(err, ErrEncounterInviteExpired) {
		t.Fatalf("token at exp must be expired, got %v", err)
	}
}

func TestEncounterInviteSecretUsesDedicatedValueOrStrictJWTFallback(t *testing.T) {
	oldInvite, hadInvite := os.LookupEnv("ENCOUNTER_INVITE_SECRET")
	t.Cleanup(func() {
		if hadInvite {
			_ = os.Setenv("ENCOUNTER_INVITE_SECRET", oldInvite)
		} else {
			_ = os.Unsetenv("ENCOUNTER_INVITE_SECRET")
		}
	})

	if err := os.Unsetenv("ENCOUNTER_INVITE_SECRET"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("JWT_SECRET", "strict-jwt-fallback-secret-at-least-32-bytes")
	fallback := NewEncounterInviteService()
	if _, _, err := fallback.Issue(uuid.New(), uuid.New()); err != nil {
		t.Fatalf("unset dedicated secret must fall back to strict JWT_SECRET: %v", err)
	}

	if err := os.Setenv("ENCOUNTER_INVITE_SECRET", "too-short"); err != nil {
		t.Fatal(err)
	}
	misconfigured := NewEncounterInviteService()
	if _, _, err := misconfigured.Issue(uuid.New(), uuid.New()); !errors.Is(err, ErrEncounterInviteNotConfigured) {
		t.Fatalf("an explicitly invalid dedicated secret must fail closed, got %v", err)
	}
}

func TestAuthorizeEncounterJoinInviteAndLegacyPaths(t *testing.T) {
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	service := newEncounterInviteService(encounterInviteTestSecret, encounterInviteTTL, func() time.Time { return now })
	owner, member, controller, outsider := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	enc := encounterForPolicy(owner, member)
	actors := map[string]encounterActorAccess{
		"legacy-character": {
			ActorID: "legacy-character", CharacterID: uuid.New(),
			ControllerUserID: controller, IsCharacter: true,
		},
	}

	if err := authorizeEncounterJoin(&enc, member, actors, "", service); err != nil {
		t.Fatalf("existing participant must remain idempotent without invite: %v", err)
	}
	if err := authorizeEncounterJoin(&enc, controller, actors, "", service); err != nil {
		t.Fatalf("legacy linked-character controller repair must remain available: %v", err)
	}
	if err := authorizeEncounterJoin(&enc, outsider, actors, "", service); err == nil || err.Status != http.StatusForbidden {
		t.Fatalf("outsider without token must be denied, got %#v", err)
	}

	valid, _, issueErr := service.Issue(enc.ID, enc.OwnerUserID)
	if issueErr != nil {
		t.Fatal(issueErr)
	}
	if err := authorizeEncounterJoin(&enc, outsider, actors, valid, service); err != nil {
		t.Fatalf("valid exact-encounter invite must authorize outsider join: %v", err)
	}
	wrong, _, issueErr := service.Issue(uuid.New(), enc.OwnerUserID)
	if issueErr != nil {
		t.Fatal(issueErr)
	}
	if err := authorizeEncounterJoin(&enc, outsider, actors, wrong, service); err == nil || err.Status != http.StatusForbidden {
		t.Fatalf("wrong-encounter invite must be denied, got %#v", err)
	}

	parts := strings.Split(valid, ".")
	parts[2] = strings.Repeat("A", len(parts[2]))
	if err := authorizeEncounterJoin(&enc, outsider, actors, strings.Join(parts, "."), service); err == nil || err.Status != http.StatusForbidden {
		t.Fatalf("forged invite must be denied, got %#v", err)
	}

	now = now.Add(encounterInviteTTL)
	if err := authorizeEncounterJoin(&enc, outsider, actors, valid, service); err == nil || err.Status != http.StatusForbidden {
		t.Fatalf("expired invite must be denied, got %#v", err)
	}
}

func TestOnlyEncounterOwnerCanIssueInvite(t *testing.T) {
	owner, member := uuid.New(), uuid.New()
	enc := encounterForPolicy(owner, member)
	if !canIssueEncounterInvite(&enc, owner) {
		t.Fatal("encounter owner must be able to issue an invite")
	}
	if canIssueEncounterInvite(&enc, member) || canIssueEncounterInvite(&enc, uuid.New()) {
		t.Fatal("members and unrelated users must not issue encounter invites")
	}
}
