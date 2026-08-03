package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func securityTestRouter(middlewares ...gin.HandlerFunc) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(middlewares...)
	router.POST("/write", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	return router
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
