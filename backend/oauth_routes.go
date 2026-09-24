package main

import (
	"strings"

	"github.com/gin-gonic/gin"
)

// Gin's default access logger captures RawQuery before route middleware runs.
// Exclude OAuth paths at router construction so authorization codes/state never
// enter those logs. Other routes retain Gin's default logging and recovery;
// the existing mutation audit still records exchange status without its body.
func newOAuthSafeRouter() *gin.Engine {
	r := gin.New()
	r.Use(gin.LoggerWithConfig(gin.LoggerConfig{Skip: func(c *gin.Context) bool {
		return strings.HasPrefix(c.Request.URL.Path, oauthPath+"/")
	}}), gin.Recovery())
	return r
}
