package main

import (
	"log"
	"os"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"dnd-cards-backend/migrations"
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

	// Получаем *sql.DB для миграций
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatal("Ошибка получения sql.DB:", err)
	}

	// Запускаем миграции
	migrator := migrations.NewMigrator(sqlDB)
	if err := migrator.Run(); err != nil {
		log.Fatal("Ошибка выполнения миграций:", err)
	}
	log.Println("Миграции выполнены успешно")

	// Настройка Gin
	r := gin.Default()

	// CORS настройки
	config := cors.DefaultConfig()
	config.AllowOrigins = []string{
		"http://localhost:3000",
		"http://localhost:5173",
		"https://*.vercel.app",
		"https://*.railway.app",
		"https://*.netlify.app",
		"https://*.render.com",
		"https://*.digitalocean.app",
	}
	config.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(config))

	// Инициализация сервисов и контроллеров
	cardController := NewCardController(db)
	authService := NewAuthService(db)
	authController := NewAuthController(authService)
	groupController := NewGroupController(db)
	inventoryController := NewInventoryController(db)
	characterController := NewCharacterController(db)
	imageLibraryController := NewImageLibraryController(db)

	// Инициализация сервисов для работы с изображениями
	yandexStorage, err := NewYandexStorageService()
	if err != nil {
		log.Printf("Предупреждение: Yandex Storage недоступен: %v", err)
		yandexStorage = nil
	}

	openAIService := NewOpenAIService()
	imageController := NewImageController(db, yandexStorage, openAIService)

	// Маршруты API
	api := r.Group("/api")
	{
		// Публичные маршруты (без авторизации)
		api.POST("/auth/register", authController.Register)
		api.POST("/auth/login", authController.Login)

		// Карточки (публичные, но с опциональной авторизацией)
		api.GET("/cards", OptionalAuthMiddleware(authService), cardController.GetCards)
		api.GET("/cards/:id", OptionalAuthMiddleware(authService), cardController.GetCard)
		api.POST("/cards", AuthMiddleware(authService), cardController.CreateCard)
		api.PUT("/cards/:id", AuthMiddleware(authService), cardController.UpdateCard)
		api.DELETE("/cards/:id", AuthMiddleware(authService), cardController.DeleteCard)
		api.POST("/cards/generate-image", AuthMiddleware(authService), cardController.GenerateImage)
		api.POST("/cards/export", AuthMiddleware(authService), cardController.ExportCards)

		// Защищенные маршруты (требуют авторизации)
		protected := api.Group("/")
		protected.Use(AuthMiddleware(authService))
		{
			// Авторизация
			protected.GET("/auth/profile", authController.GetProfile)
			protected.POST("/auth/logout", authController.Logout)

			// Группы
			protected.POST("/groups", groupController.CreateGroup)
			protected.GET("/groups", groupController.GetGroups)
			protected.GET("/groups/:id", groupController.GetGroup)
			protected.POST("/groups/join", groupController.JoinGroup)
			protected.DELETE("/groups/:id/leave", groupController.LeaveGroup)
			protected.GET("/groups/:id/members", groupController.GetGroupMembers)

			// Инвентарь
			protected.POST("/inventories", inventoryController.CreateInventory)
			protected.GET("/inventories", inventoryController.GetInventories)
			protected.GET("/inventories/:id", inventoryController.GetInventory)
			protected.POST("/inventories/:id/items", inventoryController.AddItemToInventory)
			protected.PUT("/inventories/:id/items/:itemId", inventoryController.UpdateInventoryItem)
			protected.DELETE("/inventories/:id/items/:itemId", inventoryController.RemoveItemFromInventory)

			// Персонажи
			protected.POST("/characters", characterController.CreateCharacter)
			protected.GET("/characters", characterController.GetCharacters)
			protected.GET("/characters/:id/inventories", inventoryController.GetCharacterInventories)
			protected.GET("/characters/:id", characterController.GetCharacter)
			protected.PUT("/characters/:id", characterController.UpdateCharacter)
			protected.DELETE("/characters/:id", characterController.DeleteCharacter)
			protected.POST("/characters/import", characterController.ImportCharacter)
			protected.GET("/characters/:id/export", characterController.ExportCharacter)

			// Изображения
			protected.POST("/images/upload", imageController.UploadImage)
			protected.POST("/images/generate", imageController.GenerateImage)
			protected.DELETE("/images/:entity_type/:entity_id", imageController.DeleteImage)
			protected.POST("/images/setup-cors", imageController.SetupCORS)
			protected.GET("/images/status", imageController.GetStatus)

			// Библиотека изображений
			protected.GET("/image-library", imageLibraryController.GetImageLibrary)
			protected.POST("/image-library", imageLibraryController.AddToLibrary)
			protected.PUT("/image-library/:id", imageLibraryController.UpdateImageLibrary)
			protected.DELETE("/image-library/:id", imageLibraryController.DeleteFromLibrary)
			protected.GET("/image-library/rarities", imageLibraryController.GetRarities)
		}
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
