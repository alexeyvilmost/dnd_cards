package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"unicode"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5/pgconn"
)

type entityCreateErrorBody struct {
	Error     string `json:"error"`
	Code      string `json:"code"`
	Field     string `json:"field,omitempty"`
	RequestID string `json:"request_id,omitempty"`
}

func jsonFieldName(goField string) string {
	var result strings.Builder
	for index, char := range goField {
		if unicode.IsUpper(char) {
			if index > 0 {
				result.WriteByte('_')
			}
			result.WriteRune(unicode.ToLower(char))
			continue
		}
		result.WriteRune(char)
	}
	return result.String()
}

func writeEntityCreateBindingError(c *gin.Context, entityName string, err error) {
	writeEntityBindingError(c, "создать", entityName, err)
}

func writeEntityUpdateBindingError(c *gin.Context, entityName string, err error) {
	writeEntityBindingError(c, "обновить", entityName, err)
}

func writeEntityBindingError(c *gin.Context, operation, entityName string, err error) {
	body := entityCreateErrorBody{Code: "invalid_payload", RequestID: c.GetString(requestIDContextKey)}
	switch {
	case errors.Is(err, io.EOF):
		body.Error = fmt.Sprintf("Не удалось %s %s: тело запроса пустое.", operation, entityName)
	default:
		var validationErrors validator.ValidationErrors
		var typeError *json.UnmarshalTypeError
		var syntaxError *json.SyntaxError
		switch {
		case errors.As(err, &validationErrors) && len(validationErrors) > 0:
			body.Field = jsonFieldName(validationErrors[0].Field())
			if validationErrors[0].Tag() == "required" {
				body.Error = fmt.Sprintf("Не удалось %s %s: обязательное поле «%s» не заполнено.", operation, entityName, body.Field)
			} else {
				body.Error = fmt.Sprintf("Не удалось %s %s: поле «%s» не прошло проверку %s.", operation, entityName, body.Field, validationErrors[0].Tag())
			}
		case errors.As(err, &typeError):
			body.Field = typeError.Field
			body.Error = fmt.Sprintf("Не удалось %s %s: поле «%s» имеет неверный тип.", operation, entityName, typeError.Field)
		case errors.As(err, &syntaxError):
			body.Error = fmt.Sprintf("Не удалось %s %s: JSON содержит синтаксическую ошибку около позиции %d.", operation, entityName, syntaxError.Offset)
		case strings.HasPrefix(err.Error(), `json: unknown field "`):
			body.Field = strings.TrimSuffix(strings.TrimPrefix(err.Error(), `json: unknown field "`), `"`)
			body.Error = fmt.Sprintf("Не удалось %s %s: поле «%s» не поддерживается в этом конструкторе.", operation, entityName, body.Field)
		default:
			body.Error = fmt.Sprintf("Не удалось %s %s: проверьте заполнение полей формы.", operation, entityName)
		}
	}
	c.JSON(http.StatusBadRequest, body)
}

func writeEntityCreateValidationError(c *gin.Context, message, code, field string) {
	c.JSON(http.StatusUnprocessableEntity, entityCreateErrorBody{
		Error:     message,
		Code:      code,
		Field:     field,
		RequestID: c.GetString(requestIDContextKey),
	})
}

func createFieldLabel(column string) string {
	labels := map[string]string{
		"card_number": "ID", "slug": "slug", "resource_id": "ID ресурса",
		"variable_id": "ID переменной", "concept_id": "ID понятия",
		"price": "цена", "name": "название", "description": "описание",
	}
	if label := labels[column]; label != "" {
		return label
	}
	return column
}

func uniqueFieldFromConstraint(constraint string) string {
	for _, field := range []string{"card_number", "resource_id", "variable_id", "concept_id", "slug", "name"} {
		if strings.Contains(constraint, field) {
			return field
		}
	}
	return ""
}

// writeEntityCreateDatabaseError converts database diagnostics into stable,
// actionable API errors. Full PostgreSQL details stay in server logs and are
// correlated through request_id instead of being exposed to the browser.
func writeEntityCreateDatabaseError(c *gin.Context, entityName string, err error) {
	writeEntityDatabaseError(c, "создать", "create_failed", entityName, err)
}

// Update failures use the same public error contract as creation. PostgreSQL
// diagnostics are logged with request_id but never returned to the client.
func writeEntityUpdateDatabaseError(c *gin.Context, entityName string, err error) {
	writeEntityDatabaseError(c, "обновить", "update_failed", entityName, err)
}

func writeEntityDatabaseError(c *gin.Context, operation, fallbackCode, entityName string, err error) {
	requestID := c.GetString(requestIDContextKey)
	log.Printf("%s %s failed request_id=%q: %v", operation, entityName, requestID, err)

	body := entityCreateErrorBody{
		Error:     fmt.Sprintf("Не удалось %s %s из-за внутренней ошибки. Повторите попытку. Если ошибка повторится, сообщите код запроса в поддержку.", operation, entityName),
		Code:      fallbackCode,
		RequestID: requestID,
	}
	status := http.StatusInternalServerError

	var pgError *pgconn.PgError
	if errors.As(err, &pgError) {
		switch pgError.Code {
		case "23505":
			status = http.StatusConflict
			body.Code = "already_exists"
			body.Field = uniqueFieldFromConstraint(pgError.ConstraintName)
			if body.Field == "" {
				body.Error = fmt.Sprintf("Не удалось %s %s: такая запись уже существует.", operation, entityName)
			} else {
				body.Error = fmt.Sprintf("Не удалось %s %s: значение поля «%s» уже используется.", operation, entityName, createFieldLabel(body.Field))
			}
		case "23514":
			status = http.StatusUnprocessableEntity
			body.Code = "constraint_violation"
			if strings.Contains(pgError.Message, "certified content mechanics") {
				status = http.StatusLocked
				body.Code = "content_mechanics_locked"
				body.Field = "mechanics"
				body.Error = "Механика закреплённой сущности недоступна для изменения. Проверьте поля механики и повторите попытку."
			} else if pgError.ConstraintName == "cards_price_check" {
				body.Field = "price"
				body.Error = fmt.Sprintf("Не удалось %s карточку: цена должна быть больше 0 и не превышать 1 000 000.", operation)
			} else {
				body.Error = fmt.Sprintf("Не удалось %s %s: одно из значений находится вне допустимого диапазона.", operation, entityName)
			}
		case "23502":
			status = http.StatusUnprocessableEntity
			body.Code = "required_field"
			body.Field = pgError.ColumnName
			body.Error = fmt.Sprintf("Не удалось %s %s: обязательное поле «%s» не заполнено.", operation, entityName, createFieldLabel(pgError.ColumnName))
		case "23503":
			status = http.StatusUnprocessableEntity
			body.Code = "missing_reference"
			body.Field = pgError.ColumnName
			body.Error = fmt.Sprintf("Не удалось %s %s: одна из связанных сущностей не найдена.", operation, entityName)
		case "22001":
			status = http.StatusUnprocessableEntity
			body.Code = "value_too_long"
			body.Field = pgError.ColumnName
			body.Error = fmt.Sprintf("Не удалось %s %s: значение одного из полей слишком длинное.", operation, entityName)
		case "22003":
			status = http.StatusUnprocessableEntity
			body.Code = "number_out_of_range"
			body.Field = pgError.ColumnName
			body.Error = fmt.Sprintf("Не удалось %s %s: числовое значение находится вне допустимого диапазона.", operation, entityName)
		}
	}

	c.JSON(status, body)
}
