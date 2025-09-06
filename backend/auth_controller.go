package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// AuthController - контроллер для авторизации
type AuthController struct {
	authService *AuthService
}

// NewAuthController - создание нового контроллера авторизации
func NewAuthController(authService *AuthService) *AuthController {
	return &AuthController{authService: authService}
}

// Register - регистрация нового пользователя
func (ac *AuthController) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные запроса: " + err.Error()})
		return
	}

	user, err := ac.authService.Register(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "пользователь успешно зарегистрирован",
		"user":    user,
	})
}

// Login - авторизация пользователя
func (ac *AuthController) Login(c *gin.Context) {
	var req AuthRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные запроса: " + err.Error()})
		return
	}

	response, err := ac.authService.Login(req)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, response)
}

// GetProfile - получение профиля текущего пользователя
func (ac *AuthController) GetProfile(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	user, err := ac.authService.GetUserByID(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "пользователь не найден"})
		return
	}

	c.JSON(http.StatusOK, user)
}

// Logout - выход из системы (на клиенте просто удаляется токен)
func (ac *AuthController) Logout(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "успешный выход из системы"})
}
