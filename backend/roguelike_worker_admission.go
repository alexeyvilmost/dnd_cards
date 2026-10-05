package main

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"sync"
)

// One budget for the backend process, including clients reconstructed by
// controllers and recovery commands. It bounds admitted serialization, HTTP and
// response decoding; it does not claim to measure the remote event-loop queue.
var sharedWorkerAdmission workerAdmission

type workerAdmission struct {
	mu     sync.Mutex
	active int
}

func workerAdmissionLimit() (int, error) {
	raw := os.Getenv("RULES_WORKER_MAX_INFLIGHT")
	if raw == "" {
		return 4, nil
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > 64 {
		return 0, fmt.Errorf("rules worker is not configured: invalid admission limit")
	}
	return limit, nil
}

func (admission *workerAdmission) acquire(ctx context.Context) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("rules worker unavailable: %w", err)
	}
	limit, err := workerAdmissionLimit()
	if err != nil {
		return nil, err
	}
	admission.mu.Lock()
	defer admission.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("rules worker unavailable: %w", err)
	}
	if admission.active >= limit {
		performanceAdd(ctx, "worker_admission_rejected", 1)
		return nil, &roguelikeWorkerRejection{"combat_worker_busy", "Сервис правил занят. Действие не применено; повторите попытку."}
	}
	admission.active++
	performanceAdd(ctx, "worker_admitted_calls", 1)
	var once sync.Once
	return func() {
		once.Do(func() {
			admission.mu.Lock()
			admission.active--
			admission.mu.Unlock()
		})
	}, nil
}
