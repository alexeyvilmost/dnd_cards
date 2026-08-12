package main

import (
	"os"

	"github.com/gin-gonic/gin"
)

const canonicalTransportFeatureFlag = "ENABLE_UNVERIFIED_CANONICAL_TRANSPORT"
const canonicalServerRulesFeatureFlag = "ENABLE_SERVER_RULES_AUTHORITY"

// canonicalTransportEnabled is deliberately strict: this transport persists
// client-computed state and is not a D&D semantic authority. Production must
// opt in explicitly while it remains a trusted-local shadow boundary.
func canonicalTransportEnabled() bool {
	return os.Getenv(canonicalTransportFeatureFlag) == "1"
}

func canonicalServerRulesEnabled() bool {
	return os.Getenv(canonicalServerRulesFeatureFlag) == "1"
}

// registerCanonicalSessionRoutes exposes only a bounded snapshot transport.
// It does not execute or validate D&D semantics: authority_mode=local and the
// response semanticAuthority marker make that trust boundary explicit.
func registerCanonicalSessionRoutes(
	api *gin.RouterGroup,
	authService *AuthService,
	controller *CanonicalSessionController,
) {
	if canonicalTransportEnabled() {
		transport := api.Group("/transport/canonical-sessions")
		transport.Use(StrictAuthMiddleware(authService))
		transport.GET("/:id", controller.GetCurrent)
		transport.POST(
			"/:id/transitions",
			JSONBodyLimitMiddleware(maxCanonicalTransitionBodyBytes),
			RequestBodyLimitMiddleware(maxCanonicalTransitionBodyBytes),
			controller.ApplyTransition,
		)
	}
	if canonicalServerRulesEnabled() {
		rules := api.Group("/rules/canonical-sessions")
		rules.Use(StrictAuthMiddleware(authService))
		rules.POST(
			"",
			JSONBodyLimitMiddleware(maxCanonicalSessionCreateBodyBytes),
			RequestBodyLimitMiddleware(maxCanonicalSessionCreateBodyBytes),
			controller.CreateServerSession,
		)
		rules.POST("/:id/close", controller.CloseServerSession)
		rules.GET("/:id", controller.GetCurrent)
		rules.POST(
			"/:id/commands",
			JSONBodyLimitMiddleware(maxCanonicalRulesCommandBodyBytes),
			RequestBodyLimitMiddleware(maxCanonicalRulesCommandBodyBytes),
			controller.ApplyRulesCommand,
		)
	}
}
