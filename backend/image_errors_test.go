package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	openai "github.com/sashabaranov/go-openai"
)

func TestImageProviderErrorsAreClassifiedWithoutLeakingBody(t *testing.T) {
	for _, test := range []struct {
		name, contentType, body, code, outcome string
		status                                 int
	}{
		{"region", "application/json", `{"error":{"code":"unsupported_country_region_territory","type":"request_forbidden","message":"private prompt sk-secret"}}`, "image_region_unavailable", "rejected", 403},
		{"permission", "application/json", `{"error":{"message":"organization must be verified private prompt sk-secret","type":"invalid_request_error"}}`, "image_provider_permission", "rejected", 403},
		{"edge HTML", "text/html", `<html>private prompt sk-secret data:image/png;base64,AAAA</html>`, "image_provider_forbidden", "rejected", 403},
		{"key", "application/json", `{"error":{"message":"sk-secret","code":"invalid_api_key"}}`, "image_provider_authentication", "rejected", 401},
		{"limit", "application/json", `{"error":{"message":"private prompt","code":"insufficient_quota"}}`, "image_provider_limit", "rejected", 429},
		{"server", "text/html", `<html>private prompt</html>`, "image_provider_error", "unknown", 502},
	} {
		t.Run(test.name, func(t *testing.T) {
			var attempts atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				attempts.Add(1)
				w.Header().Set("Content-Type", test.contentType)
				w.Header().Set("X-Request-ID", "req-upstream-1")
				w.WriteHeader(test.status)
				_, _ = io.WriteString(w, test.body)
			}))
			defer server.Close()
			config := openai.DefaultConfig("local-image-provider-fixture")
			config.BaseURL = server.URL + "/v1"
			client := server.Client()
			client.Transport = imageProviderTransport{base: client.Transport}
			config.HTTPClient = client
			service := &OpenAIService{client: openai.NewClientWithConfig(config)}
			_, err := service.GenerateImageContext(context.Background(), "private prompt", "low", "")
			var problem *ImageGenerationError
			if !errors.As(err, &problem) {
				t.Fatalf("expected structured error, got %T", err)
			}
			if problem.Code != test.code || problem.Outcome != test.outcome || problem.ProviderStatus != test.status || problem.ProviderRequestID != "req-upstream-1" {
				t.Fatalf("unexpected diagnostics: %+v", problem)
			}
			if attempts.Load() != 1 {
				t.Fatal("provider failure was retried")
			}
			var output bytes.Buffer
			original := log.Writer()
			log.SetOutput(&output)
			defer log.SetOutput(original)
			gin.SetMode(gin.TestMode)
			router := gin.New()
			router.Use(RequestIDMiddleware())
			router.GET("/error", func(c *gin.Context) { writeImageGenerationError(c, err) })
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest("GET", "/error", nil))
			if response.Code == 403 || response.Code == 401 {
				t.Fatal("provider error must not look like application authentication")
			}
			encoded := response.Body.String() + output.String() + err.Error()
			for _, secret := range []string{"private prompt", "sk-secret", "base64", "<html>"} {
				if strings.Contains(encoded, secret) {
					t.Fatalf("diagnostics leaked %q", secret)
				}
			}
			var body map[string]any
			if json.Unmarshal(response.Body.Bytes(), &body) != nil || body["source"] != "provider" || body["request_id"] == "" {
				t.Fatal("missing request diagnostics")
			}
		})
	}
}

func TestImageProviderNetworkOutcomeDoesNotRetryPaidRequest(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		_, _ = io.Copy(io.Discard, r.Body)
		connection, _, err := w.(http.Hijacker).Hijack()
		if err == nil {
			_ = connection.Close()
		}
	}))
	defer server.Close()
	config := openai.DefaultConfig("local-test")
	config.BaseURL = server.URL + "/v1"
	config.HTTPClient = server.Client()
	service := &OpenAIService{client: openai.NewClientWithConfig(config)}
	_, err := service.GenerateImageContext(context.Background(), "test", "low", "")
	var problem *ImageGenerationError
	if !errors.As(err, &problem) || problem.Code != "image_network_error" || problem.Outcome != "unknown" {
		t.Fatalf("unexpected network result: %v", err)
	}
	if attempts.Load() != 1 {
		t.Fatal("ambiguous paid request repeated")
	}
}

func TestImageGenerationWithoutConfiguredProviderDoesNotPanic(t *testing.T) {
	var service *OpenAIService
	_, err := service.GenerateImageContext(context.Background(), "test", "low", "")
	var problem *ImageGenerationError
	if !errors.As(err, &problem) || problem.Code != "image_provider_not_configured" || problem.Outcome != "not_started" {
		t.Fatal("expected explicit not-configured error")
	}
}

func TestImageProviderRequiresInlineImageWithoutURLFallback(t *testing.T) {
	for _, inline := range []bool{false, true} {
		t.Run(map[bool]string{false: "reject URL", true: "inline image"}[inline], func(t *testing.T) {
			attempts := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				attempts++
				w.Header().Set("Content-Type", "application/json")
				row := map[string]string{"url": "https://SECRET.invalid/image.png"}
				if inline {
					row["b64_json"] = base64.StdEncoding.EncodeToString(generatedTestPNG)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{row}})
			}))
			defer server.Close()
			config := openai.DefaultConfig("local-test")
			config.BaseURL, config.HTTPClient = server.URL+"/v1", server.Client()
			service := &OpenAIService{client: openai.NewClientWithConfig(config)}
			source, err := service.GenerateImageContext(context.Background(), "test", "low", "")
			if inline {
				if err != nil || !strings.HasPrefix(source, "data:image/png;base64,") {
					t.Fatal("documented inline response rejected")
				}
			} else {
				requireImageProblem(t, err, "image_provider_invalid_response", "unknown")
				if source != "" {
					t.Fatal("unexpected provider URL escaped")
				}
			}
			if attempts != 1 {
				t.Fatal("provider request repeated")
			}
		})
	}
}
