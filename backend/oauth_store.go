package main

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var errOAuthInvalid = errors.New("OAuth login expired or invalid")

type oauthFlow struct {
	StateHash, Provider, BrowserHash, Verifier, ClientChallenge, ReturnPath string
	ExpiresAt                                                               time.Time
}

func (oauthFlow) TableName() string { return "oauth_flows" }

type oauthHandoff struct {
	CodeHash                    string
	UserID                      uuid.UUID
	ClientChallenge, ReturnPath string
	ExpiresAt                   time.Time
}

func (oauthHandoff) TableName() string { return "oauth_handoffs" }

type oauthIdentity struct {
	Provider, Subject string
	UserID            uuid.UUID
}

func (oauthIdentity) TableName() string { return "oauth_identities" }

type oauthLoginResponse struct {
	AuthResponse
	ReturnPath string `json:"return_path"`
}

// Silence SQL parameter logging for transient browser proofs/PKCE verifiers.
func (ac *oauthController) db(ctx context.Context) *gorm.DB {
	return ac.auth.db.WithContext(ctx).Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
}

func (ac *oauthController) ready(ctx context.Context) bool {
	if ac.auth.db == nil || ac.config.FrontendOrigin == "" {
		return false
	}
	if _, err := ac.auth.generateJWTToken(User{}); err != nil {
		return false
	}
	var ready bool
	err := ac.db(ctx).Raw(`SELECT to_regclass('oauth_flows') IS NOT NULL
		AND to_regclass('oauth_identities') IS NOT NULL AND to_regclass('oauth_handoffs') IS NOT NULL
		AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('users') AND attname = 'email' AND NOT attnotnull)`).Scan(&ready).Error
	return err == nil && ready
}

func (ac *oauthController) saveFlow(ctx context.Context, flow oauthFlow) error {
	return ac.db(ctx).Transaction(func(tx *gorm.DB) error {
		// Bounded by endpoint rate limits; also remove expired records so no
		// background process or in-memory state is needed after a restart.
		if err := tx.Exec("DELETE FROM oauth_flows WHERE expires_at <= CURRENT_TIMESTAMP").Error; err != nil {
			return err
		}
		if err := tx.Exec("DELETE FROM oauth_handoffs WHERE expires_at <= CURRENT_TIMESTAMP").Error; err != nil {
			return err
		}
		return tx.Create(&flow).Error
	})
}

func (ac *oauthController) consumeFlow(ctx context.Context, provider, state, browser string) (oauthFlow, error) {
	var flow oauthFlow
	result := ac.db(ctx).Raw(`DELETE FROM oauth_flows WHERE state_hash = ? AND provider = ? AND browser_hash = ?
		AND expires_at > CURRENT_TIMESTAMP RETURNING *`, oauthHash(state), provider, oauthHash(browser)).Scan(&flow)
	if result.Error != nil {
		return flow, result.Error
	}
	if result.RowsAffected != 1 {
		return flow, errOAuthInvalid
	}
	return flow, nil
}

func (ac *oauthController) createHandoff(ctx context.Context, provider string, profile oauthProfile, flow oauthFlow) (string, error) {
	code, err := oauthRandom()
	if err != nil {
		return "", err
	}
	err = ac.db(ctx).Transaction(func(tx *gorm.DB) error {
		// Serialize registration for this provider+subject, including concurrent
		// first logins on different replicas. Database uniqueness is the backstop.
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", provider+":"+profile.Subject).Error; err != nil {
			return err
		}
		var identity oauthIdentity
		err := tx.Where("provider = ? AND subject = ?", provider, profile.Subject).Take(&identity).Error
		var user User
		if errors.Is(err, gorm.ErrRecordNotFound) {
			id := uuid.New()
			user = User{ID: id, Username: provider + "_" + strings.ReplaceAll(id.String(), "-", ""), PasswordHash: "oauth-disabled", DisplayName: profile.Name}
			// NULL is intentional, not a fabricated email address. Neither an
			// email nor a provider display name is ever used to find an account.
			if err := tx.Omit("Email").Create(&user).Error; err != nil {
				return err
			}
			identity = oauthIdentity{Provider: provider, Subject: profile.Subject, UserID: user.ID}
			if err := tx.Create(&identity).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		} else if err := tx.First(&user, "id = ?", identity.UserID).Error; err != nil {
			// A soft-deleted account cannot be resurrected by signing in again.
			return errOAuthInvalid
		}
		return tx.Create(&oauthHandoff{CodeHash: oauthHash(code), UserID: user.ID, ClientChallenge: flow.ClientChallenge, ReturnPath: flow.ReturnPath, ExpiresAt: time.Now().Add(time.Minute)}).Error
	})
	return code, err
}

func (ac *oauthController) exchangeHandoff(ctx context.Context, code, verifier string) (*oauthLoginResponse, error) {
	var response oauthLoginResponse
	err := ac.db(ctx).Transaction(func(tx *gorm.DB) error {
		var handoff oauthHandoff
		result := tx.Raw(`DELETE FROM oauth_handoffs WHERE code_hash = ? AND client_challenge = ? AND expires_at > CURRENT_TIMESTAMP RETURNING *`, oauthHash(code), oauthChallenge(verifier)).Scan(&handoff)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errOAuthInvalid
		}
		var user User
		if err := tx.First(&user, "id = ?", handoff.UserID).Error; err != nil {
			return errOAuthInvalid
		}
		path, ok := safeOAuthReturnPath(handoff.ReturnPath)
		if !ok {
			return errOAuthInvalid
		}
		token, err := ac.auth.generateJWTToken(user)
		if err != nil {
			return err
		}
		user.PasswordHash = ""
		response = oauthLoginResponse{AuthResponse: AuthResponse{Token: token, User: user}, ReturnPath: path}
		return nil
	})
	return &response, err
}
