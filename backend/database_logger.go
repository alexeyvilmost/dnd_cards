package main

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type databaseLogger struct {
	logger.Interface
	writer    logger.Writer
	threshold time.Duration
	level     logger.LogLevel
}

func newDatabaseLogger(writer logger.Writer, threshold time.Duration) logger.Interface {
	return databaseLogger{Interface: logger.New(writer, logger.Config{SlowThreshold: threshold, LogLevel: logger.Warn, IgnoreRecordNotFoundError: true, ParameterizedQueries: true, Colorful: false}), writer: writer, threshold: threshold, level: logger.Warn}
}

// Gorm's Scan replaces ParamsFilter with a trace recorder. Avoid invoking its
// SQL formatter here: it can interpolate megabytes of private combat JSON.
// Scan can still format its internal recorder, but these bytes are not logged.
// Request-scoped performance callbacks retain operation counts and durations.
func (l databaseLogger) Trace(_ context.Context, begin time.Time, _ func() (string, int64), err error) {
	elapsed := time.Since(begin)
	if l.level <= logger.Silent || errors.Is(err, gorm.ErrRecordNotFound) {
		return
	}
	if err != nil && l.level >= logger.Error {
		code := "unknown"
		var state interface{ SQLState() string }
		if errors.As(err, &state) {
			candidate := state.SQLState()
			valid := len(candidate) == 5
			for _, ch := range candidate {
				valid = valid && ((ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'Z'))
			}
			if valid {
				code = candidate
			}
		}
		l.writer.Printf("database_query duration_ms=%.3f status=error sqlstate=%s", float64(elapsed.Microseconds())/1000, code)
	} else if err == nil && l.level >= logger.Warn && elapsed > l.threshold {
		l.writer.Printf("database_query duration_ms=%.3f status=slow", float64(elapsed.Microseconds())/1000)
	}
}

func (l databaseLogger) LogMode(level logger.LogLevel) logger.Interface {
	l.Interface = l.Interface.LogMode(level)
	l.level = level
	return l
}
