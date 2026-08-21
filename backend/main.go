package main

import (
	"context"
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
	// Keep a warm, bounded pool. With DisableAutomaticPing the old process could
	// defer its first remote PostgreSQL handshake to a user's catalog request.
	sqlDB.SetMaxOpenConns(20)
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetConnMaxIdleTime(10 * time.Minute)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	pingContext, cancelPing := context.WithTimeout(context.Background(), 10*time.Second)
	if err := sqlDB.PingContext(pingContext); err != nil {
		cancelPing()
		log.Fatal("Ошибка проверки подключения к базе данных:", err)
	}
	cancelPing()

	// Запускаем миграции
	migrator := migrations.NewMigrator(sqlDB)
	if err := migrator.Run(); err != nil {
		log.Fatal("Ошибка выполнения миграций:", err)
	}
	log.Println("Миграции выполнены успешно")

	// Настройка Gin
	r := gin.Default()
	if err := configureTrustedClientIPs(r); err != nil {
		log.Fatal("Ошибка настройки доверенных reverse proxy:", err)
	}

	// gzip ответов (списки справочников после B1 сжимаются на ~85%).
	// SSE-потоки боёв (/stream) исключаем — gzip буферизирует и ломает realtime.
	r.Use(gzip.Gzip(gzip.DefaultCompression, gzip.WithExcludedPathsRegexs([]string{`.*/stream$`})))
	r.Use(RequestIDMiddleware())
	r.Use(SecurityHeadersMiddleware())

	// Same-origin production does not require CORS, but explicit origins remain
	// available for local development, canaries and a temporary rollback host.
	allowedOrigins, err := configuredAllowedOrigins()
	if err != nil {
		log.Fatal("Ошибка CORS-конфигурации:", err)
	}
	corsConfig := cors.DefaultConfig()
	corsConfig.AllowOrigins = allowedOrigins
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	corsConfig.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Request-ID"}
	corsConfig.ExposeHeaders = []string{"X-Request-ID", "Retry-After"}
	corsConfig.AllowCredentials = true
	r.Use(cors.New(corsConfig))

	// Инициализация сервисов для работы с изображениями
	yandexStorage, err := NewYandexStorageService()
	if err != nil {
		log.Printf("Предупреждение: Yandex Storage недоступен: %v", err)
		yandexStorage = nil
	}

	openAIService := NewOpenAIService()
	imageController := NewImageController(db, yandexStorage, openAIService)
	contentImageController := NewContentImageController(db)

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
	contentSupportController := NewContentSupportController(db)
	contentMigrationController := NewContentMigrationController(db)
	canonicalSessionController := NewCanonicalSessionController(db)
	monsterController := NewMonsterController(db)

	// Онлайн-бои: серверная истина + realtime-рассылка (SSE + Postgres LISTEN/NOTIFY).
	encounterHub := NewEncounterHub(dbConfig.GetDSN())
	encounterHub.StartListener(db)
	encounterInviteService := NewEncounterInviteService()
	encounterController := NewEncounterController(db, encounterHub, encounterInviteService)

	// Health check endpoint
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":        "ok",
			"timestamp":     time.Now().Unix(),
			"source_commit": deployedSourceCommit(),
		})
	})

	// Маршруты API
	api := r.Group("/api")
	api.Use(MutationAuditMiddleware())
	api.Use(JSONBodyLimitMiddleware(2 << 20))
	api.Use(NewFixedWindowRateLimiter(180, time.Minute).MutationsOnly())
	{
		// Публичные маршруты (без авторизации)
		authRateLimit := NewFixedWindowRateLimiter(20, 10*time.Minute)
		imageRateLimit := NewFixedWindowRateLimiter(3, 10*time.Minute)
		uploadRateLimit := NewFixedWindowRateLimiter(20, time.Hour)
		// Глобальные справочники читаются публично, но любое изменение требует
		// строгий JWT без public fallback и UUID из server-side admin allowlist.
		contentAdminAuth := ContentAdminAuthMiddleware(authService)
		// The atomic certification request contains exact full API preimages for
		// the complete dependency closure. Keep its larger bound isolated from the
		// ordinary 2 MiB API group and authenticate before reading the body.
		contentSupportBatchAPI := r.Group("/api/content-support")
		contentSupportBatchAPI.Use(MutationAuditMiddleware())
		contentSupportBatchAPI.Use(NewFixedWindowRateLimiter(10, time.Hour).MutationsOnly())
		contentSupportBatchAPI.POST(
			"/batch-exact",
			contentAdminAuth,
			JSONBodyLimitMiddleware(maxContentSupportBatchBodyBytes),
			RequestBodyLimitMiddleware(maxContentSupportBatchBodyBytes),
			contentMigrationController.ApplyExactSupportBatch,
		)
		api.POST("/auth/register", authRateLimit.Handler(), authController.Register)
		api.POST("/auth/login", authRateLimit.Handler(), authController.Login)
		api.GET("/content-images/:entityType/:id", contentImageController.Get)

		// Магазины (публичные ссылки на просмотр, создание за авторизацией)
		api.GET("/shops/:slug", shopController.GetShop)

		// Карточки (публичные, но с опциональной авторизацией)
		api.GET("/cards", OptionalAuthMiddleware(authService), cardController.GetCards)
		api.GET("/cards/:id", OptionalAuthMiddleware(authService), cardController.GetCard)
		api.GET("/cards/:id/battle-stats", OptionalAuthMiddleware(authService), cardController.GetCardBattleStats)
		api.POST("/cards/battle-stats", OptionalAuthMiddleware(authService), cardController.GetBatchCardBattleStats)
		api.POST("/cards", contentAdminAuth, cardController.CreateCard)
		api.PUT("/cards/:id", contentAdminAuth, cardController.UpdateCard)
		api.DELETE("/cards/:id", contentAdminAuth, cardController.DeleteCard)
		api.POST("/cards/generate-image", contentAdminAuth, imageRateLimit.Handler(), cardController.GenerateImage)
		api.POST("/cards/export", AuthMiddleware(authService), cardController.ExportCards)

		// Действия (публичные, но с опциональной авторизацией)
		api.GET("/actions", OptionalAuthMiddleware(authService), actionController.GetActions)
		api.GET("/actions/:id", OptionalAuthMiddleware(authService), actionController.GetAction)
		api.POST("/actions", contentAdminAuth, actionController.CreateAction)
		api.PUT("/actions/:id", contentAdminAuth, actionController.UpdateAction)
		api.DELETE("/actions/:id", contentAdminAuth, actionController.DeleteAction)

		// Монстры — data-driven stat blocks, ссылающиеся на общие действия и эффекты.
		api.GET("/monsters", OptionalAuthMiddleware(authService), monsterController.List)
		api.GET("/monsters/:id", OptionalAuthMiddleware(authService), monsterController.Get)
		api.POST("/monsters", contentAdminAuth, monsterController.Create)
		api.PUT("/monsters/:id", contentAdminAuth, monsterController.Update)
		api.DELETE("/monsters/:id", contentAdminAuth, monsterController.Delete)

		// Эффекты (публичные, но с опциональной авторизацией)
		api.GET("/effects", OptionalAuthMiddleware(authService), effectController.GetEffects)
		api.GET("/effects/:id", OptionalAuthMiddleware(authService), effectController.GetEffect)
		api.POST("/effects", contentAdminAuth, effectController.CreateEffect)
		api.PUT("/effects/:id", contentAdminAuth, effectController.UpdateEffect)
		api.DELETE("/effects/:id", contentAdminAuth, effectController.DeleteEffect)

		// Заклинания (публичные, но с опциональной авторизацией)
		api.GET("/spells", OptionalAuthMiddleware(authService), spellController.GetSpells)
		api.GET("/spells/:id", OptionalAuthMiddleware(authService), spellController.GetSpell)
		api.POST("/spells", contentAdminAuth, spellController.CreateSpell)
		api.PUT("/spells/:id", contentAdminAuth, spellController.UpdateSpell)
		api.DELETE("/spells/:id", contentAdminAuth, spellController.DeleteSpell)

		// Standalone-генерация изображений (вкладка «Генерация изображений»)
		api.POST("/images/generate-standalone", contentAdminAuth, imageRateLimit.Handler(), imageController.GenerateStandaloneImage)
		// Роут /images/upload-base64 удалён (KB-202): анонимная неограниченная запись любых данных
		// в облачный бакет (OptionalAuthMiddleware = аноним) — поверхность абьюза и расходов. Фронт
		// его не использовал; служил одноразовой миграции base64→S3 (см. историю git при надобности).

		// AI-генерация механики по описанию (кнопка «AI» в редакторах)
		aiMechanicsController := NewAIMechanicsController()
		aiRateLimit := NewFixedWindowRateLimiter(8, 10*time.Minute)
		api.POST("/ai/mechanics", contentAdminAuth, aiRateLimit.Handler(), aiMechanicsController.GenerateMechanics)

		// Черты (публичные, но с опциональной авторизацией)
		api.GET("/feats", OptionalAuthMiddleware(authService), featController.GetFeats)
		api.GET("/feats/:id", OptionalAuthMiddleware(authService), featController.GetFeat)
		api.POST("/feats", contentAdminAuth, featController.CreateFeat)
		api.PUT("/feats/:id", contentAdminAuth, featController.UpdateFeat)
		api.DELETE("/feats/:id", contentAdminAuth, featController.DeleteFeat)

		// Предыстории (публичные, но с опциональной авторизацией)
		api.GET("/backgrounds", OptionalAuthMiddleware(authService), backgroundController.GetBackgrounds)
		api.GET("/backgrounds/:id", OptionalAuthMiddleware(authService), backgroundController.GetBackground)
		api.POST("/backgrounds", contentAdminAuth, backgroundController.CreateBackground)
		api.PUT("/backgrounds/:id", contentAdminAuth, backgroundController.UpdateBackground)
		api.DELETE("/backgrounds/:id", contentAdminAuth, backgroundController.DeleteBackground)

		// Виды (расы)
		api.GET("/races", OptionalAuthMiddleware(authService), raceController.GetRaces)
		api.GET("/races/:id", OptionalAuthMiddleware(authService), raceController.GetRace)
		api.POST("/races", contentAdminAuth, raceController.CreateRace)
		api.PUT("/races/:id", contentAdminAuth, raceController.UpdateRace)
		api.DELETE("/races/:id", contentAdminAuth, raceController.DeleteRace)

		// Классы
		api.GET("/classes", OptionalAuthMiddleware(authService), classController.GetClasses)
		api.GET("/classes/:id", OptionalAuthMiddleware(authService), classController.GetClass)
		api.POST("/classes", contentAdminAuth, classController.CreateClass)
		api.PUT("/classes/:id", contentAdminAuth, classController.UpdateClass)
		api.DELETE("/classes/:id", contentAdminAuth, classController.DeleteClass)

		// Отдельный путь сертификации: обычный CRUD не принимает support и
		// миграционный trigger инвалидирует прежний статус после правки контента.
		api.PUT("/content-support/:entityType/:id", contentAdminAuth, contentSupportController.Update)
		// Create и физический rollback создаваемых migration-сущностей связаны
		// server-issued receipt в одной транзакции для разрешённых patch-схемой
		// коллекций с crash-safe apply/rollback протоколом.
		api.POST("/content-migrations/:bundleId/effects", contentAdminAuth, contentMigrationController.CreateEffect)
		api.POST("/content-migrations/:bundleId/actions", contentAdminAuth, contentMigrationController.CreateAction)
		api.POST("/content-migrations/:bundleId/:entityType/:id/exact-update", contentAdminAuth, contentMigrationController.ExactUpdate)
		api.POST("/content-rollback/effect/:id/hard-delete-created", contentAdminAuth, contentMigrationController.RollbackCreatedEffect)
		api.POST("/content-rollback/action/:id/hard-delete-created", contentAdminAuth, contentMigrationController.RollbackCreatedAction)
		api.POST("/content-rollback/:entityType/:id/support", contentAdminAuth, contentMigrationController.RestoreSupport)

		// Ресурсы действий/персонажа
		api.GET("/resources", OptionalAuthMiddleware(authService), resourceController.GetResources)
		api.GET("/resources/:id", OptionalAuthMiddleware(authService), resourceController.GetResource)
		api.POST("/resources", contentAdminAuth, resourceController.CreateResource)
		api.PUT("/resources/:id", contentAdminAuth, resourceController.UpdateResource)
		api.DELETE("/resources/:id", contentAdminAuth, resourceController.DeleteResource)

		// Переменные (числовые/dice), выдаваемые классами/эффектами
		api.GET("/variables", OptionalAuthMiddleware(authService), variableController.GetVariables)
		api.GET("/variables/:id", OptionalAuthMiddleware(authService), variableController.GetVariable)
		api.POST("/variables", contentAdminAuth, variableController.CreateVariable)
		api.PUT("/variables/:id", contentAdminAuth, variableController.UpdateVariable)
		api.DELETE("/variables/:id", contentAdminAuth, variableController.DeleteVariable)

		// Онлайн-бои (encounters) содержат состояние и журналы конкретных персонажей,
		// поэтому весь контур, включая SSE-handshake, требует строгий JWT. Доступ к
		// конкретному бою дополнительно проверяется контроллером по owner/member/controller.
		encounterAuth := StrictAuthMiddleware(authService)
		api.POST("/encounters", encounterAuth, encounterController.Create)
		api.GET("/encounters", encounterAuth, encounterController.List)
		api.GET("/encounters/:id", encounterAuth, encounterController.Get)
		api.DELETE("/encounters/:id", encounterAuth, encounterController.Delete)
		api.GET("/encounters/:id/events", encounterAuth, encounterController.Events)
		api.POST("/encounters/:id/invite", encounterAuth, encounterController.IssueInvite)
		api.POST("/encounters/:id/join", encounterAuth, RequestBodyLimitMiddleware(8<<10), encounterController.Join)
		api.POST("/encounters/:id/apply", encounterAuth, JSONBodyLimitMiddleware(maxEncounterApplyBodyBytes), RequestBodyLimitMiddleware(maxEncounterApplyBodyBytes), encounterController.Apply)
		api.GET("/encounters/:id/stream", encounterAuth, encounterController.Stream)

		// CharacterV3 содержит пользовательские листы и журналы. Весь контур
		// требует строгий JWT; контроллер разрешает authenticated read старых
		// public-листов, но оставляет их неизменяемыми.
		registerCharacterV3Routes(api, authService, characterV3Controller)
		api.POST(
			"/characters-v3/:id/avatar",
			StrictAuthMiddleware(authService),
			RequestBodyLimitMiddleware(12<<20),
			uploadRateLimit.Handler(),
			imageController.UploadCharacterAvatar,
		)
		if canonicalTransportEnabled() {
			log.Printf("WARNING: %s=1 exposes the partial, client-semantics-unverified canonical transport", canonicalTransportFeatureFlag)
			registerCanonicalSessionRoutes(api, authService, canonicalSessionController)
		}

		// Понятия (глоссарий): публичное чтение, строгая авторизация записи.
		api.GET("/concepts", OptionalAuthMiddleware(authService), conceptController.GetConcepts)
		api.GET("/concepts/:id", OptionalAuthMiddleware(authService), conceptController.GetConcept)
		api.POST("/concepts", contentAdminAuth, conceptController.CreateConcept)
		api.PUT("/concepts/:id", contentAdminAuth, conceptController.UpdateConcept)
		api.DELETE("/concepts/:id", contentAdminAuth, conceptController.DeleteConcept)

		// Маршруты с контекстом пользователя. В публичном режиме AuthMiddleware
		// подставляет общего пользователя public; валидный JWT по-прежнему учитывается.
		shopCreateRateLimit := NewFixedWindowRateLimiter(10, time.Hour)
		protected := api.Group("/")
		protected.Use(AuthMiddleware(authService))
		{
			// Магазины
			protected.POST("/shops", shopCreateRateLimit.Handler(), shopController.CreateShop)
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

			// Изображения
			protected.POST("/images/upload", contentAdminAuth, RequestBodyLimitMiddleware(12<<20), uploadRateLimit.Handler(), imageController.UploadImage)
			protected.POST("/images/generate", contentAdminAuth, imageRateLimit.Handler(), imageController.GenerateImage)
			protected.DELETE("/images/:entity_type/:entity_id", contentAdminAuth, imageController.DeleteImage)
			protected.POST("/images/setup-cors", contentAdminAuth, imageController.SetupCORS)
			protected.GET("/images/status", contentAdminAuth, imageController.GetStatus)

			// Библиотека изображений
			protected.GET("/image-library", imageLibraryController.GetImageLibrary)
			protected.POST("/image-library", contentAdminAuth, imageLibraryController.AddToLibrary)
			protected.PUT("/image-library/:id", contentAdminAuth, imageLibraryController.UpdateImageLibrary)
			protected.DELETE("/image-library/:id", contentAdminAuth, imageLibraryController.DeleteFromLibrary)
			protected.GET("/image-library/rarities", imageLibraryController.GetRarities)
			protected.POST("/image-library/update-from-cards", contentAdminAuth, imageLibraryController.UpdateImageLibraryFromCards)
			protected.POST("/image-library/sync-missing", contentAdminAuth, imageLibraryController.SyncMissingImages)
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
