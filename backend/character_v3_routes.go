package main

import "github.com/gin-gonic/gin"

// registerCharacterV3Routes keeps the complete CharacterV3 surface behind one
// strict authentication boundary. Do not move individual routes to the
// prototype AuthMiddleware group: an absent JWT must never resolve to `public`.
func registerCharacterV3Routes(
	api *gin.RouterGroup,
	authService *AuthService,
	controller *CharacterV3Controller,
) {
	routes := api.Group("/characters-v3")
	routes.Use(StrictAuthMiddleware(authService))
	routes.POST("", controller.CreateCharacterV3)
	routes.GET("", controller.GetCharactersV3)
	routes.POST(
		"/runtime-commands",
		JSONBodyLimitMiddleware(maxCharacterRuntimeCommandBodyBytes),
		RequestBodyLimitMiddleware(maxCharacterRuntimeCommandBodyBytes),
		controller.PostCharacterRuntimeCommand,
	)
	routes.GET("/:id", controller.GetCharacterV3)
	routes.PUT("/:id", controller.UpdateCharacterV3)
	routes.DELETE("/:id", controller.DeleteCharacterV3)
	routes.GET("/:id/events", controller.GetCharacterEvents)
	routes.POST(
		"/:id/events",
		JSONBodyLimitMiddleware(maxCharacterEventBatchBodyBytes),
		RequestBodyLimitMiddleware(maxCharacterEventBatchBodyBytes),
		controller.PostCharacterEvents,
	)
	routes.PATCH("/:id/runtime", controller.PatchCharacterRuntime)
}
