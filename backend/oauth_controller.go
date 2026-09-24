package main

import (
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
)

type oauthController struct {
	auth   *AuthService
	config oauthConfig
	client *http.Client
}

func registerOAuthRoutes(api *gin.RouterGroup, auth *AuthService, limit gin.HandlerFunc) {
	ac := &oauthController{auth: auth, config: loadOAuthConfig(), client: oauthHTTPClient()}
	ac.routes(api, limit)
}

func (ac *oauthController) routes(api *gin.RouterGroup, limit gin.HandlerFunc) {
	oauth := api.Group("/auth/oauth")
	oauth.Use(func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Header("Pragma", "no-cache")
		c.Header("Referrer-Policy", "no-referrer")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Next()
	}, limit)
	oauth.GET("/providers", ac.providers)
	oauth.GET("/:provider/start", ac.start)
	oauth.GET("/:provider/callback", ac.callback)
	oauth.POST("/exchange", ac.exchange)
}

func (ac *oauthController) providers(c *gin.Context) {
	providers := make([]gin.H, 0, 2)
	for _, id := range []string{"google", "yandex"} {
		p := ac.config.Providers[id]
		reason := "unconfigured"
		enabled := p.Configured && ac.ready(c.Request.Context())
		if enabled {
			reason = ""
		} else if p.Configured {
			reason = "unavailable"
		}
		providers = append(providers, gin.H{"id": id, "name": p.Name, "enabled": enabled, "reason": reason})
	}
	c.JSON(http.StatusOK, gin.H{"providers": providers})
}

func (ac *oauthController) provider(c *gin.Context) (oauthProvider, bool) {
	p, ok := ac.config.Providers[c.Param("provider")]
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Неизвестный способ входа"})
		return p, false
	}
	if !p.Configured || !ac.ready(c.Request.Context()) {
		ac.fail(c, "unavailable")
		return p, false
	}
	return p, true
}

func (ac *oauthController) fail(c *gin.Context, code string) {
	if ac.config.FrontendOrigin == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Вход через провайдера пока не настроен"})
		return
	}
	c.Redirect(http.StatusSeeOther, ac.config.FrontendOrigin+"/login#oauth_error="+url.QueryEscape(code))
}

func (ac *oauthController) start(c *gin.Context) {
	p, ok := ac.provider(c)
	if !ok {
		return
	}
	path, ok := safeOAuthReturnPath(c.Query("return_to"))
	challenge := c.Query("challenge")
	if !ok || !oauthProofPattern.MatchString(challenge) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректные параметры входа"})
		return
	}
	state, err := oauthRandom()
	if err != nil {
		ac.fail(c, "failed")
		return
	}
	browser, err := oauthRandom()
	if err != nil {
		ac.fail(c, "failed")
		return
	}
	verifier, err := oauthRandom()
	if err != nil {
		ac.fail(c, "failed")
		return
	}
	flow := oauthFlow{StateHash: oauthHash(state), Provider: p.ID, BrowserHash: oauthHash(browser), Verifier: verifier, ClientChallenge: challenge, ReturnPath: path, ExpiresAt: time.Now().Add(10 * time.Minute)}
	if err := ac.saveFlow(c.Request.Context(), flow); err != nil {
		ac.fail(c, "failed")
		return
	}
	ac.setCookie(c, p, state, browser, 600)
	c.Redirect(http.StatusSeeOther, p.authorizationURL(state, verifier))
}

func oauthCookieName(p oauthProvider, state string) string {
	prefix := "oauth-state-"
	if u, _ := url.Parse(p.RedirectURI); u.Scheme == "https" {
		prefix = "__Host-oauth-state-"
	}
	return prefix + oauthHash(state)[:24]
}

func (ac *oauthController) setCookie(c *gin.Context, p oauthProvider, state, value string, maxAge int) {
	u, _ := url.Parse(p.RedirectURI)
	http.SetCookie(c.Writer, &http.Cookie{Name: oauthCookieName(p, state), Value: value, Path: "/", MaxAge: maxAge, HttpOnly: true, Secure: u.Scheme == "https", SameSite: http.SameSiteLaxMode})
}

func (ac *oauthController) callback(c *gin.Context) {
	p, ok := ac.provider(c)
	if !ok {
		return
	}
	q, err := url.ParseQuery(c.Request.URL.RawQuery)
	state := q.Get("state")
	if err != nil || len(q["state"]) != 1 || !oauthProofPattern.MatchString(state) {
		ac.fail(c, "expired")
		return
	}
	browser, err := c.Cookie(oauthCookieName(p, state))
	if err != nil || !oauthProofPattern.MatchString(browser) {
		ac.fail(c, "expired")
		return
	}
	flow, err := ac.consumeFlow(c.Request.Context(), p.ID, state, browser)
	ac.setCookie(c, p, state, "", -1)
	if err != nil {
		ac.fail(c, "expired")
		return
	}
	if q.Get("error") != "" {
		ac.fail(c, "denied")
		return
	}
	code := q.Get("code")
	if len(q["code"]) != 1 || code == "" || len(code) > 4096 {
		ac.fail(c, "failed")
		return
	}
	profile, err := p.profile(c.Request.Context(), ac.client, code, flow.Verifier)
	if err != nil {
		ac.fail(c, "failed")
		return
	}
	handoff, err := ac.createHandoff(c.Request.Context(), p.ID, profile, flow)
	if err != nil {
		ac.fail(c, "failed")
		return
	}
	c.Redirect(http.StatusSeeOther, ac.config.FrontendOrigin+"/login#oauth_code="+url.QueryEscape(handoff))
}

func (ac *oauthController) exchange(c *gin.Context) {
	if origin := c.GetHeader("Origin"); origin != "" && origin != ac.config.FrontendOrigin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Недопустимый источник запроса"})
		return
	}
	if !ac.ready(c.Request.Context()) {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Вход временно недоступен"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
	var req struct {
		Code     string `json:"code"`
		Verifier string `json:"verifier"`
	}
	if c.ShouldBindJSON(&req) != nil || !oauthProofPattern.MatchString(req.Code) || !oauthProofPattern.MatchString(req.Verifier) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Некорректные параметры входа"})
		return
	}
	response, err := ac.exchangeHandoff(c.Request.Context(), req.Code, req.Verifier)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Попытка входа истекла или уже использована. Начните вход снова."})
		return
	}
	c.JSON(http.StatusOK, response)
}
