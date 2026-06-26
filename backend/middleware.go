package main

import (
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// AuthMiddleware - middleware для проверки JWT токена.
//
// ВНИМАНИЕ: авторизация временно отключена по запросу — сайт должен работать
// без токенов/логинов. Сейчас middleware не блокирует запросы: если токен есть
// и валиден, пользователь кладётся в контекст, иначе запрос просто пропускается
// (поведение как у OptionalAuthMiddleware). Чтобы вернуть строгую проверку —
// раскомментируйте блок ниже и удалите вызов optionalAuth.
func AuthMiddleware(authService *AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		// --- Авторизация временно отключена ---
		optionalAuth(authService, c)
		c.Next()

		/* СТРОГАЯ ПРОВЕРКА (временно отключена):
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "токен авторизации не предоставлен"})
			c.Abort()
			return
		}
		tokenParts := strings.Split(authHeader, " ")
		if len(tokenParts) != 2 || tokenParts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "неверный формат токена авторизации"})
			c.Abort()
			return
		}
		claims, err := authService.ValidateToken(tokenParts[1])
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "невалидный токен авторизации"})
			c.Abort()
			return
		}
		c.Set("user_id", claims.UserID)
		c.Set("username", claims.Username)
		c.Next()
		*/
	}
}

// optionalAuth кладёт пользователя в контекст, если есть валидный токен,
// и ничего не делает в противном случае (не блокирует запрос).
func optionalAuth(authService *AuthService, c *gin.Context) {
	authHeader := c.GetHeader("Authorization")
	if authHeader == "" {
		return
	}
	tokenParts := strings.Split(authHeader, " ")
	if len(tokenParts) != 2 || tokenParts[0] != "Bearer" {
		return
	}
	claims, err := authService.ValidateToken(tokenParts[1])
	if err != nil {
		return
	}
	c.Set("user_id", claims.UserID)
	c.Set("username", claims.Username)
}

// GetCurrentUserID - получение ID текущего пользователя из контекста
func GetCurrentUserID(c *gin.Context) (uuid.UUID, error) {
	userID, exists := c.Get("user_id")
	if !exists {
		return uuid.Nil, errors.New("пользователь не авторизован")
	}

	userIDUUID, ok := userID.(uuid.UUID)
	if !ok {
		return uuid.Nil, errors.New("неверный тип user_id")
	}

	return userIDUUID, nil
}

// GetCurrentUsername - получение username текущего пользователя из контекста
func GetCurrentUsername(c *gin.Context) (string, error) {
	username, exists := c.Get("username")
	if !exists {
		return "", errors.New("пользователь не авторизован")
	}

	usernameStr, ok := username.(string)
	if !ok {
		return "", errors.New("неверный тип username")
	}

	return usernameStr, nil
}

// OptionalAuthMiddleware - middleware для опциональной авторизации
func OptionalAuthMiddleware(authService *AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Получаем токен из заголовка Authorization
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.Next()
			return
		}

		// Проверяем формат заголовка (Bearer <token>)
		tokenParts := strings.Split(authHeader, " ")
		if len(tokenParts) != 2 || tokenParts[0] != "Bearer" {
			c.Next()
			return
		}

		tokenString := tokenParts[1]

		// Валидируем токен
		claims, err := authService.ValidateToken(tokenString)
		if err != nil {
			c.Next()
			return
		}

		// Сохраняем информацию о пользователе в контексте
		c.Set("user_id", claims.UserID)
		c.Set("username", claims.Username)

		c.Next()
	}
}
