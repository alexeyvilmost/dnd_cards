package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type admissionMarshalProbe struct {
	calls *atomic.Int32
	work  func() error
}

func (probe admissionMarshalProbe) MarshalJSON() ([]byte, error) {
	probe.calls.Add(1)
	if probe.work != nil {
		if err := probe.work(); err != nil {
			return nil, err
		}
	}
	return []byte(`{"command_id":"same-command","entropy":{"cursor":7}}`), nil
}

func admissionWait(t *testing.T, signal <-chan struct{}) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(5 * time.Second):
		t.Fatal("worker admission test timed out")
	}
}

func assertWorkerBusy(t *testing.T, err error) {
	t.Helper()
	var rejected *roguelikeWorkerRejection
	if !errors.As(err, &rejected) || rejected.Code != "combat_worker_busy" || publicRoguelikeWorkerFailure(err) != rejected {
		t.Fatalf("expected safe busy error, got %T", err)
	}
}

func TestWorkerAdmissionBoundsSharedClientsBeforeMarshal(t *testing.T) {
	t.Setenv("RULES_WORKER_MAX_INFLIGHT", "") // Measured default is four.
	var active, peak, requests atomic.Int32
	entered := make(chan struct{}, 4)
	unblock := make(chan struct{})
	var closeOnce sync.Once
	release := func() { closeOnce.Do(func() { close(unblock) }) }
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		current := active.Add(1)
		defer active.Add(-1)
		for old := peak.Load(); current > old && !peak.CompareAndSwap(old, current); old = peak.Load() {
		}
		var input map[string]any
		if json.NewDecoder(r.Body).Decode(&input) != nil || input["command_id"] != "same-command" || r.Header.Get("X-Request-ID") != "admission-request-1234" {
			t.Error("admission changed command or correlation identity")
		}
		entered <- struct{}{}
		<-unblock
		fmt.Fprint(w, `{"patch":{"current_hp":4}}`)
	}))
	defer server.Close()
	defer release()
	var marshals atomic.Int32
	results := make(chan error, 4)
	for range 4 {
		go func() {
			// Reconstructing a client must not create another independent budget.
			client := roguelikeWorkerClient{URL: server.URL, Token: strings.Repeat("w", 32)}
			ctx := context.WithValue(context.Background(), requestCorrelationKey{}, "admission-request-1234")
			_, err := client.call(ctx, "/rest", admissionMarshalProbe{calls: &marshals})
			results <- err
		}()
	}
	for range 4 {
		admissionWait(t, entered)
	}
	client := roguelikeWorkerClient{URL: server.URL, Token: strings.Repeat("w", 32)}
	for range 12 {
		_, err := client.call(context.Background(), "/transition", admissionMarshalProbe{calls: &marshals})
		assertWorkerBusy(t, err)
	}
	if requests.Load() != 4 || marshals.Load() != 4 || peak.Load() != 4 {
		t.Fatal("overload reached serialization/transport or bypassed shared bound")
	}
	release()
	for range 4 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	if sharedWorkerAdmission.active != 0 {
		t.Fatal("admission permits were retained after success")
	}
}

func TestWorkerAdmissionCancellationAndEveryFailureRelease(t *testing.T) {
	t.Setenv("RULES_WORKER_MAX_INFLIGHT", "1")
	var requests, marshals atomic.Int32
	entered := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		switch r.URL.Query().Get("failure") {
		case "cancel":
			_, _ = io.Copy(io.Discard, r.Body)
			entered <- struct{}{}
			select {
			case <-r.Context().Done():
			case <-time.After(5 * time.Second):
				t.Error("server did not observe cancelled request")
			}
		case "http":
			w.WriteHeader(500)
		case "decode":
			fmt.Fprint(w, "private invalid response")
		case "incomplete":
			fmt.Fprint(w, `{}`)
		default:
			fmt.Fprint(w, `{"patch":{"current_hp":4}}`)
		}
	}))
	defer server.Close()
	client := roguelikeWorkerClient{URL: server.URL, Token: strings.Repeat("w", 32)}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := client.call(ctx, "/rest", admissionMarshalProbe{calls: &marshals})
	if !errors.Is(err, context.Canceled) || marshals.Load() != 0 || requests.Load() != 0 {
		t.Fatal("cancelled-before-admission request performed work")
	}
	ctx, cancel = context.WithCancel(context.Background())
	_, err = client.call(ctx, "/rest", admissionMarshalProbe{calls: &marshals, work: func() error { cancel(); return nil }})
	if !errors.Is(err, context.Canceled) || requests.Load() != 0 {
		t.Fatal("cancelled-after-serialization request reached worker")
	}
	ctx, cancel = context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, err := client.call(ctx, "/rest?failure=cancel", JSONMap{}); done <- err }()
	admissionWait(t, entered)
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatal("in-flight cancellation was lost")
	}
	for _, failure := range []string{"marshal", "url", "http", "decode", "incomplete", "transport"} {
		t.Run(failure, func(t *testing.T) {
			current := client
			body := any(JSONMap{})
			if failure == "marshal" {
				body = admissionMarshalProbe{calls: &marshals, work: func() error { return errors.New("synthetic marshal failure") }}
			}
			if failure == "url" {
				current.URL = ":invalid"
			}
			if failure == "transport" {
				current.HTTP = &http.Client{Transport: admissionFailedTransport{}}
			}
			if _, err := current.call(context.Background(), "/rest?failure="+failure, body); err == nil {
				t.Fatal("failure fixture unexpectedly succeeded")
			}
			if _, err := client.call(context.Background(), "/rest", JSONMap{}); err != nil {
				t.Fatalf("failure leaked admission permit: %v", err)
			}
		})
	}
}

type admissionFailedTransport struct{}

func (admissionFailedTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("synthetic unavailable transport")
}

func TestWorkerAdmissionConfigurationAndIdempotentRelease(t *testing.T) {
	for _, invalid := range []string{"0", "-1", "65", "invalid", " 4"} {
		t.Setenv("RULES_WORKER_MAX_INFLIGHT", invalid)
		var calls atomic.Int32
		client := roguelikeWorkerClient{URL: "http://127.0.0.1:1", Token: strings.Repeat("w", 32)}
		_, err := client.call(context.Background(), "/rest", admissionMarshalProbe{calls: &calls})
		if err == nil || calls.Load() != 0 || publicRoguelikeWorkerFailure(err).Code != "combat_worker_unconfigured" {
			t.Fatal("invalid capacity did not fail closed before serialization")
		}
	}
	t.Setenv("RULES_WORKER_MAX_INFLIGHT", "2")
	admission := workerAdmission{}
	first, err := admission.acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	second, err := admission.acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_, err = admission.acquire(context.Background())
	assertWorkerBusy(t, err)
	first()
	first()
	second()
	second()
	if admission.active != 0 {
		t.Fatal("release was not idempotent")
	}
}
