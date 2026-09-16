package main

import (
	"bytes"
	"context"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"io"
	"net/http"
	"net/url"
	"os"
	"testing"
)

type martialDiagnosticTransport struct{ t *testing.T }

func (tr martialDiagnosticTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	response, err := http.DefaultTransport.RoundTrip(r)
	if err == nil && response.StatusCode >= 400 {
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		response.Body = io.NopCloser(bytes.NewReader(body))
		tr.t.Logf("Local worker validation: %s", body)
	}
	return response, err
}

// Opt-in, read-only replay against a fresh QA-owned party. Never saves entropy or a result.
func TestMartialPartyLocalInitialization(t *testing.T) {
	if os.Getenv("MARTIAL_QA_DIAGNOSTICS") != "1" {
		t.Skip("local QA only")
	}
	dsn := os.Getenv("MARTIAL_QA_DATABASE_URL")
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if u.Hostname() != "127.0.0.1" || u.Path != "/shop_review_249_20260915" {
		t.Fatal("Only isolated QA database permitted")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	owner := uuid.MustParse("d3d29f87-e011-446a-b55b-ce2ccd6613a7")
	var row RoguelikeRun
	if err = db.Where("user_id=? AND phase='combat' AND combat_envelope='{}'::jsonb", owner).Order("created_at DESC").First(&row).Error; err != nil {
		t.Fatal(err)
	}
	run, err := ownedRoguelikeRun(db, row.ID, owner, false)
	if err != nil {
		t.Fatal(err)
	}
	seed, err := newRoguelikeSeed()
	if err != nil {
		t.Fatal(err)
	}
	client := roguelikeWorkerClient{URL: "http://127.0.0.1:8090", Token: os.Getenv("RULES_WORKER_TOKEN"), HTTP: &http.Client{Transport: martialDiagnosticTransport{t}}}
	_, _, err = initializeRoguelikeWorker(context.Background(), db, client, run, seed, "")
	if err != nil {
		t.Fatal(err)
	}
}
