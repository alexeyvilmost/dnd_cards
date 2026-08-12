package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRulesWorkerClientPinsAuthorityArtifactAndRNG(t *testing.T) {
	hash := "sha256:" + strings.Repeat("a", 64)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer worker-secret" {
			t.Fatalf("worker authorization = %q", request.Header.Get("Authorization"))
		}
		var input rulesWorkerExecuteRequest
		if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(rulesWorkerExecuteResponse{
			ProtocolVersion:   rulesWorkerProtocolVersion,
			EngineVersion:     "test-worker",
			SemanticAuthority: rulesWorkerAuthority,
			SchemaValidation:  rulesWorkerSchemaValidation,
			Status:            "accepted", RulesArtifactHash: input.RulesArtifactHash,
			BaseStateHash: input.BaseStateHash, StateHash: hash, EventHash: hash,
			RNGConsumed: input.RNGTape[:1], Events: json.RawMessage(`[]`),
			NextState: json.RawMessage(`{"schemaVersion":5}`),
		})
	}))
	defer server.Close()

	client := &httpRulesWorkerClient{
		baseURL: server.URL, secret: "worker-secret", client: server.Client(),
	}
	result, err := client.Execute(context.Background(), rulesWorkerExecuteRequest{
		ProtocolVersion:   rulesWorkerProtocolVersion,
		RulesArtifactHash: hash, BaseStateHash: hash,
		World: json.RawMessage(`{}`), Command: json.RawMessage(`{}`),
		RNGTape: []uint32{7, 8},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.EngineVersion != "test-worker" || len(result.RNGConsumed) != 1 || result.RNGConsumed[0] != 7 {
		t.Fatalf("unexpected worker response: %#v", result)
	}
}

func TestRulesWorkerClientFailsClosedOnAuthorityMismatch(t *testing.T) {
	hash := "sha256:" + strings.Repeat("a", 64)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(response).Encode(rulesWorkerExecuteResponse{
			ProtocolVersion:   rulesWorkerProtocolVersion,
			SemanticAuthority: "client_semantics_unverified",
			SchemaValidation:  rulesWorkerSchemaValidation,
			Status:            "rejected", RulesArtifactHash: hash, BaseStateHash: hash,
			StateHash: hash, Code: "StaleRevision", Message: "stale",
		})
	}))
	defer server.Close()
	client := &httpRulesWorkerClient{baseURL: server.URL, client: server.Client()}
	_, err := client.Execute(context.Background(), rulesWorkerExecuteRequest{
		ProtocolVersion:   rulesWorkerProtocolVersion,
		RulesArtifactHash: hash, BaseStateHash: hash,
		World: json.RawMessage(`{}`), Command: json.RawMessage(`{}`), RNGTape: []uint32{1},
	})
	if err == nil || !strings.Contains(err.Error(), "authority envelope") {
		t.Fatalf("authority mismatch error = %v", err)
	}
}

func TestRulesWorkerClientValidatesGenesisAuthority(t *testing.T) {
	hash := "sha256:" + strings.Repeat("a", 64)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/validate" || request.Header.Get("Authorization") != "Bearer worker-secret" {
			t.Fatalf("unexpected validation request %s auth=%q", request.URL.Path, request.Header.Get("Authorization"))
		}
		var input rulesWorkerValidateRequest
		if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		_ = json.NewEncoder(response).Encode(rulesWorkerValidateResponse{
			ProtocolVersion: rulesWorkerProtocolVersion, EngineVersion: "test-worker",
			SemanticAuthority: rulesWorkerAuthority, SchemaValidation: rulesWorkerSchemaValidation,
			Status: "valid", RulesArtifactHash: input.RulesArtifactHash, StateHash: input.StateHash,
		})
	}))
	defer server.Close()
	client := &httpRulesWorkerClient{baseURL: server.URL, secret: "worker-secret", client: server.Client()}
	result, err := client.Validate(context.Background(), rulesWorkerValidateRequest{
		ProtocolVersion: rulesWorkerProtocolVersion, RulesArtifactHash: hash,
		StateHash: hash, World: json.RawMessage(`{"schemaVersion":5}`),
	})
	if err != nil || result.Status != "valid" {
		t.Fatalf("validation result=%#v err=%v", result, err)
	}
}
