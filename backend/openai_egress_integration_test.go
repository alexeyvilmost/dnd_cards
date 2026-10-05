package main

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	openai "github.com/sashabaranov/go-openai"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Dedicated owned-stand gate: the provider and S3 endpoints are local protocol
// emulators, while gameplay uses the actual Go controller, PostgreSQL and Node
// rules worker. No external paid request or production credential is involved.
func TestImageEgressFailureDoesNotBlockActualGameplay(t *testing.T) {
	var fixture struct{ RunID, UserID string }
	if json.Unmarshal([]byte(os.Getenv("PERFORMANCE_EGRESS_FIXTURE")), &fixture) != nil || os.Getenv("TEST_RUN_DIRECTORY") == "" {
		t.Fatal("owned image-egress gate is required")
	}
	runID, err := uuid.Parse(fixture.RunID)
	if err != nil {
		t.Fatal("invalid fixture run")
	}
	userID, err := uuid.Parse(fixture.UserID)
	if err != nil {
		t.Fatal("invalid fixture owner")
	}
	db, err := gorm.Open(postgres.Open(os.Getenv("CANONICAL_RUNTIME_TEST_DSN")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var marker string
	if db.Raw("SELECT run_id FROM test_run_ownership").Scan(&marker).Error != nil || marker == "" || marker != os.Getenv("TEST_RUN_ID") {
		t.Fatal("owned database marker mismatch")
	}
	var run RoguelikeRun
	if db.First(&run, "id = ? AND user_id = ?", runID, userID).Error != nil {
		t.Fatal("owned fixture unavailable")
	}
	workerURL, err := url.Parse(os.Getenv("TEST_WORKER_ORIGIN"))
	if err != nil || workerURL.Scheme != "http" || workerURL.Hostname() != "127.0.0.1" || workerURL.Port() == "" || os.Getenv("TEST_WORKER_TOKEN") == "" {
		t.Fatal("actual owned worker required")
	}
	var workerCalls atomic.Int64
	workerProxy := httputil.NewSingleHostReverseProxy(workerURL)
	worker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { workerCalls.Add(1); workerProxy.ServeHTTP(w, r) }))
	defer worker.Close()
	t.Setenv("RULES_WORKER_URL", worker.URL)
	t.Setenv("RULES_WORKER_TOKEN", os.Getenv("TEST_WORKER_TOKEN"))
	router := gin.New()
	controller := NewRoguelikeController(db)
	router.POST("/runs/:id/commands", func(c *gin.Context) { c.Set("user_id", userID); controller.Command(c) })
	command := func() {
		t.Helper()
		if db.First(&run, "id = ?", runID).Error != nil {
			t.Fatal("run reload failed")
		}
		body, _ := json.Marshal(RoguelikeCommandRequest{CommandID: uuid.New(), ExpectedRevision: run.Revision, Type: "camp_turn", Payload: JSONMap{}})
		call := func() *httptest.ResponseRecorder {
			req := httptest.NewRequest("POST", "/runs/"+runID.String()+"/commands", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			ctx, cancel := context.WithTimeout(req.Context(), 30*time.Second)
			defer cancel()
			response := httptest.NewRecorder()
			router.ServeHTTP(response, req.WithContext(ctx))
			return response
		}
		before := workerCalls.Load()
		response := call()
		if response.Code != 200 {
			t.Fatalf("actual gameplay status=%d", response.Code)
		}
		if workerCalls.Load() <= before {
			t.Fatal("gameplay bypassed actual worker")
		}
		var saved string
		if db.Raw("SELECT row_to_json(r)::text FROM roguelike_runs r WHERE id = ?", runID).Scan(&saved).Error != nil {
			t.Fatal("run snapshot failed")
		}
		var receipts int64
		db.Model(&RoguelikeCommandReceipt{}).Where("run_id = ?", runID).Count(&receipts)
		before = workerCalls.Load()
		retry := call()
		decode := func(data []byte) any {
			var value any
			decoder := json.NewDecoder(bytes.NewReader(data))
			decoder.UseNumber()
			if err := decoder.Decode(&value); err != nil {
				t.Fatal("invalid command JSON")
			}
			return value
		}
		if retry.Code != 200 || !reflect.DeepEqual(decode(response.Body.Bytes()), decode(retry.Body.Bytes())) || workerCalls.Load() != before {
			t.Fatalf("receipt replay status=%d, equal=%v, extra_worker_calls=%d", retry.Code, reflect.DeepEqual(decode(response.Body.Bytes()), decode(retry.Body.Bytes())), workerCalls.Load()-before)
		}
		var after string
		var afterReceipts int64
		db.Raw("SELECT row_to_json(r)::text FROM roguelike_runs r WHERE id = ?", runID).Scan(&after)
		db.Model(&RoguelikeCommandReceipt{}).Where("run_id = ?", runID).Count(&afterReceipts)
		if saved != after || receipts != afterReceipts {
			t.Fatal("retry changed persisted state or receipt count")
		}
	}

	var providerCalls, storageCalls, connectCalls, directAttempts atomic.Int64
	png := []byte{137, 80, 78, 71, 13, 10, 26, 10}
	origin := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls.Add(1)
		if r.URL.Path != "/v1/images/generations" || r.Header.Get("Authorization") != "Bearer LOCAL-TEST-KEY" {
			http.Error(w, "unexpected local provider request", 400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"created": 1, "data": []any{map[string]string{"b64_json": base64.StdEncoding.EncodeToString(png)}}})
	}))
	defer origin.Close()
	storageServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "PUT" {
			http.Error(w, "unexpected storage request", 400)
			return
		}
		data, readErr := io.ReadAll(r.Body)
		if readErr != nil || !bytes.Equal(data, png) {
			http.Error(w, "invalid image bytes", 400)
			return
		}
		storageCalls.Add(1)
		w.Header().Set("ETag", `"local-etag"`)
		w.WriteHeader(200)
	}))
	defer storageServer.Close()
	t.Setenv("YANDEX_CLOUD_ACCESS_KEY_ID", "LOCAL-TEST-KEY")
	t.Setenv("YANDEX_CLOUD_SECRET_ACCESS_KEY", "LOCAL-TEST-SECRET")
	t.Setenv("YANDEX_CLOUD_BUCKET_NAME", "local-egress-fixture")
	t.Setenv("YANDEX_CLOUD_REGION", "ru-central1")
	t.Setenv("YANDEX_CLOUD_ENDPOINT", storageServer.URL)
	storage, err := NewYandexStorageService()
	if err != nil {
		t.Fatal(err)
	}
	var fail atomic.Bool
	entered, release := make(chan struct{}, 1), make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	var sockets sync.Map
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connectCalls.Add(1)
		// The hostname need not resolve on the application host. Only this local
		// CONNECT peer maps the certified destination to its loopback listener.
		if r.Method != "CONNECT" || r.Host != "example.com:443" || r.Header.Get("Authorization") != "" {
			http.Error(w, "destination or credential boundary failed", 400)
			return
		}
		if fail.Load() {
			select {
			case entered <- struct{}{}:
			default:
			}
			select {
			case <-release:
			case <-r.Context().Done():
			}
			http.Error(w, "local upstream lookup failure", 502)
			return
		}
		remote, dialErr := net.DialTimeout("tcp", origin.Listener.Addr().String(), 5*time.Second)
		if dialErr != nil {
			http.Error(w, "local origin unavailable", 502)
			return
		}
		conn, _, hijackErr := w.(http.Hijacker).Hijack()
		if hijackErr != nil {
			remote.Close()
			return
		}
		sockets.Store(conn, remote)
		fmt.Fprint(conn, "HTTP/1.1 200 Connection Established\r\n\r\n")
		go func() { defer conn.Close(); defer remote.Close(); defer sockets.Delete(conn); io.Copy(remote, conn) }()
		go func() { defer conn.Close(); defer remote.Close(); io.Copy(conn, remote) }()
	}))
	defer proxy.Close()
	defer sockets.Range(func(key, value any) bool { key.(net.Conn).Close(); value.(net.Conn).Close(); return true })
	t.Setenv("HTTPS_PROXY", "http://global.invalid:1")
	t.Setenv("NO_PROXY", "*")
	t.Setenv("OPENAI_CONNECT_PROXY_URL", proxy.URL)
	client := newOpenAIHTTPClient()
	defer client.CloseIdleConnections()
	transport := client.Transport.(imageProviderTransport).base.(*http.Transport)
	transport.DisableKeepAlives = true
	roots := x509.NewCertPool()
	roots.AddCert(origin.Certificate())
	transport.TLSClientConfig.RootCAs = roots
	proxyURL, _ := url.Parse(proxy.URL)
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		if address != proxyURL.Host {
			directAttempts.Add(1)
			return nil, errors.New("direct egress prohibited by test")
		}
		return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, address)
	}
	config := openai.DefaultConfig("LOCAL-TEST-KEY")
	config.BaseURL = "https://example.com/v1"
	config.HTTPClient = client
	service := newGeneratedImageService(&OpenAIService{client: openai.NewClientWithConfig(config)}, storage)
	input := generatedImageInput{Prompt: "local protocol fixture", Quality: "low", Size: "1024x1024", Folder: "egress-test", RequestID: "local-egress-test"}
	generate := func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		_, err := service.Generate(ctx, input, nil)
		return err
	}
	if err = generate(); err != nil {
		t.Fatalf("healthy local pipeline failed: %v", err)
	}
	command()
	fail.Store(true)
	failed := make(chan error, 1)
	go func() { failed <- generate() }()
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("CONNECT was not held")
	}
	command()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	_, _, err = storage.UploadImageFromBytes(ctx, png, "independent.png", "image/png", "egress-test")
	cancel()
	if err != nil {
		t.Fatal("independent storage failed while provider was held")
	}
	select {
	case <-failed:
		t.Fatal("provider request unexpectedly completed before release")
	default:
	}
	unblock()
	select {
	case err = <-failed:
	case <-time.After(10 * time.Second):
		t.Fatal("failed provider did not return")
	}
	var problem *ImageGenerationError
	if !errors.As(err, &problem) || providerCalls.Load() != 1 || connectCalls.Load() != 2 {
		t.Fatal("proxy failure was not classified, retried, or reached provider")
	}
	fail.Store(false)
	if err = generate(); err != nil {
		t.Fatalf("explicit recovery request failed: %v", err)
	}
	command()
	if providerCalls.Load() != 2 || connectCalls.Load() != 3 || storageCalls.Load() != 3 || directAttempts.Load() != 0 || transport.TLSClientConfig.InsecureSkipVerify {
		t.Fatal("egress, storage or TLS invariant failed")
	}
	report := map[string]any{"status": "passed", "gameplayCommands": 3, "exactReceiptReplays": 3, "workerCalls": workerCalls.Load(), "providerCalls": providerCalls.Load(), "connectCalls": connectCalls.Load(), "storageUploads": storageCalls.Load(), "directAttempts": directAttempts.Load(), "failureCode": problem.Code, "tlsVerified": true, "provider": "local TLS emulator", "storage": "local S3 protocol emulator", "externalProviderRequests": 0}
	data, _ := json.MarshalIndent(report, "", "  ")
	if err = os.WriteFile(filepath.Join(os.Getenv("TEST_RUN_DIRECTORY"), "image-egress-isolation.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
}
