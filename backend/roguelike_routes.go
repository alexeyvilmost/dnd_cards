package main

import "github.com/gin-gonic/gin"

func registerRoguelikeRoutes(api *gin.RouterGroup, authService *AuthService, controller *RoguelikeController) {
	routes := api.Group("/roguelike/runs")
	routes.Use(StrictAuthMiddleware(authService))
	routes.POST("", controller.Create)
	routes.GET("", controller.List)
	routes.GET("/:id", controller.Get)
	routes.POST("/:id/commands", controller.Command)
}
