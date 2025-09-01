package main

import (
	"log"
	"os"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	// Загрузка переменных окружения
	if err := godotenv.Load(); err != nil {
		log.Println("Файл .env не найден, используем переменные окружения")
	}

	// Загрузка конфигурации
	dbConfig := LoadConfig()
	log.Printf("Подключение к БД: %s:%s/%s", dbConfig.DBHost, dbConfig.DBPort, dbConfig.DBName)

	// Подключение к базе данных
	db, err := gorm.Open(postgres.Open(dbConfig.GetDSN()), &gorm.Config{
		DisableAutomaticPing: true,
		PrepareStmt:          false,
	})
	if err != nil {
		log.Fatal("Ошибка подключения к базе данных:", err)
	}

	// Автомиграция моделей (отключена, так как таблицы созданы в Supabase)
	// if err := db.AutoMigrate(&Card{}); err != nil {
	// 	log.Fatal("Ошибка миграции:", err)
	// }

	// Настройка Gin
	r := gin.Default()

	// CORS настройки
	config := cors.DefaultConfig()
	config.AllowOrigins = []string{"http://localhost:3000", "http://localhost:5173"}
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(config))

	// Инициализация контроллеров
	cardController := NewCardController(db)

	// Маршруты API
	api := r.Group("/api")
	{
		api.GET("/cards", cardController.GetCards)
		api.GET("/cards/:id", cardController.GetCard)
		api.POST("/cards", cardController.CreateCard)
		api.PUT("/cards/:id", cardController.UpdateCard)
		api.DELETE("/cards/:id", cardController.DeleteCard)
		api.POST("/cards/generate-image", cardController.GenerateImage)
		api.POST("/cards/export", cardController.ExportCards)

		// Шаблоны оружия
		api.GET("/weapon-templates", cardController.GetWeaponTemplates)
		api.GET("/weapon-templates/:id", cardController.GetWeaponTemplate)
	}

	// Запуск сервера
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Сервер запущен на порту %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatal("Ошибка запуска сервера:", err)
	}
}
