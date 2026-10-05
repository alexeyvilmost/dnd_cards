package main

import (
	"context"
	"fmt"
	"sync"
)

type preparationCatalogFlight struct {
	done  chan struct{}
	entry preparationCatalogEntry
	err   error
}
type preparationCatalogFlights struct {
	mu         sync.Mutex
	maxEntries int
	pending    map[string]*preparationCatalogFlight
}

var characterPreparationFlights = &preparationCatalogFlights{maxEntries: 128, pending: map[string]*preparationCatalogFlight{}}

func clonePreparationCatalogEntry(entry preparationCatalogEntry) preparationCatalogEntry {
	entry.Payload = append([]byte(nil), entry.Payload...)
	entry.Needs = append([]roguelikeWorkerNeed(nil), entry.Needs...)
	entry.BasicIDs = append([]string(nil), entry.BasicIDs...)
	return entry
}

// Only joins immutable CPU work AFTER every caller's own snapshot/rights proof.
// The build callback must not perform DB/HTTP I/O, execute rules, or retain a
// character/runtime result. A canceled waiter never cancels another request.
func (flights *preparationCatalogFlights) do(ctx context.Context, key string, build func() (preparationCatalogEntry, error)) (preparationCatalogEntry, bool, error) {
	if err := ctx.Err(); err != nil {
		return preparationCatalogEntry{}, false, err
	}
	flights.mu.Lock()
	if pending := flights.pending[key]; pending != nil {
		flights.mu.Unlock()
		select {
		case <-ctx.Done():
			return preparationCatalogEntry{}, true, ctx.Err()
		case <-pending.done:
			return clonePreparationCatalogEntry(pending.entry), true, pending.err
		}
	}
	if len(flights.pending) >= flights.maxEntries {
		flights.mu.Unlock()
		entry, err := build()
		return entry, false, err
	}
	pending := &preparationCatalogFlight{done: make(chan struct{}), err: fmt.Errorf("immutable catalog processing did not finish")}
	flights.pending[key] = pending
	flights.mu.Unlock()
	defer func() { flights.mu.Lock(); delete(flights.pending, key); close(pending.done); flights.mu.Unlock() }()
	pending.entry, pending.err = build()
	pending.entry = clonePreparationCatalogEntry(pending.entry)
	return clonePreparationCatalogEntry(pending.entry), false, pending.err
}
