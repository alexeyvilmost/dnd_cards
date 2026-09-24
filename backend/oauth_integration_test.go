package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"dnd-cards-backend/migrations"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Integration tests may only create their own schema on an explicitly supplied
// loopback database. They never run the project's global migration list.
func oauthTestDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("OAUTH_TEST_DSN")
	if dsn == "" {
		t.Skip("OAUTH_TEST_DSN is not set (loopback PostgreSQL only)")
	}
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid test database configuration")
	}
	if cfg.Host != "localhost" && cfg.Host != "127.0.0.1" && cfg.Host != "::1" {
		t.Fatal("OAuth tests require a loopback database")
	}
	for _, fallback := range cfg.Fallbacks {
		if fallback.Host != "localhost" && fallback.Host != "127.0.0.1" && fallback.Host != "::1" {
			t.Fatal("non-local database fallback refused")
		}
	}
	cfg.ConnectTimeout = 3 * time.Second
	admin := stdlib.OpenDB(*cfg)
	if err := admin.Ping(); err != nil {
		admin.Close()
		t.Fatal("local test database unavailable")
	}
	schema := "oauth_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.Exec(`CREATE SCHEMA "` + schema + `"`); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = admin.Exec(`DROP SCHEMA "` + schema + `" CASCADE`); _ = admin.Close() })
	cfg.RuntimeParams["search_path"] = schema
	sqlDB := stdlib.OpenDB(*cfg)
	t.Cleanup(func() { _ = sqlDB.Close() })
	_, err = sqlDB.Exec(`CREATE TABLE users (
		id uuid PRIMARY KEY, username varchar(50) NOT NULL UNIQUE, email varchar(255) NOT NULL UNIQUE,
		password_hash varchar(255) NOT NULL, display_name varchar(100) NOT NULL,
		created_at timestamptz, updated_at timestamptz, deleted_at timestamptz
	)`)
	if err != nil {
		t.Fatal(err)
	}
	legacyID := uuid.New()
	_, err = sqlDB.Exec(`INSERT INTO users (id,username,email,password_hash,display_name) VALUES ($1,'legacy','legacy@example.test','unchanged-password-hash','Existing User')`, legacyID)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := migrations.OAuth263Migration().Up(sqlDB); err != nil {
			t.Fatal(err)
		}
	}
	var hash string
	if err := sqlDB.QueryRow(`SELECT password_hash FROM users WHERE id=$1`, legacyID).Scan(&hash); err != nil || hash != "unchanged-password-hash" {
		t.Fatal("migration changed existing account")
	}
	db, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	return db
}

func TestOAuthIntegration(t *testing.T) {
	db := oauthTestDatabase(t)
	t.Setenv("JWT_SECRET", strings.Repeat("local-oauth-test-only-", 3))
	gin.SetMode(gin.TestMode)
	var tokenCalls atomic.Int32
	providerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := strings.Split(strings.TrimPrefix(r.URL.Path, "/"), "/")[0]
		if strings.HasSuffix(r.URL.Path, "/token") {
			tokenCalls.Add(1)
			_ = r.ParseForm()
			if !oauthProofPattern.MatchString(r.Form.Get("code_verifier")) || r.Form.Get("client_secret") != "server-secret" || r.Form.Get("redirect_uri") != "https://api.test"+oauthPath+"/"+id+"/callback" {
				t.Error("invalid server-side exchange")
			}
			json.NewEncoder(w).Encode(map[string]string{"access_token": "provider-access-token", "token_type": "bearer"})
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"sub": "same-subject", "id": "same-subject", "client_id": "client", "name": "Provider Person", "display_name": "Яндекс Пользователь", "email": "legacy@example.test"})
	}))
	defer providerServer.Close()
	cfg := oauthConfig{FrontendOrigin: "https://app.test", Providers: map[string]oauthProvider{}}
	for _, id := range []string{"google", "yandex"} {
		cfg.Providers[id] = oauthProvider{ID: id, Name: id, ClientID: "client", ClientSecret: "server-secret", Configured: true, RedirectURI: "https://api.test" + oauthPath + "/" + id + "/callback", AuthorizeURL: "https://provider.test/authorize", TokenURL: providerServer.URL + "/" + id + "/token", UserInfoURL: providerServer.URL + "/" + id + "/info"}
	}
	ac := &oauthController{auth: NewAuthService(db), config: cfg, client: oauthHTTPClient()}
	newRouter := func() *gin.Engine {
		r := gin.New()
		(&oauthController{auth: ac.auth, config: cfg, client: oauthHTTPClient()}).routes(r.Group("/api"), func(c *gin.Context) { c.Next() })
		return r
	}
	router := newRouter()
	request := func(method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	start := func(id, path string) (string, string, *http.Cookie) {
		verifier, _ := oauthRandom()
		w := request("GET", oauthPath+"/"+id+"/start?"+url.Values{"challenge": {oauthChallenge(verifier)}, "return_to": {path}}.Encode(), "", nil)
		if w.Code != 303 {
			t.Fatalf("start failed: %d %s", w.Code, w.Body.String())
		}
		location, _ := url.Parse(w.Header().Get("Location"))
		if location.Query().Get("redirect_uri") != cfg.Providers[id].RedirectURI || location.Query().Get("code_challenge_method") != "S256" {
			t.Fatal("redirect is not fixed/PKCE bound")
		}
		return location.Query().Get("state"), verifier, w.Result().Cookies()[0]
	}
	callback := func(id, state string, cookie *http.Cookie) *httptest.ResponseRecorder {
		return request("GET", oauthPath+"/"+id+"/callback?"+url.Values{"state": {state}, "code": {"provider-code"}}.Encode(), "", cookie)
	}
	exchange := func(code, verifier string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]string{"code": code, "verifier": verifier})
		return request("POST", oauthPath+"/exchange", string(body), nil)
	}
	getHandoff := func(w *httptest.ResponseRecorder) string {
		u, _ := url.Parse(w.Header().Get("Location"))
		q, _ := url.ParseQuery(u.Fragment)
		if u.Scheme+"://"+u.Host+u.Path != "https://app.test/login" || !oauthProofPattern.MatchString(q.Get("oauth_code")) {
			t.Fatalf("invalid callback result: %d %s", w.Code, w.Header().Get("Location"))
		}
		return q.Get("oauth_code")
	}

	t.Run("configured provider availability", func(t *testing.T) {
		w := request("GET", oauthPath+"/providers", "", nil)
		if strings.Count(w.Body.String(), `"enabled":true`) != 2 || strings.Contains(w.Body.String(), "server-secret") {
			t.Fatal("provider availability leaked secrets or is disabled")
		}
	})
	t.Run("state cookie provider binding and replay", func(t *testing.T) {
		state, verifier, cookie := start("google", "/encounters/join?mode=play#invite=abc")
		before := tokenCalls.Load()
		for _, w := range []*httptest.ResponseRecorder{callback("google", state, nil), callback("google", strings.Repeat("x", 43), cookie), callback("yandex", state, cookie)} {
			if !strings.Contains(w.Header().Get("Location"), "oauth_error=expired") {
				t.Fatal("invalid state accepted")
			}
		}
		if tokenCalls.Load() != before {
			t.Fatal("invalid CSRF state reached provider")
		}
		// A different controller instance resumes the DB-backed flow.
		router = newRouter()
		code := getHandoff(callback("google", state, cookie))
		if !strings.Contains(callback("google", state, cookie).Header().Get("Location"), "oauth_error=expired") || tokenCalls.Load() != before+1 {
			t.Fatal("callback replay exchanged another token")
		}
		if exchange(code, strings.Repeat("x", 43)).Code != 400 {
			t.Fatal("foreign tab redeemed code")
		}
		w := exchange(code, verifier)
		if w.Code != 200 {
			t.Fatalf("handoff failed: %d %s", w.Code, w.Body.String())
		}
		var result oauthLoginResponse
		if json.Unmarshal(w.Body.Bytes(), &result) != nil || result.ReturnPath != "/encounters/join?mode=play#invite=abc" {
			t.Fatal("return path lost")
		}
		if _, err := ac.auth.ValidateTokenStrict(result.Token); err != nil {
			t.Fatal("invalid application token")
		}
		if result.User.Email != "" || result.User.Username == "legacy" || strings.Contains(w.Body.String(), "provider-access-token") {
			t.Fatal("unsafe email linking or provider token disclosure")
		}
		if exchange(code, verifier).Code != 400 {
			t.Fatal("handoff replay succeeded")
		}
	})
	t.Run("second provider and repeat login reuse identity", func(t *testing.T) {
		var first uuid.UUID
		for i := 0; i < 2; i++ {
			state, verifier, cookie := start("yandex", "/")
			w := exchange(getHandoff(callback("yandex", state, cookie)), verifier)
			var result oauthLoginResponse
			if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || result.ReturnPath != "/" {
				t.Fatal("Yandex login failed")
			}
			if i == 0 {
				first = result.User.ID
			} else if result.User.ID != first {
				t.Fatal("repeat login created another user")
			}
		}
		var count int64
		db.Table("users").Count(&count)
		if count != 3 {
			t.Fatalf("expected legacy plus two distinct provider accounts, got %d", count)
		}
		var email sql.NullString
		if err := db.Raw("SELECT email FROM users WHERE id = ?", first).Row().Scan(&email); err != nil || email.Valid {
			t.Fatal("OAuth email is not NULL")
		}
	})
	t.Run("cancellation expires state without exchange", func(t *testing.T) {
		state, _, cookie := start("google", "/")
		before := tokenCalls.Load()
		w := request("GET", oauthPath+"/google/callback?state="+state+"&error=access_denied&error_description=untrusted", "", cookie)
		if !strings.HasSuffix(w.Header().Get("Location"), "oauth_error=denied") || tokenCalls.Load() != before {
			t.Fatal("cancellation not handled")
		}
		if !strings.HasSuffix(callback("google", state, cookie).Header().Get("Location"), "oauth_error=expired") {
			t.Fatal("denied state reusable")
		}
	})
	t.Run("expired flow and handoff", func(t *testing.T) {
		state, _, cookie := start("google", "/")
		db.Exec("UPDATE oauth_flows SET expires_at = CURRENT_TIMESTAMP - interval '1 second' WHERE state_hash = ?", oauthHash(state))
		if !strings.HasSuffix(callback("google", state, cookie).Header().Get("Location"), "oauth_error=expired") {
			t.Fatal("expired state accepted")
		}
		state, verifier, cookie := start("google", "/")
		code := getHandoff(callback("google", state, cookie))
		db.Exec("UPDATE oauth_handoffs SET expires_at = CURRENT_TIMESTAMP - interval '1 second' WHERE code_hash = ?", oauthHash(code))
		if exchange(code, verifier).Code != 400 {
			t.Fatal("expired handoff accepted")
		}
	})
	t.Run("bad returns and foreign origins", func(t *testing.T) {
		verifier, _ := oauthRandom()
		w := request("GET", oauthPath+"/google/start?"+url.Values{"challenge": {oauthChallenge(verifier)}, "return_to": {"//evil.test"}}.Encode(), "", nil)
		if w.Code != 400 {
			t.Fatal("open redirect accepted")
		}
		r := httptest.NewRequest("POST", oauthPath+"/exchange", strings.NewReader(`{}`))
		r.Header.Set("Origin", "https://evil.test")
		w = httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatal("foreign origin accepted")
		}
	})
	t.Run("concurrent first login and redemption", func(t *testing.T) {
		flow := oauthFlow{ClientChallenge: oauthChallenge(strings.Repeat("v", 43)), ReturnPath: "/"}
		var wg sync.WaitGroup
		codes := make(chan string, 6)
		failures := make(chan error, 6)
		for i := 0; i < 6; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				code, err := ac.createHandoff(context.Background(), "google", oauthProfile{Subject: "concurrent", Name: "Concurrent"}, flow)
				if err != nil {
					failures <- err
				} else {
					codes <- code
				}
			}()
		}
		wg.Wait()
		close(failures)
		close(codes)
		for err := range failures {
			t.Fatal(err)
		}
		var count int64
		db.Table("oauth_identities").Where("provider = 'google' AND subject = 'concurrent'").Count(&count)
		if count != 1 {
			t.Fatal("duplicate identity")
		}
		code := <-codes
		var successes atomic.Int32
		for i := 0; i < 6; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if _, err := ac.exchangeHandoff(context.Background(), code, strings.Repeat("v", 43)); err == nil {
					successes.Add(1)
				}
			}()
		}
		wg.Wait()
		if successes.Load() != 1 {
			t.Fatalf("redeemed %d times", successes.Load())
		}
	})
	t.Run("deleted account stays deleted", func(t *testing.T) {
		state, verifier, cookie := start("yandex", "/")
		code := getHandoff(callback("yandex", state, cookie))
		if err := db.Exec("UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id IN (SELECT user_id FROM oauth_identities WHERE provider = 'yandex')").Error; err != nil {
			t.Fatal(err)
		}
		if exchange(code, verifier).Code != 400 {
			t.Fatal("deleted account received a session")
		}
		state, _, cookie = start("yandex", "/")
		if !strings.HasSuffix(callback("yandex", state, cookie).Header().Get("Location"), "oauth_error=failed") {
			t.Fatal("deleted account resurrected")
		}
	})
	t.Run("identity constraint", func(t *testing.T) {
		var user User
		db.Where("username = 'legacy'").First(&user)
		if err := db.Create(&oauthIdentity{Provider: "google", Subject: "same-subject", UserID: user.ID}).Error; err == nil {
			t.Fatal("provider subject unique constraint missing")
		}
	})
	t.Run("account creation rolls back if handoff cannot be saved", func(t *testing.T) {
		flow := oauthFlow{ClientChallenge: strings.Repeat("x", 100), ReturnPath: "/"}
		_, err := ac.createHandoff(context.Background(), "google", oauthProfile{Subject: "rollback-subject", Name: "Rollback Person"}, flow)
		if err == nil {
			t.Fatal("expected bounded handoff column to reject invalid data")
		}
		var count int64
		db.Table("oauth_identities").Where("subject = ?", "rollback-subject").Count(&count)
		if count != 0 {
			t.Fatal("orphan identity after rollback")
		}
		db.Table("users").Where("display_name = ?", "Rollback Person").Count(&count)
		if count != 0 {
			t.Fatal("orphan user after rollback")
		}
	})
	t.Run("OAuth account has no password credential", func(t *testing.T) {
		var user User
		if err := db.Joins("JOIN oauth_identities oi ON oi.user_id = users.id").Where("oi.provider = 'google' AND oi.subject = 'same-subject'").First(&user).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := ac.auth.Login(AuthRequest{Username: user.Username, Password: "oauth-disabled"}); err == nil {
			t.Fatal("disabled password became a valid credential")
		}
	})
	t.Run("missing JWT configuration disables configured providers", func(t *testing.T) {
		t.Setenv("JWT_SECRET", "")
		w := request("GET", oauthPath+"/providers", "", nil)
		if strings.Count(w.Body.String(), `"enabled":false`) != 2 || strings.Count(w.Body.String(), `"reason":"unavailable"`) != 2 {
			t.Fatal("provider enabled without session signer")
		}
	})
	t.Log(fmt.Sprintf("local PostgreSQL OAuth flow verified for both providers; %d server-side token exchanges", tokenCalls.Load()))
}
