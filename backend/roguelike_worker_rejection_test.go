package main

import (
	"context"
	"errors"
	"fmt"
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
		{`{"error":"invalid_combat_command","message":"Карта столкновения отсутствует"}`, true},
		{`{"error":"invalid_combat_command","message":"Каталог не содержит spell/hunters_mark"}`, true},
		{`{"error":"invalid_combat_command","message":"Несовместимая версия каталога"}`, true},
		{`{"error":"unknown","message":"Неизвестная команда боя"}`, false},
		{`private-entropy-secret`, false},
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(422); w.Write([]byte(tc.body)) }))
		client := roguelikeWorkerClient{URL: server.URL, Token: strings.Repeat("x", 32)}
		_, err := client.call(context.Background(), "/transition", JSONMap{})
		server.Close()
		var public *roguelikeWorkerRejection
		if errors.As(err, &public) != tc.public {
			t.Fatalf("public rejection classification mismatch for %s: err=%v", tc.body, err)
		}
		if err == nil || strings.Contains(err.Error(), "private-") {
			t.Fatal("worker exposed private exception")
		}
	}
}

func TestPublicRoguelikeWorkerFailureDetails(t *testing.T) {
	cases := []struct {
		err  error
		code string
		want string
	}{
		{fmt.Errorf("missing pinned spell hunters_mark: record not found"), "combat_catalog_incomplete", "spell «hunters_mark»"},
		{fmt.Errorf("rules worker is not configured"), "combat_worker_unconfigured", "не настроен"},
		{fmt.Errorf("rules worker unavailable: dial tcp"), "combat_worker_unavailable", "недоступен"},
		{fmt.Errorf("rules worker rejected command (HTTP 422)"), "combat_worker_rejected", "HTTP 422"},
		{fmt.Errorf("catalog resolution made no progress"), "combat_catalog_stalled", "зациклился"},
		{fmt.Errorf("catalog dependency budget exceeded"), "combat_catalog_budget", "зависимостей"},
		{&roguelikeWorkerRejection{"combat_map_missing", "Карта столкновения отсутствует. Действие не применено."}, "combat_map_missing", "Карта столкновения"},
	}
	for _, tc := range cases {
		got := publicRoguelikeWorkerFailure(tc.err)
		if got == nil || got.Code != tc.code || !strings.Contains(got.Message, tc.want) {
			t.Fatalf("err=%v => %#v, want code=%s containing %q", tc.err, got, tc.code, tc.want)
		}
		if strings.Contains(got.Message, "private-") || strings.Contains(got.Message, "entropy") {
			t.Fatalf("leaked private detail: %s", got.Message)
		}
	}
	if publicRoguelikeWorkerFailure(fmt.Errorf("unexpected internal boom")) != nil {
		t.Fatal("unknown errors must stay opaque")
	}
}
