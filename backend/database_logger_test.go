package main

import (
	"bytes"
	"context"
	"errors"
	"log"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestDatabaseLoggerKeepsStructureWithoutPrivateParameters(t *testing.T) {
	f := openCharacterV3AccessFixture(t)
	var output bytes.Buffer
	db := f.db.Session(&gorm.Session{Logger: newDatabaseLogger(log.New(&output, "", 0), time.Nanosecond)})
	private := "qa-private-combat-" + strings.Repeat("🐉", 20000)
	var value string
	if err := db.Raw("SELECT ?::text", private).Scan(&value).Error; err != nil || value != private {
		t.Fatal("parameterized query changed")
	}
	text := output.String()
	if !strings.Contains(text, "status=slow") || !strings.Contains(text, "duration_ms=") || strings.Contains(text, "qa-private-combat") || strings.Contains(text, "🐉") || len(text) > 2048 {
		t.Fatal("slow SQL contains parameters or lost structure")
	}
	output.Reset()
	if db.Exec("SELECT missing_qa_column WHERE ?::text IS NOT NULL", private).Error == nil {
		t.Fatal("failed query accepted")
	}
	text = output.String()
	if !strings.Contains(text, "status=error sqlstate=42703") || strings.Contains(text, "qa-private-combat") || len(text) > 2048 {
		t.Fatal("SQL error log contains parameters or lost error")
	}
}

func TestDatabaseLoggerHonorsLevelsAndAvoidsFormatting(t *testing.T) {
	for _, level := range []logger.LogLevel{logger.Silent, logger.Error, logger.Warn, logger.Info} {
		var out bytes.Buffer
		l := newDatabaseLogger(log.New(&out, "", 0), time.Nanosecond).LogMode(level)
		format := func() (string, int64) { t.Fatal("logger requested interpolated SQL"); return "", 0 }
		l.Trace(context.Background(), time.Now().Add(-time.Second), format, nil)
		if (out.Len() > 0) != (level >= logger.Warn) {
			t.Fatal("slow query log level ignored")
		}
		out.Reset()
		l.Trace(context.Background(), time.Now(), format, errors.New("private SQL text"))
		if (out.Len() > 0) != (level >= logger.Error) || strings.Contains(out.String(), "private") {
			t.Fatal("error log level or privacy ignored")
		}
		out.Reset()
		l.Trace(context.Background(), time.Now().Add(-time.Second), format, gorm.ErrRecordNotFound)
		if out.Len() != 0 {
			t.Fatal("expected missing receipt logged")
		}
	}
}
