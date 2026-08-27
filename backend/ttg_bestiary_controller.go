package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	ttgBestiaryUpstreamOrigin     = "https://new.ttg.club"
	ttgBestiaryMaxBodyBytes       = 2 << 20
	ttgBestiaryUpstreamTimeout    = 8 * time.Second
	ttgBestiaryCacheTTL           = 45 * time.Second
	ttgBestiaryCacheMaxEntries    = 128
	ttgBestiaryCacheMaxBytes      = 16 << 20
	ttgBestiaryMaxUpstreamFlights = 8
	ttgBestiaryRequestsPerMinute  = 30
	ttgBestiaryRateLimitWindow    = time.Minute
)

var ttgBestiarySlugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,127}$`)

// TTGBestiaryController is the application-owned boundary around TTG's
// structured bestiary API. The browser never follows TTG presentation-page
// redirects and never has to understand Nuxt-generated HTML.
type TTGBestiaryController struct {
	client          *http.Client
	upstreamOrigin  string
	upstreamTimeout time.Duration

	mu              sync.Mutex
	cache           map[string]ttgBestiaryCacheEntry
	cacheBytes      int
	inFlight        map[string]*ttgBestiaryFlight
	upstreamSlots   chan struct{}
	cacheTTL        time.Duration
	cacheMaxEntries int
	cacheMaxBytes   int
	now             func() time.Time
}

type ttgBestiaryCacheEntry struct {
	body       []byte
	expiresAt  time.Time
	lastAccess time.Time
}

type ttgBestiaryFetchResult struct {
	status  int
	code    string
	message string
	body    []byte
}

type ttgBestiaryFlight struct {
	done         chan struct{}
	participants int
	result       ttgBestiaryFetchResult
}

func NewTTGBestiaryController() *TTGBestiaryController {
	return &TTGBestiaryController{
		client: &http.Client{
			Timeout: ttgBestiaryUpstreamTimeout,
			// The structured endpoint is the authority. Following a redirect
			// would reintroduce the escaped-origin failure that this boundary
			// replaces and could let an upstream redirect choose our egress host.
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		upstreamOrigin:  ttgBestiaryUpstreamOrigin,
		upstreamTimeout: ttgBestiaryUpstreamTimeout,
		cache:           make(map[string]ttgBestiaryCacheEntry),
		inFlight:        make(map[string]*ttgBestiaryFlight),
		upstreamSlots:   make(chan struct{}, ttgBestiaryMaxUpstreamFlights),
		cacheTTL:        ttgBestiaryCacheTTL,
		cacheMaxEntries: ttgBestiaryCacheMaxEntries,
		cacheMaxBytes:   ttgBestiaryCacheMaxBytes,
		now:             time.Now,
	}
}

func newTTGBestiaryRateLimiter() *FixedWindowRateLimiter {
	return NewFixedWindowRateLimiter(ttgBestiaryRequestsPerMinute, ttgBestiaryRateLimitWindow)
}

type ttgLocalizedName struct {
	Rus string `json:"rus"`
}

type ttgInteger struct {
	Value int
	Valid bool
}

func (value *ttgInteger) UnmarshalJSON(raw []byte) error {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return nil
	}
	if strings.HasPrefix(trimmed, `"`) {
		var text string
		if err := json.Unmarshal(raw, &text); err != nil {
			return err
		}
		trimmed = strings.TrimSpace(strings.TrimPrefix(text, "+"))
	}
	parsed, err := strconv.Atoi(trimmed)
	if err != nil {
		return fmt.Errorf("expected integer, got %q", trimmed)
	}
	value.Value = parsed
	value.Valid = true
	return nil
}

type ttgUpstreamAbility struct {
	Value ttgInteger `json:"value"`
	Mod   ttgInteger `json:"mod"`
	Save  ttgInteger `json:"sav"`
}

type ttgUpstreamAction struct {
	Name        ttgLocalizedName  `json:"name"`
	Description []json.RawMessage `json:"description"`
}

type ttgUpstreamDocument struct {
	URL  string           `json:"url"`
	Name ttgLocalizedName `json:"name"`
	AC   ttgInteger       `json:"ac"`
	Hit  struct {
		Hit ttgInteger `json:"hit"`
	} `json:"hit"`
	Initiative struct {
		Value ttgInteger `json:"value"`
	} `json:"initiative"`
	Speed         string                        `json:"speed"`
	Abilities     map[string]ttgUpstreamAbility `json:"abilities"`
	Vulnerability string                        `json:"vulnerability"`
	Resistance    string                        `json:"resistance"`
	Immunity      string                        `json:"immunity"`
	Sense         string                        `json:"sense"`
	Languages     string                        `json:"languages"`
	CR            string                        `json:"cr"`
	Actions       []ttgUpstreamAction           `json:"actions"`
	BonusActions  []ttgUpstreamAction           `json:"bonusActions"`
	Reactions     []ttgUpstreamAction           `json:"reactions"`
	Legendary     struct {
		Actions []ttgUpstreamAction `json:"actions"`
	} `json:"legendary"`
}

type ttgImportAbility struct {
	Score int `json:"score"`
	Mod   int `json:"mod"`
	Save  int `json:"save"`
}

type ttgImportAction struct {
	Kind        string   `json:"kind"`
	Name        string   `json:"name"`
	Description []string `json:"description"`
}

type ttgImportStatBlock struct {
	Speed           string                      `json:"speed,omitempty"`
	Senses          string                      `json:"senses,omitempty"`
	Languages       string                      `json:"languages,omitempty"`
	CR              string                      `json:"cr,omitempty"`
	Vulnerabilities string                      `json:"vulnerabilities,omitempty"`
	Resistances     string                      `json:"resistances,omitempty"`
	Immunities      string                      `json:"immunities,omitempty"`
	Abilities       map[string]ttgImportAbility `json:"abilities,omitempty"`
}

type ttgImportResponse struct {
	Slug            string             `json:"slug"`
	SourceURL       string             `json:"source_url"`
	Name            string             `json:"name"`
	AC              int                `json:"ac"`
	MaxHP           int                `json:"max_hp"`
	InitiativeBonus int                `json:"initiative_bonus"`
	Actions         []ttgImportAction  `json:"actions"`
	StatBlock       ttgImportStatBlock `json:"statblock"`
}

func flattenTTGRichText(raw json.RawMessage, depth int) (string, error) {
	if depth > 32 {
		return "", errors.New("rich text nesting is too deep")
	}
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return "", nil
	}
	if strings.HasPrefix(trimmed, `"`) {
		var text string
		if err := json.Unmarshal(raw, &text); err != nil {
			return "", err
		}
		return text, nil
	}
	if strings.HasPrefix(trimmed, "[") {
		var children []json.RawMessage
		if err := json.Unmarshal(raw, &children); err != nil {
			return "", err
		}
		parts := make([]string, 0, len(children))
		for _, child := range children {
			text, err := flattenTTGRichText(child, depth+1)
			if err != nil {
				return "", err
			}
			if text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, ""), nil
	}
	if !strings.HasPrefix(trimmed, "{") {
		return "", errors.New("rich text value is neither text nor an object")
	}
	var node struct {
		Type    string            `json:"type"`
		Text    string            `json:"text"`
		Content []json.RawMessage `json:"content"`
	}
	if err := json.Unmarshal(raw, &node); err != nil {
		return "", err
	}
	parts := make([]string, 0, len(node.Content)+1)
	if node.Text != "" {
		parts = append(parts, node.Text)
	}
	for _, child := range node.Content {
		text, err := flattenTTGRichText(child, depth+1)
		if err != nil {
			return "", err
		}
		if text != "" {
			parts = append(parts, text)
		}
	}
	separator := ""
	if node.Type == "list" {
		separator = "\n"
	}
	text := strings.Join(parts, separator)
	if node.Type == "li" && text != "" {
		return "• " + text, nil
	}
	return text, nil
}

func normalizeTTGActions(kind string, actions []ttgUpstreamAction) ([]ttgImportAction, error) {
	result := make([]ttgImportAction, 0, len(actions))
	for index, action := range actions {
		name := strings.TrimSpace(action.Name.Rus)
		if name == "" {
			return nil, fmt.Errorf("%s[%d].name.rus is missing", kind, index)
		}
		descriptions := make([]string, 0, len(action.Description))
		for descriptionIndex, description := range action.Description {
			text, err := flattenTTGRichText(description, 0)
			if err != nil {
				return nil, fmt.Errorf("%s[%d].description[%d]: %w", kind, index, descriptionIndex, err)
			}
			if trimmed := strings.TrimSpace(text); trimmed != "" {
				descriptions = append(descriptions, trimmed)
			}
		}
		result = append(result, ttgImportAction{
			Kind: kind, Name: name, Description: descriptions,
		})
	}
	return result, nil
}

func normalizeTTGDocument(slug string, document ttgUpstreamDocument) (ttgImportResponse, error) {
	if upstreamSlug := strings.TrimSpace(document.URL); upstreamSlug != "" && upstreamSlug != slug {
		return ttgImportResponse{}, fmt.Errorf("url %q does not match requested slug %q", upstreamSlug, slug)
	}
	name := strings.TrimSpace(document.Name.Rus)
	if name == "" {
		return ttgImportResponse{}, errors.New("name.rus is missing")
	}
	if !document.AC.Valid || document.AC.Value <= 0 {
		return ttgImportResponse{}, errors.New("ac is missing or invalid")
	}
	if !document.Hit.Hit.Valid || document.Hit.Hit.Value <= 0 {
		return ttgImportResponse{}, errors.New("hit.hit is missing or invalid")
	}

	allActions := make([]ttgImportAction, 0)
	for _, group := range []struct {
		kind    string
		actions []ttgUpstreamAction
	}{
		{kind: "action", actions: document.Actions},
		{kind: "bonus_action", actions: document.BonusActions},
		{kind: "reaction", actions: document.Reactions},
		{kind: "legendary_action", actions: document.Legendary.Actions},
	} {
		normalized, err := normalizeTTGActions(group.kind, group.actions)
		if err != nil {
			return ttgImportResponse{}, err
		}
		allActions = append(allActions, normalized...)
	}

	abilities := make(map[string]ttgImportAbility)
	for _, pair := range []struct{ upstream, local string }{
		{upstream: "str", local: "str"},
		{upstream: "dex", local: "dex"},
		{upstream: "con", local: "con"},
		{upstream: "int", local: "int"},
		{upstream: "wis", local: "wis"},
		{upstream: "chr", local: "cha"},
		{upstream: "cha", local: "cha"},
	} {
		ability, found := document.Abilities[pair.upstream]
		if !found {
			continue
		}
		if !ability.Value.Valid || !ability.Mod.Valid || !ability.Save.Valid {
			return ttgImportResponse{}, fmt.Errorf("abilities.%s is incomplete", pair.upstream)
		}
		abilities[pair.local] = ttgImportAbility{
			Score: ability.Value.Value, Mod: ability.Mod.Value, Save: ability.Save.Value,
		}
	}

	initiativeBonus := 0
	if document.Initiative.Value.Valid {
		initiativeBonus = document.Initiative.Value.Value
	}
	return ttgImportResponse{
		Slug:            slug,
		SourceURL:       ttgBestiaryUpstreamOrigin + "/bestiary?detail=" + slug,
		Name:            name,
		AC:              document.AC.Value,
		MaxHP:           document.Hit.Hit.Value,
		InitiativeBonus: initiativeBonus,
		Actions:         allActions,
		StatBlock: ttgImportStatBlock{
			Speed: strings.TrimSpace(document.Speed), Senses: strings.TrimSpace(document.Sense),
			Languages: strings.TrimSpace(document.Languages), CR: strings.TrimSpace(document.CR),
			Vulnerabilities: strings.TrimSpace(document.Vulnerability),
			Resistances:     strings.TrimSpace(document.Resistance), Immunities: strings.TrimSpace(document.Immunity),
			Abilities: abilities,
		},
	}, nil
}

func ttgImportError(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{"error": message, "code": code})
}

func ttgFetchError(status int, code, message string) ttgBestiaryFetchResult {
	return ttgBestiaryFetchResult{status: status, code: code, message: message}
}

func (controller *TTGBestiaryController) removeCacheEntryLocked(slug string) {
	entry, found := controller.cache[slug]
	if !found {
		return
	}
	delete(controller.cache, slug)
	controller.cacheBytes -= len(entry.body)
	if controller.cacheBytes < 0 {
		controller.cacheBytes = 0
	}
}

func (controller *TTGBestiaryController) pruneExpiredCacheLocked(now time.Time) {
	for slug, entry := range controller.cache {
		if !now.Before(entry.expiresAt) {
			controller.removeCacheEntryLocked(slug)
		}
	}
}

func (controller *TTGBestiaryController) cachedResultLocked(slug string, now time.Time) (ttgBestiaryFetchResult, bool) {
	entry, found := controller.cache[slug]
	if !found {
		return ttgBestiaryFetchResult{}, false
	}
	if !now.Before(entry.expiresAt) {
		controller.removeCacheEntryLocked(slug)
		return ttgBestiaryFetchResult{}, false
	}
	entry.lastAccess = now
	controller.cache[slug] = entry
	return ttgBestiaryFetchResult{status: http.StatusOK, body: entry.body}, true
}

func (controller *TTGBestiaryController) evictOldestCacheEntryLocked() bool {
	oldestSlug := ""
	var oldestAccess time.Time
	for slug, entry := range controller.cache {
		if oldestSlug == "" || entry.lastAccess.Before(oldestAccess) ||
			(entry.lastAccess.Equal(oldestAccess) && slug < oldestSlug) {
			oldestSlug = slug
			oldestAccess = entry.lastAccess
		}
	}
	if oldestSlug == "" {
		return false
	}
	controller.removeCacheEntryLocked(oldestSlug)
	return true
}

func (controller *TTGBestiaryController) storeCacheLocked(slug string, body []byte, now time.Time) {
	// Only validated success payloads reach this cache. Limit both entries and
	// serialized bytes so a legal-but-large upstream document cannot multiply
	// into unbounded resident memory.
	if controller.cacheTTL <= 0 || controller.cacheMaxEntries <= 0 ||
		controller.cacheMaxBytes <= 0 || len(body) > controller.cacheMaxBytes {
		return
	}
	controller.pruneExpiredCacheLocked(now)
	controller.removeCacheEntryLocked(slug)
	for len(controller.cache) >= controller.cacheMaxEntries ||
		controller.cacheBytes+len(body) > controller.cacheMaxBytes {
		if !controller.evictOldestCacheEntryLocked() {
			return
		}
	}
	controller.cache[slug] = ttgBestiaryCacheEntry{
		body: body, expiresAt: now.Add(controller.cacheTTL), lastAccess: now,
	}
	controller.cacheBytes += len(body)
}

func (controller *TTGBestiaryController) resolve(
	requestContext context.Context,
	slug string,
) (ttgBestiaryFetchResult, bool) {
	now := controller.now()
	controller.mu.Lock()
	controller.pruneExpiredCacheLocked(now)
	if cached, found := controller.cachedResultLocked(slug, now); found {
		controller.mu.Unlock()
		return cached, true
	}
	flight, found := controller.inFlight[slug]
	if found {
		flight.participants++
	} else {
		select {
		case controller.upstreamSlots <- struct{}{}:
		default:
			controller.mu.Unlock()
			return ttgFetchError(
				http.StatusServiceUnavailable,
				"ttg_busy",
				"Импорт TTG временно перегружен",
			), true
		}
		flight = &ttgBestiaryFlight{done: make(chan struct{}), participants: 1}
		controller.inFlight[slug] = flight
	}
	controller.mu.Unlock()

	if !found {
		go controller.completeFlight(slug, flight)
	}
	select {
	case <-requestContext.Done():
		return ttgBestiaryFetchResult{}, false
	case <-flight.done:
		return flight.result, true
	}
}

func (controller *TTGBestiaryController) completeFlight(slug string, flight *ttgBestiaryFlight) {
	defer func() { <-controller.upstreamSlots }()
	// The shared request must not inherit the first browser's cancellation: later
	// waiters still own the same flight. Its independent lifetime remains bounded
	// by upstreamTimeout.
	upstreamContext := context.Background()
	cancel := func() {}
	if controller.upstreamTimeout > 0 {
		upstreamContext, cancel = context.WithTimeout(upstreamContext, controller.upstreamTimeout)
	}
	result := controller.fetch(upstreamContext, slug)
	cancel()

	controller.mu.Lock()
	if result.status == http.StatusOK {
		controller.storeCacheLocked(slug, result.body, controller.now())
	}
	flight.result = result
	delete(controller.inFlight, slug)
	close(flight.done)
	controller.mu.Unlock()
}

func (controller *TTGBestiaryController) fetch(ctx context.Context, slug string) ttgBestiaryFetchResult {
	request, err := http.NewRequestWithContext(
		ctx, http.MethodGet,
		strings.TrimRight(controller.upstreamOrigin, "/")+"/api/v2/bestiary/"+slug, nil,
	)
	if err != nil {
		return ttgFetchError(http.StatusInternalServerError, "ttg_internal_error", "Не удалось подготовить импорт TTG")
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "BagOfHolding/1.0")

	response, err := controller.client.Do(request)
	if err != nil {
		return ttgFetchError(http.StatusBadGateway, "ttg_upstream_unavailable", "TTG временно недоступен")
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return ttgFetchError(http.StatusNotFound, "ttg_not_found", "Существо не найдено в TTG")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ttgFetchError(http.StatusBadGateway, "ttg_upstream_error", "TTG вернул ошибку")
	}
	mediaType, _, mediaErr := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if mediaErr != nil || (mediaType != "application/json" && !strings.HasSuffix(mediaType, "+json")) {
		return ttgFetchError(http.StatusBadGateway, "ttg_schema_invalid", "TTG вернул данные неизвестного формата")
	}

	body, readErr := io.ReadAll(io.LimitReader(response.Body, ttgBestiaryMaxBodyBytes+1))
	if readErr != nil || len(body) > ttgBestiaryMaxBodyBytes {
		return ttgFetchError(http.StatusBadGateway, "ttg_schema_invalid", "TTG вернул слишком большой статблок")
	}
	var document ttgUpstreamDocument
	if err := json.Unmarshal(body, &document); err != nil {
		return ttgFetchError(http.StatusBadGateway, "ttg_schema_invalid", "TTG вернул данные неизвестного формата")
	}
	normalized, err := normalizeTTGDocument(slug, document)
	if err != nil {
		return ttgFetchError(http.StatusBadGateway, "ttg_schema_invalid", "TTG вернул неполный статблок")
	}
	encoded, err := json.Marshal(normalized)
	if err != nil {
		return ttgFetchError(http.StatusInternalServerError, "ttg_internal_error", "Не удалось подготовить импорт TTG")
	}
	return ttgBestiaryFetchResult{status: http.StatusOK, body: encoded}
}

func (controller *TTGBestiaryController) Get(c *gin.Context) {
	slug := strings.ToLower(strings.TrimSpace(c.Param("slug")))
	if !ttgBestiarySlugPattern.MatchString(slug) {
		ttgImportError(c, http.StatusBadRequest, "ttg_invalid_slug", "Некорректная ссылка на существо TTG")
		return
	}
	result, completed := controller.resolve(c.Request.Context(), slug)
	if !completed {
		return
	}
	if result.status != http.StatusOK {
		ttgImportError(c, result.status, result.code, result.message)
		return
	}
	c.Header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600")
	c.Data(http.StatusOK, "application/json; charset=utf-8", result.body)
}
