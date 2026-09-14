package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWorkerRejectionDoesNotExposePrivateException(t *testing.T) {
	for _, tc := range []struct {
		body   string
		public bool
	}{
		{`{"error":"invalid_combat_command","message":"Неизвестная команда боя"}`, true},
		{`{"error":"artifact_unavailable","message":"private-path"}`, true},
		{`{"error":"invalid_combat_command","message":"private-entropy-secret"}`, false},
		{`{"error":"unknown","message":"Неизвестная команда боя"}`, false},
		{`private-entropy-secret`, false},
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(422); w.Write([]byte(tc.body)) }))
		client := roguelikeWorkerClient{URL: server.URL, Token: strings.Repeat("x", 32)}
		_, err := client.call(context.Background(), "/transition", JSONMap{})
		server.Close()
		var public *roguelikeWorkerRejection
		if errors.As(err, &public) != tc.public {
			t.Fatalf("public rejection classification mismatch")
		}
		if err == nil || strings.Contains(err.Error(), "private-") {
			t.Fatal("worker exposed private exception")
		}
	}
}
