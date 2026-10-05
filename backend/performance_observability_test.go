package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func TestPerformanceRequestCorrelationAndOptIn(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		for _, requested := range []bool{false, true} {
			router := gin.New()
			router.Use(RequestIDMiddleware(), PerformanceMiddleware(enabled))
			router.GET("/sample", func(c *gin.Context) {
				performanceAdd(c.Request.Context(), "sample_count", 2)
				c.JSON(200, gin.H{"safe": true})
			})
			request := httptest.NewRequest("GET", "/sample?token=secret", nil)
			request.Header.Set("X-Request-ID", "safe-request-1")
			if requested {
				request.Header.Set("X-Performance-Trace", "1")
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Header().Get("X-Request-ID") != "safe-request-1" {
				t.Fatal("request correlation lost")
			}
			raw := response.Header().Get("X-Performance-Metrics")
			if (raw != "") != (enabled && requested) {
				t.Fatal("tracing requires both opt-ins")
			}
			if strings.Contains(raw, "secret") {
				t.Fatal("query escaped into telemetry")
			}
			if enabled && requested {
				var values map[string]float64
				if json.Unmarshal([]byte(raw), &values) != nil || values["sample_count"] != 2 || values["backend_first_write_uncompressed_bytes"] <= 0 {
					t.Fatal("numeric metrics missing")
				}
			}
		}
	}
}

func TestPerformanceWorkerCorrelationAndNumericAllowlist(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Request-ID") != "trace-2" || r.Header.Get("X-Performance-Trace") != "1" {
			t.Error("worker context lost")
		}
		w.Header().Set("X-Request-ID", "trace-2")
		w.Header().Set("X-Rules-Performance", `{"worker_execute_ms":2.5,"private_seed":123,"worker_parse_ms":-1}`)
		w.Write([]byte(`{"status":"ready","patch":{"runtime_revision":2}}`))
	}))
	defer server.Close()
	trace := &requestPerformance{values: map[string]float64{}}
	ctx := context.WithValue(context.WithValue(context.Background(), performanceContextKey{}, trace), requestCorrelationKey{}, "trace-2")
	_, err := (roguelikeWorkerClient{URL: server.URL, Token: strings.Repeat("t", 32)}).call(ctx, "/rest", map[string]any{"private": "do-not-log"})
	if err != nil {
		t.Fatal(err)
	}
	values := trace.snapshot()
	if values["worker_execute_ms"] != 2.5 || values["worker_correlated_calls"] != 1 || values["worker_calls"] != 1 {
		t.Fatal("missing measured fields")
	}
	if _, ok := values["private_seed"]; ok {
		t.Fatal("unknown metric accepted")
	}
	if _, ok := values["worker_parse_ms"]; ok {
		t.Fatal("negative timing accepted")
	}
}

func TestPerformanceSQLCountsPreloadOnceAndRecordsActualLockScope(t *testing.T) {
	fixture := openCharacterV3AccessFixture(t)
	if err := registerPerformanceCallbacks(fixture.db); err != nil {
		t.Fatal(err)
	}
	trace := &requestPerformance{values: map[string]float64{}}
	ctx := context.WithValue(context.Background(), performanceContextKey{}, trace)
	var hero CharacterV3
	if err := fixture.db.WithContext(ctx).Preload("User").First(&hero, "id = ?", fixture.ownerCharacter.ID).Error; err != nil {
		t.Fatal(err)
	}
	if trace.snapshot()["sql_count"] != 2 {
		t.Fatalf("parent/preload counted incorrectly: %#v", trace.snapshot())
	}
	err := performanceTransaction(fixture.db, ctx, func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&hero, "id = ?", hero.ID).Error; err != nil {
			return err
		}
		return tx.Model(&CharacterV3{}).Where("id = ?", hero.ID).Update("name", hero.Name).Error
	})
	if err != nil {
		t.Fatal(err)
	}
	values := trace.snapshot()
	_, hasPersist := values["persist_sql_ms"]
	_, hasLock := values["lock_statement_ms"]
	// Fast local calls may round to 0.000 ms; presence and SQL cardinality
	// establish coverage without a machine-speed-dependent lower bound.
	if values["sql_count"] != 4 || !hasLock || !hasPersist || values["lock_acquired_to_tx_return_ms"] < 0 {
		t.Fatalf("missing transaction timings: %#v", values)
	}
}
