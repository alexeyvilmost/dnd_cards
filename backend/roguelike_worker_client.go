package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type roguelikeWorkerClient struct {
	URL, Token string
	HTTP       *http.Client
}
type roguelikeWorkerNeed struct {
	Kind       string `json:"kind"`
	EntityType string `json:"entityType"`
	Reference  string `json:"reference"`
	EffectType string `json:"effectType"`
}
type roguelikeWorkerResult struct {
	Status              string                `json:"status"`
	Needs               []roguelikeWorkerNeed `json:"needs"`
	Envelope            JSONMap               `json:"envelope"`
	Patch               JSONMap               `json:"patch"`
	ContentManifestHash string                `json:"contentManifestHash"`
	RandomValues        []float64             `json:"randomValues"`
	Trace               JSONMap               `json:"trace"`
}

func (client roguelikeWorkerClient) call(ctx context.Context, endpoint string, body any) (*roguelikeWorkerResult, error) {
	if client.URL == "" || len(client.Token) < 32 {
		return nil, fmt.Errorf("rules worker is not configured")
	}
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(client.URL, "/")+endpoint, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+client.Token)
	request.Header.Set("Content-Type", "application/json")
	transport := client.HTTP
	if transport == nil {
		transport = &http.Client{Timeout: 20 * time.Second}
	}
	response, err := transport.Do(request)
	if err != nil {
		return nil, fmt.Errorf("rules worker unavailable: %w", err)
	}
	defer response.Body.Close()
	// Never log response bodies: they can contain private combat entropy.
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("rules worker rejected command (HTTP %d)", response.StatusCode)
	}
	const maximum = 16 << 20
	payload, err := io.ReadAll(io.LimitReader(response.Body, maximum+1))
	if err != nil {
		return nil, err
	}
	if len(payload) > maximum {
		return nil, fmt.Errorf("rules worker response too large")
	}
	var result roguelikeWorkerResult
	if err = json.Unmarshal(payload, &result); err != nil {
		return nil, fmt.Errorf("invalid rules worker response")
	}
	if result.Status == "needs_content" {
		if len(result.Needs) == 0 || len(result.Needs) > 2048 {
			return nil, fmt.Errorf("invalid dependency request")
		}
	} else if (endpoint != "/rest" && len(result.Envelope) == 0) || len(result.Patch) == 0 {
		return nil, fmt.Errorf("incomplete rules worker result")
	}
	return &result, nil
}
