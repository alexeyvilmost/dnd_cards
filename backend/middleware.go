package main

import (
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// AuthMiddleware сохраняет продуктовый anonymous/public режим только когда
// Authorization отсутствует. Любой предъявленный Bearer обязан пройти строгую
// HS256/issuer/identity-проверку; истёкший или повреждённый JWT не может
// незаметно переключить пользователя на общий public account.
func AuthMiddleware(authService *AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := strings.TrimSpace(c.GetHeader("Authorization"))
		if authHeader == "" {
			publicID, err := authService.ResolvePublicUser()
			if err != nil {
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "не удалось определить публичного пользователя"})
				return
			}
			c.Set("user_id", publicID)
			c.Set("username", "public")
			c.Next()
			return
		}

		// Anonymous mode is selected only by an absent header. A malformed,
		// expired or rotated credential must never silently change identity to
		// the shared public user.
		claims, ok := requireStrictJWT(authService, c)
		if !ok {
			return
		}
		c.Set("user_id", claims.UserID)
		c.Set("username", claims.Username)
		c.Next()
	}
}

// StrictAuthMiddleware всегда требует валидный Bearer JWT и намеренно не
// поддерживает публичного пользователя.
func StrictAuthMiddleware(authService *AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, ok := requireStrictJWT(authService, c)
		if !ok {
			return
		}
		c.Set("user_id", claims.UserID)
		c.Set("username", claims.Username)
		c.Next()
	}
}

func requireStrictJWT(authService *AuthService, c *gin.Context) (*JWTClaims, bool) {
	authHeader := c.GetHeader("Authorization")
	tokenParts := strings.Split(authHeader, " ")
	if len(tokenParts) != 2 || tokenParts[0] != "Bearer" || strings.TrimSpace(tokenParts[1]) == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "токен авторизации не предоставлен или имеет неверный формат"})
		return nil, false
	}

	claims, err := authService.ValidateTokenStrict(tokenParts[1])
	if err != nil {
		if errors.Is(err, ErrJWTSecretNotConfigured) {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "строгая авторизация не настроена"})
			return nil, false
		}
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "невалидный токен авторизации"})
		return nil, false
	}
	if err := authService.ValidateActiveIdentity(claims); err != nil {
		if errors.Is(err, ErrAuthenticationStoreUnavailable) {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "проверка пользователя временно недоступна"})
			return nil, false
		}
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "пользователь токена больше не активен"})
		return nil, false
	}
	return claims, true
}

func parseContentAdminUserIDs(raw string) (map[uuid.UUID]struct{}, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, errors.New("CONTENT_ADMIN_USER_IDS is not configured")
	}
	allowed := make(map[uuid.UUID]struct{})
	for _, entry := range strings.Split(raw, ",") {
		trimmed := strings.TrimSpace(entry)
		if trimmed == "" {
			return nil, errors.New("CONTENT_ADMIN_USER_IDS contains an empty UUID")
		}
		userID, err := uuid.Parse(trimmed)
		if err != nil || userID == uuid.Nil {
			return nil, errors.New("CONTENT_ADMIN_USER_IDS contains an invalid UUID")
		}
		allowed[userID] = struct{}{}
	}
	if len(allowed) == 0 {
		return nil, errors.New("CONTENT_ADMIN_USER_IDS contains no UUIDs")
	}
	return allowed, nil
}

// ContentAdminAuthMiddleware is the short-term production authorization
// boundary for global catalog mutations. Authentication is still the strict
// HS256/issuer/identity contract; authorization is an immutable user UUID
// allowlist supplied only through server configuration.
func ContentAdminAuthMiddleware(authService *AuthService) gin.HandlerFunc {
	allowed, configErr := parseContentAdminUserIDs(os.Getenv("CONTENT_ADMIN_USER_IDS"))
	return func(c *gin.Context) {
		if configErr != nil {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "авторизация администраторов контента не настроена"})
			return
		}
		claims, ok := requireStrictJWT(authService, c)
		if !ok {
			return
		}
		if _, authorized := allowed[claims.UserID]; !authorized {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "нет прав администратора контента"})
			return
		}
		c.Set("user_id", claims.UserID)
		c.Set("username", claims.Username)
		c.Next()
	}
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
		authHeader := strings.TrimSpace(c.GetHeader("Authorization"))
		if authHeader == "" {
			c.Next()
			return
		}
		claims, ok := requireStrictJWT(authService, c)
		if !ok {
			return
		}
		c.Set("user_id", claims.UserID)
		c.Set("username", claims.Username)
		c.Next()
	}
}
