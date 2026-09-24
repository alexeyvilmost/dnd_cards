// Local QA entrypoint, built as a Go overlay for backend/main.go.
// Production sources and migrations are never modified or executed by this command.
package main

import (
	"context"
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

const paperCatalogAddress = "127.0.0.1:8080"
const paperCatalogDatabase = "shop_review_249_20260915"

type paperCatalogNoHTTP struct{}

func (paperCatalogNoHTTP) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("outbound HTTP is disabled in the local read-only catalog")
}

func main() {
	configFile := flag.String("config", "", "Local JSON file; only its DATABASE_URL credentials are read")
	checkOnly := flag.Bool("check-only", false, "Verify the read-only connection and exit")
	flag.Parse()
	// No inherited API keys, cloud configuration, JWTs, proxy or database settings.
	// Windows needs SystemRoot to locate its socket provider; it is an OS path.
	systemRoot := os.Getenv("SystemRoot")
	os.Clearenv()
	if systemRoot != "" {
		_ = os.Setenv("SystemRoot", systemRoot)
	}
	http.DefaultTransport = paperCatalogNoHTTP{}
	if *configFile == "" {
		log.Fatal("-config must identify the existing local environment JSON")
	}
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
		log.Fatal("the source connection must already target a loopback host")
	}
	// Reconstruct, rather than inherit, host, port, database and connection options.
	connection := &url.URL{Scheme: "postgres", User: original.User, Host: "127.0.0.1:5434", Path: "/" + paperCatalogDatabase}
	query := url.Values{
		"sslmode": {"disable"}, "connect_timeout": {"5"},
		"application_name": {"paper-sheet-readonly-catalog"},
		"options":          {"-c default_transaction_read_only=on -c statement_timeout=5000"},
	}
	connection.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(connection.String()), &gorm.Config{DisableAutomaticPing: true})
	if err != nil {
		log.Fatal("cannot initialize the local read-only database connection")
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatal("cannot access the local database pool")
	}
	defer sqlDB.Close()
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(1)
	sqlDB.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var database, serverAddress, transactionReadOnly, defaultReadOnly string
	err = sqlDB.QueryRowContext(ctx, "SELECT current_database(), host(inet_server_addr()), current_setting('transaction_read_only'), current_setting('default_transaction_read_only')").Scan(&database, &serverAddress, &transactionReadOnly, &defaultReadOnly)
	if err != nil {
		var sqlState interface{ SQLState() string }
		if errors.As(err, &sqlState) {
			log.Fatalf("local read-only database check failed (SQLSTATE %s)", sqlState.SQLState())
		}
		message := err.Error()
		if password, hasPassword := original.User.Password(); hasPassword && password != "" {
			message = strings.ReplaceAll(strings.ReplaceAll(message, password, "[redacted]"), url.QueryEscape(password), "[redacted]")
		}
		log.Fatalf("local read-only database check failed: %s", message)
	}
	serverIP := net.ParseIP(serverAddress)
	if database != paperCatalogDatabase || serverIP == nil || !serverIP.IsLoopback() || transactionReadOnly != "on" || defaultReadOnly != "on" {
		log.Fatalf("database scope/read-only verification failed: database=%s address=%s transaction_read_only=%s default_transaction_read_only=%s", database, serverAddress, transactionReadOnly, defaultReadOnly)
	}
	status := gin.H{"mode": "local-read-only-catalog", "database": database, "server_address": serverAddress, "transaction_read_only": transactionReadOnly, "default_transaction_read_only": defaultReadOnly}
	if *checkOnly {
		_ = json.NewEncoder(os.Stdout).Encode(status)
		return
	}

	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())
	_ = router.SetTrustedProxies(nil)
	router.Use(cors.New(cors.Config{
		AllowOrigins: []string{"http://127.0.0.1:3000", "http://localhost:3000"},
		AllowMethods: []string{http.MethodGet, http.MethodOptions},
		AllowHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization"},
		MaxAge:       time.Hour,
	}))
	router.Use(func(c *gin.Context) {
		c.Header("X-Local-Catalog-Mode", "read-only")
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodOptions {
			c.AbortWithStatusJSON(http.StatusMethodNotAllowed, gin.H{"error": "This local QA catalog is read-only"})
			return
		}
		c.Next()
	})
	router.GET("/api/health", func(c *gin.Context) { c.JSON(http.StatusOK, status) })
	// Struct literals intentionally omit external-service constructors.
	cards, spells := &CardController{db: db}, &SpellController{db: db}
	actions, effects := &ActionController{db: db}, &EffectController{db: db}
	resources, variables := &ResourceController{db: db}, &VariableController{db: db}
	concepts := &ConceptController{db: db}
	for _, route := range []struct {
		path         string
		list, detail gin.HandlerFunc
	}{
		{"cards", cards.GetCards, cards.GetCard}, {"spells", spells.GetSpells, spells.GetSpell},
		{"actions", actions.GetActions, actions.GetAction}, {"effects", effects.GetEffects, effects.GetEffect},
		{"resources", resources.GetResources, resources.GetResource}, {"variables", variables.GetVariables, variables.GetVariable},
		{"concepts", concepts.GetConcepts, concepts.GetConcept},
	} {
		router.GET("/api/"+route.path, route.list)
		router.GET("/api/"+route.path+"/:id", route.detail)
	}
	router.GET("/api/content-images/:entityType/:id", (&ContentImageController{db: db}).Get)
	// Extract only the existing metadata GET handlers from their registrar.
	// No auth/session or mutation route is exposed by the serving router.
	tags := gin.New()
	registerEntityTagRoutes(tags.Group("/api"), nil, db)
	for _, route := range tags.Routes() {
		if route.Method == http.MethodGet && (route.Path == "/api/entity-tags" || route.Path == "/api/entity-tags/:type/:id" || route.Path == "/api/entity-tag-members/:id") {
			router.GET(route.Path, route.HandlerFunc)
		}
	}
	fmt.Printf("Local read-only catalog: http://%s; database=%s; transaction_read_only=on\n", paperCatalogAddress, database)
	server := &http.Server{Addr: paperCatalogAddress, Handler: router, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second}
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
