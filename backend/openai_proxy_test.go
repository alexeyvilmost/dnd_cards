package main

import (
	"crypto/x509"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestImageProviderProxyIsExplicitAndFailClosed(t *testing.T) {
	t.Setenv("HTTPS_PROXY", "http://global.invalid:1")
	t.Setenv("NO_PROXY", "*")
	t.Setenv("OPENAI_CONNECT_PROXY_URL", "")
	direct := newOpenAIHTTPClient().Transport.(imageProviderTransport).base.(*http.Transport)
	if direct.Proxy != nil {
		t.Fatal("provider inherited a process-wide proxy")
	}
	for _, raw := range []string{"socks5://secret:password@host:1", "http://host/path?secret=password", "http://", "%secret"} {
		proxy := imageProviderProxy(raw)
		req, _ := http.NewRequest("GET", "https://example.test", nil)
		if _, err := proxy(req); err == nil || strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "password") {
			t.Fatal("invalid proxy was accepted or disclosed")
		}
	}
	req, _ := http.NewRequest("POST", "http://example.test", nil)
	if _, err := imageProviderProxy("http://127.0.0.1:1")(req); err == nil {
		t.Fatal("cleartext provider destination allowed")
	}
}

func TestImageProviderCONNECTPreservesTLSAndCredentialBoundary(t *testing.T) {
	var lock sync.Mutex
	var method, proxyAuth, providerAuth string
	origin := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lock.Lock()
		providerAuth = r.Header.Get("Authorization")
		lock.Unlock()
		w.Write([]byte("local provider"))
	}))
	defer origin.Close()
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lock.Lock()
		method = r.Method
		proxyAuth = r.Header.Get("Authorization")
		lock.Unlock()
		if r.Method != "CONNECT" || r.Host != strings.TrimPrefix(origin.URL, "https://") {
			http.Error(w, "unexpected destination", 400)
			return
		}
		remote, err := net.Dial("tcp", r.Host)
		if err != nil {
			http.Error(w, "local connection failed", 502)
			return
		}
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			remote.Close()
			return
		}
		_, _ = conn.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))
		go func() { defer remote.Close(); defer conn.Close(); _, _ = io.Copy(remote, conn) }()
		go func() { defer remote.Close(); defer conn.Close(); _, _ = io.Copy(conn, remote) }()
	}))
	defer proxy.Close()
	t.Setenv("OPENAI_CONNECT_PROXY_URL", proxy.URL)
	t.Setenv("NO_PROXY", "*")
	client := newOpenAIHTTPClient()
	req, _ := http.NewRequest("GET", origin.URL, nil)
	req.Header.Set("Authorization", "Bearer LOCAL-TEST-KEY")
	if response, err := client.Do(req); err == nil {
		response.Body.Close()
		t.Fatal("untrusted TLS accepted")
	}
	tr := client.Transport.(imageProviderTransport).base.(*http.Transport)
	roots := x509.NewCertPool()
	roots.AddCert(origin.Certificate())
	tr.TLSClientConfig.RootCAs = roots
	// Trust is test-local. The production client never disables verification.
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal(response.StatusCode)
	}
	lock.Lock()
	defer lock.Unlock()
	if method != "CONNECT" || proxyAuth != "" || providerAuth != "Bearer LOCAL-TEST-KEY" {
		t.Fatal("proxy bypass or credential leak")
	}
	if tr.TLSClientConfig.InsecureSkipVerify {
		t.Fatal("TLS verification disabled")
	}
}
