package main

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRuntimeProjectionSelector(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		query       string
		wantRuntime bool
		wantList    bool
	}{
		{query: "fields=runtime", wantRuntime: true},
		{query: "fields=list", wantList: true},
		{query: ""},
	} {
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		ctx.Request = httptest.NewRequest("GET", "/catalog?"+tc.query, nil)
		if got := wantsRuntimeView(ctx); got != tc.wantRuntime {
			t.Fatalf("query %q runtime=%v want %v", tc.query, got, tc.wantRuntime)
		}
		if got := wantsListView(ctx); got != tc.wantList {
			t.Fatalf("query %q list=%v want %v", tc.query, got, tc.wantList)
		}
	}
}
