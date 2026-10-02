// Local paper-document QA entrypoint, compiled instead of backend/main.go.
// It serves only a named clone: no migrations, .env, cloud clients or battle workers.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const paperQAAddress = "127.0.0.1:8082"
const paperQADatabase = "paper_sheet_20261002_qa"

type paperQANoHTTP struct{}

func (paperQANoHTTP) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("outbound HTTP is disabled in the isolated paper QA service")
}

func main() {
	configFile := flag.String("config", "", "Local JSON; only loopback database credentials are read")
	secretFile := flag.String("local-secret", "", "Private local QA JWT key file, never a production secret")
	databasePort := flag.Int("database-port", 5432, "Existing local PostgreSQL port: 5432 or 5434")
	checkOnly := flag.Bool("check-only", false, "Check the isolated database and exit without serving")
	flag.Parse()
	if *databasePort != 5432 && *databasePort != 5434 {
		log.Fatal("the local PostgreSQL port must be 5432 or 5434")
	}
	if *configFile == "" || *secretFile == "" {
		log.Fatal("local credentials and a separate QA secret path are required")
	}
	systemRoot := os.Getenv("SystemRoot")
	os.Clearenv()
	if systemRoot != "" {
		_ = os.Setenv("SystemRoot", systemRoot)
	}
	http.DefaultTransport = paperQANoHTTP{}
	content, err := os.ReadFile(*configFile)
	if err != nil {
		log.Fatal("cannot read the local connection file")
	}
	var settings struct {
		DatabaseURL string `json:"DATABASE_URL"`
	}
	if json.Unmarshal(content, &settings) != nil {
		log.Fatal("invalid local connection file")
	}
	original, err := url.Parse(settings.DatabaseURL)
	if err != nil || original.User == nil || (original.Scheme != "postgres" && original.Scheme != "postgresql") {
		log.Fatal("a PostgreSQL URL with local credentials is required")
	}
	ip := net.ParseIP(original.Hostname())
	if original.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback()) {
		log.Fatal("the source credentials must already target a loopback host")
	}
	// Host, database and options cannot be inherited from the credential file.
	// Only this explicit QA clone can receive document/auth writes.
	openDatabase := func(readOnly bool) *gorm.DB {
		connection := &url.URL{Scheme: "postgres", User: original.User, Host: fmt.Sprintf("127.0.0.1:%d", *databasePort), Path: "/" + paperQADatabase}
		mode := "off"
		if readOnly {
			mode = "on"
		}
		connection.RawQuery = url.Values{
			"sslmode": {"disable"}, "connect_timeout": {"5"},
			"application_name": {"paper-document-isolated-qa"},
			"options":          {"-c default_transaction_read_only=" + mode + " -c statement_timeout=5000"},
		}.Encode()
		db, openErr := gorm.Open(postgres.Open(connection.String()), &gorm.Config{DisableAutomaticPing: true})
		if openErr != nil {
			log.Fatal("cannot initialize the isolated QA connection")
		}
		pool, poolErr := db.DB()
		if poolErr != nil {
			log.Fatal("cannot access the isolated QA database pool")
		}
		pool.SetMaxOpenConns(4)
		pool.SetMaxIdleConns(1)
		pool.SetConnMaxLifetime(5 * time.Minute)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		var database, address, transactionMode string
		var port int
		var documentsReady bool
		checkErr := pool.QueryRowContext(ctx, `SELECT current_database(),host(inet_server_addr()),inet_server_port(),current_setting('transaction_read_only'),EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='paper_documents' AND column_name='deleted_at')`).Scan(&database, &address, &port, &transactionMode, &documentsReady)
		if checkErr != nil {
			log.Fatal("isolated QA database check failed; prepare the clone first")
		}
		if database != paperQADatabase || address != "127.0.0.1" || port != *databasePort || transactionMode != mode || !documentsReady {
			log.Fatal("isolated QA database scope or paper document schema verification failed")
		}
		return db
	}
	// Separate read-only pool for catalog handlers, even within the disposable clone.
	catalogDB := openDatabase(true)
	documentDB := openDatabase(false)
	catalogPool, _ := catalogDB.DB()
	documentPool, _ := documentDB.DB()
	defer catalogPool.Close()
	defer documentPool.Close()
	status := gin.H{"mode": "isolated-paper-document-qa", "database": paperQADatabase, "server_address": "127.0.0.1", "server_port": *databasePort, "catalog_transaction_read_only": "on", "document_transaction_read_only": "off", "outbound_http": "disabled"}
	if *checkOnly {
		_ = json.NewEncoder(os.Stdout).Encode(status)
		return
	}
	secret, err := os.ReadFile(*secretFile)
	if errors.Is(err, os.ErrNotExist) {
		raw := make([]byte, 32)
		if _, err = rand.Read(raw); err != nil {
			log.Fatal("cannot generate a local QA session key")
		}
		secret = []byte(hex.EncodeToString(raw))
		file, createErr := os.OpenFile(*secretFile, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if createErr != nil {
			log.Fatal("cannot create a separate local QA session key")
		}
		_, err = file.Write(secret)
		_ = file.Close()
	}
	if err != nil || len(secret) < 32 {
		log.Fatal("cannot read a valid local QA session key")
	}
	_ = os.Setenv("JWT_SECRET", string(secret))
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())
	_ = router.SetTrustedProxies(nil)
	router.Use(cors.New(cors.Config{
		AllowOrigins: []string{"http://127.0.0.1:3000", "http://localhost:3000", "http://127.0.0.1:3001", "http://localhost:3001"},
		AllowMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization"},
		MaxAge:       time.Hour,
	}))
	router.Use(func(c *gin.Context) {
		c.Header("X-Local-QA-Mode", "isolated-paper-documents")
		path := c.Request.URL.Path
		paperWrite := path == "/api/paper-sheets" || strings.HasPrefix(path, "/api/paper-sheets/")
		authWrite := c.Request.Method == http.MethodPost && (path == "/api/auth/login" || path == "/api/auth/register")
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodOptions && !paperWrite && !authWrite {
			c.AbortWithStatusJSON(http.StatusMethodNotAllowed, gin.H{"error": "Only paper documents and local sign-in can change in this isolated QA service"})
			return
		}
		c.Next()
	})
	router.GET("/api/health", func(c *gin.Context) { c.JSON(http.StatusOK, status) })
	// These constructors only store the local DB. No OAuth, mail or cloud service.
	auth := NewAuthService(documentDB)
	authController := NewAuthController(auth)
	registerPaperDocumentRoutes(router, auth, documentDB)
	authLimit := NewFixedWindowRateLimiter(20, 10*time.Minute)
	router.POST("/api/auth/login", authLimit.Handler(), JSONBodyLimitMiddleware(4096), authController.Login)
	router.POST("/api/auth/register", authLimit.Handler(), JSONBodyLimitMiddleware(4096), authController.Register)
	router.GET("/api/auth/profile", StrictAuthMiddleware(auth), authController.GetProfile)
	router.GET("/api/auth/me", StrictAuthMiddleware(auth), authController.GetProfile)
	router.GET("/api/auth/oauth/providers", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"providers": []any{}}) })
	router.GET("/api/content-capabilities", StrictAuthMiddleware(auth), func(c *gin.Context) {
		id, _ := GetCurrentUserID(c)
		c.JSON(http.StatusOK, gin.H{"admin": false, "user_id": id.String()})
	})
	cards, spells := &CardController{db: catalogDB}, &SpellController{db: catalogDB}
	actions, effects := &ActionController{db: catalogDB}, &EffectController{db: catalogDB}
	feats, backgrounds := &FeatController{db: catalogDB}, &BackgroundController{db: catalogDB}
	races, classes := &RaceController{db: catalogDB}, &ClassController{db: catalogDB}
	resources, variables := &ResourceController{db: catalogDB}, &VariableController{db: catalogDB}
	concepts := &ConceptController{db: catalogDB}
	for _, route := range []struct {
		path         string
		list, detail gin.HandlerFunc
	}{
		{"cards", cards.GetCards, cards.GetCard}, {"spells", spells.GetSpells, spells.GetSpell},
		{"actions", actions.GetActions, actions.GetAction}, {"effects", effects.GetEffects, effects.GetEffect},
		{"feats", feats.GetFeats, feats.GetFeat}, {"backgrounds", backgrounds.GetBackgrounds, backgrounds.GetBackground},
		{"races", races.GetRaces, races.GetRace}, {"classes", classes.GetClasses, classes.GetClass},
		{"resources", resources.GetResources, resources.GetResource}, {"variables", variables.GetVariables, variables.GetVariable},
		{"concepts", concepts.GetConcepts, concepts.GetConcept},
	} {
		router.GET("/api/"+route.path, OptionalAuthMiddleware(auth), route.list)
		router.GET("/api/"+route.path+"/:id", OptionalAuthMiddleware(auth), route.detail)
	}
	router.GET("/api/content-images/:entityType/:id", (&ContentImageController{db: catalogDB}).Get)
	tags := gin.New()
	registerEntityTagRoutes(tags.Group("/api"), nil, catalogDB)
	for _, route := range tags.Routes() {
		if route.Method == http.MethodGet && (route.Path == "/api/entity-tags" || route.Path == "/api/entity-tags/:type/:id" || route.Path == "/api/entity-tag-members/:id") {
			router.GET(route.Path, route.HandlerFunc)
		}
	}
	fmt.Printf("Isolated paper QA: http://%s; clone=%s; catalog=read-only; document CRUD=clone only\n", paperQAAddress, paperQADatabase)
	server := &http.Server{Addr: paperQAAddress, Handler: router, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 30 * time.Second}
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
