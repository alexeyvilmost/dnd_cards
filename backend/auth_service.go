package main

import (
	"errors"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// JWTClaims - структура для JWT токена
type JWTClaims struct {
	UserID   uuid.UUID `json:"user_id"`
	Username string    `json:"username"`
	jwt.RegisteredClaims
}

// AuthService - сервис для работы с авторизацией
type AuthService struct {
	db *gorm.DB
}

// NewAuthService - создание нового сервиса авторизации
func NewAuthService(db *gorm.DB) *AuthService {
	return &AuthService{db: db}
}

// Register - регистрация нового пользователя
func (s *AuthService) Register(req RegisterRequest) (*User, error) {
	// Проверяем, существует ли пользователь с таким username
	var existingUser User
	if err := s.db.Where("username = ?", req.Username).First(&existingUser).Error; err == nil {
		return nil, errors.New("пользователь с таким именем уже существует")
	}

	// Проверяем, существует ли пользователь с таким email
	if err := s.db.Where("email = ?", req.Email).First(&existingUser).Error; err == nil {
		return nil, errors.New("пользователь с таким email уже существует")
	}

	// Хешируем пароль
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, errors.New("ошибка хеширования пароля")
	}

	// Создаем пользователя
	user := User{
		Username:     req.Username,
		Email:        req.Email,
		PasswordHash: string(hashedPassword),
		DisplayName:  req.DisplayName,
	}

	if err := s.db.Create(&user).Error; err != nil {
		return nil, errors.New("ошибка создания пользователя")
	}

	// Не возвращаем хеш пароля
	user.PasswordHash = ""
	return &user, nil
}

// Login - авторизация пользователя
func (s *AuthService) Login(req AuthRequest) (*AuthResponse, error) {
	// Находим пользователя по username
	var user User
	if err := s.db.Where("username = ?", req.Username).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("неверное имя пользователя или пароль")
		}
		return nil, errors.New("ошибка поиска пользователя")
	}

	// Проверяем пароль
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return nil, errors.New("неверное имя пользователя или пароль")
	}

	// Генерируем JWT токен
	token, err := s.generateJWTToken(user)
	if err != nil {
		return nil, errors.New("ошибка генерации токена")
	}

	// Не возвращаем хеш пароля
	user.PasswordHash = ""

	return &AuthResponse{
		Token: token,
		User:  user,
	}, nil
}

// generateJWTToken - генерация JWT токена
func (s *AuthService) generateJWTToken(user User) (string, error) {
	// Получаем секретный ключ из переменных окружения
	secretKey := os.Getenv("JWT_SECRET")
	if secretKey == "" {
		secretKey = "default-secret-key" // В продакшене обязательно должен быть установлен
	}

	// Создаем claims
	claims := JWTClaims{
		UserID:   user.ID,
		Username: user.Username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)), // Токен действует 24 часа
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Issuer:    "dnd-cards-backend",
			Subject:   user.ID.String(),
		},
	}

	// Создаем токен
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secretKey))
}

// ValidateToken - валидация JWT токена
func (s *AuthService) ValidateToken(tokenString string) (*JWTClaims, error) {
	// Получаем секретный ключ
	secretKey := os.Getenv("JWT_SECRET")
	if secretKey == "" {
		secretKey = "default-secret-key"
	}

	// Парсим токен
	token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(secretKey), nil
	})

	if err != nil {
		return nil, err
	}

	// Проверяем валидность токена
	if claims, ok := token.Claims.(*JWTClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, errors.New("невалидный токен")
}

// GetUserByID - получение пользователя по ID
func (s *AuthService) GetUserByID(userID uuid.UUID) (*User, error) {
	var user User
	if err := s.db.First(&user, userID).Error; err != nil {
		return nil, err
	}

	// Не возвращаем хеш пароля
	user.PasswordHash = ""
	return &user, nil
}

// GetUserByUsername - получение пользователя по username
func (s *AuthService) GetUserByUsername(username string) (*User, error) {
	var user User
	if err := s.db.Where("username = ?", username).First(&user).Error; err != nil {
		return nil, err
	}

	// Не возвращаем хеш пароля
	user.PasswordHash = ""
	return &user, nil
}
