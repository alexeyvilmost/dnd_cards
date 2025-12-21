package main

import (
	"fmt"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	DBHost     string
	DBPort     string
	DBUser     string
	DBPassword string
	DBName     string
	DBSSLMode  string
}

func LoadConfig() *Config {
	// Проверяем наличие DATABASE_URL (Railway автоматически предоставляет эту переменную)
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL != "" {
		return parseDatabaseURL(databaseURL)
	}

	// Если DATABASE_URL нет, используем отдельные переменные окружения
	config := &Config{
		DBHost:     getEnv("DB_HOST", "localhost"),
		DBPort:     getEnv("DB_PORT", "5432"),
		DBUser:     getEnv("DB_USER", "postgres"),
		DBPassword: getEnv("DB_PASSWORD", "password"),
		DBName:     getEnv("DB_NAME", "dnd_cards"),
		DBSSLMode:  getEnv("DB_SSLMODE", "disable"),
	}

	return config
}

// parseDatabaseURL парсит DATABASE_URL в формате postgresql://user:password@host:port/database
func parseDatabaseURL(databaseURL string) *Config {
	// Заменяем postgresql:// на postgres:// для совместимости
	databaseURL = strings.Replace(databaseURL, "postgresql://", "postgres://", 1)

	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		// Если не удалось распарсить, возвращаем конфигурацию по умолчанию
		return &Config{
			DBHost:     "localhost",
			DBPort:     "5432",
			DBUser:     "postgres",
			DBPassword: "password",
			DBName:     "dnd_cards",
			DBSSLMode:  "disable",
		}
	}

	password, _ := parsedURL.User.Password()
	sslMode := "require"
	if parsedURL.Query().Get("sslmode") != "" {
		sslMode = parsedURL.Query().Get("sslmode")
	}

	// Извлекаем имя базы данных из пути
	dbName := strings.TrimPrefix(parsedURL.Path, "/")
	if dbName == "" {
		dbName = "postgres"
	}

	return &Config{
		DBHost:     parsedURL.Hostname(),
		DBPort:     parsedURL.Port(),
		DBUser:     parsedURL.User.Username(),
		DBPassword: password,
		DBName:     dbName,
		DBSSLMode:  sslMode,
	}
}

func (c *Config) GetDSN() string {
	// Если порт не указан, используем значение по умолчанию
	port := c.DBPort
	if port == "" {
		port = "5432"
	}
	return fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		c.DBHost, port, c.DBUser, c.DBPassword, c.DBName, c.DBSSLMode)
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
