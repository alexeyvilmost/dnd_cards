package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestCardCreateValidationNamesInvalidFieldAndRange(t *testing.T) {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/cards", bytes.NewBufferString(`{
		"name":"Слишком дорогой предмет",
		"description":"Проверка сообщения",
		"rarity":"artifact",
		"price":1000000.01
	}`))
	context.Request.Header.Set("Content-Type", "application/json")

	NewCardController(nil).CreateCard(context)

	if recorder.Code != 422 {
		t.Fatalf("status = %d, want 422: %s", recorder.Code, recorder.Body.String())
	}
	var body entityCreateErrorBody
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Code != "invalid_price" || body.Field != "price" {
		t.Fatalf("unexpected response: %+v", body)
	}
	if !strings.Contains(body.Error, "1 000 000") {
		t.Fatalf("price range is missing: %q", body.Error)
	}
}

func TestEntityCreateDatabaseErrorExplainsCardPriceConstraint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(requestIDContextKey, "request-card-price")

	writeEntityCreateDatabaseError(context, "карточку", &pgconn.PgError{
		Code:           "23514",
		ConstraintName: "cards_price_check",
	})

	if recorder.Code != 422 {
		t.Fatalf("status = %d, want 422", recorder.Code)
	}
	var body entityCreateErrorBody
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Code != "constraint_violation" || body.Field != "price" || body.RequestID != "request-card-price" {
		t.Fatalf("unexpected response: %+v", body)
	}
	if body.Error != "Не удалось создать карточку: цена должна быть больше 0 и не превышать 1 000 000." {
		t.Fatalf("unexpected message: %q", body.Error)
	}
}

func TestEntityCreateDatabaseErrorDoesNotExposePostgresDetails(t *testing.T) {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)

	writeEntityCreateDatabaseError(context, "ресурс", &pgconn.PgError{
		Code:           "23505",
		ConstraintName: "resources_resource_id_key",
		Detail:         "secret database detail",
	})

	if recorder.Code != 409 {
		t.Fatalf("status = %d, want 409", recorder.Code)
	}
	if body := recorder.Body.String(); body == "" || strings.Contains(body, "secret database detail") {
		t.Fatalf("database detail leaked: %s", body)
	}
}

func TestEntityUpdateDatabaseErrorsAreActionableAndSafe(t *testing.T) {
	tests := []struct {
		name, entity string
		pg           *pgconn.PgError
		status       int
		code, field  string
	}{
		{"spell lock", "заклинание", &pgconn.PgError{Code: "23514", Message: "certified content mechanics lock cannot be removed", Detail: "secret"}, 423, "content_mechanics_locked", "mechanics"},
		{"card duplicate", "карточку", &pgconn.PgError{Code: "23505", ConstraintName: "cards_card_number_key", Detail: "secret"}, 409, "already_exists", "card_number"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Set(requestIDContextKey, "trace-123")
			writeEntityUpdateDatabaseError(context, tc.entity, tc.pg)
			if recorder.Code != tc.status {
				t.Fatalf("status = %d, want %d", recorder.Code, tc.status)
			}
			var body entityCreateErrorBody
			if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Code != tc.code || body.Field != tc.field || body.RequestID != "trace-123" || body.Error == "" || strings.Contains(recorder.Body.String(), "secret") {
				t.Fatalf("unexpected response: %+v", body)
			}
		})
	}
}

func TestEntityUpdateBindingErrorNamesRequest(t *testing.T) {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(requestIDContextKey, "trace-invalid-json")
	writeEntityUpdateBindingError(context, "эффект", errors.New("invalid request"))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
	var body entityCreateErrorBody
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Code != "invalid_payload" || body.RequestID != "trace-invalid-json" || !strings.Contains(body.Error, "обновить эффект") {
		t.Fatalf("unexpected response: %+v", body)
	}
}
