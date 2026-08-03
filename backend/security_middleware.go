package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/gin-gonic/gin"
)

const requestIDContextKey = "request_id"

func validRequestID(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for _, char := range value {
		if !unicode.IsLetter(char) && !unicode.IsDigit(char) && char != '-' && char != '_' && char != '.' {
			return false
		}
	}
	return true
}

func newRequestID() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err == nil {
		return hex.EncodeToString(raw[:])
	}
	return strconv.FormatInt(time.Now().UnixNano(), 36)
}

// RequestIDMiddleware связывает ошибку фронта с одной строкой в логах. Входной ID
// принимается только в безопасном формате, чтобы не допустить подмену строк лога.
func RequestIDMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := strings.TrimSpace(c.GetHeader("X-Request-ID"))
		if !validRequestID(requestID) {
			requestID = newRequestID()
		}
		c.Set(requestIDContextKey, requestID)
		c.Header("X-Request-ID", requestID)
		c.Next()
	}
}

func SecurityHeadersMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Next()
	}
}

func hasRequestBody(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch:
		return true
	default:
		return false
	}
}

// JSONBodyLimitMiddleware ограничивает именно JSON, не затрагивая multipart-загрузки изображений.
// Тело читается не больше limit+1, поэтому chunked-запрос не обойдёт защиту.
func JSONBodyLimitMiddleware(limit int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !hasRequestBody(c.Request.Method) || c.Request.Body == nil ||
			!strings.HasPrefix(strings.ToLower(c.GetHeader("Content-Type")), "application/json") {
			c.Next()
			return
		}
		if c.Request.ContentLength > limit {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{"error": "JSON-запрос слишком большой"})
			return
		}
		body, err := io.ReadAll(io.LimitReader(c.Request.Body, limit+1))
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Не удалось прочитать JSON-запрос"})
			return
		}
		if int64(len(body)) > limit {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{"error": "JSON-запрос слишком большой"})
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
		c.Request.ContentLength = int64(len(body))
		c.Next()
	}
}

// RequestBodyLimitMiddleware ограничивает поток загрузки. Для запроса с известным Content-Length
// возвращает 413 до разбора multipart; chunked-тело прерывается MaxBytesReader.
func RequestBodyLimitMiddleware(limit int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body == nil {
			c.Next()
			return
		}
		if c.Request.ContentLength > limit {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{"error": "Тело запроса слишком большое"})
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
		c.Next()
	}
}

type rateWindow struct {
	started  time.Time
	lastSeen time.Time
	count    int
}

type FixedWindowRateLimiter struct {
	mu       sync.Mutex
	windows  map[string]rateWindow
	limit    int
	window   time.Duration
	now      func() time.Time
	requests uint64
}

func NewFixedWindowRateLimiter(limit int, window time.Duration) *FixedWindowRateLimiter {
	return &FixedWindowRateLimiter{
		windows: make(map[string]rateWindow),
		limit:   limit,
		window:  window,
		now:     time.Now,
	}
}

func (limiter *FixedWindowRateLimiter) allow(key string) (bool, time.Duration) {
	now := limiter.now()
	limiter.mu.Lock()
	defer limiter.mu.Unlock()

	limiter.requests++
	if limiter.requests%256 == 0 {
		for candidate, state := range limiter.windows {
			if now.Sub(state.lastSeen) > 2*limiter.window {
				delete(limiter.windows, candidate)
			}
		}
	}

	state := limiter.windows[key]
	if state.started.IsZero() || now.Sub(state.started) >= limiter.window {
		limiter.windows[key] = rateWindow{started: now, lastSeen: now, count: 1}
		return true, 0
	}
	state.lastSeen = now
	if state.count >= limiter.limit {
		limiter.windows[key] = state
		return false, limiter.window - now.Sub(state.started)
	}
	state.count++
	limiter.windows[key] = state
	return true, 0
}

func (limiter *FixedWindowRateLimiter) Handler() gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.ClientIP() + ":" + c.FullPath()
		allowed, retryAfter := limiter.allow(key)
		if !allowed {
			seconds := int(retryAfter.Round(time.Second) / time.Second)
			if seconds < 1 {
				seconds = 1
			}
			c.Header("Retry-After", strconv.Itoa(seconds))
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "Слишком много запросов, повторите позже"})
			return
		}
		c.Next()
	}
}

func (limiter *FixedWindowRateLimiter) MutationsOnly() gin.HandlerFunc {
	handler := limiter.Handler()
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			c.Next()
		default:
			handler(c)
		}
	}
}

func MutationAuditMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			c.Next()
			return
		}

		started := time.Now()
		c.Next()
		requestID, _ := c.Get(requestIDContextKey)
		username, _ := c.Get("username")
		log.Printf(
			"audit mutation request_id=%q method=%s path=%q status=%d latency_ms=%d client_ip=%q username=%q",
			requestID,
			c.Request.Method,
			c.FullPath(),
			c.Writer.Status(),
			time.Since(started).Milliseconds(),
			c.ClientIP(),
			username,
		)
	}
}
