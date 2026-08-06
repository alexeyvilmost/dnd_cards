package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestValidateEncounterApplyEnvelopeAcceptsBoundedCurrentProtocol(t *testing.T) {
	req := ApplyRequest{
		Events: []any{"legacy combat log line"},
		Log: []BattleLogEntry{
			{Message: "message-only encounter line"},
			{
				Message: "Wizard dealt damage", Type: "damage",
				Payload: JSONMap{"type": "damage", "amount": float64(3), "damageType": "force"},
			},
		},
	}
	if err := validateEncounterApplyEnvelope(req); err != nil {
		t.Fatalf("valid envelope rejected: %v", err)
	}
}

func TestEncounterApplyBodyLimitRejectsKnownAndChunkedOversizeBodies(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST(
		"/apply",
		JSONBodyLimitMiddleware(maxEncounterApplyBodyBytes),
		RequestBodyLimitMiddleware(maxEncounterApplyBodyBytes),
		func(c *gin.Context) {
			if _, err := io.ReadAll(c.Request.Body); err != nil {
				c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "body too large"})
				return
			}
			c.Status(http.StatusNoContent)
		},
	)
	for _, contentType := range []string{"application/json", "application/octet-stream"} {
		for _, chunked := range []bool{false, true} {
			body := strings.NewReader(strings.Repeat("x", int(maxEncounterApplyBodyBytes)+1))
			request := httptest.NewRequest(http.MethodPost, "/apply", body)
			request.Header.Set("Content-Type", contentType)
			if chunked {
				request.ContentLength = -1
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != http.StatusRequestEntityTooLarge {
				t.Fatalf("contentType=%s chunked=%v status=%d, want 413", contentType, chunked, response.Code)
			}
		}
	}
}

func TestValidateEncounterApplyEnvelopeRejectsUnboundedOrMalformedFields(t *testing.T) {
	tooMany := make([]interface{}, maxEncounterApplyArrayItems+1)
	for index := range tooMany {
		tooMany[index] = "line"
	}
	tests := []struct {
		name string
		req  ApplyRequest
		want string
	}{
		{name: "too many legacy events", req: ApplyRequest{Events: tooMany}, want: "events: no more than"},
		{name: "arbitrary legacy event object", req: ApplyRequest{Events: []any{map[string]any{"injected": true}}}, want: "legacy log string"},
		{name: "oversized legacy event", req: ApplyRequest{Events: []any{strings.Repeat("x", maxEncounterLegacyEventBytes+1)}}, want: "legacy log string"},
		{name: "oversized log message", req: ApplyRequest{Log: []BattleLogEntry{{Message: strings.Repeat("x", maxEncounterLogMessageBytes+1)}}}, want: "message: is too large"},
		{name: "target without payload", req: ApplyRequest{Log: []BattleLogEntry{{TargetCharacterID: "9bd091f4-28a5-4eb9-ab17-ec0604205f2f", Type: "damage"}}}, want: "requires both type and payload"},
		{name: "payload without outer type", req: ApplyRequest{Log: []BattleLogEntry{{Payload: JSONMap{"type": "turn_started"}}}}, want: "type: is required"},
		{name: "mismatched discriminants", req: ApplyRequest{Log: []BattleLogEntry{{Type: "healing", Payload: JSONMap{"type": "damage", "amount": float64(1), "damageType": "fire"}}}}, want: "must exactly match"},
		{name: "unknown engine event field", req: ApplyRequest{Log: []BattleLogEntry{{Type: "damage", Payload: JSONMap{"type": "damage", "amount": float64(1), "damageType": "fire", "runtime": true}}}}, want: "is not allowed"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateEncounterApplyEnvelope(test.req)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error=%v, want substring %q", err, test.want)
			}
		})
	}
}
