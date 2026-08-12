package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	rulesWorkerProtocolVersion  = 1
	rulesWorkerAuthority        = "server_rules_core_verified"
	rulesWorkerSchemaValidation = "rules-core-world-v5-verified"
	maxRulesWorkerBodyBytes     = 2 << 20
)

type rulesWorkerExecuteRequest struct {
	ProtocolVersion   int             `json:"protocolVersion"`
	RulesArtifactHash string          `json:"rulesArtifactHash"`
	BaseStateHash     string          `json:"baseStateHash"`
	World             json.RawMessage `json:"world"`
	Command           json.RawMessage `json:"command"`
	RNGTape           []uint32        `json:"rngTape"`
}

type rulesWorkerExecuteResponse struct {
	ProtocolVersion   int             `json:"protocolVersion"`
	EngineVersion     string          `json:"engineVersion"`
	SemanticAuthority string          `json:"semanticAuthority"`
	SchemaValidation  string          `json:"schemaValidation"`
	Status            string          `json:"status"`
	RulesArtifactHash string          `json:"rulesArtifactHash"`
	BaseStateHash     string          `json:"baseStateHash"`
	StateHash         string          `json:"stateHash"`
	EventHash         string          `json:"eventHash,omitempty"`
	RNGConsumed       []uint32        `json:"rngConsumed"`
	Events            json.RawMessage `json:"events,omitempty"`
	NextState         json.RawMessage `json:"nextState,omitempty"`
	Code              string          `json:"code,omitempty"`
	Message           string          `json:"message,omitempty"`
}

type rulesWorkerValidateRequest struct {
	ProtocolVersion   int             `json:"protocolVersion"`
	RulesArtifactHash string          `json:"rulesArtifactHash"`
	StateHash         string          `json:"stateHash"`
	World             json.RawMessage `json:"world"`
}

type rulesWorkerValidateResponse struct {
	ProtocolVersion   int    `json:"protocolVersion"`
	EngineVersion     string `json:"engineVersion"`
	SemanticAuthority string `json:"semanticAuthority"`
	SchemaValidation  string `json:"schemaValidation"`
	Status            string `json:"status"`
	RulesArtifactHash string `json:"rulesArtifactHash"`
	StateHash         string `json:"stateHash"`
}

type rulesWorkerExecutor interface {
	Execute(context.Context, rulesWorkerExecuteRequest) (rulesWorkerExecuteResponse, error)
	Validate(context.Context, rulesWorkerValidateRequest) (rulesWorkerValidateResponse, error)
}

type httpRulesWorkerClient struct {
	baseURL string
	secret  string
	client  *http.Client
}

func (client *httpRulesWorkerClient) Validate(
	ctx context.Context,
	request rulesWorkerValidateRequest,
) (rulesWorkerValidateResponse, error) {
	var response rulesWorkerValidateResponse
	encoded, err := json.Marshal(request)
	if err != nil || len(encoded) > maxRulesWorkerBodyBytes {
		return response, errors.New("rules worker validation request is invalid or too large")
	}
	httpRequest, err := http.NewRequestWithContext(
		ctx, http.MethodPost, client.baseURL+"/v1/validate", bytes.NewReader(encoded),
	)
	if err != nil {
		return response, fmt.Errorf("create rules worker validation request: %w", err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	if client.secret != "" {
		httpRequest.Header.Set("Authorization", "Bearer "+client.secret)
	}
	httpResponse, err := client.client.Do(httpRequest)
	if err != nil {
		return response, fmt.Errorf("rules worker unavailable: %w", err)
	}
	defer httpResponse.Body.Close()
	body, err := io.ReadAll(io.LimitReader(httpResponse.Body, maxRulesWorkerBodyBytes+1))
	if err != nil || len(body) > maxRulesWorkerBodyBytes {
		return response, errors.New("rules worker validation response is invalid or too large")
	}
	if httpResponse.StatusCode != http.StatusOK {
		var problem struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &problem)
		return response, fmt.Errorf("rules worker rejected WorldState: %s", problem.Error)
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&response); err != nil || requireJSONEOF(decoder) != nil {
		return response, errors.New("rules worker validation response is malformed")
	}
	if response.ProtocolVersion != rulesWorkerProtocolVersion || response.Status != "valid" ||
		response.SemanticAuthority != rulesWorkerAuthority ||
		response.SchemaValidation != rulesWorkerSchemaValidation ||
		response.RulesArtifactHash != request.RulesArtifactHash || response.StateHash != request.StateHash ||
		strings.TrimSpace(response.EngineVersion) == "" {
		return response, errors.New("rules worker returned an inconsistent validation envelope")
	}
	return response, nil
}

func newRulesWorkerClientFromEnvironment() rulesWorkerExecutor {
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("RULES_WORKER_URL")), "/")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:9090"
	}
	return &httpRulesWorkerClient{
		baseURL: baseURL,
		secret:  strings.TrimSpace(os.Getenv("RULES_WORKER_SECRET")),
		client:  &http.Client{Timeout: 5 * time.Second},
	}
}

func (client *httpRulesWorkerClient) Execute(
	ctx context.Context,
	request rulesWorkerExecuteRequest,
) (rulesWorkerExecuteResponse, error) {
	var response rulesWorkerExecuteResponse
	encoded, err := json.Marshal(request)
	if err != nil {
		return response, fmt.Errorf("encode rules worker request: %w", err)
	}
	if len(encoded) > maxRulesWorkerBodyBytes {
		return response, errors.New("rules worker request is too large")
	}
	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		client.baseURL+"/v1/execute",
		bytes.NewReader(encoded),
	)
	if err != nil {
		return response, fmt.Errorf("create rules worker request: %w", err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	if client.secret != "" {
		httpRequest.Header.Set("Authorization", "Bearer "+client.secret)
	}
	httpResponse, err := client.client.Do(httpRequest)
	if err != nil {
		return response, fmt.Errorf("rules worker unavailable: %w", err)
	}
	defer httpResponse.Body.Close()
	body, err := io.ReadAll(io.LimitReader(httpResponse.Body, maxRulesWorkerBodyBytes+1))
	if err != nil {
		return response, fmt.Errorf("read rules worker response: %w", err)
	}
	if len(body) > maxRulesWorkerBodyBytes {
		return response, errors.New("rules worker response is too large")
	}
	if httpResponse.StatusCode != http.StatusOK {
		var problem struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &problem)
		if problem.Error == "" {
			problem.Error = http.StatusText(httpResponse.StatusCode)
		}
		return response, fmt.Errorf("rules worker rejected execution: %s", problem.Error)
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&response); err != nil {
		return response, fmt.Errorf("decode rules worker response: %w", err)
	}
	if err = requireJSONEOF(decoder); err != nil {
		return response, errors.New("rules worker response has trailing JSON")
	}
	if response.ProtocolVersion != rulesWorkerProtocolVersion ||
		response.SemanticAuthority != rulesWorkerAuthority ||
		response.SchemaValidation != rulesWorkerSchemaValidation ||
		response.RulesArtifactHash != request.RulesArtifactHash ||
		response.BaseStateHash != request.BaseStateHash ||
		(response.Status != "accepted" && response.Status != "rejected") {
		return response, errors.New("rules worker returned an inconsistent authority envelope")
	}
	if response.Status == "accepted" {
		if len(response.NextState) == 0 || len(response.Events) == 0 ||
			!canonicalTransportSHA256Pattern.MatchString(response.StateHash) ||
			!canonicalTransportSHA256Pattern.MatchString(response.EventHash) {
			return response, errors.New("rules worker accepted response is incomplete")
		}
	} else if response.Code == "" || response.Message == "" {
		return response, errors.New("rules worker rejection is incomplete")
	}
	if len(response.RNGConsumed) > len(request.RNGTape) {
		return response, errors.New("rules worker consumed an impossible RNG prefix")
	}
	for index, value := range response.RNGConsumed {
		if request.RNGTape[index] != value {
			return response, errors.New("rules worker RNG audit differs from the server tape")
		}
	}
	return response, nil
}
