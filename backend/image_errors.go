package main

import (
	"context"
	"errors"
	"log"
	"mime"
	"net"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	openai "github.com/sashabaranov/go-openai"
)

// ImageGenerationError is the public diagnostic contract. Provider messages,
// response bodies, URLs and request prompts are deliberately not part of it.
type ImageGenerationError struct {
	Code                string `json:"code"`
	Message             string `json:"error"`
	Source              string `json:"source"`
	Outcome             string `json:"outcome"`
	ProviderStatus      int    `json:"provider_status,omitempty"`
	ProviderCode        string `json:"provider_code,omitempty"`
	ProviderType        string `json:"provider_type,omitempty"`
	ProviderRequestID   string `json:"provider_request_id,omitempty"`
	ProviderContentType string `json:"provider_content_type,omitempty"`
	RequestID           string `json:"request_id,omitempty"`
	Status              int    `json:"-"`
	cause               error
}

func (e *ImageGenerationError) Error() string { return e.Code + ": " + e.Message }
func (e *ImageGenerationError) Unwrap() error { return e.cause }

type imageProviderMetadataKey struct{}
type imageProviderMetadata struct {
	status      int
	requestID   string
	contentType string
}

// Each call owns its metadata through context; concurrent generations never
// overwrite another request's diagnostic headers. The response body is untouched.
type imageProviderTransport struct{ base http.RoundTripper }

func (t imageProviderTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	response, err := t.base.RoundTrip(request)
	if metadata, ok := request.Context().Value(imageProviderMetadataKey{}).(*imageProviderMetadata); ok && response != nil {
		metadata.status = response.StatusCode
		if id := response.Header.Get("X-Request-ID"); validRequestID(id) {
			metadata.requestID = id
		}
		contentType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
		switch contentType {
		case "application/json", "text/html", "text/plain":
			metadata.contentType = contentType
		default:
			metadata.contentType = "other"
		}
	}
	return response, err
}

func classifyImageProviderError(err error, metadata imageProviderMetadata) *ImageGenerationError {
	var known *ImageGenerationError
	if errors.As(err, &known) {
		return known
	}
	result := &ImageGenerationError{
		Code: "image_provider_error", Message: "Не удалось получить изображение от сервиса генерации.",
		Source: "provider", Outcome: "unknown", Status: http.StatusBadGateway,
		ProviderStatus: metadata.status, ProviderRequestID: metadata.requestID,
		ProviderContentType: metadata.contentType, cause: err,
	}
	if errors.Is(err, context.Canceled) {
		result.Code, result.Message, result.Source, result.Status = "image_cancelled", "Запрос генерации отменён. Результат у провайдера может быть неизвестен.", "network", 499
		return result
	}
	if errors.Is(err, context.DeadlineExceeded) {
		result.Code, result.Message, result.Source, result.Status = "image_timeout", "Время ожидания генерации истекло. Не запускайте повтор, пока не проверен результат.", "network", http.StatusGatewayTimeout
		return result
	}
	var apiError *openai.APIError
	var requestError *openai.RequestError
	var providerCode, providerType, providerMessage string
	if errors.As(err, &apiError) {
		result.ProviderStatus = apiError.HTTPStatusCode
		providerCode, _ = apiError.Code.(string)
		providerType, providerMessage = apiError.Type, strings.ToLower(apiError.Message)
	} else if errors.As(err, &requestError) {
		result.ProviderStatus = requestError.HTTPStatusCode
	}
	// Only documented diagnostic codes are public. An arbitrary echoed body or
	// provider string must not become a log field or a browser error message.
	switch providerCode {
	case "unsupported_country_region_territory", "model_not_found", "permission_denied", "organization_verification_required", "invalid_api_key", "insufficient_quota", "rate_limit_exceeded", "credit_balance_exhausted", "project_spend_limit_exceeded", "organization_spend_limit_exceeded":
		result.ProviderCode = providerCode
	}
	switch providerType {
	case "request_forbidden", "invalid_request_error", "authentication_error", "permission_error", "rate_limit_error", "insufficient_quota", "server_error":
		result.ProviderType = providerType
	}
	if result.ProviderStatus >= 400 && result.ProviderStatus < 500 {
		result.Outcome = "rejected"
	}
	switch {
	case providerCode == "unsupported_country_region_territory":
		result.Code, result.Message = "image_region_unavailable", "OpenAI отклонил запрос из-за региональной доступности. Требуется проверить поддерживаемое размещение и доступ аккаунта."
	case result.ProviderStatus == http.StatusUnauthorized:
		result.Code, result.Message = "image_provider_authentication", "Сервис генерации отклонил учётные данные. Администратору нужно проверить проект и ключ API."
	case result.ProviderStatus == http.StatusForbidden && (providerCode == "permission_denied" || providerCode == "organization_verification_required" || strings.Contains(providerMessage, "verif") || strings.Contains(providerMessage, "access") || strings.Contains(providerMessage, "permission")):
		result.Code, result.Message = "image_provider_permission", "Нет доступа к модели генерации. Администратору нужно проверить права проекта и проверку организации."
	case result.ProviderStatus == http.StatusForbidden:
		result.Code, result.Message = "image_provider_forbidden", "Сервис генерации вернул отказ 403. Причина требует проверки; один статус не доказывает региональную блокировку."
	case result.ProviderStatus == http.StatusTooManyRequests:
		result.Code, result.Message, result.Status = "image_provider_limit", "Сервис генерации сообщил об ограничении запросов или бюджета. Администратору нужно проверить лимиты.", http.StatusServiceUnavailable
	case providerCode == "model_not_found":
		result.Code, result.Message = "image_model_unavailable", "Указанная модель генерации недоступна для проекта."
	case result.ProviderStatus == http.StatusBadRequest:
		result.Code, result.Message = "image_provider_invalid_request", "Сервис генерации отклонил параметры изображения."
	case result.ProviderStatus == 0:
		result.Code, result.Message, result.Source = "image_network_error", "Не удалось получить ответ сервиса генерации. Результат запроса может быть неизвестен.", "network"
		var networkError net.Error
		if errors.As(err, &networkError) && networkError.Timeout() {
			result.Code, result.Message, result.Status = "image_timeout", "Время ожидания генерации истекло. Не запускайте повтор, пока не проверен результат.", http.StatusGatewayTimeout
		}
	}
	return result
}

func writeImageGenerationError(c *gin.Context, err error) {
	problem := *classifyImageProviderError(err, imageProviderMetadata{})
	problem.RequestID = c.GetString(requestIDContextKey)
	log.Printf("[image] request_id=%s code=%s source=%s outcome=%s provider_status=%d provider_request_id=%s provider_content_type=%s",
		problem.RequestID, problem.Code, problem.Source, problem.Outcome, problem.ProviderStatus, problem.ProviderRequestID, problem.ProviderContentType)
	c.JSON(problem.Status, problem)
}
