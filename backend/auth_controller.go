package main

import (
	"net/http"
	"net/mail"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
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

// UpdateProfile changes only ordinary, self-owned profile fields. Role and
// username are deliberately not accepted from the request body.
func (ac *AuthController) UpdateProfile(c *gin.Context) {
	userID, _ := GetCurrentUserID(c)
	var req struct {
		DisplayName string `json:"display_name"`
		Email       string `json:"email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные профиля"})
		return
	}
	name := strings.TrimSpace(req.DisplayName)
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if len([]rune(name)) < 1 || len([]rune(name)) > 100 || len(email) > 254 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "проверьте имя и адрес почты"})
		return
	}
	if email != "" {
		parsed, err := mail.ParseAddress(email)
		if err != nil || parsed.Address != email {
			c.JSON(http.StatusBadRequest, gin.H{"error": "неверный адрес почты"})
			return
		}
	}
	var duplicate int64
	if email != "" {
		if err := ac.authService.db.Model(&User{}).Where("lower(email) = ? AND id <> ?", email, userID).Count(&duplicate).Error; err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "не удалось проверить адрес почты"})
			return
		}
	}
	if duplicate > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "этот адрес уже занят"})
		return
	}
	if err := ac.authService.db.Model(&User{}).Where("id = ?", userID).Updates(map[string]any{"display_name": name, "email": email}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "не удалось сохранить профиль"})
		return
	}
	user, err := ac.authService.GetUserByID(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "не удалось загрузить профиль"})
		return
	}
	c.JSON(http.StatusOK, user)
}

func (ac *AuthController) ChangePassword(c *gin.Context) {
	userID, _ := GetCurrentUserID(c)
	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.CurrentPassword == "" || len(req.NewPassword) < 12 || len(req.NewPassword) > 128 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "укажите текущий пароль и новый пароль длиной от 12 до 128 символов"})
		return
	}
	var user User
	if err := ac.authService.db.Where("id = ?", userID).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не найден"})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.CurrentPassword)) != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "неверный текущий пароль"})
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "не удалось изменить пароль"})
		return
	}
	result := ac.authService.db.Model(&User{}).Where("id = ? AND password_hash = ?", userID, user.PasswordHash).Update("password_hash", string(hash))
	if result.Error != nil || result.RowsAffected != 1 {
		c.JSON(http.StatusConflict, gin.H{"error": "пароль изменился, повторите попытку"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "пароль изменён"})
}

// ElevateAdmin compares the submitted secret against a bcrypt hash available
// only to the backend process. No profile update or client claim can set it.
func (ac *AuthController) ElevateAdmin(c *gin.Context) {
	configuredHash := os.Getenv("ADMIN_ELEVATION_PASSWORD_HASH")
	if configuredHash == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "пароль администратора не настроен на сервере"})
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Password == "" || len(req.Password) > 256 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "введите пароль администратора"})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(configuredHash), []byte(req.Password)) != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "неверный пароль администратора"})
		return
	}
	userID, _ := GetCurrentUserID(c)
	result := ac.authService.db.Model(&User{}).Where("id = ?", userID).Update("is_admin", true)
	if result.Error != nil || result.RowsAffected != 1 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "не удалось обновить статус"})
		return
	}
	c.Set("is_admin", true)
	user, err := ac.authService.GetUserByID(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "не удалось загрузить профиль"})
		return
	}
	c.JSON(http.StatusOK, user)
}

// Logout - выход из системы (на клиенте просто удаляется токен)
func (ac *AuthController) Logout(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "успешный выход из системы"})
}
