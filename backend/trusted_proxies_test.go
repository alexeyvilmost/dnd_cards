package main

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func configuredProxyTestRouter(t *testing.T, middlewares ...gin.HandlerFunc) *gin.Engine {
	t.Helper()
	t.Setenv(trustedProxyCIDRsEnv, "100.0.0.0/8,127.0.0.0/8,::1/128")
	gin.SetMode(gin.TestMode)
	router := gin.New()
	if err := configureTrustedClientIPs(router); err != nil {
		t.Fatalf("configure trusted client IPs: %v", err)
	}
	router.Use(middlewares...)
	router.POST("/write", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	return router
}

func proxyTestRequest(remoteAddr, realIP, forwardedFor string) *http.Request {
	request := httptest.NewRequest(http.MethodPost, "/write", nil)
	request.RemoteAddr = remoteAddr
	if realIP != "" {
		request.Header.Set("X-Real-IP", realIP)
	}
	if forwardedFor != "" {
		request.Header.Set("X-Forwarded-For", forwardedFor)
	}
	return request
}

func TestTrustedProxyConfigurationAcceptsOnlyCanonicalBoundedCIDRs(t *testing.T) {
	tests := map[string]string{
		"empty":               "",
		"empty entry":         "100.0.0.0/8,",
		"plain IP":            "127.0.0.1",
		"host bits":           "100.64.1.2/8",
		"all IPv4":            "0.0.0.0/0",
		"all IPv6":            "::/0",
		"overbroad IPv4":      "0.0.0.0/1",
		"overbroad IPv6":      "8000::/1",
		"duplicate canonical": "127.0.0.0/8,127.0.0.0/8",
	}
	for name, configured := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := parseTrustedProxyCIDRs(configured, true); err == nil {
				t.Fatalf("expected invalid %s to be rejected", trustedProxyCIDRsEnv)
			}
		})
	}

	got, err := parseTrustedProxyCIDRs(" 100.0.0.0/8, 127.0.0.0/8, ::1/128 ", true)
	if err != nil {
		t.Fatalf("expected valid CIDRs: %v", err)
	}
	want := []string{"100.0.0.0/8", "127.0.0.0/8", "::1/128"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("trusted CIDRs = %#v, want %#v", got, want)
	}
}

func TestConfigureTrustedClientIPsFailsClosedForInvalidEnv(t *testing.T) {
	t.Setenv(trustedProxyCIDRsEnv, "not-a-network")
	router := gin.New()
	if err := configureTrustedClientIPs(router); err == nil {
		t.Fatalf("expected invalid %s to fail configuration", trustedProxyCIDRsEnv)
	}
}

func TestTrustedProxyConfigurationUsesSafeDefaultsAndOnlyXRealIP(t *testing.T) {
	t.Setenv(trustedProxyCIDRsEnv, "100.0.0.0/8,127.0.0.0/8,::1/128")
	router := gin.New()
	if err := configureTrustedClientIPs(router); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(router.RemoteIPHeaders, []string{"X-Real-IP"}) {
		t.Fatalf("remote IP headers = %#v, want only X-Real-IP", router.RemoteIPHeaders)
	}
	if router.TrustedPlatform != "" {
		t.Fatalf("unexpected trusted platform header %q", router.TrustedPlatform)
	}

	defaults, err := parseTrustedProxyCIDRs("", false)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(defaults, defaultTrustedProxyCIDRs) {
		t.Fatalf("default trusted CIDRs = %#v, want %#v", defaults, defaultTrustedProxyCIDRs)
	}
}

func TestUntrustedForwardingHeadersCannotRotateRateLimitIdentity(t *testing.T) {
	limiter := NewFixedWindowRateLimiter(1, time.Minute)
	router := configuredProxyTestRouter(t, limiter.Handler())

	requests := []*http.Request{
		proxyTestRequest("203.0.113.10:41000", "198.51.100.1", "198.51.100.2"),
		proxyTestRequest("203.0.113.10:41001", "198.51.100.3", "198.51.100.4"),
	}
	wantStatuses := []int{http.StatusNoContent, http.StatusTooManyRequests}
	for index, request := range requests {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != wantStatuses[index] {
			t.Fatalf("request %d status = %d, want %d", index+1, response.Code, wantStatuses[index])
		}
	}
}

func TestTrustedRailwayXRealIPDrivesLimiterAndXForwardedForIsIgnored(t *testing.T) {
	limiter := NewFixedWindowRateLimiter(1, time.Minute)
	router := configuredProxyTestRouter(t, limiter.Handler())

	tests := []struct {
		realIP       string
		forwardedFor string
		wantStatus   int
	}{
		{realIP: "198.51.100.11", forwardedFor: "192.0.2.11", wantStatus: http.StatusNoContent},
		{realIP: "198.51.100.12", forwardedFor: "192.0.2.12", wantStatus: http.StatusNoContent},
		{realIP: "198.51.100.12", forwardedFor: "192.0.2.99", wantStatus: http.StatusTooManyRequests},
	}
	for index, test := range tests {
		request := proxyTestRequest("100.64.0.8:41000", test.realIP, test.forwardedFor)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != test.wantStatus {
			t.Fatalf("request %d status = %d, want %d", index+1, response.Code, test.wantStatus)
		}
	}
}

func TestMutationAuditUsesOnlyAuthenticatedProxyIdentity(t *testing.T) {
	var output bytes.Buffer
	originalWriter := log.Writer()
	log.SetOutput(&output)
	defer log.SetOutput(originalWriter)

	router := configuredProxyTestRouter(t, RequestIDMiddleware(), MutationAuditMiddleware())

	untrustedOne := proxyTestRequest("203.0.113.20:42000", "198.51.100.20", "192.0.2.20")
	untrustedOne.Header.Set("X-Request-ID", "audit-untrusted-one")
	router.ServeHTTP(httptest.NewRecorder(), untrustedOne)
	untrustedTwo := proxyTestRequest("203.0.113.20:42001", "198.51.100.21", "192.0.2.21")
	untrustedTwo.Header.Set("X-Request-ID", "audit-untrusted-two")
	router.ServeHTTP(httptest.NewRecorder(), untrustedTwo)

	trusted := proxyTestRequest("100.64.0.9:42000", "198.51.100.30", "192.0.2.30")
	trusted.Header.Set("X-Request-ID", "audit-trusted")
	router.ServeHTTP(httptest.NewRecorder(), trusted)

	entries := output.String()
	if got := strings.Count(entries, `client_ip="203.0.113.20"`); got != 2 {
		t.Fatalf("untrusted proxy headers changed audit identity; matching entries = %d:\n%s", got, entries)
	}
	if !strings.Contains(entries, `request_id="audit-trusted"`) ||
		!strings.Contains(entries, `client_ip="198.51.100.30"`) {
		t.Fatalf("trusted Railway-style X-Real-IP was not used in audit:\n%s", entries)
	}
	for _, spoofed := range []string{"198.51.100.20", "198.51.100.21", "192.0.2.20", "192.0.2.21", "192.0.2.30"} {
		if strings.Contains(entries, `client_ip="`+spoofed+`"`) {
			t.Fatalf("spoofable forwarding address %s appeared as audit identity:\n%s", spoofed, entries)
		}
	}
}
