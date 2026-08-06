package scriptauth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func clearAuthEnv(t *testing.T) {
	t.Helper()
	t.Setenv("API_TOKEN", "")
	t.Setenv("CONTENT_ADMIN_USERNAME", "")
	t.Setenv("CONTENT_ADMIN_PASSWORD", "")
}

func TestTokenFailsClosedWithoutExplicitCredentials(t *testing.T) {
	clearAuthEnv(t)
	if _, err := Token("http://127.0.0.1:1/api"); err == nil {
		t.Fatal("missing credentials must fail before network access")
	}
}

func TestTokenPrefersExplicitAPIToken(t *testing.T) {
	clearAuthEnv(t)
	t.Setenv("API_TOKEN", " explicit-token ")
	token, err := Token("http://127.0.0.1:1/api")
	if err != nil || token != "explicit-token" {
		t.Fatalf("token=%q err=%v", token, err)
	}
}

func TestTokenLogsInWithoutEverRegistering(t *testing.T) {
	clearAuthEnv(t)
	t.Setenv("CONTENT_ADMIN_USERNAME", "configured-admin")
	t.Setenv("CONTENT_ADMIN_PASSWORD", "configured-secret")
	var registrationCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/register" {
			registrationCalls.Add(1)
			http.Error(w, "must not register", http.StatusInternalServerError)
			return
		}
		if r.URL.Path != "/api/auth/login" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		var credentials map[string]string
		if err := json.NewDecoder(r.Body).Decode(&credentials); err != nil {
			t.Fatal(err)
		}
		if credentials["username"] != "configured-admin" || credentials["password"] != "configured-secret" {
			t.Fatalf("unexpected credentials payload: %#v", credentials)
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"token": "server-token"})
	}))
	defer server.Close()

	token, err := Token(server.URL + "/api")
	if err != nil || token != "server-token" {
		t.Fatalf("token=%q err=%v", token, err)
	}
	if registrationCalls.Load() != 0 {
		t.Fatal("auth helper must never auto-register an admin")
	}
}

func TestTokenDoesNotRegisterAfterLoginFailure(t *testing.T) {
	clearAuthEnv(t)
	t.Setenv("CONTENT_ADMIN_USERNAME", "configured-admin")
	t.Setenv("CONTENT_ADMIN_PASSWORD", "wrong-secret")
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	}))
	defer server.Close()

	if _, err := Token(server.URL + "/api"); err == nil {
		t.Fatal("login failure must fail closed")
	}
	if calls.Load() != 1 {
		t.Fatalf("login failure caused %d requests; expected exactly one login attempt", calls.Load())
	}
}
