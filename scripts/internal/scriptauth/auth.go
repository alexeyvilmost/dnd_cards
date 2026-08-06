package scriptauth

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const maxAuthErrorBody = 4096

type loginResponse struct {
	Token string `json:"token"`
}

// Token returns an explicitly supplied bearer token or performs a login with
// explicitly supplied content-admin credentials. It never invents defaults,
// registers users, or prints credentials/tokens.
func Token(apiBaseURL string) (string, error) {
	if token := strings.TrimSpace(os.Getenv("API_TOKEN")); token != "" {
		return token, nil
	}

	username := strings.TrimSpace(os.Getenv("CONTENT_ADMIN_USERNAME"))
	password := os.Getenv("CONTENT_ADMIN_PASSWORD")
	if username == "" || strings.TrimSpace(password) == "" {
		return "", fmt.Errorf("authentication is not configured: set API_TOKEN or both CONTENT_ADMIN_USERNAME and CONTENT_ADMIN_PASSWORD")
	}
	baseURL := strings.TrimRight(strings.TrimSpace(apiBaseURL), "/")
	if baseURL == "" {
		return "", fmt.Errorf("API base URL is empty")
	}
	body, err := json.Marshal(map[string]string{"username": username, "password": password})
	if err != nil {
		return "", err
	}
	request, err := http.NewRequest(http.MethodPost, baseURL+"/auth/login", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Timeout: 15 * time.Second}).Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		errorBody, _ := io.ReadAll(io.LimitReader(response.Body, maxAuthErrorBody))
		return "", fmt.Errorf("content-admin login failed with HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(errorBody)))
	}
	var result loginResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result); err != nil {
		return "", fmt.Errorf("decode login response: %w", err)
	}
	if strings.TrimSpace(result.Token) == "" {
		return "", fmt.Errorf("content-admin login response did not contain a token")
	}
	return result.Token, nil
}
