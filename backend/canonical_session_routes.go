package main

import (
	"os"

	"github.com/gin-gonic/gin"
)

const canonicalTransportFeatureFlag = "ENABLE_UNVERIFIED_CANONICAL_TRANSPORT"

// canonicalTransportEnabled is deliberately strict: this transport persists
// client-computed state and is not a D&D semantic authority. Production must
// opt in explicitly while it remains a trusted-local shadow boundary.
func canonicalTransportEnabled() bool {
	return os.Getenv(canonicalTransportFeatureFlag) == "1"
}

// registerCanonicalSessionRoutes exposes only a bounded snapshot transport.
// It does not execute or validate D&D semantics: authority_mode=local and the
// response semanticAuthority marker make that trust boundary explicit.
func registerCanonicalSessionRoutes(
	api *gin.RouterGroup,
	authService *AuthService,
	controller *CanonicalSessionController,
) {
	routes := api.Group("/transport/canonical-sessions")
	routes.Use(StrictAuthMiddleware(authService))
	routes.GET("/:id", controller.GetCurrent)
	routes.POST(
		"/:id/transitions",
		JSONBodyLimitMiddleware(maxCanonicalTransitionBodyBytes),
		RequestBodyLimitMiddleware(maxCanonicalTransitionBodyBytes),
		controller.ApplyTransition,
	)
}
