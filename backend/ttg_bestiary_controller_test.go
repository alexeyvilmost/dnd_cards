package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

const ttgSkeletonAPIResponse = `{
  "url":"skeleton-mm",
  "name":{"rus":"Скелет","eng":"Skeleton"},
  "ac":"14",
  "hit":{"hit":13,"formula":"2к8 + 4"},
  "initiative":{"label":"13","value":"+3"},
  "speed":" 30 фт.",
  "abilities":{
    "str":{"value":10,"mod":"+0","sav":"+0"},
    "dex":{"value":16,"mod":"+3","sav":"+3"},
    "con":{"value":15,"mod":"+2","sav":"+2"},
    "int":{"value":6,"mod":"-2","sav":"-2"},
    "wis":{"value":8,"mod":"-1","sav":"-1"},
    "chr":{"value":5,"mod":"-3","sav":"-3"}
  },
  "vulnerability":"дробящий",
  "resistance":"",
  "immunity":"ядовитый; истощённый, отравленный",
  "sense":"тёмное зрение 60 фт.",
  "languages":"понимает общий",
  "cr":"1/4 (Опыт 50; БМ +2)",
  "actions":[
    {"name":{"rus":"Короткий меч"},"description":["{@i Бросок рукопашной атаки:} {@roll +5|notation:1d20+5}.","{@i Попадание:} 6 ({@roll 1к6 + 3}) урона."]},
    {"name":{"rus":"Короткий лук"},"description":["{@i Бросок дальнобойной атаки:} {@roll +5|notation:1d20+5}.",{"type":"list","content":[{"type":"li","content":[{"type":"bold","content":[{"type":"text","text":"Особое:"}]},{"type":"text","text":" сохраняет структурированное описание"}]}]}]}
  ],
  "reactions":[{"name":{"rus":"Защита"},"description":["Скелет получает +2 КД."]}],
  "bonusActions":[],
  "legendary":{"actions":[]}
}`

func ttgTestController(upstream *httptest.Server) (*TTGBestiaryController, *gin.Engine) {
	controller := NewTTGBestiaryController()
	controller.client = upstream.Client()
	controller.upstreamOrigin = upstream.URL
	router := gin.New()
	router.GET("/api/integrations/ttg/bestiary/:slug", controller.Get)
	return controller, router
}

func ttgTestRouter(upstream *httptest.Server) *gin.Engine {
	_, router := ttgTestController(upstream)
	return router
}

func ttgPayloadForSlug(slug string) string {
	return strings.Replace(ttgSkeletonAPIResponse, `"url":"skeleton-mm"`, `"url":"`+slug+`"`, 1)
}

func requestTTGBestiary(router http.Handler, slug string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(
		http.MethodGet, "/api/integrations/ttg/bestiary/"+slug, nil,
	))
	return recorder
}

func TestTTGBestiaryAdapterReturnsValidatedStructuredStatBlock(t *testing.T) {
	gin.SetMode(gin.TestMode)
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v2/bestiary/skeleton-mm" {
			t.Fatalf("unexpected upstream path %q", request.URL.Path)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(ttgSkeletonAPIResponse))
	}))
	defer upstream.Close()

	recorder := httptest.NewRecorder()
	ttgTestRouter(upstream).ServeHTTP(recorder, httptest.NewRequest(
		http.MethodGet, "/api/integrations/ttg/bestiary/skeleton-mm", nil,
	))
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status %d: %s", recorder.Code, recorder.Body.String())
	}
	var response ttgImportResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Name != "Скелет" || response.AC != 14 || response.MaxHP != 13 || response.InitiativeBonus != 3 {
		t.Fatalf("core stat block was not normalized: %#v", response)
	}
	if len(response.Actions) != 3 || len(response.Actions[0].Description) != 2 || len(response.Actions[1].Description) != 2 {
		t.Fatalf("action bodies were lost: %#v", response.Actions)
	}
	if response.Actions[1].Description[1] != "• Особое: сохраняет структурированное описание" {
		t.Fatalf("rich action body was not preserved: %#v", response.Actions[1].Description)
	}
	if response.Actions[2].Kind != "reaction" || response.Actions[2].Name != "Защита" {
		t.Fatalf("action category was not preserved: %#v", response.Actions[2])
	}
	if response.StatBlock.Abilities["cha"].Score != 5 || response.StatBlock.Abilities["dex"].Mod != 3 {
		t.Fatalf("abilities were not normalized: %#v", response.StatBlock.Abilities)
	}
	if response.SourceURL != "https://new.ttg.club/bestiary?detail=skeleton-mm" {
		t.Fatalf("unexpected canonical source URL %q", response.SourceURL)
	}
}

func TestTTGBestiaryAdapterDistinguishesUpstreamAndSchemaFailures(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name         string
		upstreamCode int
		body         string
		wantStatus   int
		wantCode     string
	}{
		{name: "not found", upstreamCode: http.StatusNotFound, wantStatus: http.StatusNotFound, wantCode: "ttg_not_found"},
		{name: "upstream failure", upstreamCode: http.StatusServiceUnavailable, wantStatus: http.StatusBadGateway, wantCode: "ttg_upstream_error"},
		{name: "schema drift", upstreamCode: http.StatusOK, body: `{"name":{"rus":"Скелет"},"ac":"unknown"}`, wantStatus: http.StatusBadGateway, wantCode: "ttg_schema_invalid"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.WriteHeader(test.upstreamCode)
				_, _ = response.Write([]byte(test.body))
			}))
			defer upstream.Close()
			recorder := httptest.NewRecorder()
			ttgTestRouter(upstream).ServeHTTP(recorder, httptest.NewRequest(
				http.MethodGet, "/api/integrations/ttg/bestiary/skeleton-mm", nil,
			))
			if recorder.Code != test.wantStatus {
				t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
			}
			var body struct {
				Code string `json:"code"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Code != test.wantCode {
				t.Fatalf("code=%q want=%q", body.Code, test.wantCode)
			}
		})
	}
}

func TestTTGBestiaryAdapterRejectsInvalidSlugBeforeNetwork(t *testing.T) {
	controller := NewTTGBestiaryController()
	router := gin.New()
	router.GET("/api/integrations/ttg/bestiary/:slug", controller.Get)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(
		http.MethodGet, "/api/integrations/ttg/bestiary/INVALID_SLUG", nil,
	))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("unexpected status %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestTTGBestiaryAdapterCachesValidatedResponsesWithTTLAndEntryBound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var upstreamCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		upstreamCalls.Add(1)
		slug := strings.TrimPrefix(request.URL.Path, "/api/v2/bestiary/")
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(ttgPayloadForSlug(slug)))
	}))
	defer upstream.Close()

	controller, router := ttgTestController(upstream)
	now := time.Date(2026, time.August, 27, 12, 0, 0, 0, time.UTC)
	controller.now = func() time.Time { return now }
	controller.cacheTTL = time.Minute
	controller.cacheMaxEntries = 2

	for _, slug := range []string{"skeleton-mm", "skeleton-mm"} {
		response := requestTTGBestiary(router, slug)
		if response.Code != http.StatusOK {
			t.Fatalf("%s returned %d: %s", slug, response.Code, response.Body.String())
		}
	}
	if calls := upstreamCalls.Load(); calls != 1 {
		t.Fatalf("cache miss for repeated validated response: upstream calls=%d, want 1", calls)
	}

	now = now.Add(time.Second)
	if response := requestTTGBestiary(router, "zombie-mm"); response.Code != http.StatusOK {
		t.Fatalf("zombie-mm returned %d: %s", response.Code, response.Body.String())
	}
	now = now.Add(time.Second)
	if response := requestTTGBestiary(router, "goblin-mm"); response.Code != http.StatusOK {
		t.Fatalf("goblin-mm returned %d: %s", response.Code, response.Body.String())
	}
	controller.mu.Lock()
	cacheEntries := len(controller.cache)
	cacheBytes := controller.cacheBytes
	_, oldestStillCached := controller.cache["skeleton-mm"]
	controller.mu.Unlock()
	if cacheEntries != 2 || oldestStillCached {
		t.Fatalf("bounded LRU cache state entries=%d oldest_present=%v", cacheEntries, oldestStillCached)
	}
	if cacheBytes <= 0 || cacheBytes > controller.cacheMaxBytes {
		t.Fatalf("bounded cache bytes=%d max=%d", cacheBytes, controller.cacheMaxBytes)
	}

	now = now.Add(controller.cacheTTL)
	if response := requestTTGBestiary(router, "goblin-mm"); response.Code != http.StatusOK {
		t.Fatalf("expired goblin-mm returned %d: %s", response.Code, response.Body.String())
	}
	if calls := upstreamCalls.Load(); calls != 4 {
		t.Fatalf("expired response was not refreshed: upstream calls=%d, want 4", calls)
	}
}

func TestTTGBestiaryAdapterDoesNotCacheResponseOverByteBudget(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var upstreamCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		upstreamCalls.Add(1)
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(ttgSkeletonAPIResponse))
	}))
	defer upstream.Close()

	controller, router := ttgTestController(upstream)
	controller.cacheMaxBytes = 1
	for range 2 {
		if response := requestTTGBestiary(router, "skeleton-mm"); response.Code != http.StatusOK {
			t.Fatalf("unexpected status %d: %s", response.Code, response.Body.String())
		}
	}
	controller.mu.Lock()
	cacheEntries := len(controller.cache)
	cacheBytes := controller.cacheBytes
	controller.mu.Unlock()
	if upstreamCalls.Load() != 2 || cacheEntries != 0 || cacheBytes != 0 {
		t.Fatalf("oversized cache result calls=%d entries=%d bytes=%d", upstreamCalls.Load(), cacheEntries, cacheBytes)
	}
}

func TestTTGBestiaryAdapterCoalescesConcurrentRequestsBySlug(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const requestCount = 16
	var upstreamCalls atomic.Int32
	var startedOnce sync.Once
	started := make(chan struct{})
	release := make(chan struct{})
	var releaseOnce sync.Once
	releaseUpstream := func() { releaseOnce.Do(func() { close(release) }) }
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		upstreamCalls.Add(1)
		startedOnce.Do(func() { close(started) })
		<-release
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(ttgSkeletonAPIResponse))
	}))
	defer upstream.Close()
	defer releaseUpstream()

	controller, router := ttgTestController(upstream)
	statuses := make(chan int, requestCount)
	for range requestCount {
		go func() {
			statuses <- requestTTGBestiary(router, "skeleton-mm").Code
		}()
	}

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("upstream request did not start")
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		controller.mu.Lock()
		flight := controller.inFlight["skeleton-mm"]
		participants := 0
		if flight != nil {
			participants = flight.participants
		}
		controller.mu.Unlock()
		if participants == requestCount {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("only %d/%d requests joined the shared flight", participants, requestCount)
		}
		time.Sleep(time.Millisecond)
	}
	if calls := upstreamCalls.Load(); calls != 1 {
		t.Fatalf("concurrent requests produced %d upstream calls, want 1", calls)
	}
	releaseUpstream()
	for range requestCount {
		select {
		case status := <-statuses:
			if status != http.StatusOK {
				t.Fatalf("coalesced request returned status %d", status)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("coalesced request did not complete")
		}
	}
}

func TestTTGBestiaryAdapterBoundsDistinctUpstreamFlightsButAllowsSameSlugJoiners(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var upstreamCalls atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		if upstreamCalls.Add(1) == 1 {
			close(started)
		}
		<-release
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(ttgSkeletonAPIResponse))
	}))
	defer upstream.Close()

	controller, router := ttgTestController(upstream)
	controller.upstreamSlots = make(chan struct{}, 1)
	first := make(chan int, 1)
	joined := make(chan int, 1)
	go func() { first <- requestTTGBestiary(router, "skeleton-mm").Code }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("first upstream request did not start")
	}
	go func() { joined <- requestTTGBestiary(router, "skeleton-mm").Code }()

	busy := requestTTGBestiary(router, "zombie-mm")
	if busy.Code != http.StatusServiceUnavailable || !strings.Contains(busy.Body.String(), `"code":"ttg_busy"`) {
		t.Fatalf("distinct request over the global flight bound returned %d: %s", busy.Code, busy.Body.String())
	}
	if calls := upstreamCalls.Load(); calls != 1 {
		t.Fatalf("flight bound allowed %d upstream calls, want 1", calls)
	}
	close(release)
	for label, status := range map[string]<-chan int{"first": first, "same-slug joiner": joined} {
		select {
		case code := <-status:
			if code != http.StatusOK {
				t.Fatalf("%s returned %d", label, code)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("%s did not complete", label)
		}
	}
}

func TestTTGBestiaryAdapterDoesNotCacheUpstreamFailures(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var upstreamCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		call := upstreamCalls.Add(1)
		if call == 1 {
			response.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(ttgSkeletonAPIResponse))
	}))
	defer upstream.Close()

	router := ttgTestRouter(upstream)
	if response := requestTTGBestiary(router, "skeleton-mm"); response.Code != http.StatusBadGateway {
		t.Fatalf("upstream failure returned %d: %s", response.Code, response.Body.String())
	}
	for range 2 {
		if response := requestTTGBestiary(router, "skeleton-mm"); response.Code != http.StatusOK {
			t.Fatalf("recovery returned %d: %s", response.Code, response.Body.String())
		}
	}
	if calls := upstreamCalls.Load(); calls != 2 {
		t.Fatalf("failure was cached or success was not cached: upstream calls=%d, want 2", calls)
	}
}

func TestTTGBestiaryRateLimiterCountsGETsPerClientIP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	limiter := newTTGBestiaryRateLimiter()
	limiter.limit = 2
	limiter.now = func() time.Time {
		return time.Date(2026, time.August, 27, 12, 0, 0, 0, time.UTC)
	}
	router := gin.New()
	router.GET("/api/integrations/ttg/bestiary/:slug", limiter.Handler(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	for index, wantStatus := range []int{http.StatusNoContent, http.StatusNoContent, http.StatusTooManyRequests} {
		request := httptest.NewRequest(http.MethodGet, "/api/integrations/ttg/bestiary/skeleton-mm", nil)
		request.RemoteAddr = "192.0.2.10:41000"
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != wantStatus {
			t.Fatalf("same-IP request %d returned %d, want %d", index+1, response.Code, wantStatus)
		}
		if wantStatus == http.StatusTooManyRequests && response.Header().Get("Retry-After") == "" {
			t.Fatal("rate-limited response is missing Retry-After")
		}
	}

	request := httptest.NewRequest(http.MethodGet, "/api/integrations/ttg/bestiary/skeleton-mm", nil)
	request.RemoteAddr = "192.0.2.11:41000"
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("different client IP inherited another client's limit: status=%d", response.Code)
	}
}
