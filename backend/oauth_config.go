package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

const oauthPath = "/api/auth/oauth"

var oauthProofPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

type oauthProvider struct {
	ID, Name, ClientID, ClientSecret, RedirectURI string
	AuthorizeURL, TokenURL, UserInfoURL, Scope    string
	Configured                                    bool
}

type oauthConfig struct {
	FrontendOrigin string
	Providers      map[string]oauthProvider
}

func loadOAuthConfig() oauthConfig {
	cfg := oauthConfig{FrontendOrigin: strings.TrimSpace(os.Getenv("OAUTH_FRONTEND_ORIGIN")), Providers: map[string]oauthProvider{}}
	origin, valid := oauthFixedURL(cfg.FrontendOrigin)
	valid = valid && (origin.Path == "" || origin.Path == "/")
	if valid {
		cfg.FrontendOrigin = origin.Scheme + "://" + origin.Host
	} else {
		cfg.FrontendOrigin = ""
	}
	for _, p := range []oauthProvider{
		{ID: "google", Name: "Google", AuthorizeURL: "https://accounts.google.com/o/oauth2/v2/auth", TokenURL: "https://oauth2.googleapis.com/token", UserInfoURL: "https://openidconnect.googleapis.com/v1/userinfo", Scope: "openid profile"},
		{ID: "yandex", Name: "Яндекс", AuthorizeURL: "https://oauth.yandex.ru/authorize", TokenURL: "https://oauth.yandex.ru/token", UserInfoURL: "https://login.yandex.ru/info?format=json", Scope: "login:info"},
	} {
		prefix := "OAUTH_" + strings.ToUpper(p.ID) + "_"
		p.ClientID = strings.TrimSpace(os.Getenv(prefix + "CLIENT_ID"))
		p.ClientSecret = os.Getenv(prefix + "CLIENT_SECRET")
		p.RedirectURI = strings.TrimSpace(os.Getenv(prefix + "REDIRECT_URI"))
		callback, ok := oauthFixedURL(p.RedirectURI)
		p.Configured = valid && ok && callback.Path == oauthPath+"/"+p.ID+"/callback" && callback.RawPath == "" && p.ClientID != "" && strings.TrimSpace(p.ClientSecret) != ""
		cfg.Providers[p.ID] = p
	}
	return cfg
}

// Configuration, never request Host/Forwarded headers, defines redirect hosts.
// Plain HTTP is only allowed on loopback for local development.
func oauthFixedURL(raw string) (*url.URL, bool) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.ContainsAny(raw, "\\\r\n\t") {
		return &url.URL{}, false
	}
	loopback := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"
	return u, u.Scheme == "https" || (u.Scheme == "http" && loopback)
}

// Keep invite query/fragment intact, but reject browser URL normalization
// tricks, encoded network-path redirects, auth loops and control characters.
func safeOAuthReturnPath(raw string) (string, bool) {
	if raw == "" {
		return "/", true
	}
	if len(raw) > 2048 {
		return "", false
	}
	u, err := url.Parse(raw)
	if err != nil || u.IsAbs() || u.Host != "" || u.Opaque != "" {
		return "", false
	}
	path := strings.SplitN(strings.SplitN(raw, "?", 2)[0], "#", 2)[0]
	for i := 0; i < 4; i++ {
		if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") || strings.Contains(path, "\\") {
			return "", false
		}
		for _, c := range path {
			if c <= 32 || c == 127 {
				return "", false
			}
		}
		for _, segment := range strings.Split(path, "/") {
			if segment == "." || segment == ".." {
				return "", false
			}
		}
		lower := strings.ToLower(path)
		if strings.TrimSuffix(lower, "/") == "/login" || strings.TrimSuffix(lower, "/") == "/register" || strings.HasPrefix(lower, "/api/") {
			return "", false
		}
		decoded, err := url.PathUnescape(path)
		if err != nil {
			return "", false
		}
		if decoded == path {
			return raw, true
		}
		path = decoded
	}
	return "", false
}

func oauthRandom() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func oauthHash(value string) string {
	h := sha256.Sum256([]byte(value))
	return hex.EncodeToString(h[:])
}
func oauthChallenge(value string) string {
	h := sha256.Sum256([]byte(value))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

func oauthHTTPClient() *http.Client {
	return &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}
