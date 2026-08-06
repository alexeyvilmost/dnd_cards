package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	openai "github.com/sashabaranov/go-openai"
)

func TestGenerateImageContextStopsPaidAttemptsWhenCallerDeadlineExpires(t *testing.T) {
	var requestCount atomic.Int32
	requestCancelled := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		requestCount.Add(1)
		_, _ = io.Copy(io.Discard, request.Body)
		_ = request.Body.Close()
		select {
		case <-request.Context().Done():
			requestCancelled <- struct{}{}
		case <-time.After(2 * time.Second):
			// A broken cancellation path must fail the assertion below, but the
			// test server still has to release its connection and let the suite end.
			http.Error(w, "caller cancellation was not propagated", http.StatusGatewayTimeout)
		}
	}))
	defer server.Close()

	config := openai.DefaultConfig("context-cancellation-test")
	config.BaseURL = server.URL + "/v1"
	config.HTTPClient = server.Client()
	service := &OpenAIService{client: openai.NewClientWithConfig(config)}
	ctx, cancel := context.WithTimeout(context.Background(), 75*time.Millisecond)
	defer cancel()

	started := time.Now()
	_, err := service.GenerateImageContext(ctx, "test prompt", "low", "1024x1024")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected caller deadline error, got %v", err)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("generation ignored caller cancellation for %s", elapsed)
	}
	if got := requestCount.Load(); got != 1 {
		t.Fatalf("caller cancellation must prevent paid retries, got %d requests", got)
	}
	select {
	case <-requestCancelled:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("caller cancellation was not propagated to the paid HTTP request")
	}
}

func TestDownloadImageRejectsAlreadyCancelledContextBeforeNetwork(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	controller := &ImageController{}
	_, err := controller.downloadImage(ctx, "https://example.invalid/image.png")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancelled download, got %v", err)
	}
}
