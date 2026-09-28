package main

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func TestAuthTokenLifetimeCoversThirtyDaysAndStillExpires(t *testing.T) {
	t.Setenv("JWT_SECRET", strings.Repeat("session-test-", 4))
	service := NewAuthService(nil)
	user := User{ID: uuid.New(), Username: "session-lifetime"}
	token, err := service.generateJWTToken(user)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := service.ValidateTokenStrict(token)
	if err != nil {
		t.Fatal(err)
	}
	if got := claims.ExpiresAt.Sub(claims.IssuedAt.Time); got != 30*24*time.Hour {
		t.Fatalf("token lifetime = %s, want 30 days", got)
	}
	if claims.NotBefore.Time != claims.IssuedAt.Time {
		t.Fatal("issuance and not-before must use the same clock instant")
	}
	if err := jwt.NewValidator(jwt.WithTimeFunc(func() time.Time {
		return claims.IssuedAt.Add(29 * 24 * time.Hour)
	})).Validate(claims); err != nil {
		t.Fatalf("session expired before day 30: %v", err)
	}
	if err := jwt.NewValidator(jwt.WithTimeFunc(func() time.Time {
		return claims.ExpiresAt.Time
	})).Validate(claims); err == nil {
		t.Fatal("expired token was accepted")
	}
}
