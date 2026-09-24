package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
)

var errOAuthProvider = errors.New("OAuth provider request failed")

type oauthProfile struct{ Subject, Name string }

func (p oauthProvider) authorizationURL(state, verifier string) string {
	q := url.Values{"response_type": {"code"}, "client_id": {p.ClientID}, "redirect_uri": {p.RedirectURI}, "scope": {p.Scope}, "state": {state}, "code_challenge": {oauthChallenge(verifier)}, "code_challenge_method": {"S256"}}
	return p.AuthorizeURL + "?" + q.Encode()
}

// No browser-supplied token or unsigned ID token is accepted. Identity comes
// only from the fixed HTTPS UserInfo endpoint after a confidential code/PKCE
// exchange. Provider tokens are never persisted, logged or sent to the client.
func (p oauthProvider) profile(ctx context.Context, client *http.Client, code, verifier string) (oauthProfile, error) {
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "client_id": {p.ClientID}, "client_secret": {p.ClientSecret}, "redirect_uri": {p.RedirectURI}, "code_verifier": {verifier}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return oauthProfile{}, errOAuthProvider
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var token struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
	}
	if err := oauthJSON(client, req, &token); err != nil || token.AccessToken == "" || !strings.EqualFold(token.TokenType, "bearer") {
		return oauthProfile{}, errOAuthProvider
	}
	req, err = http.NewRequestWithContext(ctx, http.MethodGet, p.UserInfoURL, nil)
	if err != nil {
		return oauthProfile{}, errOAuthProvider
	}
	authType := "Bearer "
	if p.ID == "yandex" {
		authType = "OAuth "
	}
	req.Header.Set("Authorization", authType+token.AccessToken)
	var info struct {
		Sub         string `json:"sub"`
		ID          string `json:"id"`
		ClientID    string `json:"client_id"`
		Name        string `json:"name"`
		DisplayName string `json:"display_name"`
	}
	if err := oauthJSON(client, req, &info); err != nil {
		return oauthProfile{}, err
	}
	profile := oauthProfile{Subject: info.Sub, Name: info.Name}
	if p.ID == "yandex" {
		if info.ClientID != p.ClientID {
			return oauthProfile{}, errOAuthProvider
		}
		profile = oauthProfile{Subject: info.ID, Name: info.DisplayName}
	}
	if profile.Subject == "" || len(profile.Subject) > 255 || strings.TrimSpace(profile.Subject) != profile.Subject {
		return oauthProfile{}, errOAuthProvider
	}
	for _, c := range profile.Subject {
		if c < 33 || c == 127 {
			return oauthProfile{}, errOAuthProvider
		}
	}
	name := []rune(strings.TrimSpace(profile.Name))
	if len(name) > 100 {
		name = name[:100]
	}
	profile.Name = string(name)
	if profile.Name == "" {
		profile.Name = p.Name + " пользователь"
	}
	return profile, nil
}

func oauthJSON(client *http.Client, req *http.Request, out any) error {
	req.Header.Set("Accept", "application/json")
	response, err := client.Do(req)
	if err != nil {
		return errOAuthProvider
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return errOAuthProvider
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, (64<<10)+1))
	if err != nil || len(body) > 64<<10 || json.Unmarshal(body, out) != nil {
		return errOAuthProvider
	}
	return nil
}
