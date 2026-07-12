package main

import (
	"log"
	"os"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-contrib/gzip"
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

	// gzip ответов (списки справочников после B1 сжимаются на ~85%).
	// SSE-потоки боёв (/stream) исключаем — gzip буферизирует и ломает realtime.
	r.Use(gzip.Gzip(gzip.DefaultCompression, gzip.WithExcludedPathsRegexs([]string{`.*/stream$`})))

	// CORS настройки
	config := cors.DefaultConfig()
	config.AllowOrigins = []string{
		"http://localhost:3000",
		"http://localhost:5173",
		"https://frontend-production-550b.up.railway.app", // Ваш конкретный frontend URL
		"https://bagofholding.up.railway.app",             // Домен на Railway
		"https://*.vercel.app",
		"https://*.netlify.app",
		"https://*.render.com",
		"https://*.digitalocean.app",
	}
	config.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	config.AllowCredentials = true
	r.Use(cors.New(config))

	// Инициализация сервисов для работы с изображениями
	yandexStorage, err := NewYandexStorageService()
	if err != nil {
		log.Printf("Предупреждение: Yandex Storage недоступен: %v", err)
		yandexStorage = nil
	}

	openAIService := NewOpenAIService()
	imageController := NewImageController(db, yandexStorage, openAIService)

	// Инициализация сервисов и контроллеров
	cardController := NewCardController(db)
	authService := NewAuthService(db)
	authController := NewAuthController(authService)
	groupController := NewGroupController(db)
	inventoryController := NewInventoryController(db)
	characterController := NewCharacterController(db)
	characterV2Controller := NewCharacterV2Controller(db)
	characterV3Controller := NewCharacterV3Controller(db)
	imageLibraryController := NewImageLibraryController(db)
	shopController := NewShopController(db)
	actionController := NewActionController(db)
	effectController := NewEffectController(db)
	spellController := NewSpellController(db)
	featController := NewFeatController(db)
	backgroundController := NewBackgroundController(db)
	raceController := NewRaceController(db)
	classController := NewClassController(db)
	resourceController := NewResourceController(db)
	variableController := NewVariableController(db)
	conceptController := NewConceptController(db)

	// Онлайн-бои: серверная истина + realtime-рассылка (SSE + Postgres LISTEN/NOTIFY).
	encounterHub := NewEncounterHub(dbConfig.GetDSN())
	encounterHub.StartListener(db)
	encounterController := NewEncounterController(db, encounterHub)

	// Health check endpoint
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":    "ok",
			"timestamp": time.Now().Unix(),
			"version":   "fixed-v3", // Обновляем версию для принудительного пересборки
		})
	})

	// Debug endpoint
	r.GET("/api/debug", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":          "ok",
			"timestamp":       time.Now().Unix(),
			"auth_controller": authController != nil,
			"auth_service":    authService != nil,
		})
	})

	// Test auth endpoint
	r.GET("/api/test-auth", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"message":        "Auth endpoint test",
			"auth_available": authController != nil,
		})
	})

	// Маршруты API
	api := r.Group("/api")
	{
		// Тестовый endpoint в группе API
		api.GET("/test", func(c *gin.Context) {
			c.JSON(200, gin.H{"message": "API group works", "auth_controller": authController != nil})
		})

		// Тест auth endpoints
		api.GET("/auth/test", func(c *gin.Context) {
			c.JSON(200, gin.H{"message": "Auth endpoints work", "controller": authController != nil})
		})

		// Публичные маршруты (без авторизации)
		api.POST("/auth/register", authController.Register)
		api.POST("/auth/login", authController.Login)

		// Магазины (публичные ссылки на просмотр, создание за авторизацией)
		api.GET("/shops/:slug", shopController.GetShop)

		// Карточки (публичные, но с опциональной авторизацией)
		api.GET("/cards", OptionalAuthMiddleware(authService), cardController.GetCards)
		api.GET("/cards/:id", OptionalAuthMiddleware(authService), cardController.GetCard)
		api.GET("/cards/:id/battle-stats", OptionalAuthMiddleware(authService), cardController.GetCardBattleStats)
		api.POST("/cards/battle-stats", OptionalAuthMiddleware(authService), cardController.GetBatchCardBattleStats)
		api.POST("/cards", AuthMiddleware(authService), cardController.CreateCard)
		api.PUT("/cards/:id", AuthMiddleware(authService), cardController.UpdateCard)
		api.DELETE("/cards/:id", AuthMiddleware(authService), cardController.DeleteCard)
		api.POST("/cards/generate-image", AuthMiddleware(authService), cardController.GenerateImage)
		api.POST("/cards/export", AuthMiddleware(authService), cardController.ExportCards)

		// Действия (публичные, но с опциональной авторизацией)
		api.GET("/actions", OptionalAuthMiddleware(authService), actionController.GetActions)
		api.GET("/actions/:id", OptionalAuthMiddleware(authService), actionController.GetAction)
		api.POST("/actions", AuthMiddleware(authService), actionController.CreateAction)
		// PUT публичный (как у заклинаний): контент глобальный, нужен для смены изображения из детального окна.
		api.PUT("/actions/:id", OptionalAuthMiddleware(authService), actionController.UpdateAction)
		api.DELETE("/actions/:id", AuthMiddleware(authService), actionController.DeleteAction)

		// Эффекты (публичные, но с опциональной авторизацией)
		api.GET("/effects", OptionalAuthMiddleware(authService), effectController.GetEffects)
		api.GET("/effects/:id", OptionalAuthMiddleware(authService), effectController.GetEffect)
		api.POST("/effects", AuthMiddleware(authService), effectController.CreateEffect)
		// PUT публичный (как у заклинаний): нужен для смены изображения из детального окна.
		api.PUT("/effects/:id", OptionalAuthMiddleware(authService), effectController.UpdateEffect)
		api.DELETE("/effects/:id", AuthMiddleware(authService), effectController.DeleteEffect)

		// Заклинания (публичные, но с опциональной авторизацией)
		api.GET("/spells", OptionalAuthMiddleware(authService), spellController.GetSpells)
		api.GET("/spells/:id", OptionalAuthMiddleware(authService), spellController.GetSpell)
		api.POST("/spells", AuthMiddleware(authService), spellController.CreateSpell)
		// PUT публичный (как у понятий): контент заклинаний глобальный, без владельца;
		// нужен для конструктора без авторизации и массового обогащения описаний.
		api.PUT("/spells/:id", OptionalAuthMiddleware(authService), spellController.UpdateSpell)
		api.DELETE("/spells/:id", AuthMiddleware(authService), spellController.DeleteSpell)

		// Standalone-генерация изображений (вкладка «Генерация изображений»)
		api.POST("/images/generate-standalone", OptionalAuthMiddleware(authService), imageController.GenerateStandaloneImage)
		// Загрузка готового data-URL (base64) в Yandex Storage — для миграции base64→S3.
		api.POST("/images/upload-base64", OptionalAuthMiddleware(authService), imageController.UploadBase64Image)

		// AI-генерация механики по описанию (кнопка «AI» в редакторах)
		aiMechanicsController := NewAIMechanicsController()
		api.POST("/ai/mechanics", OptionalAuthMiddleware(authService), aiMechanicsController.GenerateMechanics)

		// Черты (публичные, но с опциональной авторизацией)
		api.GET("/feats", OptionalAuthMiddleware(authService), featController.GetFeats)
		api.GET("/feats/:id", OptionalAuthMiddleware(authService), featController.GetFeat)
		api.POST("/feats", AuthMiddleware(authService), featController.CreateFeat)
		// PUT публичный (как у заклинаний): нужен для смены изображения из детального окна.
		api.PUT("/feats/:id", OptionalAuthMiddleware(authService), featController.UpdateFeat)
		api.DELETE("/feats/:id", AuthMiddleware(authService), featController.DeleteFeat)

		// Предыстории (публичные, но с опциональной авторизацией)
		api.GET("/backgrounds", OptionalAuthMiddleware(authService), backgroundController.GetBackgrounds)
		api.GET("/backgrounds/:id", OptionalAuthMiddleware(authService), backgroundController.GetBackground)
		api.POST("/backgrounds", AuthMiddleware(authService), backgroundController.CreateBackground)
		api.PUT("/backgrounds/:id", AuthMiddleware(authService), backgroundController.UpdateBackground)
		api.DELETE("/backgrounds/:id", AuthMiddleware(authService), backgroundController.DeleteBackground)

		// Виды (расы)
		api.GET("/races", OptionalAuthMiddleware(authService), raceController.GetRaces)
		api.GET("/races/:id", OptionalAuthMiddleware(authService), raceController.GetRace)
		api.POST("/races", AuthMiddleware(authService), raceController.CreateRace)
		api.PUT("/races/:id", AuthMiddleware(authService), raceController.UpdateRace)
		api.DELETE("/races/:id", AuthMiddleware(authService), raceController.DeleteRace)

		// Классы
		api.GET("/classes", OptionalAuthMiddleware(authService), classController.GetClasses)
		api.GET("/classes/:id", OptionalAuthMiddleware(authService), classController.GetClass)
		api.POST("/classes", AuthMiddleware(authService), classController.CreateClass)
		api.PUT("/classes/:id", AuthMiddleware(authService), classController.UpdateClass)
		api.DELETE("/classes/:id", AuthMiddleware(authService), classController.DeleteClass)

		// Ресурсы действий/персонажа
		api.GET("/resources", OptionalAuthMiddleware(authService), resourceController.GetResources)
		api.GET("/resources/:id", OptionalAuthMiddleware(authService), resourceController.GetResource)
		api.POST("/resources", AuthMiddleware(authService), resourceController.CreateResource)
		api.PUT("/resources/:id", AuthMiddleware(authService), resourceController.UpdateResource)
		api.DELETE("/resources/:id", AuthMiddleware(authService), resourceController.DeleteResource)

		// Переменные (числовые/dice), выдаваемые классами/эффектами
		api.GET("/variables", OptionalAuthMiddleware(authService), variableController.GetVariables)
		api.GET("/variables/:id", OptionalAuthMiddleware(authService), variableController.GetVariable)
		api.POST("/variables", AuthMiddleware(authService), variableController.CreateVariable)
		api.PUT("/variables/:id", AuthMiddleware(authService), variableController.UpdateVariable)
		api.DELETE("/variables/:id", AuthMiddleware(authService), variableController.DeleteVariable)

		// Онлайн-бои (encounters): серверная истина боя + SSE-поток изменений всем клиентам.
		// OptionalAuth: SSE из браузерного EventSource не шлёт заголовок Authorization.
		api.POST("/encounters", OptionalAuthMiddleware(authService), encounterController.Create)
		api.GET("/encounters", OptionalAuthMiddleware(authService), encounterController.List)
		api.GET("/encounters/:id", OptionalAuthMiddleware(authService), encounterController.Get)
		api.GET("/encounters/:id/events", OptionalAuthMiddleware(authService), encounterController.Events)
		api.POST("/encounters/:id/join", OptionalAuthMiddleware(authService), encounterController.Join)
		api.POST("/encounters/:id/apply", OptionalAuthMiddleware(authService), encounterController.Apply)
		api.GET("/encounters/:id/stream", encounterController.Stream) // SSE, без middleware-обёрток

		// Понятия (глоссарий): пояснения, не выражаемые отдельной сущностью.
		// Общий справочник без авторизации (создание/правка/удаление доступны всем).
		api.GET("/concepts", OptionalAuthMiddleware(authService), conceptController.GetConcepts)
		api.GET("/concepts/:id", OptionalAuthMiddleware(authService), conceptController.GetConcept)
		api.POST("/concepts", OptionalAuthMiddleware(authService), conceptController.CreateConcept)
		api.PUT("/concepts/:id", OptionalAuthMiddleware(authService), conceptController.UpdateConcept)
		api.DELETE("/concepts/:id", OptionalAuthMiddleware(authService), conceptController.DeleteConcept)

		// Защищенные маршруты (требуют авторизации)
		protected := api.Group("/")
		protected.Use(AuthMiddleware(authService))
		{
			// Магазины
			protected.POST("/shops", shopController.CreateShop)
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
			protected.PUT("/inventories/items/:itemId/equip", inventoryController.EquipItem)

			// Персонажи
			protected.POST("/characters", characterController.CreateCharacter)
			protected.GET("/characters", characterController.GetCharacters)
			protected.GET("/characters/:id/inventories", inventoryController.GetCharacterInventories)
			protected.GET("/characters/:id", characterController.GetCharacter)
			protected.PUT("/characters/:id", characterController.UpdateCharacter)
			protected.DELETE("/characters/:id", characterController.DeleteCharacter)
			protected.POST("/characters/import", characterController.ImportCharacter)
			protected.GET("/characters/:id/export", characterController.ExportCharacter)
			protected.PATCH("/characters/:id/stats/:statName", characterController.UpdateCharacterStat)

			// Персонажи V2 (новая система)
			protected.POST("/characters-v2", characterV2Controller.CreateCharacterV2)
			protected.GET("/characters-v2", characterV2Controller.GetCharactersV2)
			protected.GET("/characters-v2/:id", characterV2Controller.GetCharacterV2)
			protected.PUT("/characters-v2/:id", characterV2Controller.UpdateCharacterV2)
			protected.DELETE("/characters-v2/:id", characterV2Controller.DeleteCharacterV2)
			protected.PATCH("/characters-v2/:id/stats/:statName", characterV2Controller.UpdateCharacterV2Stat)
			protected.GET("/characters-v2/:id/inventories", inventoryController.GetCharacterInventories)
			protected.GET("/characters-v2/:id/armor", characterV2Controller.GetCharacterArmor)
			protected.POST("/characters-v2/:id/inventories/items", characterV2Controller.AddItemsToCharacterInventory)
			protected.POST("/characters-v2/:id/equip", characterV2Controller.EquipItem)
			protected.GET("/characters-v2/:id/active-effects", characterV2Controller.GetActiveEffects)

			// Персонажи V3 (сущностно-ориентированное хранение)
			protected.POST("/characters-v3", characterV3Controller.CreateCharacterV3)
			protected.GET("/characters-v3", characterV3Controller.GetCharactersV3)
			protected.GET("/characters-v3/:id", characterV3Controller.GetCharacterV3)
			protected.PUT("/characters-v3/:id", characterV3Controller.UpdateCharacterV3)
			protected.DELETE("/characters-v3/:id", characterV3Controller.DeleteCharacterV3)
			protected.GET("/characters-v3/:id/events", characterV3Controller.GetCharacterEvents)
			protected.POST("/characters-v3/:id/events", characterV3Controller.PostCharacterEvents)
			protected.PATCH("/characters-v3/:id/runtime", characterV3Controller.PatchCharacterRuntime)

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
			protected.POST("/image-library/update-from-cards", imageLibraryController.UpdateImageLibraryFromCards)
			protected.POST("/image-library/sync-missing", imageLibraryController.SyncMissingImages)
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
