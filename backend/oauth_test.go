package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestOAuthReturnPaths(t *testing.T) {
	for _, path := range []string{"/", "/library?tab=cards", "/encounters/join#invite=abc", "/m/персонаж"} {
		if got, ok := safeOAuthReturnPath(path); !ok || got != path {
			t.Errorf("safe path %q rejected", path)
		}
	}
	for _, path := range []string{"//evil.test", "https://evil.test", "/\\evil.test", "/%2fevil.test", "/%252fevil.test", "/%5cevil.test", "/\t/evil.test", "/%0aevil", "/a/../login", "/%2e%2e//evil.test", "/login", "/register", "/api/auth/oauth/google/start", "/%zz", strings.Repeat("a", 2049)} {
		if _, ok := safeOAuthReturnPath(path); ok {
			t.Errorf("unsafe path %q accepted", path)
		}
	}
	if got, ok := safeOAuthReturnPath(""); !ok || got != "/" {
		t.Fatal("default is not homepage")
	}
}

func TestOAuthConfigFailsClosed(t *testing.T) {
	for _, key := range []string{"OAUTH_FRONTEND_ORIGIN", "OAUTH_GOOGLE_CLIENT_ID", "OAUTH_GOOGLE_CLIENT_SECRET", "OAUTH_GOOGLE_REDIRECT_URI", "OAUTH_YANDEX_CLIENT_ID", "OAUTH_YANDEX_CLIENT_SECRET", "OAUTH_YANDEX_REDIRECT_URI"} {
		t.Setenv(key, "")
	}
	if loadOAuthConfig().Providers["google"].Configured {
		t.Fatal("missing configuration enabled")
	}
	t.Setenv("OAUTH_FRONTEND_ORIGIN", "http://localhost:3000")
	t.Setenv("OAUTH_GOOGLE_CLIENT_ID", "test-client")
	t.Setenv("OAUTH_GOOGLE_CLIENT_SECRET", "test-secret")
	t.Setenv("OAUTH_GOOGLE_REDIRECT_URI", "http://localhost:8080/api/auth/oauth/google/callback")
	if !loadOAuthConfig().Providers["google"].Configured {
		t.Fatal("local config rejected")
	}
	for _, bad := range []string{"http://example.com/api/auth/oauth/google/callback", "https://example.com/wrong", "https://user@example.com/api/auth/oauth/google/callback", "https://example.com/api/auth/oauth/google/callback?x=y", "//example.com/api/auth/oauth/google/callback"} {
		t.Setenv("OAUTH_GOOGLE_REDIRECT_URI", bad)
		if loadOAuthConfig().Providers["google"].Configured {
			t.Errorf("unsafe redirect accepted: %q", bad)
		}
	}
}

func TestOAuthDisabledProviderAPI(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ac := &oauthController{auth: NewAuthService(nil), config: oauthConfig{Providers: map[string]oauthProvider{"google": {ID: "google", Name: "Google"}, "yandex": {ID: "yandex", Name: "Яндекс"}}}}
	r := gin.New()
	ac.routes(r.Group("/api"), func(c *gin.Context) { c.Next() })
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", oauthPath+"/providers", nil))
	if w.Code != 200 || strings.Count(w.Body.String(), `"enabled":false`) != 2 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("unexpected disabled response: %d %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", oauthPath+"/google/start", nil))
	if w.Code != 503 || w.Header().Get("Location") != "" {
		t.Fatal("unconfigured start redirected")
	}
}

func TestOAuthProviderExchangeUsesPKCEAndServerUserInfo(t *testing.T) {
	for _, id := range []string{"google", "yandex"} {
		t.Run(id, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path == "/token" {
					if r.Method != "POST" {
						t.Error("token request must be POST")
					}
					_ = r.ParseForm()
					if r.Form.Get("code_verifier") != "verifier" || r.Form.Get("client_secret") != "secret" || r.Form.Get("redirect_uri") != "https://app.test/api/auth/oauth/"+id+"/callback" {
						t.Error("missing confidential exchange binding")
					}
					io.WriteString(w, `{"access_token":"provider-token","token_type":"bearer"}`)
				} else {
					want := "Bearer provider-token"
					if id == "yandex" {
						want = "OAuth provider-token"
					}
					if r.Header.Get("Authorization") != want || r.URL.Query().Has("access_token") || r.URL.Query().Has("oauth_token") {
						t.Error("userinfo token transport")
					}
					io.WriteString(w, `{"sub":"google-subject","id":"yandex-subject","client_id":"client","name":"Google User","display_name":"Yandex User","email":"legacy@example.test"}`)
				}
			}))
			defer server.Close()
			p := oauthProvider{ID: id, ClientID: "client", ClientSecret: "secret", AuthorizeURL: "https://provider.test/authorize", TokenURL: server.URL + "/token", UserInfoURL: server.URL + "/userinfo", RedirectURI: "https://app.test/api/auth/oauth/" + id + "/callback"}
			authorize, _ := url.Parse(p.authorizationURL("state", "verifier"))
			if authorize.Query().Get("code_challenge_method") != "S256" || authorize.Query().Get("code_challenge") != oauthChallenge("verifier") || authorize.Query().Has("client_secret") {
				t.Fatal("authorization PKCE/secret contract")
			}
			profile, err := p.profile(context.Background(), oauthHTTPClient(), "code", "verifier")
			if err != nil || profile.Subject != id+"-subject" || calls != 2 {
				t.Fatalf("profile: %+v, err: %v, calls: %d", profile, err, calls)
			}
		})
	}
}

func TestOAuthProviderRejectsInvalidResponses(t *testing.T) {
	for _, tc := range []struct {
		name, token, info string
		status            int
	}{
		{"token failure", `{}`, `{}`, 400},
		{"malformed token", `{`, `{}`, 200},
		{"missing token", `{"token_type":"bearer"}`, `{}`, 200},
		{"wrong token type", `{"access_token":"x","token_type":"mac"}`, `{}`, 200},
		{"missing subject", `{"access_token":"x","token_type":"bearer"}`, `{"client_id":"client"}`, 200},
		{"wrong yandex audience", `{"access_token":"x","token_type":"bearer"}`, `{"id":"123","client_id":"other"}`, 200},
		{"oversized", strings.Repeat("x", 65537), `{}`, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/token" {
					w.WriteHeader(tc.status)
					io.WriteString(w, tc.token)
				} else {
					io.WriteString(w, tc.info)
				}
			}))
			defer s.Close()
			p := oauthProvider{ID: "yandex", ClientID: "client", TokenURL: s.URL + "/token", UserInfoURL: s.URL + "/info"}
			if _, err := p.profile(context.Background(), oauthHTTPClient(), "code", "verifier"); err == nil {
				t.Fatal("invalid response accepted")
			}
		})
	}
	var forwarded bool
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" {
			http.Redirect(w, r, "/leak", 307)
		} else {
			forwarded = true
		}
	}))
	defer s.Close()
	p := oauthProvider{TokenURL: s.URL + "/token"}
	if _, err := p.profile(context.Background(), oauthHTTPClient(), "code", "verifier"); err == nil || forwarded {
		t.Fatal("provider redirect followed")
	}
}

func TestOAuthSecureCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	p := oauthProvider{RedirectURI: "https://app.test/api/auth/oauth/google/callback"}
	(&oauthController{}).setCookie(c, p, "state", "browser", 600)
	cookie := w.Result().Cookies()[0]
	if !strings.HasPrefix(cookie.Name, "__Host-") || !cookie.HttpOnly || !cookie.Secure || cookie.Domain != "" || cookie.Path != "/" || cookie.SameSite != http.SameSiteLaxMode {
		b, _ := json.Marshal(cookie)
		t.Fatalf("unsafe cookie: %s", b)
	}
}

func TestOAuthAccessLogOmitsCallbackSecrets(t *testing.T) {
	var output bytes.Buffer
	previous := gin.DefaultWriter
	gin.DefaultWriter = &output
	defer func() { gin.DefaultWriter = previous }()
	r := newOAuthSafeRouter()
	r.GET(oauthPath+"/google/callback", func(c *gin.Context) { c.Status(400) })
	r.GET("/ordinary", func(c *gin.Context) { c.Status(200) })
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", oauthPath+"/google/callback?code=private-code&state=private-state", nil))
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/ordinary", nil))
	if strings.Contains(output.String(), "private-") || !strings.Contains(output.String(), "/ordinary") {
		t.Fatal("OAuth query leaked or ordinary access logging changed")
	}
}
