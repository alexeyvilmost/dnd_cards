package main

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
)

type observedFlightContext struct {
	context.Context
	entered chan struct{}
	once    sync.Once
}

func (ctx *observedFlightContext) Done() <-chan struct{} {
	ctx.once.Do(func() { close(ctx.entered) })
	return ctx.Context.Done()
}

func TestPreparationCatalogFlightsShareOnlyImmutableProcessing(t *testing.T) {
	flights := &preparationCatalogFlights{maxEntries: 2, pending: map[string]*preparationCatalogFlight{}}
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	ownerDone := make(chan preparationCatalogEntry, 1)
	go func() {
		entry, joined, err := flights.do(context.Background(), "same validated content", func() (preparationCatalogEntry, error) {
			calls.Add(1)
			close(started)
			<-release
			return preparationCatalogEntry{Payload: []byte("safe"), BasicIDs: []string{"basic"}}, nil
		})
		if err != nil || joined {
			t.Error("owner processing failed")
		}
		ownerDone <- entry
	}()
	<-started
	cancelCtx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := flights.do(cancelCtx, "same validated content", func() (preparationCatalogEntry, error) {
		t.Error("canceled request built")
		return preparationCatalogEntry{}, nil
	}); !errors.Is(err, context.Canceled) {
		t.Fatal("cancellation lost")
	}
	observed := &observedFlightContext{Context: context.Background(), entered: make(chan struct{})}
	waiterDone := make(chan preparationCatalogEntry, 1)
	go func() {
		entry, joined, err := flights.do(observed, "same validated content", func() (preparationCatalogEntry, error) {
			t.Error("same proof recomputed")
			return preparationCatalogEntry{}, nil
		})
		if err != nil || !joined {
			t.Error("waiter processing failed")
		}
		waiterDone <- entry
	}()
	<-observed.entered
	close(release)
	waiter := <-waiterDone
	if calls.Load() != 1 {
		t.Fatal("duplicate immutable processing")
	}
	owner := <-ownerDone
	owner.Payload[0] = 'X'
	owner.BasicIDs[0] = "changed"
	if string(waiter.Payload) != "safe" || waiter.BasicIDs[0] != "basic" {
		t.Fatal("mutable alias escaped flight")
	}
	if len(flights.pending) != 0 {
		t.Fatal("completed flight retained")
	}
}

func TestPreparationCatalogFlightsBoundDistinctProofsAndRetryFailure(t *testing.T) {
	flights := &preparationCatalogFlights{maxEntries: 1, pending: map[string]*preparationCatalogFlight{}}
	flights.pending["held"] = &preparationCatalogFlight{done: make(chan struct{})}
	entry, joined, err := flights.do(context.Background(), "changed rights/content", func() (preparationCatalogEntry, error) { return preparationCatalogEntry{Payload: []byte("new")}, nil })
	if err != nil || joined || string(entry.Payload) != "new" || len(flights.pending) != 1 {
		t.Fatal("saturation did not fall back independently")
	}
	delete(flights.pending, "held")
	if _, _, err := flights.do(context.Background(), "bad", func() (preparationCatalogEntry, error) { return preparationCatalogEntry{}, errors.New("bad hash") }); err == nil {
		t.Fatal("failed processing accepted")
	}
	if _, joined, err := flights.do(context.Background(), "bad", func() (preparationCatalogEntry, error) { return preparationCatalogEntry{}, nil }); err != nil || joined {
		t.Fatal("failed processing poisoned retry")
	}
}

func TestPreparationCatalogFlightsCancelJoinedWaiterWithoutCancelingOwner(t *testing.T) {
	flights := &preparationCatalogFlights{maxEntries: 1, pending: map[string]*preparationCatalogFlight{}}
	started, release := make(chan struct{}), make(chan struct{})
	ownerDone := make(chan error, 1)
	go func() {
		_, _, err := flights.do(context.Background(), "proof", func() (preparationCatalogEntry, error) {
			close(started)
			<-release
			return preparationCatalogEntry{Payload: []byte("owner completed")}, nil
		})
		ownerDone <- err
	}()
	<-started
	ctx, cancel := context.WithCancel(context.Background())
	observed := &observedFlightContext{Context: ctx, entered: make(chan struct{})}
	waiterDone := make(chan error, 1)
	go func() {
		_, joined, err := flights.do(observed, "proof", func() (preparationCatalogEntry, error) {
			t.Error("joined waiter built independently")
			return preparationCatalogEntry{}, nil
		})
		if !joined {
			t.Error("waiter did not join")
		}
		waiterDone <- err
	}()
	<-observed.entered
	cancel()
	if err := <-waiterDone; !errors.Is(err, context.Canceled) {
		t.Fatal("joined cancellation lost")
	}
	select {
	case <-ownerDone:
		t.Fatal("waiter canceled owner processing")
	default:
	}
	close(release)
	if err := <-ownerDone; err != nil {
		t.Fatal(err)
	}
	if len(flights.pending) != 0 {
		t.Fatal("canceled waiter left a retained flight")
	}
}

func TestPreparationCatalogFlightsShareFailureAndAllowFreshRetry(t *testing.T) {
	flights := &preparationCatalogFlights{maxEntries: 1, pending: map[string]*preparationCatalogFlight{}}
	started, release := make(chan struct{}), make(chan struct{})
	failed := errors.New("canonical manifest mismatch")
	ownerDone, waiterDone := make(chan error, 1), make(chan error, 1)
	go func() {
		_, _, err := flights.do(context.Background(), "proof", func() (preparationCatalogEntry, error) {
			close(started)
			<-release
			return preparationCatalogEntry{}, failed
		})
		ownerDone <- err
	}()
	<-started
	observed := &observedFlightContext{Context: context.Background(), entered: make(chan struct{})}
	go func() {
		_, joined, err := flights.do(observed, "proof", func() (preparationCatalogEntry, error) {
			t.Error("failed flight recomputed by waiter")
			return preparationCatalogEntry{}, nil
		})
		if !joined {
			t.Error("failure waiter did not join")
		}
		waiterDone <- err
	}()
	<-observed.entered
	close(release)
	if !errors.Is(<-ownerDone, failed) || !errors.Is(<-waiterDone, failed) {
		t.Fatal("shared failure was lost")
	}
	if _, joined, err := flights.do(context.Background(), "proof", func() (preparationCatalogEntry, error) { return preparationCatalogEntry{Payload: []byte("fresh")}, nil }); err != nil || joined {
		t.Fatal("failed flight was reused after completion")
	}
}
