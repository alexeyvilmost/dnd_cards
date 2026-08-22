package main

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

var (
	ErrJWTSecretNotConfigured         = errors.New("JWT_SECRET is required for strict authentication")
	ErrAuthenticatedUserInactive      = errors.New("authenticated user no longer exists")
	ErrAuthenticationStoreUnavailable = errors.New("authentication identity store is unavailable")
)

// JWTClaims - структура для JWT токена
type JWTClaims struct {
	UserID   uuid.UUID `json:"user_id"`
	Username string    `json:"username"`
	jwt.RegisteredClaims
}

// AuthService - сервис для работы с авторизацией
type AuthService struct {
	db                      *gorm.DB
	activeIdentityValidator func(uuid.UUID, string) error
	publicMu                sync.Mutex
	publicID                uuid.UUID
}

// NewAuthService - создание нового сервиса авторизации
func NewAuthService(db *gorm.DB) *AuthService {
	return &AuthService{db: db}
}

// ResolvePublicUser возвращает общего владельца анонимного прототипа. Успешный
// результат кэшируется, ошибка БД — нет, чтобы следующий запрос мог повторить
// попытку после кратковременного сбоя.
func (s *AuthService) ResolvePublicUser() (uuid.UUID, error) {
	s.publicMu.Lock()
	defer s.publicMu.Unlock()
	if s.publicID != uuid.Nil {
		return s.publicID, nil
	}

	var user User
	if err := s.db.Where("username = ?", "public").First(&user).Error; err == nil {
		s.publicID = user.ID
		return user.ID, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return uuid.Nil, err
	}

	user = User{
		Username:     "public",
		Email:        "public@local",
		PasswordHash: "disabled",
		DisplayName:  "Публичный",
	}
	if err := s.db.Create(&user).Error; err != nil {
		// Другая горутина/версия сервиса могла создать запись между SELECT и INSERT.
		if retryErr := s.db.Where("username = ?", "public").First(&user).Error; retryErr != nil {
			return uuid.Nil, err
		}
	}
	s.publicID = user.ID
	return user.ID, nil
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
	secretKey := os.Getenv("JWT_SECRET")
	if len(secretKey) < 32 || strings.TrimSpace(secretKey) == "" {
		return "", ErrJWTSecretNotConfigured
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
	return s.ValidateTokenStrict(tokenString)
}

// ValidateTokenStrict is the single validation contract for every presented
// credential. Anonymous access is represented only by an absent Authorization
// header; a supplied JWT never receives a weaker prototype parser.
func (s *AuthService) ValidateTokenStrict(tokenString string) (*JWTClaims, error) {
	// Use the exact configured bytes, as token issuance does. Trimming only for
	// the configuration check would otherwise make a secret with intentional
	// surrounding whitespace sign and verify with different keys.
	secretKey := os.Getenv("JWT_SECRET")
	if len(secretKey) < 32 || strings.TrimSpace(secretKey) == "" {
		return nil, ErrJWTSecretNotConfigured
	}
	token, err := jwt.ParseWithClaims(
		tokenString,
		&JWTClaims{},
		func(token *jwt.Token) (interface{}, error) {
			return []byte(secretKey), nil
		},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer("dnd-cards-backend"),
	)
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*JWTClaims)
	if !ok || !token.Valid || claims.UserID == uuid.Nil ||
		strings.TrimSpace(claims.Username) == "" || claims.Subject != claims.UserID.String() {
		return nil, errors.New("невалидный токен")
	}
	return claims, nil
}

// ValidateActiveIdentity binds a cryptographically valid JWT to the current
// user row. Deleting or renaming an account therefore revokes every previously
// issued token without rotating the global signing key for unrelated users.
func (s *AuthService) ValidateActiveIdentity(claims *JWTClaims) error {
	if claims == nil || claims.UserID == uuid.Nil || strings.TrimSpace(claims.Username) == "" {
		return ErrAuthenticatedUserInactive
	}
	if s.activeIdentityValidator != nil {
		return s.activeIdentityValidator(claims.UserID, claims.Username)
	}
	if s.db == nil {
		return ErrAuthenticationStoreUnavailable
	}

	var matches int64
	if err := s.db.Model(&User{}).
		Where("id = ? AND username = ?", claims.UserID, claims.Username).
		Count(&matches).Error; err != nil {
		return fmt.Errorf("%w: %v", ErrAuthenticationStoreUnavailable, err)
	}
	if matches != 1 {
		return ErrAuthenticatedUserInactive
	}
	return nil
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
