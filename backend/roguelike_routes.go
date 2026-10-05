package main

import "github.com/gin-gonic/gin"

func registerRoguelikeRoutes(api *gin.RouterGroup, authService *AuthService, controller *RoguelikeController) {
	routes := api.Group("/roguelike/runs")
	routes.Use(StrictAuthMiddleware(authService))
	routes.POST("", controller.Create)
	routes.GET("", controller.List)
	routes.GET("/modes", controller.Modes)
	routes.GET("/:id", controller.Get)
	routes.GET("/:id/initiative-options", controller.InitiativeOptions)
	routes.POST("/:id/commands", controller.Command)
}
