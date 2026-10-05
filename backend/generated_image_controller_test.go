package main

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// No sockets or database credentials: callbacks below capture Gorm writes and
// this minimal driver supports only the ancillary metadata transaction.
type imageTestConnector struct{}
type imageTestDriver struct{}
type imageTestConn struct{}
type imageTestTx struct{}

func (imageTestConnector) Connect(context.Context) (driver.Conn, error) { return imageTestConn{}, nil }
func (imageTestConnector) Driver() driver.Driver                        { return imageTestDriver{} }
func (imageTestDriver) Open(string) (driver.Conn, error)                { return imageTestConn{}, nil }
func (imageTestConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected SQL: callback missing")
}
func (imageTestConn) Close() error              { return nil }
func (imageTestConn) Begin() (driver.Tx, error) { return imageTestTx{}, nil }
func (imageTestTx) Commit() error               { return nil }
func (imageTestTx) Rollback() error             { return nil }

type imageTestDatabase struct {
	db                             *gorm.DB
	rows                           int64
	updateErr, queryErr, createErr error
	updates                        []map[string]interface{}
	queryContexts, updateContexts  []context.Context
	models                         []string
}

func newImageTestDatabase(t *testing.T) *imageTestDatabase {
	t.Helper()
	sqlDB := sql.OpenDB(imageTestConnector{})
	t.Cleanup(func() { _ = sqlDB.Close() })
	db, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{DisableAutomaticPing: true, SkipDefaultTransaction: true, Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	f := &imageTestDatabase{db: db, rows: 1}
	if err := db.Callback().Query().Replace("gorm:query", func(tx *gorm.DB) {
		f.queryContexts = append(f.queryContexts, tx.Statement.Context)
		if f.queryErr != nil {
			tx.AddError(f.queryErr)
			return
		}
		if card, ok := tx.Statement.Dest.(*Card); ok {
			*card = Card{Name: "Saved item", ImageURL: "https://images.example.test/old.png", ImageCloudinaryID: "cards/old.png"}
		}
		tx.RowsAffected = 1
	}); err != nil {
		t.Fatal(err)
	}
	if err := db.Callback().Update().Replace("gorm:update", func(tx *gorm.DB) {
		f.updateContexts = append(f.updateContexts, tx.Statement.Context)
		f.updates = append(f.updates, tx.Statement.Dest.(map[string]interface{}))
		tx.RowsAffected = f.rows
		if f.updateErr != nil {
			tx.AddError(f.updateErr)
		}
	}); err != nil {
		t.Fatal(err)
	}
	if err := db.Callback().Create().Replace("gorm:create", func(tx *gorm.DB) {
		if f.createErr != nil {
			tx.AddError(f.createErr)
			return
		}
		switch row := tx.Statement.Dest.(type) {
		case *ImageGenerationLog:
			f.models = append(f.models, row.GenerationModel)
		case *ImageLibrary:
			f.models = append(f.models, *row.GenerationModel)
		}
		tx.RowsAffected = 1
	}); err != nil {
		t.Fatal(err)
	}
	return f
}

func imageTestRequest(t *testing.T, handler gin.HandlerFunc, body string, ctx context.Context) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/image-test", strings.NewReader(body)).WithContext(ctx)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(requestIDContextKey, "image-test-request")
	handler(c)
	return recorder
}

func TestGeneratedImageEndpointAdaptersKeepCompatibleDTO(t *testing.T) {
	const id = "11111111-1111-4111-8111-111111111111"
	for _, route := range []string{"entity", "legacy", "standalone"} {
		t.Run(route, func(t *testing.T) {
			db := newImageTestDatabase(t)
			service, provider, storage := generatedFixture()
			controller := &ImageController{db: db.db, generation: service}
			handler, body := controller.GenerateImage, fmt.Sprintf(`{"entity_type":"card","entity_id":%q,"prompt":"SECRET prompt"}`, id)
			switch route {
			case "legacy":
				handler = NewCardController(db.db, controller).GenerateImage
				body = fmt.Sprintf(`{"card_id":%q,"prompt":"SECRET prompt"}`, id)
			case "standalone":
				handler = controller.GenerateStandaloneImage
				body = `{"prompt":"SECRET prompt"}`
			}
			response := imageTestRequest(t, handler, body, context.Background())
			if response.Code != http.StatusOK {
				t.Fatalf("response %d: %s", response.Code, response.Body)
			}
			var dto map[string]interface{}
			if err := json.Unmarshal(response.Body.Bytes(), &dto); err != nil {
				t.Fatal(err)
			}
			if dto["image_url"] != "https://images.example.test/new.png" || strings.Contains(response.Body.String(), "base64") {
				t.Fatalf("invalid DTO: %v", dto)
			}
			if route == "legacy" {
				if len(dto) != 2 || dto["message"] != "Изображение сгенерировано" {
					t.Fatalf("legacy DTO changed: %v", dto)
				}
			} else if dto["success"] != true {
				t.Fatalf("new DTO changed: %v", dto)
			}
			if route != "standalone" {
				if len(db.updates) != 1 || len(db.models) != 2 {
					t.Fatalf("missing entity or metadata writes: %+v", db)
				}
				for _, model := range db.models {
					if model != "gpt-image-1" {
						t.Fatalf("incorrect recorded model: %s", model)
					}
				}
				update := db.updates[0]
				if update["image_url"] != dto["image_url"] || update["image_cloudinary_url"] != dto["image_url"] || update["image_cloudinary_id"] != "cards/new.png" || update["image_generated"] != true {
					t.Fatalf("inconsistent writer: %v", update)
				}
				for _, ctx := range append(db.queryContexts, db.updateContexts...) {
					if _, ok := ctx.Deadline(); !ok {
						t.Fatal("database operation lost request deadline")
					}
				}
			} else if len(db.updates) != 0 {
				t.Fatal("standalone wrote entity")
			}
			if provider.calls != 1 || storage.uploads != 1 || len(storage.deleted) != 0 {
				t.Fatal("unexpected provider/storage calls")
			}
		})
	}
}

func TestGeneratedImageEndpointsDoNotReportFalseSuccess(t *testing.T) {
	const body = `{"entity_type":"card","entity_id":"11111111-1111-4111-8111-111111111111","entity_data":{"name":"Untrusted override"}}`
	for _, scenario := range []string{"not-found-before-paid", "missing-storage", "no-row-updated", "unknown-write"} {
		t.Run(scenario, func(t *testing.T) {
			db := newImageTestDatabase(t)
			service, provider, storage := generatedFixture()
			code, outcome, wantCalls := "image_entity_not_found", "not_started", 0
			switch scenario {
			case "not-found-before-paid":
				db.queryErr = gorm.ErrRecordNotFound
			case "missing-storage":
				service.storage = nil
				code = "image_storage_not_configured"
			case "no-row-updated":
				db.rows = 0
				outcome, wantCalls = "not_saved", 1
			case "unknown-write":
				db.updateErr = errors.New("SECRET database details")
				code, outcome, wantCalls = "image_persistence_unknown", "unknown", 1
			}
			controller := &ImageController{db: db.db, generation: service}
			response := imageTestRequest(t, controller.GenerateImage, body, context.Background())
			var problem ImageGenerationError
			if err := json.Unmarshal(response.Body.Bytes(), &problem); err != nil {
				t.Fatal(err)
			}
			if response.Code < 400 || strings.Contains(response.Body.String(), "SECRET") || problem.Code != code || problem.Outcome != outcome || provider.calls != wantCalls {
				t.Fatalf("unsafe response: %d %s, calls=%d", response.Code, response.Body, provider.calls)
			}
			if scenario == "unknown-write" && len(storage.deleted) != 0 {
				t.Fatal("deleted potentially committed image")
			}
			if scenario == "no-row-updated" && len(storage.deleted) != 1 {
				t.Fatal("orphan not cleaned")
			}
			if len(db.models) != 0 {
				t.Fatal("recorded failed generation as saved")
			}
		})
	}
	service, provider, _ := generatedFixture()
	service.storage = nil
	controller := &ImageController{generation: service}
	response := imageTestRequest(t, controller.GenerateStandaloneImage, `{"prompt":"local"}`, context.Background())
	if response.Code != 503 || provider.calls != 0 || strings.Contains(response.Body.String(), `"success":true`) {
		t.Fatalf("standalone storage fallback returned success: %s", response.Body)
	}
}

func TestGeneratedImageEntityWriterRequiresExactlyOneRow(t *testing.T) {
	for _, rows := range []int64{0, 1, 2} {
		t.Run(fmt.Sprint(rows), func(t *testing.T) {
			db := newImageTestDatabase(t)
			db.rows = rows
			controller := &ImageController{db: db.db}
			err := controller.updateEntityImageContext(context.Background(), "monster", "11111111-1111-4111-8111-111111111111", "https://images.example.test/new.png", "monster/new.png", true, "prompt")
			if (err == nil) != (rows == 1) {
				t.Fatalf("rows=%d err=%v", rows, err)
			}
			if rows == 0 && !errors.Is(err, gorm.ErrRecordNotFound) {
				t.Fatalf("zero rows outcome lost: %v", err)
			}
			if db.updates[0]["token_storage_id"] != "monster/new.png" {
				t.Fatal("monster adapter missing")
			}
		})
	}
}

func TestGeneratedImageMetadataFailureKeepsKnownSuccessAndSafeLogs(t *testing.T) {
	db := newImageTestDatabase(t)
	db.createErr = errors.New("SECRET metadata query and prompt")
	service, _, storage := generatedFixture()
	controller := &ImageController{db: db.db, generation: service}
	var logs bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(previous)
	response := imageTestRequest(t, controller.GenerateImage, `{"entity_type":"card","entity_id":"11111111-1111-4111-8111-111111111111","prompt":"SECRET prompt","entity_data":{"name":"SECRET name"}}`, context.Background())
	if response.Code != http.StatusOK || len(storage.deleted) != 0 || len(db.updates) != 1 {
		t.Fatalf("metadata failure undid confirmed entity save: %s", response.Body)
	}
	if strings.Contains(logs.String(), "SECRET") || strings.Contains(logs.String(), "https://") || strings.Contains(logs.String(), "base64") {
		t.Fatalf("generation data leaked: %s", logs.String())
	}
	if !strings.Contains(logs.String(), "image_metadata_not_recorded") || !strings.Contains(logs.String(), "model=gpt-image-1") {
		t.Fatalf("missing safe diagnostics: %s", logs.String())
	}
}
