package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestLockedContentAllowsMetadataButRejectsMechanicsDrift(t *testing.T) {
	gin.SetMode(gin.TestMode)
	support := JSONMap{"status": "verified_mechanical", "mechanics_locked": true}
	current := JSONMap{"activation": map[string]any{"mode": "active"}}
	equivalent := JSONMap{"activation": map[string]any{"mode": "active"}}
	changed := JSONMap{"activation": map[string]any{"mode": "reaction"}}

	for name, requested := range map[string]*JSONMap{
		"metadata-only request omits mechanics": nil,
		"equivalent mechanics":                  &equivalent,
	} {
		t.Run(name, func(t *testing.T) {
			context, _ := gin.CreateTestContext(httptest.NewRecorder())
			if rejectLockedMechanicsMutation(context, &support, &current, requested) {
				t.Fatal("metadata-safe update was rejected")
			}
		})
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	if !rejectLockedMechanicsMutation(context, &support, &current, &changed) {
		t.Fatal("mechanics drift was accepted")
	}
	if recorder.Code != http.StatusLocked {
		t.Fatalf("mechanics drift status=%d, want %d", recorder.Code, http.StatusLocked)
	}
}
