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
	body := entityCreateErrorBody{Code: "invalid_payload"}
	switch {
	case errors.Is(err, io.EOF):
		body.Error = fmt.Sprintf("Не удалось создать %s: тело запроса пустое.", entityName)
	default:
		var validationErrors validator.ValidationErrors
		var typeError *json.UnmarshalTypeError
		var syntaxError *json.SyntaxError
		switch {
		case errors.As(err, &validationErrors) && len(validationErrors) > 0:
			body.Field = jsonFieldName(validationErrors[0].Field())
			if validationErrors[0].Tag() == "required" {
				body.Error = fmt.Sprintf("Не удалось создать %s: обязательное поле «%s» не заполнено.", entityName, body.Field)
			} else {
				body.Error = fmt.Sprintf("Не удалось создать %s: поле «%s» не прошло проверку %s.", entityName, body.Field, validationErrors[0].Tag())
			}
		case errors.As(err, &typeError):
			body.Field = typeError.Field
			body.Error = fmt.Sprintf("Не удалось создать %s: поле «%s» имеет неверный тип.", entityName, typeError.Field)
		case errors.As(err, &syntaxError):
			body.Error = fmt.Sprintf("Не удалось создать %s: JSON содержит синтаксическую ошибку около позиции %d.", entityName, syntaxError.Offset)
		default:
			body.Error = fmt.Sprintf("Не удалось создать %s: проверьте заполнение полей формы.", entityName)
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
	requestID := c.GetString(requestIDContextKey)
	log.Printf("create %s failed request_id=%q: %v", entityName, requestID, err)

	body := entityCreateErrorBody{
		Error:     fmt.Sprintf("Не удалось создать %s из-за внутренней ошибки. Повторите попытку.", entityName),
		Code:      "create_failed",
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
				body.Error = fmt.Sprintf("Не удалось создать %s: такая запись уже существует.", entityName)
			} else {
				body.Error = fmt.Sprintf("Не удалось создать %s: значение поля «%s» уже используется.", entityName, createFieldLabel(body.Field))
			}
		case "23514":
			status = http.StatusUnprocessableEntity
			body.Code = "constraint_violation"
			if pgError.ConstraintName == "cards_price_check" {
				body.Field = "price"
				body.Error = "Не удалось создать карточку: цена должна быть больше 0 и не превышать 1 000 000."
			} else {
				body.Error = fmt.Sprintf("Не удалось создать %s: одно из значений находится вне допустимого диапазона.", entityName)
			}
		case "23502":
			status = http.StatusUnprocessableEntity
			body.Code = "required_field"
			body.Field = pgError.ColumnName
			body.Error = fmt.Sprintf("Не удалось создать %s: обязательное поле «%s» не заполнено.", entityName, createFieldLabel(pgError.ColumnName))
		case "23503":
			status = http.StatusUnprocessableEntity
			body.Code = "missing_reference"
			body.Field = pgError.ColumnName
			body.Error = fmt.Sprintf("Не удалось создать %s: одна из связанных сущностей не найдена.", entityName)
		case "22001":
			status = http.StatusUnprocessableEntity
			body.Code = "value_too_long"
			body.Field = pgError.ColumnName
			body.Error = fmt.Sprintf("Не удалось создать %s: значение одного из полей слишком длинное.", entityName)
		case "22003":
			status = http.StatusUnprocessableEntity
			body.Code = "number_out_of_range"
			body.Field = pgError.ColumnName
			body.Error = fmt.Sprintf("Не удалось создать %s: числовое значение находится вне допустимого диапазона.", entityName)
		}
	}

	c.JSON(status, body)
}
