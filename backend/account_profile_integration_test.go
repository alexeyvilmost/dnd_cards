package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

func TestAccountAdminPromotionRequiresServerSecretAndPersists(t *testing.T) {
	t.Setenv("JWT_SECRET", "account-admin-test-secret-at-least-32-bytes")
	t.Setenv("CONTENT_ADMIN_USER_IDS", "")
	secretHash, err := bcrypt.GenerateFromPassword([]byte("test-admin-secret"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("ADMIN_ELEVATION_PASSWORD_HASH", string(secretHash))
	f := openCharacterV3AccessFixture(t)
	controller := NewAuthController(f.auth)
	router := gin.New()
	router.PUT("/profile", StrictAuthMiddleware(f.auth), controller.UpdateProfile)
	router.POST("/promote", StrictAuthMiddleware(f.auth), controller.ElevateAdmin)
	router.POST("/admin-only", ContentAdminAuthMiddleware(f.auth), func(c *gin.Context) { c.Status(http.StatusNoContent) })
	request := func(method, path string, body any, authenticated bool) *httptest.ResponseRecorder {
		t.Helper()
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(encoded))
		req.Header.Set("Content-Type", "application/json")
		if authenticated {
			req.Header.Set("Authorization", "Bearer "+f.token(t, f.owner))
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}
	if got := request(http.MethodPost, "/promote", map[string]string{"password": "test-admin-secret"}, false).Code; got != http.StatusUnauthorized {
		t.Fatalf("anonymous promotion = %d", got)
	}
	if got := request(http.MethodPost, "/admin-only", nil, true).Code; got != http.StatusForbidden {
		t.Fatalf("unpromoted admin access = %d", got)
	}
	if got := request(http.MethodPut, "/profile", map[string]any{"display_name": "New name", "email": "new@example.test", "is_admin": true}, true).Code; got != http.StatusOK {
		t.Fatalf("profile update = %d", got)
	}
	var account User
	if err := f.db.First(&account, f.owner.ID).Error; err != nil {
		t.Fatal(err)
	}
	if account.IsAdmin {
		t.Fatal("profile body assigned administrator role")
	}
	if account.DisplayName != "New name" || account.Email != "new@example.test" {
		t.Fatalf("profile not updated: %+v", account)
	}
	if got := request(http.MethodPost, "/promote", map[string]string{"password": "wrong"}, true).Code; got != http.StatusForbidden {
		t.Fatalf("wrong password = %d", got)
	}
	if got := request(http.MethodPost, "/admin-only", nil, true).Code; got != http.StatusForbidden {
		t.Fatalf("wrong password granted role: %d", got)
	}
	if got := request(http.MethodPost, "/promote", map[string]string{"password": "test-admin-secret"}, true).Code; got != http.StatusOK {
		t.Fatalf("correct password = %d", got)
	}
	if got := request(http.MethodPost, "/admin-only", nil, true).Code; got != http.StatusNoContent {
		t.Fatalf("new grant not applied on next request: %d", got)
	}
	if err := f.db.First(&account, f.owner.ID).Error; err != nil || !account.IsAdmin {
		t.Fatalf("grant not persisted: %v", err)
	}
}

func TestAccountAdminPromotionFailsClosedWithoutPasswordConfiguration(t *testing.T) {
	t.Setenv("JWT_SECRET", "account-admin-test-secret-at-least-32-bytes")
	t.Setenv("ADMIN_ELEVATION_PASSWORD_HASH", "")
	f := openCharacterV3AccessFixture(t)
	router := gin.New()
	router.POST("/promote", StrictAuthMiddleware(f.auth), NewAuthController(f.auth).ElevateAdmin)
	req := httptest.NewRequest(http.MethodPost, "/promote", bytes.NewBufferString(`{"password":"anything"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+f.token(t, f.owner))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured promotion = %d", response.Code)
	}
}

func TestAccountPasswordChangeRequiresCurrentPassword(t *testing.T) {
	t.Setenv("JWT_SECRET", "account-admin-test-secret-at-least-32-bytes")
	f := openCharacterV3AccessFixture(t)
	initialHash, err := bcrypt.GenerateFromPassword([]byte("current-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.db.Model(&User{}).Where("id = ?", f.owner.ID).Update("password_hash", string(initialHash)).Error; err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	router.POST("/change", StrictAuthMiddleware(f.auth), NewAuthController(f.auth).ChangePassword)
	request := func(current, next string) int {
		reqBody, _ := json.Marshal(map[string]string{"current_password": current, "new_password": next})
		req := httptest.NewRequest(http.MethodPost, "/change", bytes.NewReader(reqBody))
		req.Header.Set("Authorization", "Bearer "+f.token(t, f.owner))
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response.Code
	}
	if got := request("wrong", "new-password-with-16-chars"); got != http.StatusForbidden {
		t.Fatalf("wrong current password = %d", got)
	}
	if got := request("current-password", "short"); got != http.StatusBadRequest {
		t.Fatalf("short new password = %d", got)
	}
	if got := request("current-password", "new-password-with-16-chars"); got != http.StatusOK {
		t.Fatalf("valid change = %d", got)
	}
	var account User
	if err := f.db.First(&account, f.owner.ID).Error; err != nil {
		t.Fatal(err)
	}
	if bcrypt.CompareHashAndPassword([]byte(account.PasswordHash), []byte("current-password")) == nil {
		t.Fatal("old password still valid")
	}
	if bcrypt.CompareHashAndPassword([]byte(account.PasswordHash), []byte("new-password-with-16-chars")) != nil {
		t.Fatal("new password not saved")
	}
}
