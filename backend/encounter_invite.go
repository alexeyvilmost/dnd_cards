package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	encounterInvitePurpose    = "dnd-cards:encounter-invite:v1"
	encounterInviteTokenV1    = "v1"
	encounterInviteTTL        = 15 * time.Minute
	encounterInviteClockSkew  = 30 * time.Second
	encounterInviteNonceBytes = 16
	maxEncounterInviteLength  = 4096
)

var (
	ErrEncounterInviteNotConfigured = errors.New("encounter invite signing is not configured")
	ErrEncounterInviteInvalid       = errors.New("encounter invite is invalid")
	ErrEncounterInviteExpired       = errors.New("encounter invite is expired")
	ErrEncounterInviteWrongScope    = errors.New("encounter invite is for another encounter")
)

type encounterInviteClaims struct {
	Version     int       `json:"v"`
	Purpose     string    `json:"purpose"`
	EncounterID uuid.UUID `json:"encounter_id"`
	OwnerUserID uuid.UUID `json:"owner_user_id"`
	IssuedAt    int64     `json:"iat"`
	ExpiresAt   int64     `json:"exp"`
	Nonce       string    `json:"nonce"`
}

// EncounterInviteService is a stateless, domain-separated HMAC capability.
// Tokens are never persisted: all replicas only need the same signing secret.
type EncounterInviteService struct {
	secret    []byte
	ttl       time.Duration
	now       func() time.Time
	configErr error
}

func encounterInviteSecretFromEnv() ([]byte, error) {
	if configured, exists := os.LookupEnv("ENCOUNTER_INVITE_SECRET"); exists {
		if len(configured) < 32 || strings.TrimSpace(configured) == "" {
			return nil, ErrEncounterInviteNotConfigured
		}
		return []byte(configured), nil
	}
	fallback := os.Getenv("JWT_SECRET")
	if len(fallback) < 32 || strings.TrimSpace(fallback) == "" {
		return nil, ErrEncounterInviteNotConfigured
	}
	return []byte(fallback), nil
}

func NewEncounterInviteService() *EncounterInviteService {
	secret, err := encounterInviteSecretFromEnv()
	return &EncounterInviteService{
		secret:    append([]byte(nil), secret...),
		ttl:       encounterInviteTTL,
		now:       time.Now,
		configErr: err,
	}
}

func newEncounterInviteService(secret []byte, ttl time.Duration, now func() time.Time) *EncounterInviteService {
	service := &EncounterInviteService{
		secret: append([]byte(nil), secret...),
		ttl:    ttl,
		now:    now,
	}
	if len(secret) < 32 || ttl <= 0 || ttl > encounterInviteTTL || now == nil {
		service.configErr = ErrEncounterInviteNotConfigured
	}
	return service
}

func (s *EncounterInviteService) configured() error {
	if s == nil || s.configErr != nil || len(s.secret) < 32 || s.now == nil || s.ttl <= 0 || s.ttl > encounterInviteTTL {
		return ErrEncounterInviteNotConfigured
	}
	return nil
}

func (s *EncounterInviteService) signature(payloadPart string) []byte {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte(encounterInvitePurpose))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(payloadPart))
	return mac.Sum(nil)
}

func (s *EncounterInviteService) Issue(encounterID, ownerUserID uuid.UUID) (string, time.Time, error) {
	if err := s.configured(); err != nil {
		return "", time.Time{}, err
	}
	if encounterID == uuid.Nil || ownerUserID == uuid.Nil {
		return "", time.Time{}, ErrEncounterInviteInvalid
	}
	nonce := make([]byte, encounterInviteNonceBytes)
	if _, err := rand.Read(nonce); err != nil {
		return "", time.Time{}, err
	}
	now := time.Unix(s.now().UTC().Unix(), 0).UTC()
	expiresAt := now.Add(s.ttl)
	claims := encounterInviteClaims{
		Version:     1,
		Purpose:     encounterInvitePurpose,
		EncounterID: encounterID,
		OwnerUserID: ownerUserID,
		IssuedAt:    now.Unix(),
		ExpiresAt:   expiresAt.Unix(),
		Nonce:       base64.RawURLEncoding.EncodeToString(nonce),
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", time.Time{}, err
	}
	payloadPart := base64.RawURLEncoding.EncodeToString(payload)
	signaturePart := base64.RawURLEncoding.EncodeToString(s.signature(payloadPart))
	return encounterInviteTokenV1 + "." + payloadPart + "." + signaturePart, expiresAt, nil
}

func decodeEncounterInviteClaims(payload []byte) (encounterInviteClaims, error) {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var claims encounterInviteClaims
	if err := decoder.Decode(&claims); err != nil {
		return encounterInviteClaims{}, ErrEncounterInviteInvalid
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return encounterInviteClaims{}, ErrEncounterInviteInvalid
	}
	return claims, nil
}

func (s *EncounterInviteService) Validate(token string, encounterID, ownerUserID uuid.UUID) error {
	if err := s.configured(); err != nil {
		return err
	}
	if len(token) == 0 || len(token) > maxEncounterInviteLength || token != strings.TrimSpace(token) {
		return ErrEncounterInviteInvalid
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != encounterInviteTokenV1 || parts[1] == "" || parts[2] == "" {
		return ErrEncounterInviteInvalid
	}
	presentedSignature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(presentedSignature) != sha256.Size || !hmac.Equal(presentedSignature, s.signature(parts[1])) {
		return ErrEncounterInviteInvalid
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || len(payload) == 0 || len(payload) > 2048 {
		return ErrEncounterInviteInvalid
	}
	claims, err := decodeEncounterInviteClaims(payload)
	if err != nil {
		return err
	}
	if claims.Version != 1 || claims.Purpose != encounterInvitePurpose || claims.EncounterID == uuid.Nil || claims.OwnerUserID == uuid.Nil {
		return ErrEncounterInviteInvalid
	}
	nonce, err := base64.RawURLEncoding.DecodeString(claims.Nonce)
	if err != nil || len(nonce) != encounterInviteNonceBytes {
		return ErrEncounterInviteInvalid
	}
	if claims.IssuedAt <= 0 || claims.ExpiresAt <= claims.IssuedAt || claims.ExpiresAt-claims.IssuedAt > int64(encounterInviteTTL/time.Second) {
		return ErrEncounterInviteInvalid
	}
	now := s.now().UTC()
	if time.Unix(claims.IssuedAt, 0).After(now.Add(encounterInviteClockSkew)) {
		return ErrEncounterInviteInvalid
	}
	if !now.Before(time.Unix(claims.ExpiresAt, 0)) {
		return ErrEncounterInviteExpired
	}
	if claims.EncounterID != encounterID || claims.OwnerUserID != ownerUserID {
		return ErrEncounterInviteWrongScope
	}
	return nil
}
