package main

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestArchivedContentLocksAllowMetadataAndMechanicsEdits(t *testing.T) {
	gin.SetMode(gin.TestMode)
	support := JSONMap{"status": "verified_mechanical", "mechanics_locked": true}
	current := JSONMap{"activation": map[string]any{"mode": "active"}}
	equivalent := JSONMap{"activation": map[string]any{"mode": "active"}}
	changed := JSONMap{"activation": map[string]any{"mode": "reaction"}}

	for name, requested := range map[string]*JSONMap{
		"metadata-only request omits mechanics": nil,
		"equivalent mechanics":                  &equivalent,
		"changed mechanics":                     &changed,
	} {
		t.Run(name, func(t *testing.T) {
			context, _ := gin.CreateTestContext(httptest.NewRecorder())
			if rejectLockedMechanicsMutation(context, &support, &current, requested) {
				t.Fatal("an archived lock rejected an authorized edit")
			}
		})
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	if rejectLockedContentMutation(context, &support) {
		t.Fatal("an archived lock rejected an authorized delete")
	}
}
