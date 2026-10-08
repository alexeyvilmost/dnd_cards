package main

import (
	"context"
	"encoding/json"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type requestCorrelationKey struct{}
type performanceContextKey struct{}
type performanceTransactionKey struct{}

// Numeric, bounded, request-scoped observations only. No SQL, parameters,
// characters, entropy, authentication, catalog payloads or provider text.
type requestPerformance struct {
	mu     sync.Mutex
	values map[string]float64
}
type transactionPerformance struct{ firstLockAcquired time.Time }

func performanceFrom(ctx context.Context) *requestPerformance {
	value, _ := ctx.Value(performanceContextKey{}).(*requestPerformance)
	return value
}
func performanceAdd(ctx context.Context, key string, value float64) {
	trace := performanceFrom(ctx)
	if trace == nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return
	}
	trace.mu.Lock()
	defer trace.mu.Unlock()
	trace.values[key] += value
}
func performanceSince(ctx context.Context, key string) func() {
	if performanceFrom(ctx) == nil {
		return func() {}
	}
	start := time.Now()
	return func() { performanceAdd(ctx, key, float64(time.Since(start).Nanoseconds())/1e6) }
}
func (trace *requestPerformance) snapshot() map[string]float64 {
	trace.mu.Lock()
	defer trace.mu.Unlock()
	result := make(map[string]float64, len(trace.values))
	for key, value := range trace.values {
		result[key] = math.Round(value*1000) / 1000
	}
	return result
}

type performanceResponseWriter struct {
	gin.ResponseWriter
	ctx     context.Context
	started time.Time
	written bool
}

func (writer *performanceResponseWriter) prepare(bytes int) {
	if writer.written {
		return
	}
	writer.written = true
	performanceAdd(writer.ctx, "backend_to_first_write_ms", float64(time.Since(writer.started).Nanoseconds())/1e6)
	performanceAdd(writer.ctx, "backend_first_write_uncompressed_bytes", float64(bytes))
	metrics := performanceFrom(writer.ctx).snapshot()
	encoded, _ := json.Marshal(metrics)
	writer.Header().Set("X-Performance-Metrics", string(encoded))
	keys := make([]string, 0, len(metrics))
	for key := range metrics {
		if strings.HasSuffix(key, "_ms") {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	values := make([]string, 0, len(keys))
	for _, key := range keys {
		values = append(values, strings.TrimSuffix(key, "_ms")+";dur="+strconv.FormatFloat(metrics[key], 'f', 3, 64))
	}
	writer.Header().Set("Server-Timing", strings.Join(values, ", "))
}
func (writer *performanceResponseWriter) Write(data []byte) (int, error) {
	writer.prepare(len(data))
	return writer.ResponseWriter.Write(data)
}
func (writer *performanceResponseWriter) WriteString(value string) (int, error) {
	writer.prepare(len(value))
	return writer.ResponseWriter.WriteString(value)
}
func (writer *performanceResponseWriter) WriteHeaderNow() {
	writer.prepare(0)
	writer.ResponseWriter.WriteHeaderNow()
}

// Configuration opt-in. Combat commands are measured automatically; other
// routes require the trace header. Headers contain numeric timings only.
func PerformanceMiddleware(enabled bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		autoCombat := strings.HasPrefix(c.Request.URL.Path, "/api/roguelike/runs/") && strings.HasSuffix(c.Request.URL.Path, "/commands")
		if !enabled || (c.GetHeader("X-Performance-Trace") != "1" && !autoCombat) {
			c.Next()
			return
		}
		ctx := context.WithValue(c.Request.Context(), performanceContextKey{}, &requestPerformance{values: map[string]float64{}})
		c.Request = c.Request.WithContext(ctx)
		c.Writer = &performanceResponseWriter{ResponseWriter: c.Writer, ctx: ctx, started: time.Now()}
		c.Next()
	}
}

func performanceTransaction(db *gorm.DB, ctx context.Context, work func(*gorm.DB) error) error {
	if performanceFrom(ctx) == nil {
		return db.WithContext(ctx).Transaction(work)
	}
	defer performanceSince(ctx, "transaction_ms")()
	span := &transactionPerformance{}
	err := db.WithContext(context.WithValue(ctx, performanceTransactionKey{}, span)).Transaction(work)
	if !span.firstLockAcquired.IsZero() {
		performanceAdd(ctx, "lock_acquired_to_tx_return_ms", float64(time.Since(span.firstLockAcquired).Nanoseconds())/1e6)
	}
	return err
}

// Callback pairs surround the actual GORM operation, before preloads or
// association callbacks, so a parent lifecycle does not count a child twice.
// Time includes database round trip and row scanning, not isolated server CPU.
func registerPerformanceCallbacks(db *gorm.DB) error {
	before := func(tx *gorm.DB) {
		if performanceFrom(tx.Statement.Context) != nil {
			tx.Statement.Settings.Store("performance:sql-start", time.Now())
		}
	}
	after := func(tx *gorm.DB) {
		start, ok := tx.Statement.Settings.LoadAndDelete("performance:sql-start")
		if !ok {
			return
		}
		ctx := tx.Statement.Context
		elapsed := float64(time.Since(start.(time.Time)).Nanoseconds()) / 1e6
		performanceAdd(ctx, "sql_count", 1)
		performanceAdd(ctx, "sql_operation_ms", elapsed)
		if tx.RowsAffected > 0 {
			performanceAdd(ctx, "sql_rows", float64(tx.RowsAffected))
		}
		sql := strings.ToUpper(tx.Statement.SQL.String())
		if strings.HasPrefix(sql, "INSERT ") || strings.HasPrefix(sql, "UPDATE ") || strings.HasPrefix(sql, "DELETE ") {
			performanceAdd(ctx, "persist_sql_ms", elapsed)
		}
		if strings.Contains(sql, "FOR UPDATE") || strings.Contains(sql, "PG_ADVISORY_XACT_LOCK") {
			performanceAdd(ctx, "lock_statement_ms", elapsed)
			if span, ok := ctx.Value(performanceTransactionKey{}).(*transactionPerformance); ok && span.firstLockAcquired.IsZero() && tx.Error == nil {
				span.firstLockAcquired = time.Now()
			}
		}
	}
	for _, pair := range []struct {
		before func(string, func(*gorm.DB)) error
		after  func(string, func(*gorm.DB)) error
	}{
		{db.Callback().Query().Before("gorm:query").Register, db.Callback().Query().After("gorm:query").Before("gorm:preload").Register},
		{db.Callback().Create().Before("gorm:create").Register, db.Callback().Create().After("gorm:create").Before("gorm:save_after_associations").Register},
		{db.Callback().Update().Before("gorm:update").Register, db.Callback().Update().After("gorm:update").Before("gorm:save_after_associations").Register},
		{db.Callback().Delete().Before("gorm:delete").Register, db.Callback().Delete().After("gorm:delete").Register},
		{db.Callback().Row().Before("gorm:row").Register, db.Callback().Row().After("gorm:row").Register},
		{db.Callback().Raw().Before("gorm:raw").Register, db.Callback().Raw().After("gorm:raw").Register},
	} {
		if err := pair.before("performance:before", before); err != nil {
			return err
		}
		if err := pair.after("performance:after", after); err != nil {
			return err
		}
	}
	return nil
}
