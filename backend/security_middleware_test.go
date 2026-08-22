package main

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func securityTestRouter(middlewares ...gin.HandlerFunc) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middlewares...)
	router.POST("/write", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	return router
}

func activeSecurityTestAuthService() *AuthService {
	return &AuthService{activeIdentityValidator: func(uuid.UUID, string) error { return nil }}
}

func TestRequestIDMiddlewareValidatesAndEchoesID(t *testing.T) {
	router := securityTestRouter(RequestIDMiddleware())

	valid := httptest.NewRequest(http.MethodPost, "/write", nil)
	valid.Header.Set("X-Request-ID", "browser-123")
	validResponse := httptest.NewRecorder()
	router.ServeHTTP(validResponse, valid)
	if got := validResponse.Header().Get("X-Request-ID"); got != "browser-123" {
		t.Fatalf("expected valid request id to be echoed, got %q", got)
	}

	invalid := httptest.NewRequest(http.MethodPost, "/write", nil)
	invalid.Header.Set("X-Request-ID", "line-one\nline-two")
	invalidResponse := httptest.NewRecorder()
	router.ServeHTTP(invalidResponse, invalid)
	got := invalidResponse.Header().Get("X-Request-ID")
	if !validRequestID(got) || got == "line-one\nline-two" {
		t.Fatalf("expected generated safe request id, got %q", got)
	}
}

func TestMutationAuditMiddlewareFormatsMissingIdentityAsEmptyString(t *testing.T) {
	var output bytes.Buffer
	originalWriter := log.Writer()
	log.SetOutput(&output)
	defer log.SetOutput(originalWriter)

	router := securityTestRouter(RequestIDMiddleware(), MutationAuditMiddleware())
	request := httptest.NewRequest(http.MethodPost, "/write", nil)
	request.Header.Set("X-Request-ID", "audit-no-user")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	entry := output.String()
	if strings.Contains(entry, "%!q") {
		t.Fatalf("audit log contains a formatting diagnostic: %s", entry)
	}
	if !strings.Contains(entry, `request_id="audit-no-user"`) || !strings.Contains(entry, `username=""`) {
		t.Fatalf("audit log did not preserve safe string fields: %s", entry)
	}
}

func TestJSONBodyLimitRejectsKnownAndChunkedOversizeBodies(t *testing.T) {
	router := securityTestRouter(JSONBodyLimitMiddleware(8))
	for _, contentLength := range []int64{9, -1} {
		request := httptest.NewRequest(http.MethodPost, "/write", strings.NewReader(`{"large":1}`))
		request.Header.Set("Content-Type", "application/json")
		request.ContentLength = contentLength
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("content length %d: expected 413, got %d", contentLength, response.Code)
		}
	}
}

func TestFixedWindowRateLimiterResets(t *testing.T) {
	limiter := NewFixedWindowRateLimiter(2, time.Minute)
	now := time.Date(2026, time.August, 3, 12, 0, 0, 0, time.UTC)
	limiter.now = func() time.Time { return now }
	router := securityTestRouter(limiter.Handler())

	for index, status := range []int{http.StatusNoContent, http.StatusNoContent, http.StatusTooManyRequests} {
		request := httptest.NewRequest(http.MethodPost, "/write", nil)
		request.RemoteAddr = "192.0.2.10:1234"
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != status {
			t.Fatalf("request %d: expected %d, got %d", index+1, status, response.Code)
		}
	}

	now = now.Add(time.Minute)
	request := httptest.NewRequest(http.MethodPost, "/write", nil)
	request.RemoteAddr = "192.0.2.10:1234"
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("expected limiter to reset after its window, got %d", response.Code)
	}
}

func TestStrictAuthMiddlewareNeverFallsBackToPublicUser(t *testing.T) {
	t.Setenv("JWT_SECRET", "strict-auth-test-secret-at-least-32-bytes")
	authService := activeSecurityTestAuthService()
	router := securityTestRouter(StrictAuthMiddleware(authService))

	for name, authorization := range map[string]string{
		"missing":   "",
		"malformed": "token",
		"invalid":   "Bearer not-a-jwt",
	} {
		t.Run(name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/write", nil)
			if authorization != "" {
				request.Header.Set("Authorization", authorization)
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("expected strict 401, got %d", response.Code)
			}
		})
	}

	token, err := authService.generateJWTToken(User{
		ID:       uuid.MustParse("00000000-0000-4000-8000-000000000001"),
		Username: "migration-admin",
	})
	if err != nil {
		t.Fatalf("generate JWT: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/write", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("expected valid strict JWT to pass, got %d", response.Code)
	}
}

func TestPresentedInvalidBearerNeverFallsBackToAnonymousIdentity(t *testing.T) {
	const secret = "presented-bearer-test-secret-at-least-32-bytes"
	t.Setenv("JWT_SECRET", secret)
	authService := activeSecurityTestAuthService()
	userID := uuid.MustParse("00000000-0000-4000-8000-000000000124")
	expiredClaims := JWTClaims{
		UserID: userID, Username: "expired-user",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "dnd-cards-backend", Subject: userID.String(),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Hour)),
		},
	}
	expiredToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, expiredClaims).
		SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}

	for middlewareName, middleware := range map[string]gin.HandlerFunc{
		"prototype": AuthMiddleware(authService),
		"optional":  OptionalAuthMiddleware(authService),
	} {
		t.Run(middlewareName, func(t *testing.T) {
			router := securityTestRouter(middleware)
			for name, authorization := range map[string]string{
				"malformed": "token",
				"invalid":   "Bearer not-a-jwt",
				"expired":   "Bearer " + expiredToken,
			} {
				t.Run(name, func(t *testing.T) {
					request := httptest.NewRequest(http.MethodPost, "/write", nil)
					request.Header.Set("Authorization", authorization)
					response := httptest.NewRecorder()
					router.ServeHTTP(response, request)
					if response.Code != http.StatusUnauthorized {
						t.Fatalf("expected invalid presented credential to return 401, got %d", response.Code)
					}
				})
			}
		})
	}
}

func TestOptionalAuthAllowsAbsentBearerAndAcceptsValidStrictIdentity(t *testing.T) {
	t.Setenv("JWT_SECRET", "optional-auth-test-secret-at-least-32-bytes")
	authService := activeSecurityTestAuthService()
	router := securityTestRouter(OptionalAuthMiddleware(authService))

	anonymous := httptest.NewRequest(http.MethodPost, "/write", nil)
	anonymousResponse := httptest.NewRecorder()
	router.ServeHTTP(anonymousResponse, anonymous)
	if anonymousResponse.Code != http.StatusNoContent {
		t.Fatalf("expected absent credential to remain anonymous, got %d", anonymousResponse.Code)
	}

	token, err := authService.generateJWTToken(User{
		ID:       uuid.MustParse("00000000-0000-4000-8000-000000000125"),
		Username: "optional-user",
	})
	if err != nil {
		t.Fatal(err)
	}
	authenticated := httptest.NewRequest(http.MethodPost, "/write", nil)
	authenticated.Header.Set("Authorization", "Bearer "+token)
	authenticatedResponse := httptest.NewRecorder()
	router.ServeHTTP(authenticatedResponse, authenticated)
	if authenticatedResponse.Code != http.StatusNoContent {
		t.Fatalf("expected valid strict identity to pass optional auth, got %d", authenticatedResponse.Code)
	}
}

func TestStrictAuthMiddlewareFailsClosedWithoutJWTSecret(t *testing.T) {
	t.Setenv("JWT_SECRET", "")
	authService := &AuthService{}
	router := securityTestRouter(StrictAuthMiddleware(authService))
	request := httptest.NewRequest(http.MethodPost, "/write", nil)
	request.Header.Set("Authorization", "Bearer syntactically-present-token")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 for missing strict JWT secret, got %d", response.Code)
	}
}

func TestStrictAuthMiddlewareFailsClosedWithoutIdentityStore(t *testing.T) {
	t.Setenv("JWT_SECRET", "strict-auth-test-secret-at-least-32-bytes")
	authService := &AuthService{}
	token, err := authService.generateJWTToken(User{
		ID:       uuid.MustParse("00000000-0000-4000-8000-000000000127"),
		Username: "missing-store",
	})
	if err != nil {
		t.Fatal(err)
	}
	router := securityTestRouter(StrictAuthMiddleware(authService))
	request := httptest.NewRequest(http.MethodPost, "/write", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 without the identity store, got %d", response.Code)
	}
}

func TestJWTIssuanceAndValidationHaveNoDevelopmentFallbackSecret(t *testing.T) {
	t.Setenv("JWT_SECRET", "")
	authService := activeSecurityTestAuthService()
	if _, err := authService.generateJWTToken(User{
		ID:       uuid.MustParse("00000000-0000-4000-8000-000000000126"),
		Username: "no-fallback",
	}); err == nil {
		t.Fatal("JWT issuance unexpectedly used a fallback secret")
	}
	if _, err := authService.ValidateToken("syntactically-present-token"); err == nil {
		t.Fatal("JWT validation unexpectedly used a fallback secret")
	}
}

func TestStrictAuthMiddlewareFailsClosedWithShortJWTSecret(t *testing.T) {
	t.Setenv("JWT_SECRET", "short-secret")
	authService := &AuthService{}
	router := securityTestRouter(StrictAuthMiddleware(authService))
	request := httptest.NewRequest(http.MethodPost, "/write", nil)
	request.Header.Set("Authorization", "Bearer syntactically-present-token")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 for short strict JWT secret, got %d", response.Code)
	}
}

func TestStrictAuthMiddlewarePinsAlgorithmIssuerAndIdentity(t *testing.T) {
	const secret = "strict-auth-test-secret-at-least-32-bytes"
	t.Setenv("JWT_SECRET", secret)
	authService := &AuthService{}
	router := securityTestRouter(StrictAuthMiddleware(authService))
	userID := uuid.MustParse("00000000-0000-4000-8000-000000000123")
	validClaims := JWTClaims{
		UserID: userID, Username: "content-admin",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "dnd-cards-backend", Subject: userID.String(),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	wrongIssuer := validClaims
	wrongIssuer.Issuer = "another-service"
	missingIdentity := validClaims
	missingIdentity.UserID = uuid.Nil

	for name, token := range map[string]*jwt.Token{
		"wrong algorithm": jwt.NewWithClaims(jwt.SigningMethodHS512, validClaims),
		"wrong issuer":    jwt.NewWithClaims(jwt.SigningMethodHS256, wrongIssuer),
		"missing identity": jwt.NewWithClaims(
			jwt.SigningMethodHS256,
			missingIdentity,
		),
	} {
		t.Run(name, func(t *testing.T) {
			signed, err := token.SignedString([]byte(secret))
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, "/write", nil)
			request.Header.Set("Authorization", "Bearer "+signed)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("expected strict 401, got %d", response.Code)
			}
		})
	}
}

func contentAdminTestToken(t *testing.T, authService *AuthService, userID uuid.UUID) string {
	t.Helper()
	token, err := authService.generateJWTToken(User{
		ID:       userID,
		Username: "content-admin-test",
	})
	if err != nil {
		t.Fatalf("generate content-admin JWT: %v", err)
	}
	return token
}

func TestContentAdminAuthMiddlewareAllowsOnlyConfiguredUserIDs(t *testing.T) {
	const secret = "content-admin-test-secret-at-least-32-bytes"
	allowedID := uuid.MustParse("00000000-0000-4000-8000-000000000201")
	secondAllowedID := uuid.MustParse("00000000-0000-4000-8000-000000000202")
	nonAdminID := uuid.MustParse("00000000-0000-4000-8000-000000000203")
	t.Setenv("JWT_SECRET", secret)
	t.Setenv(
		"CONTENT_ADMIN_USER_IDS",
		"  "+allowedID.String()+", "+secondAllowedID.String()+"  ",
	)
	authService := activeSecurityTestAuthService()
	router := securityTestRouter(ContentAdminAuthMiddleware(authService))

	for name, testCase := range map[string]struct {
		userID uuid.UUID
		want   int
	}{
		"allowed":   {userID: allowedID, want: http.StatusNoContent},
		"forbidden": {userID: nonAdminID, want: http.StatusForbidden},
	} {
		t.Run(name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/write", nil)
			request.Header.Set(
				"Authorization",
				"Bearer "+contentAdminTestToken(t, authService, testCase.userID),
			)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != testCase.want {
				t.Fatalf("expected %d, got %d: %s", testCase.want, response.Code, response.Body.String())
			}
		})
	}
}

func TestContentAdminAuthMiddlewareFailsClosedForMissingOrMalformedAllowlist(t *testing.T) {
	const secret = "content-admin-test-secret-at-least-32-bytes"
	userID := uuid.MustParse("00000000-0000-4000-8000-000000000204")
	t.Setenv("JWT_SECRET", secret)
	authService := &AuthService{}
	token := contentAdminTestToken(t, authService, userID)

	for name, configured := range map[string]string{
		"missing":       "",
		"malformed":     "not-a-uuid",
		"empty entry":   userID.String() + ",",
		"nil UUID":      uuid.Nil.String(),
		"mixed invalid": userID.String() + ",not-a-uuid",
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("CONTENT_ADMIN_USER_IDS", configured)
			router := securityTestRouter(ContentAdminAuthMiddleware(authService))
			request := httptest.NewRequest(http.MethodPost, "/write", nil)
			request.Header.Set("Authorization", "Bearer "+token)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != http.StatusServiceUnavailable {
				t.Fatalf("expected fail-closed 503, got %d: %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestContentAdminAuthMiddlewareStillRequiresStrictJWT(t *testing.T) {
	t.Setenv("JWT_SECRET", "content-admin-test-secret-at-least-32-bytes")
	t.Setenv("CONTENT_ADMIN_USER_IDS", "00000000-0000-4000-8000-000000000205")
	router := securityTestRouter(ContentAdminAuthMiddleware(&AuthService{}))

	request := httptest.NewRequest(http.MethodPost, "/write", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without strict JWT, got %d", response.Code)
	}
}
